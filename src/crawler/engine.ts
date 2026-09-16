/**
 * Testable crawl engine.
 *
 * Every piece of crawl behaviour lives here as a plain function so it can be
 * unit tested against the real local D1 binding. `workflow.ts` is only a thin
 * adapter that sequences `step.do` / `step.sleep` around these calls.
 */

import { extractStructured } from "../ai/extract";
import type { Env } from "../index";
import { normalizeFormats } from "../v2/scrape";
import {
	CRAWL_USER_AGENT,
	type RobotsRules,
	fetchRobots,
	isPathAllowed,
} from "./robots";
import { fetchSitemapUrls } from "./sitemap";
import {
	type CrawlStatus,
	ROBOTS_DISALLOWED,
	bumpJobCounters,
	claimNextBatch,
	enqueueUrls,
	getJob,
	insertResult,
	listResults,
	markQueueItem,
	resetQueueItems,
	setJobStatus,
} from "./store";

export interface CrawlOptions {
	limit: number;
	maxDiscoveryDepth: number;
	allowExternalLinks: boolean;
	allowSubdomains: boolean;
	includePaths?: string[];
	excludePaths?: string[];
	ignoreRobotsTxt: boolean;
	sitemap: "skip" | "include" | "only";
	scrapeFormats: string[];
	jsonFormat?: { schema?: unknown; prompt?: string } | null;
	// Optional robots UA override (persisted `robotsUserAgent`).
	robotsUserAgent?: string;
	// Set when the request asked for `summary`; crawl does not implement it, so
	// every result carries an explanatory metadata warning instead.
	summaryRequested?: boolean;
}

export interface StoredWebhook {
	url: string;
	headers?: Record<string, string>;
	metadata?: Record<string, unknown>;
	events?: string[];
}

export interface StoredCrawlOptions extends CrawlOptions {
	webhook?: StoredWebhook | null;
}

export type WebhookType = "crawl.completed" | "crawl.failed";

export interface TerminalPayload {
	type: WebhookType;
	id: string;
	status: string;
	total: number;
	completed: number;
	data: Array<Record<string, unknown>>;
	metadata?: Record<string, unknown>;
}

export interface CrawlBatch {
	id: number;
	url: string;
	depth: number;
}

export interface CrawlBatchResult {
	completed: number;
	failed: number;
	discovered: number;
	// Longest `Crawl-delay` seen in this batch's robots rules (seconds), so the
	// Workflow can pace itself politely.
	crawlDelaySec?: number;
}

export interface CrawlRunResult extends CrawlBatchResult {
	empty: boolean;
	terminal: boolean;
}

// Imported lazily inside `processCrawlBatch`: exporting `CrawlWorkflow` from
// `src/index.ts` must not eagerly pull puppeteer/node-html-markdown into the
// module graph of every route (and, in tests, of every suite that imports the
// app).
type BrowserModule = typeof import("../browser");
type BrowserHandle = Awaited<ReturnType<BrowserModule["getBrowser"]>>;
type ExtractResult = Awaited<ReturnType<BrowserModule["extractContent"]>>;

const DEFAULT_LIMIT = 10000;
const DEFAULT_MAX_DISCOVERY_DEPTH = 10;
const SCRAPE_TIMEOUT_MS = 60000;
const TERMINAL_PAGE_SIZE = 50;
// Sitemap fetch bounds. Worst case is `SITEMAP_MAX_FILES * SITEMAP_TIMEOUT_MS`
// plus one robots discovery fetch: 20 * 5s + 5s = 105s, comfortably inside the
// initialize step's 10 minute timeout even if every file times out.
const SITEMAP_MAX_FILES = 20;
const SITEMAP_TIMEOUT_MS = 5000;

const SUMMARY_UNSUPPORTED =
	"summary format is not supported by crawl and was ignored";

const ASSET_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"ico",
	"css",
	"js",
	"woff",
	"woff2",
	"ttf",
	"eot",
	"mp4",
	"mp3",
	"zip",
	"gz",
	"rar",
	"7z",
	"exe",
	"dmg",
]);

const NON_HTTP_SCHEME = /^(mailto|tel|javascript|data|sms|ftp):/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUrl(url: string): string {
	try {
		return new URL(url).toString();
	} catch {
		return url;
	}
}

function isInternalHost(
	baseHost: string,
	host: string,
	allowSubdomains: boolean,
): boolean {
	if (baseHost === host) return true;
	if (!allowSubdomains) return false;
	return host.endsWith(`.${baseHost}`);
}

function hasAssetExtension(pathname: string): boolean {
	const dot = pathname.lastIndexOf(".");
	if (dot === -1) return false;
	return ASSET_EXTENSIONS.has(pathname.slice(dot + 1).toLowerCase());
}

function globToRegExp(glob: string): RegExp {
	const source = glob
		.replace(/[.+^${}()|[\]\\?]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${source}$`);
}

function matchesGlob(glob: string, pathname: string): boolean {
	try {
		return globToRegExp(glob).test(pathname);
	} catch {
		return false;
	}
}

function passesPathFilters(url: URL, opts: CrawlOptions): boolean {
	const include = opts.includePaths ?? [];
	if (
		include.length > 0 &&
		!include.some((p) => matchesGlob(p, url.pathname))
	) {
		return false;
	}
	const exclude = opts.excludePaths ?? [];
	if (exclude.length > 0 && exclude.some((p) => matchesGlob(p, url.pathname))) {
		return false;
	}
	return true;
}

// The returned depth is the depth assigned to every kept candidate, so callers
// pass `parentDepth + 1` and sitemap seeding passes 0.
export function filterDiscoveredLinks(
	baseUrl: string,
	candidates: string[],
	seen: Set<string>,
	depth: number,
	opts: CrawlOptions,
): { url: string; depth: number }[] {
	if (depth > opts.maxDiscoveryDepth) return [];

	let base: URL;
	try {
		base = new URL(baseUrl);
	} catch {
		return [];
	}

	const results: { url: string; depth: number }[] = [];
	const localSeen = new Set<string>();

	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const raw = candidate.trim();
		if (raw === "" || raw.startsWith("#")) continue;
		if (NON_HTTP_SCHEME.test(raw)) continue;

		let resolved: URL;
		try {
			resolved = new URL(raw, base);
		} catch {
			continue;
		}
		if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
			continue;
		}
		// Fragments never change the fetched document; drop them so in-page
		// anchors collapse onto the page they point at.
		resolved.hash = "";
		const url = resolved.toString();

		if (seen.has(url) || localSeen.has(url)) continue;
		if (
			!opts.allowExternalLinks &&
			!isInternalHost(base.hostname, resolved.hostname, opts.allowSubdomains)
		) {
			continue;
		}
		if (hasAssetExtension(resolved.pathname)) continue;
		if (!passesPathFilters(resolved, opts)) continue;

		localSeen.add(url);
		results.push({ url, depth });
	}

	return results;
}

function ensureLinks(formats: string[]): string[] {
	return formats.includes("links") ? formats : [...formats, "links"];
}

function crawlUserAgent(opts: CrawlOptions): string {
	const override = opts.robotsUserAgent?.trim();
	return override && override !== "" ? override : CRAWL_USER_AGENT;
}

// Robots rules are fetched at most once per origin per batch. The cache is
// created per `processCrawlBatch` call, so concurrent batches on the same
// isolate cannot clobber each other.
async function robotsForOrigin(
	url: string,
	cache: Map<string, RobotsRules | null>,
	userAgent: string,
): Promise<RobotsRules | null> {
	let origin: string;
	try {
		origin = new URL(url).origin;
	} catch {
		return null;
	}
	if (cache.has(origin)) return cache.get(origin) ?? null;
	const rules = await fetchRobots(url, userAgent);
	cache.set(origin, rules);
	return rules;
}

function requestPath(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
}

export function isTerminal(status: string): boolean {
	return (
		status === "completed" || status === "failed" || status === "cancelled"
	);
}

// Single source of truth for the terminal status: an explicit cancel/failure
// wins, an all-failed run is `failed`, anything else is `completed`.
export function decideTerminalStatus(
	attempted: number,
	succeeded: number,
	currentStatus: string,
): CrawlStatus {
	if (currentStatus === "cancelled" || currentStatus === "failed") {
		return currentStatus;
	}
	if (attempted > 0 && succeeded === 0) return "failed";
	return "completed";
}

function toPositiveInt(value: unknown, fallback: number): number {
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.trunc(parsed);
}

function toNonNegativeInt(value: unknown, fallback: number): number {
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return Math.trunc(parsed);
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function parseWebhook(value: unknown): StoredWebhook | null {
	if (!isRecord(value)) return null;
	const url = typeof value.url === "string" ? value.url : "";
	if (url === "") return null;

	const webhook: StoredWebhook = { url };
	if (isRecord(value.headers)) {
		const headers: Record<string, string> = {};
		for (const [key, header] of Object.entries(value.headers)) {
			if (typeof header === "string") headers[key] = header;
		}
		webhook.headers = headers;
	}
	if (isRecord(value.metadata)) webhook.metadata = value.metadata;
	if (Array.isArray(value.events)) {
		webhook.events = value.events.filter(
			(event): event is string => typeof event === "string",
		);
	}
	return webhook;
}

// Translates the persisted request options into concrete engine options,
// reusing the v2 scrape format normalizer so crawl and scrape never drift.
export function parseCrawlOptions(raw: unknown): StoredCrawlOptions {
	const source = isRecord(raw) ? raw : {};
	const scrapeOptions = isRecord(source.scrapeOptions)
		? source.scrapeOptions
		: {};
	const rawFormats = Array.isArray(scrapeOptions.formats)
		? scrapeOptions.formats
		: ["markdown"];

	let scrapeFormats: string[] = [];
	let jsonFormat: { schema?: unknown; prompt?: string } | null = null;
	let summaryRequested = false;
	try {
		const normalized = normalizeFormats(rawFormats);
		summaryRequested = normalized.wantsSummary;
		scrapeFormats = normalized.strings
			.filter((format) => format !== "summary")
			.map((format) =>
				format === "screenshot" && normalized.screenshotFullPage
					? "screenshot@fullPage"
					: format,
			);
		if (
			(normalized.wantsJson !== null || normalized.wantsSummary) &&
			!scrapeFormats.includes("markdown")
		) {
			scrapeFormats.push("markdown");
		}
		jsonFormat = normalized.wantsJson;
	} catch {
		scrapeFormats = ["markdown"];
	}

	const sitemap =
		source.sitemap === "skip" || source.sitemap === "only"
			? source.sitemap
			: "include";

	const robotsUserAgent =
		typeof source.robotsUserAgent === "string" && source.robotsUserAgent !== ""
			? source.robotsUserAgent
			: undefined;

	return {
		limit: toPositiveInt(source.limit, DEFAULT_LIMIT),
		maxDiscoveryDepth: toNonNegativeInt(
			source.maxDiscoveryDepth,
			DEFAULT_MAX_DISCOVERY_DEPTH,
		),
		allowExternalLinks: source.allowExternalLinks === true,
		allowSubdomains: source.allowSubdomains === true,
		includePaths: toStringArray(source.includePaths),
		excludePaths: toStringArray(source.excludePaths),
		ignoreRobotsTxt: source.ignoreRobotsTxt === true,
		sitemap,
		scrapeFormats,
		jsonFormat,
		robotsUserAgent,
		summaryRequested,
		webhook: parseWebhook(source.webhook),
	};
}

// `store.getJob` intentionally omits the options column, so the engine reads it
// here (only ever for the job row the workflow already validated).
export async function loadCrawlOptions(
	env: Env,
	jobId: string,
): Promise<StoredCrawlOptions | null> {
	const row = await env.DB.prepare(
		"SELECT options FROM crawl_jobs WHERE id = ?",
	)
		.bind(jobId)
		.first<{ options: string | null }>();
	if (!row) return null;

	let parsed: unknown = null;
	if (typeof row.options === "string") {
		try {
			parsed = JSON.parse(row.options);
		} catch {
			parsed = null;
		}
	}
	return parseCrawlOptions(parsed);
}

export async function initializeCrawl(
	env: Env,
	jobId: string,
	jobUrl: string,
	opts: CrawlOptions,
): Promise<{ seeded: number }> {
	const now = Date.now();
	const userAgent = crawlUserAgent(opts);

	let rules: RobotsRules | null = null;
	if (!opts.ignoreRobotsTxt) {
		rules = await fetchRobots(jobUrl, userAgent);
	}

	let seeded = 0;

	// The seed is enqueued first so it holds the lowest id and is claimed first.
	// `sitemap:"only"` never enqueues (or crawls) the seed: only sitemap URLs.
	// `crawl.ts` already enqueues/bumps the seed at creation, so this re-enqueue
	// inserts 0 rows for it and cannot double-count `total`.
	if (opts.sitemap !== "only") {
		seeded += await enqueueUrls(
			env.DB,
			jobId,
			[{ url: jobUrl, depth: 0 }],
			now,
		);
	}

	if (opts.sitemap !== "skip") {
		const sitemapUrls = await fetchSitemapUrls(jobUrl, {
			limit: opts.limit,
			maxFiles: SITEMAP_MAX_FILES,
			timeoutMs: SITEMAP_TIMEOUT_MS,
		});
		const filtered = filterDiscoveredLinks(
			jobUrl,
			sitemapUrls,
			new Set(),
			0,
			opts,
		).filter((item) => (rules ? isPathAllowed(rules, item.url) : true));
		if (filtered.length > 0) {
			seeded += await enqueueUrls(env.DB, jobId, filtered, now);
		}
	}

	if (seeded > 0) {
		await bumpJobCounters(env.DB, jobId, { total: seeded, now });
	}

	return { seeded };
}

export async function processCrawlBatch(
	env: Env,
	jobId: string,
	batch: CrawlBatch[],
	opts: CrawlOptions,
	remaining?: number,
): Promise<CrawlBatchResult> {
	const counts: CrawlBatchResult = { completed: 0, failed: 0, discovered: 0 };
	if (batch.length === 0) return counts;

	const db = env.DB;
	const first = await getJob(db, jobId);
	if (!first || isTerminal(first.status)) return counts;

	const userAgent = crawlUserAgent(opts);
	const seedUrl = normalizeUrl(first.url);
	const robotsCache = new Map<string, RobotsRules | null>();
	const seen = new Set(batch.map((item) => item.url));
	let crawlDelaySec = 0;

	let browser: BrowserHandle | undefined;
	try {
		const { getBrowser, extractContent } = await import("../browser");
		browser = await getBrowser(env);

		for (const item of batch) {
			// Enforce `limit` in-batch: stop as soon as this batch reaches the
			// remaining success budget, and suppress its discoveries.
			if (remaining !== undefined && counts.completed >= remaining) break;

			const job = await getJob(db, jobId);
			if (!job || isTerminal(job.status)) break;

			// `sitemap:"only"` must never crawl the seed, even if a row for it
			// exists (e.g. a job created before this rule landed).
			if (opts.sitemap === "only" && normalizeUrl(item.url) === seedUrl) {
				await markQueueItem(db, item.id, "done");
				continue;
			}

			if (!opts.ignoreRobotsTxt) {
				const rules = await robotsForOrigin(item.url, robotsCache, userAgent);
				if (rules?.crawlDelaySec !== undefined) {
					crawlDelaySec = Math.max(crawlDelaySec, rules.crawlDelaySec);
				}
				if (rules && !isPathAllowed(rules, requestPath(item.url))) {
					await insertResult(db, {
						jobId,
						url: item.url,
						status: "failed",
						error: ROBOTS_DISALLOWED,
						now: Date.now(),
					});
					await markQueueItem(db, item.id, "failed");
					counts.failed += 1;
					continue;
				}
			}

			let result: ExtractResult = null;
			try {
				result = await extractContent(browser, item.url, {
					formats: ensureLinks(opts.scrapeFormats),
					onlyMainContent: true,
					timeout: SCRAPE_TIMEOUT_MS,
					headers: { "User-Agent": userAgent },
				});
			} catch {
				result = null;
			}

			if (!result) {
				await markQueueItem(db, item.id, "failed");
				counts.failed += 1;
				continue;
			}

			const warnings: string[] = [];
			if (opts.summaryRequested) warnings.push(SUMMARY_UNSUPPORTED);

			let json: unknown;
			if (opts.jsonFormat) {
				try {
					const extracted = await extractStructured(
						{
							content: result.markdown ?? "",
							jsonSchema: toJsonSchema(opts.jsonFormat.schema),
							prompt: opts.jsonFormat.prompt,
						},
						env,
					);
					if (extracted.data !== undefined) json = extracted.data;
					if (extracted.warning !== undefined) {
						warnings.push(extracted.warning);
					}
				} catch (error) {
					warnings.push(`AI extraction failed: ${(error as Error).message}`);
				}
			}

			const metadata =
				warnings.length > 0
					? { ...(result.metadata ?? {}), warning: warnings.join("; ") }
					: result.metadata;

			await insertResult(db, {
				jobId,
				url: item.url,
				status: "completed",
				statusCode: result.metadata?.statusCode ?? null,
				markdown: result.markdown,
				html: result.html,
				rawHtml: result.rawHtml,
				links: result.links,
				metadata,
				json,
				now: Date.now(),
			});
			await markQueueItem(db, item.id, "done");
			counts.completed += 1;
			await bumpJobCounters(db, jobId, { completed: 1, now: Date.now() });

			// Once the budget is spent, enqueue nothing further.
			if (remaining !== undefined && counts.completed >= remaining) continue;
			if (opts.sitemap === "only" || !Array.isArray(result.links)) continue;

			const discovered = filterDiscoveredLinks(
				item.url,
				result.links,
				seen,
				item.depth + 1,
				opts,
			);
			if (discovered.length === 0) continue;
			for (const found of discovered) seen.add(found.url);
			const inserted = await enqueueUrls(db, jobId, discovered, Date.now());
			counts.discovered += discovered.length;
			if (inserted > 0) {
				await bumpJobCounters(db, jobId, { total: inserted, now: Date.now() });
			}
		}
	} finally {
		if (browser) await browser.close();
	}

	if (crawlDelaySec > 0) counts.crawlDelaySec = crawlDelaySec;
	return counts;
}

// Claims and processes one batch. Any row still `processing` when the batch
// settles (limit stop, cancellation, or a thrown error) is returned to
// `pending`, so a retried Workflow step re-claims it instead of orphaning it.
export async function runCrawlBatch(
	env: Env,
	jobId: string,
	opts: CrawlOptions,
	size: number,
): Promise<CrawlRunResult> {
	const batch = await claimNextBatch(env.DB, jobId, size);
	if (batch.length === 0) {
		return {
			empty: true,
			terminal: false,
			completed: 0,
			failed: 0,
			discovered: 0,
		};
	}

	// The budget is derived from the persisted counter, not passed in, so the
	// Workflow never has to reason about it.
	const job = await getJob(env.DB, jobId);
	const remaining = job ? Math.max(opts.limit - job.completed, 0) : opts.limit;

	const ids = batch.map((item) => item.id);
	let counts: CrawlBatchResult;
	try {
		counts = await processCrawlBatch(env, jobId, batch, opts, remaining);
	} catch (error) {
		await resetQueueItems(env.DB, ids);
		throw error;
	}
	await resetQueueItems(env.DB, ids);

	const current = await getJob(env.DB, jobId);
	return {
		empty: false,
		terminal: current ? isTerminal(current.status) : true,
		...counts,
	};
}

// Only a job still `scraping` may be finalized: an explicit cancel/failure
// already recorded must never be overwritten by a later step.
export async function finalizeCrawl(
	env: Env,
	jobId: string,
	attempted: number,
	succeeded: number,
): Promise<CrawlStatus | null> {
	const job = await getJob(env.DB, jobId);
	if (!job) return null;
	if (job.status !== "scraping") return job.status;

	const status = decideTerminalStatus(attempted, succeeded, job.status);
	await setJobStatus(env.DB, jobId, status, { completedAt: Date.now() });
	return status;
}

function toJsonSchema(schema: unknown): Record<string, unknown> | undefined {
	if (!isRecord(schema)) return undefined;
	return schema;
}

// Shapes the first page of results into the terminal webhook payload. Kept in
// the engine so the Workflow class stays free of presentation logic.
export async function buildTerminalPayload(
	env: Env,
	jobId: string,
	type: WebhookType,
	metadata?: Record<string, unknown>,
): Promise<TerminalPayload> {
	const [job, rows] = await Promise.all([
		getJob(env.DB, jobId),
		listResults(env.DB, jobId, { limit: TERMINAL_PAGE_SIZE }),
	]);

	const payload: TerminalPayload = {
		type,
		id: jobId,
		status: job?.status ?? (type === "crawl.failed" ? "failed" : "completed"),
		total: job?.total ?? 0,
		completed: job?.completed ?? 0,
		data: rows.map((row) => {
			const item: Record<string, unknown> = {
				url: row.url,
				status: row.status,
			};
			if (row.markdown !== null) item.markdown = row.markdown;
			if (row.html !== null) item.html = row.html;
			if (row.raw_html !== null) item.rawHtml = row.raw_html;
			if (row.links !== null) item.links = row.links;
			if (row.metadata !== null) item.metadata = row.metadata;
			if (row.json !== null) item.json = row.json;
			if (row.error !== null) item.error = row.error;
			return item;
		}),
	};
	// `webhook.metadata` from the request is honoured here rather than stored
	// and dropped.
	if (metadata) payload.metadata = metadata;
	return payload;
}

// Best-effort delivery: a webhook failure must never fail the crawl, so this
// swallows the error after a single log line. `events`, when present, filters
// which terminal statuses are delivered.
export async function postWebhook(
	webhook: StoredWebhook,
	payload: TerminalPayload,
): Promise<boolean> {
	if (
		webhook.events &&
		webhook.events.length > 0 &&
		!webhook.events.includes(payload.status)
	) {
		return false;
	}

	try {
		const response = await fetch(webhook.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(webhook.headers ?? {}),
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10000),
		});
		return response.ok;
	} catch (error) {
		console.error(
			`Crawl webhook delivery failed for ${payload.id}: ${(error as Error).message}`,
		);
		return false;
	}
}
