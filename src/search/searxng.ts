import type { Env } from "../index";
import { buildDomainQuery, mapTbs } from "./params";
import {
	type ImageResult,
	type NewsResult,
	type SearchInput,
	type SearchOutcome,
	type SearchResults,
	type WebResult,
	imageResultSchema,
	newsResultSchema,
	webResultSchema,
} from "./types";

type SearchSource = "web" | "news" | "images";

const SOURCE_CATEGORIES: Record<SearchSource, string> = {
	web: "general",
	news: "news",
	images: "images",
};

const PAGE_FETCH_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 250;
const MAX_PAGES = 3;

const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

interface SearxngEngineError {
	error?: string;
}

interface SearxngRawItem {
	url?: string;
	title?: string;
	content?: string;
	publishedDate?: string;
	thumbnail_src?: string;
	img_src?: string;
	resolution?: string;
}

interface SearxngPage {
	results?: SearxngRawItem[];
	unresponsive_engines?: (
		| string
		| (string | string[])[]
		| SearxngEngineError
	)[];
}

function searchEndpoint(env: Env): string {
	const base = env.SEARXNG_ENDPOINT ?? "";
	const cleaned = base.endsWith("/") ? base.slice(0, -1) : base;
	return `${cleaned}/search`;
}

function authHeaders(env: Env): Record<string, string> {
	if (!env.SEARXNG_HEADERS) return {};
	try {
		const parsed = JSON.parse(env.SEARXNG_HEADERS);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, string>;
		}
	} catch {
		// ignore malformed JSON — fall through to no extra headers
	}
	return {};
}

function buildPageParams(
	input: SearchInput,
	source: SearchSource,
	page: number,
	warnings: string[],
): URLSearchParams {
	const mapped = mapTbs(input.tbs);
	warnings.push(...mapped.warnings);
	const params = new URLSearchParams();
	params.set(
		"q",
		buildDomainQuery(input.query, {
			includeDomains: input.includeDomains,
			excludeDomains: input.excludeDomains,
		}),
	);
	params.set("format", "json");
	params.set("categories", SOURCE_CATEGORIES[source]);
	if (input.lang) params.set("language", input.lang);
	params.set("pageno", String(page));
	if (input.safe === true) params.set("safesearch", "2");
	if (mapped.timeRange) params.set("time_range", mapped.timeRange);
	return params;
}

class SearxngHttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
	) {
		super(`searxng: HTTP ${status}`);
	}
}

async function requestPage(
	url: string,
	headers: Record<string, string>,
): Promise<SearxngPage> {
	const response = await fetch(url, {
		method: "GET",
		headers,
		signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new SearxngHttpError(response.status, body);
	}
	return (await response.json()) as SearxngPage;
}

async function fetchPageWithRetry(
	url: string,
	headers: Record<string, string>,
): Promise<SearxngPage> {
	try {
		return await requestPage(url, headers);
	} catch (error) {
		// Retry once on network error or 5xx; never retry 4xx
		if (error instanceof SearxngHttpError && error.status < 500) throw error;
		await delay(RETRY_DELAY_MS);
		return await requestPage(url, headers);
	}
}

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

function isHttpUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function parseResolution(resolution: string | undefined): {
	imageWidth?: number;
	imageHeight?: number;
} {
	if (!resolution) return {};
	const match = /(\d+)\D+(\d+)/.exec(resolution);
	if (!match) return {};
	return {
		imageWidth: Number.parseInt(match[1], 10),
		imageHeight: Number.parseInt(match[2], 10),
	};
}

function describeEngineErrors(
	errors: NonNullable<SearxngPage["unresponsive_engines"]>,
): string {
	const parts: string[] = [];
	for (const entry of errors) {
		if (typeof entry === "string") parts.push(entry);
		else if (Array.isArray(entry))
			parts.push(entry.filter((part) => typeof part === "string").join(" "));
		else if (entry && typeof entry.error === "string") parts.push(entry.error);
	}
	return parts.join("; ");
}

function normalizeItems(
	source: "web",
	items: SearxngRawItem[],
	positions: number[],
): WebResult[];
function normalizeItems(
	source: "news",
	items: SearxngRawItem[],
	positions: number[],
): NewsResult[];
function normalizeItems(
	source: "images",
	items: SearxngRawItem[],
	positions: number[],
): ImageResult[];
function normalizeItems(
	source: SearchSource,
	items: SearxngRawItem[],
	positions: number[],
): unknown[] {
	if (source === "web") {
		const web: WebResult[] = [];
		items.forEach((item, index) => {
			if (!item.url || !isHttpUrl(item.url)) return;
			const parsed = webResultSchema.safeParse({
				url: item.url,
				title: item.title ?? "",
				description: item.content ?? "",
				position: positions[index],
			});
			if (parsed.success) web.push(parsed.data);
		});
		return web;
	}
	if (source === "news") {
		const news: NewsResult[] = [];
		items.forEach((item, index) => {
			if (!item.url || !isHttpUrl(item.url)) return;
			const parsed = newsResultSchema.safeParse({
				url: item.url,
				title: item.title ?? "",
				snippet: item.content ?? "",
				date: item.publishedDate ?? undefined,
				imageUrl: item.thumbnail_src ?? item.img_src ?? undefined,
				position: positions[index],
			});
			if (parsed.success) news.push(parsed.data);
		});
		return news;
	}
	const images: ImageResult[] = [];
	items.forEach((item, index) => {
		if (!item.img_src || !isHttpUrl(item.img_src)) return;
		const parsed = imageResultSchema.safeParse({
			imageUrl: item.img_src,
			url: item.url && item.url !== item.img_src ? item.url : undefined,
			title: item.title,
			...parseResolution(item.resolution),
			position: positions[index],
		});
		if (parsed.success) images.push(parsed.data);
	});
	return images;
}

function dedupeByUrl<T extends { url?: string; imageUrl?: string }>(
	items: T[],
	keyFrom: (item: T) => string | undefined,
): T[] {
	const seen = new Set<string>();
	const deduped: T[] = [];
	for (const item of items) {
		const raw = keyFrom(item);
		const key = raw ? normalizeUrlKey(raw) : null;
		if (key && seen.has(key)) continue;
		if (key) seen.add(key);
		deduped.push(item);
	}
	return deduped;
}

async function searchSource(
	source: SearchSource,
	input: SearchInput,
	env: Env,
	sharedWarnings: string[],
): Promise<{ results: SearchResults; warning?: string }> {
	const baseUrl = searchEndpoint(env);
	const headers = authHeaders(env);
	const collected: SearxngRawItem[] = [];
	// Set when page-1 fails (or is empty with unresponsive engines); surfaced
	// as a warning if the source ends up contributing no results at all.
	let failureWarning: string | undefined;

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const pageWarnings: string[] = [];
		const params = buildPageParams(input, source, page, pageWarnings);
		if (env.SEARXNG_ENGINES) params.set("engines", env.SEARXNG_ENGINES);
		let data: SearxngPage;
		try {
			data = await fetchPageWithRetry(
				`${baseUrl}?${params.toString()}`,
				headers,
			);
		} catch (error) {
			sharedWarnings.push(...pageWarnings);
			if (error instanceof SearxngHttpError) {
				if (error.status === 403) {
					failureWarning =
						"SearXNG returned 403 — enable 'json' in settings.yml search.formats";
					break;
				}
				if (error.status === 400) {
					failureWarning = `SearXNG returned 400: ${error.body}`;
					break;
				}
				failureWarning = `searxng ${source}: HTTP ${error.status}`;
				break;
			}
			const message = error instanceof Error ? error.message : String(error);
			failureWarning = `searxng ${source}: ${message}`;
			break;
		}
		sharedWarnings.push(...pageWarnings);

		const rawItems = Array.isArray(data.results) ? data.results : [];
		if (rawItems.length === 0) {
			if (page === 1 && collected.length === 0) {
				const engineErrors = data.unresponsive_engines;
				if (Array.isArray(engineErrors) && engineErrors.length > 0) {
					failureWarning = `searxng ${source}: no results; unresponsive engines: ${describeEngineErrors(engineErrors)}`;
				}
			}
			break;
		}
		collected.push(...rawItems);
		if (collected.length >= input.limit) break;
	}

	const positions = collected.map((_, index) => index + 1);

	if (source === "web") {
		const normalized = normalizeItems("web", collected, positions);
		const items = dedupeByUrl(normalized, (item) => item.url).slice(
			0,
			input.limit,
		);
		if (items.length === 0) {
			return failureWarning
				? { results: {}, warning: failureWarning }
				: { results: {} };
		}
		return { results: { web: items } };
	}
	if (source === "news") {
		const normalized = normalizeItems("news", collected, positions);
		const items = dedupeByUrl(normalized, (item) => item.url).slice(
			0,
			input.limit,
		);
		if (items.length === 0) {
			return failureWarning
				? { results: {}, warning: failureWarning }
				: { results: {} };
		}
		return { results: { news: items } };
	}
	const normalized = normalizeItems("images", collected, positions);
	const items = dedupeByUrl(normalized, (item) => item.imageUrl).slice(
		0,
		input.limit,
	);
	if (items.length === 0) {
		return failureWarning
			? { results: {}, warning: failureWarning }
			: { results: {} };
	}
	return { results: { images: items } };
}

export async function searxngSearch(
	input: SearchInput,
	env: Env,
): Promise<SearchOutcome> {
	const warnings: string[] = [];
	const settled = await Promise.allSettled(
		input.sources.map((source) => searchSource(source, input, env, warnings)),
	);

	const results: SearchResults = {};
	let failures = 0;
	settled.forEach((outcome, index) => {
		const source = input.sources[index];
		if (outcome.status === "rejected") {
			failures += 1;
			const message =
				outcome.reason instanceof Error
					? outcome.reason.message
					: String(outcome.reason);
			warnings.push(`searxng ${source}: ${message}`);
			return;
		}
		const { results: sourceResults, warning } = outcome.value;
		if (warning) {
			failures += 1;
			warnings.push(warning);
		}
		if (sourceResults.web?.length) results.web = sourceResults.web;
		if (sourceResults.news?.length) results.news = sourceResults.news;
		if (sourceResults.images?.length) results.images = sourceResults.images;
	});

	if (input.sources.length > 0 && failures === input.sources.length) {
		throw new Error("searxng: all sources failed");
	}

	return { results, warnings };
}
