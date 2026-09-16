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
// source wrappers so one dead endpoint never takes down the other.
class DdgSourceError extends Error {}

type SourceKind = "news" | "images";

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

export async function extractVqd(query: string, kl: string): Promise<string> {
	const params = new URLSearchParams({ q: query, kl });
	let body: string;
	try {
		const response = await fetchResponseWithRetry(
			`${DDG_SEARCH_URL}?${params.toString()}`,
			{
				method: "GET",
				headers: requestHeaders(undefined, "text/html,application/xhtml+xml"),
			},
		);
		if (!response.ok) throw new DdgVqdError(`HTTP ${response.status}`);
		body = await response.text();
	} catch (error) {
		if (error instanceof DdgVqdError) throw error;
		throw new DdgVqdError("network error");
	}
	const token =
		VQD_QUOTED_RE.exec(body)?.[1] ?? VQD_FALLBACK_RE.exec(body)?.[1];
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
): Promise<T[]> {
	const collected: T[] = [];
	const seen = new Set<string>();
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		if (page > 1) await delay(INTERPAGE_DELAY_MS);
		const body = await fetchSourceJson(source, urlForPage(page), {
			method: "GET",
			headers,
		});
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
	return collected;
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
	lang: string | undefined,
	limit: number,
): Promise<NewsResult[]> {
	const headers = requestHeaders(lang, "application/json");
	const urlForPage = (page: number) => {
		const params = new URLSearchParams({
			l: kl,
			o: "json",
			noamp: "1",
			q: query,
			vqd,
			p: String(page),
			...(df !== undefined ? { df } : {}),
			s: String((page - 1) * NEWS_PAGE_SIZE),
		});
		return `${DDG_NEWS_URL}?${params.toString()}`;
	};
	const raw = await paginate(
		"news",
		urlForPage,
		headers,
		limit,
		mapNewsItem,
		(item) => normalizeUrlKey(item.url),
	);
	return finalizeResults(raw, limit, parseNewsItem);
}

async function collectImages(
	query: string,
	kl: string,
	vqd: string,
	timeFilter: string | undefined,
	lang: string | undefined,
	limit: number,
): Promise<ImageResult[]> {
	const headers = requestHeaders(lang, "application/json");
	const urlForPage = (page: number) => {
		const params = new URLSearchParams({
			o: "json",
			q: query,
			l: kl,
			vqd,
			p: String(page),
			...(timeFilter !== undefined ? { f: timeFilter } : {}),
			s: String((page - 1) * IMAGES_PAGE_SIZE),
			ct: "AT",
		});
		return `${DDG_IMAGES_URL}?${params.toString()}`;
	};
	const raw = await paginate(
		"images",
		urlForPage,
		headers,
		limit,
		mapImageItem,
		(item) => normalizeUrlKey(item.imageUrl),
	);
	return finalizeResults(raw, limit, parseImageItem);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type SourceOutcome =
	| { kind: "news"; items: NewsResult[]; warning?: string }
	| { kind: "images"; items: ImageResult[]; warning?: string };

async function runNews(
	task: () => Promise<NewsResult[]>,
): Promise<SourceOutcome> {
	try {
		return { kind: "news", items: await task() };
	} catch (error) {
		if (error instanceof DdgSourceError) {
			return { kind: "news", items: [], warning: error.message };
		}
		throw error;
	}
}

async function runImages(
	task: () => Promise<ImageResult[]>,
): Promise<SourceOutcome> {
	try {
		return { kind: "images", items: await task() };
	} catch (error) {
		if (error instanceof DdgSourceError) {
			return { kind: "images", items: [], warning: error.message };
		}
		throw error;
	}
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
		vqd = await extractVqd(query, kl);
	} catch (error) {
		if (!(error instanceof DdgVqdError)) throw error;
		if (wantsNews) warnings.push(`ddg-media: ${error.reason}`);
		if (wantsImages) warnings.push(`ddg-media: ${error.reason}`);
		return { results: {}, warnings };
	}

	const jobs: Array<Promise<SourceOutcome>> = [];
	if (wantsNews) {
		jobs.push(
			runNews(() =>
				collectNews(query, kl, vqd, mapped.df, input.lang, input.limit),
			),
		);
	}
	if (wantsImages) {
		jobs.push(
			runImages(() =>
				collectImages(
					query,
					kl,
					vqd,
					imagesTimeFilter(mapped.timeRange),
					input.lang,
					input.limit,
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
