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
import { type RobotsRules, fetchRobots, isPathAllowed } from "./robots";
import { fetchSitemapUrls } from "./sitemap";
import {
	bumpJobCounters,
	enqueueUrls,
	getJob,
	insertResult,
	listResults,
	markQueueItem,
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

export interface TerminalPayload {
	type: "crawl.completed";
	id: string;
	status: string;
	total: number;
	completed: number;
	data: Array<Record<string, unknown>>;
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

// Robots rules are fetched at most once per origin per batch. The map is
// module-level so concurrent items in the same batch share it, and is reset at
// the start of every batch so a long-lived isolate never serves stale rules.
let robotsCache = new Map<string, RobotsRules | null>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
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

async function robotsForOrigin(url: string): Promise<RobotsRules | null> {
	let origin: string;
	try {
		origin = new URL(url).origin;
	} catch {
		return null;
	}
	if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
	const rules = await fetchRobots(url);
	robotsCache.set(origin, rules);
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
	try {
		const normalized = normalizeFormats(rawFormats);
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

	let rules: RobotsRules | null = null;
	if (!opts.ignoreRobotsTxt) {
		rules = await fetchRobots(jobUrl);
	}

	let seeded = 0;

	// The seed is enqueued first so it holds the lowest id and is claimed first.
	if (opts.sitemap !== "only") {
		seeded += await enqueueUrls(
			env.DB,
			jobId,
			[{ url: jobUrl, depth: 0 }],
			now,
		);
	}

	if (opts.sitemap !== "skip") {
		const sitemapUrls = await fetchSitemapUrls(jobUrl, { limit: opts.limit });
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
): Promise<CrawlBatchResult> {
	const counts: CrawlBatchResult = { completed: 0, failed: 0, discovered: 0 };
	if (batch.length === 0) return counts;

	const db = env.DB;
	const first = await getJob(db, jobId);
	if (!first || isTerminal(first.status)) return counts;

	robotsCache = new Map();
	const seen = new Set(batch.map((item) => item.url));

	let browser: BrowserHandle | undefined;
	try {
		const { getBrowser, extractContent } = await import("../browser");
		browser = await getBrowser(env);

		for (const item of batch) {
			const job = await getJob(db, jobId);
			if (!job || isTerminal(job.status)) break;

			if (!opts.ignoreRobotsTxt) {
				const rules = await robotsForOrigin(item.url);
				if (rules && !isPathAllowed(rules, requestPath(item.url))) {
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
				});
			} catch {
				result = null;
			}

			if (!result) {
				await markQueueItem(db, item.id, "failed");
				counts.failed += 1;
				continue;
			}

			let json: unknown;
			let warning: string | undefined;
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
					if (extracted.warning !== undefined) warning = extracted.warning;
				} catch (error) {
					warning = `AI extraction failed: ${(error as Error).message}`;
				}
			}

			const metadata = warning
				? { ...(result.metadata ?? {}), warning }
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

	return counts;
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
	status: string,
): Promise<TerminalPayload> {
	const [job, rows] = await Promise.all([
		getJob(env.DB, jobId),
		listResults(env.DB, jobId, { limit: TERMINAL_PAGE_SIZE }),
	]);

	return {
		type: "crawl.completed",
		id: jobId,
		status,
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
}

// Best-effort delivery: a webhook failure must never fail the crawl, so this
// swallows the error after a single log line.
export async function postWebhook(
	webhook: StoredWebhook,
	payload: TerminalPayload,
): Promise<boolean> {
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
