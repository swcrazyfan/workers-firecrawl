import type { Env } from "../index";
import { type TbsMapping, buildDomainQuery, klFrom, mapTbs } from "./params";
import {
	type ImageResult,
	type NewsResult,
	type SearchInput,
	type SearchOutcome,
	type SearchResults,
	imageResultSchema,
	newsResultSchema,
} from "./types";

const DDG_SEARCH_URL = "https://duckduckgo.com/";
const DDG_NEWS_URL = "https://duckduckgo.com/news.js";
const DDG_IMAGES_URL = "https://duckduckgo.com/i.js";
const FETCH_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 250;
const INTERPAGE_DELAY_MS = 400;
const MAX_PAGES = 3;
const NEWS_PAGE_SIZE = 30;
const IMAGES_PAGE_SIZE = 100;
// Same guard as ddg.ts: pathological vqd pages are bailed out before regexing.
const MAX_HTML_BYTES = 1_000_000;

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Firefox/133.0",
];

const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DdgVqdError extends Error {
	constructor(readonly reason: string) {
		super(`ddg-vqd: ${reason}`);
	}
}

// Per-source failure already carrying its final warning text; caught by the
// pagination loop so a dead page keeps the partials and never takes down the
// other source.
class DdgSourceError extends Error {}

type SourceKind = "news" | "images";

// `p` is the per-endpoint SAFESEARCH code — never the page number; page
// offsets ride on `s` alone. Codes per the ddgs reference implementation.
const SAFESEARCH_CODES: Record<
	SourceKind,
	{ on: string; moderate: string; off: string }
> = {
	news: { on: "1", moderate: "-1", off: "-2" },
	images: { on: "1", moderate: "1", off: "-1" },
};

function safesearchParam(
	source: SourceKind,
	safe: boolean | undefined,
): string {
	const codes = SAFESEARCH_CODES[source];
	if (safe === true) return codes.on;
	if (safe === false) return codes.off;
	return codes.moderate;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function requestHeaders(
	lang: string | undefined,
	accept: string,
): Record<string, string> {
	return {
		"User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
		Accept: accept,
		"Accept-Language": lang ?? "en",
	};
}

// Same retry rule as ddg.ts: a single retry on network error or 5xx; 4xx is
// never retried (status is classified by the caller).
async function fetchResponseWithRetry(
	url: string,
	init: RequestInit,
): Promise<Response> {
	const attempt = (): Promise<Response> =>
		fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	try {
		const response = await attempt();
		if (response.status < 500) return response;
	} catch {
		// network error — fall through to the single retry
	}
	await delay(RETRY_DELAY_MS);
	return await attempt();
}

async function fetchSourceJson(
	source: SourceKind,
	url: string,
	init: RequestInit,
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetchResponseWithRetry(url, init);
	} catch {
		throw new DdgSourceError(`ddg-media ${source}: network error`);
	}
	// DDG 403s bot-flagged sessions on these endpoints — fail softly.
	if (response.status === 403) {
		throw new DdgSourceError(`ddg-media ${source}: 403 blocked`);
	}
	if (!response.ok) {
		throw new DdgSourceError(`ddg-media ${source}: HTTP ${response.status}`);
	}
	try {
		return await response.json();
	} catch {
		throw new DdgSourceError(`ddg-media ${source}: invalid response`);
	}
}

// ---------------------------------------------------------------------------
// vqd token
// ---------------------------------------------------------------------------

const VQD_QUOTED_RE = /vqd="([^"]+)"/;
const VQD_FALLBACK_RE = /vqd=([0-9-]+)&/;
const VQD_SINGLE_QUOTED_RE = /vqd='([^']+)'/;

export async function extractVqd(
	query: string,
	kl: string,
	lang?: string,
): Promise<string> {
	const params = new URLSearchParams({ q: query, kl });
	let body: string;
	try {
		const response = await fetchResponseWithRetry(
			`${DDG_SEARCH_URL}?${params.toString()}`,
			{
				method: "GET",
				headers: requestHeaders(lang, "text/html,application/xhtml+xml"),
			},
		);
		if (!response.ok) throw new DdgVqdError(`HTTP ${response.status}`);
		body = await response.text();
	} catch (error) {
		if (error instanceof DdgVqdError) throw error;
		throw new DdgVqdError("network error");
	}
	if (body.length > MAX_HTML_BYTES) throw new DdgVqdError("page too large");
	const token =
		VQD_QUOTED_RE.exec(body)?.[1] ??
		VQD_FALLBACK_RE.exec(body)?.[1] ??
		VQD_SINGLE_QUOTED_RE.exec(body)?.[1];
	if (token === undefined) throw new DdgVqdError("token not found");
	return token;
}

// ---------------------------------------------------------------------------
// Parsing / mapping
// ---------------------------------------------------------------------------

function isHttpUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

// Copied from ddg.ts (not imported): lowercase host, trailing slash
// collapsed, search kept, hash dropped.
function normalizeUrlKey(rawUrl: string): string | null {
	try {
		const parsed = new URL(rawUrl);
		const host = parsed.hostname.toLowerCase();
		let path = parsed.pathname;
		if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
		return `${host}${path}${parsed.search}`;
	} catch {
		return null;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

// i.js ships dimensions either as JSON numbers or as numeric strings.
function asInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) return value;
	if (typeof value === "string" && /^-?\d+$/.test(value)) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	return undefined;
}

function extractResults(body: unknown): unknown[] {
	if (typeof body !== "object" || body === null) return [];
	if ("results" in body && Array.isArray(body.results)) return body.results;
	return [];
}

function field(raw: object, key: string): unknown {
	return (raw as Record<string, unknown>)[key];
}

function mapNewsItem(raw: object, position: number): NewsResult | null {
	const url = asString(field(raw, "url"));
	if (url === undefined || !isHttpUrl(url)) return null;
	const title = asString(field(raw, "title"));
	if (title === undefined) return null;
	const image = asString(field(raw, "image"));
	return {
		url,
		title,
		snippet: asString(field(raw, "excerpt")) ?? "",
		date: asString(field(raw, "date")),
		imageUrl: image !== undefined && isHttpUrl(image) ? image : undefined,
		position,
	};
}

function mapImageItem(raw: object, position: number): ImageResult | null {
	const image = asString(field(raw, "image"));
	if (image === undefined || !isHttpUrl(image)) return null;
	const url = asString(field(raw, "url"));
	return {
		imageUrl: image,
		url: url !== undefined && url !== image && isHttpUrl(url) ? url : undefined,
		title: asString(field(raw, "title")),
		imageWidth: asInt(field(raw, "width")),
		imageHeight: asInt(field(raw, "height")),
		position,
	};
}

// `time:Day|Week|Month|Year` — capitalized form of mapTbs' timeRange.
function imagesTimeFilter(
	timeRange: TbsMapping["timeRange"],
): string | undefined {
	if (timeRange === undefined) return undefined;
	return `time:${timeRange.charAt(0).toUpperCase()}${timeRange.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Per-source pagination
// ---------------------------------------------------------------------------

async function paginate<T>(
	source: SourceKind,
	urlForPage: (page: number) => string,
	headers: Record<string, string>,
	limit: number,
	mapItem: (raw: object, position: number) => T | null,
	dedupeKey: (item: T) => string | null,
): Promise<{ items: T[]; warning?: string }> {
	const collected: T[] = [];
	const seen = new Set<string>();
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		if (page > 1) await delay(INTERPAGE_DELAY_MS);
		let body: unknown;
		try {
			body = await fetchSourceJson(source, urlForPage(page), {
				method: "GET",
				headers,
			});
		} catch (error) {
			// Fail soft and KEEP the partials already collected — a dead page 2
			// must never discard usable page-1 results.
			if (error instanceof DdgSourceError) {
				return { items: collected, warning: error.message };
			}
			throw error;
		}
		let added = 0;
		for (const raw of extractResults(body)) {
			if (typeof raw !== "object" || raw === null) continue;
			const item = mapItem(raw, collected.length + 1);
			if (item === null) continue;
			const key = dedupeKey(item);
			if (key !== null) {
				if (seen.has(key)) continue;
				seen.add(key);
			}
			collected.push(item);
			added += 1;
		}
		// A page that adds nothing post-dedupe means the well is dry.
		if (added === 0) break;
		if (collected.length >= limit) break;
	}
	return { items: collected };
}

// Positions are provisional until after the slice — renumbered 1..N, like
// ddg.ts does for web results. (No `position` constraint: under this repo's
// strictNullChecks:false config zod-inferred types read as fully optional.)
function finalizeResults<T>(
	items: T[],
	limit: number,
	parse: (item: T, position: number) => T | null,
): T[] {
	return items
		.flatMap((item, index) => {
			const parsed = parse(item, index + 1);
			return parsed === null ? [] : [parsed];
		})
		.slice(0, limit)
		.map((item, index) => ({ ...item, position: index + 1 }));
}

function parseNewsItem(item: NewsResult, position: number): NewsResult | null {
	const parsed = newsResultSchema.safeParse({ ...item, position });
	return parsed.success ? parsed.data : null;
}

function parseImageItem(
	item: ImageResult,
	position: number,
): ImageResult | null {
	const parsed = imageResultSchema.safeParse({ ...item, position });
	return parsed.success ? parsed.data : null;
}

async function collectNews(
	query: string,
	kl: string,
	vqd: string,
	df: string | undefined,
	safe: boolean | undefined,
	lang: string | undefined,
	limit: number,
): Promise<{ items: NewsResult[]; warning?: string }> {
	const headers = {
		...requestHeaders(lang, "application/json"),
		Referer: DDG_SEARCH_URL,
	};
	const urlForPage = (page: number) => {
		const params = new URLSearchParams({
			l: kl,
			o: "json",
			noamp: "1",
			q: query,
			vqd,
			p: safesearchParam("news", safe),
			...(df !== undefined ? { df } : {}),
			s: String((page - 1) * NEWS_PAGE_SIZE),
		});
		return `${DDG_NEWS_URL}?${params.toString()}`;
	};
	const { items, warning } = await paginate(
		"news",
		urlForPage,
		headers,
		limit,
		mapNewsItem,
		(item) => normalizeUrlKey(item.url),
	);
	return { items: finalizeResults(items, limit, parseNewsItem), warning };
}

async function collectImages(
	query: string,
	kl: string,
	vqd: string,
	timeFilter: string | undefined,
	safe: boolean | undefined,
	lang: string | undefined,
	limit: number,
): Promise<{ items: ImageResult[]; warning?: string }> {
	const headers = {
		...requestHeaders(lang, "application/json"),
		Referer: DDG_SEARCH_URL,
	};
	const urlForPage = (page: number) => {
		const params = new URLSearchParams({
			o: "json",
			q: query,
			l: kl,
			vqd,
			p: safesearchParam("images", safe),
			...(timeFilter !== undefined ? { f: timeFilter } : {}),
			s: String((page - 1) * IMAGES_PAGE_SIZE),
			ct: "AT",
		});
		return `${DDG_IMAGES_URL}?${params.toString()}`;
	};
	const { items, warning } = await paginate(
		"images",
		urlForPage,
		headers,
		limit,
		mapImageItem,
		(item) => normalizeUrlKey(item.imageUrl),
	);
	return { items: finalizeResults(items, limit, parseImageItem), warning };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type SourceOutcome =
	| { kind: "news"; items: NewsResult[]; warning?: string }
	| { kind: "images"; items: ImageResult[]; warning?: string };

async function runNews(
	task: () => Promise<{ items: NewsResult[]; warning?: string }>,
): Promise<SourceOutcome> {
	const { items, warning } = await task();
	return { kind: "news", items, warning };
}

async function runImages(
	task: () => Promise<{ items: ImageResult[]; warning?: string }>,
): Promise<SourceOutcome> {
	const { items, warning } = await task();
	return { kind: "images", items, warning };
}

export async function ddgMediaSearch(
	input: SearchInput,
	env: Env,
): Promise<SearchOutcome> {
	const warnings: string[] = [];
	const mapped = mapTbs(input.tbs);
	warnings.push(...mapped.warnings);
	const query = buildDomainQuery(input.query, {
		includeDomains: input.includeDomains,
		excludeDomains: input.excludeDomains,
	});
	const kl = klFrom({
		country: input.country,
		lang: input.lang,
		location: input.location,
	});

	const wantsNews = input.sources.includes("news");
	const wantsImages = input.sources.includes("images");
	if (!wantsNews && !wantsImages) return { results: {}, warnings };

	// One shared vqd scrape for both sources; failure poisons every requested
	// source but never throws — the provider chain decides the messaging.
	let vqd: string;
	try {
		vqd = await extractVqd(query, kl, input.lang);
	} catch (error) {
		if (!(error instanceof DdgVqdError)) throw error;
		if (wantsNews) warnings.push(`ddg-media: ${error.reason}`);
		if (wantsImages) warnings.push(`ddg-media: ${error.reason}`);
		return { results: {}, warnings };
	}

	const jobs: Array<Promise<SourceOutcome>> = [];
	// DDG intermittently 403s these endpoints per egress IP (verified in
	// production). The block is often tied to the vqd session — one retry
	// with a freshly extracted token recovers a meaningful share of hits.
	const retryOn403 = async (
		run: (token: string) => Promise<SourceOutcome>,
	): Promise<SourceOutcome> => {
		const first = await run(vqd);
		if (!first.warning?.includes("403")) return first;
		try {
			const fresh = await extractVqd(query, kl, input.lang);
			const second = await run(fresh);
			if (second.items.length > 0 || !second.warning?.includes("403")) {
				return second;
			}
		} catch {
			// retry itself failed — surface the original outcome
		}
		return first;
	};
	if (wantsNews) {
		jobs.push(
			retryOn403((token) =>
				runNews(() =>
					collectNews(
						query,
						kl,
						token,
						mapped.df,
						input.safe,
						input.lang,
						input.limit,
					),
				),
			),
		);
	}
	if (wantsImages) {
		jobs.push(
			retryOn403((token) =>
				runImages(() =>
					collectImages(
						query,
						kl,
						token,
						imagesTimeFilter(mapped.timeRange),
						input.safe,
						input.lang,
						input.limit,
					),
				),
			),
		);
	}

	const results: SearchResults = {};
	for (const entry of await Promise.allSettled(jobs)) {
		// HTTP-level failures were already converted to warnings inside each
		// source; only unexpected programming errors propagate.
		if (entry.status === "rejected") throw entry.reason;
		const { kind, items, warning } = entry.value;
		if (warning !== undefined) warnings.push(warning);
		if (items.length === 0) continue;
		if (kind === "news") results.news = items;
		else results.images = items;
	}

	if (results.news === undefined && results.images === undefined) {
		warnings.push("ddg-media: no results");
	}
	return { results, warnings };
}
