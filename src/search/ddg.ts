import type { Env } from "../index";
import { buildDomainQuery, klFrom, mapTbs } from "./params";
import {
	type SearchInput,
	type SearchOutcome,
	type WebResult,
	webResultSchema,
} from "./types";

const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const PAGE_FETCH_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 250;
const INTERPAGE_DELAY_MS = 1100;
const MAX_PAGES = 5;

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
];

const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DdgAntiBotError extends Error {
	constructor() {
		super("ddg: anti-bot challenge");
	}
}

class DdgHttpError extends Error {
	constructor(readonly status: number) {
		super(`ddg: HTTP ${status}`);
	}
}

// ---------------------------------------------------------------------------
// Pure HTML parsing
// ---------------------------------------------------------------------------

// &amp; must decode LAST so "&amp;lt;" yields the literal "&lt;".
const ENTITY_DECODINGS: [RegExp, string][] = [
	[/&lt;/g, "<"],
	[/&gt;/g, ">"],
	[/&quot;/g, '"'],
	[/&#x27;/g, "'"],
	[/&#39;/g, "'"],
	[/&amp;/g, "&"],
];

function decodeEntities(text: string): string {
	let out = text;
	for (const [entity, char] of ENTITY_DECODINGS) {
		out = out.replace(entity, char);
	}
	return out;
}

function cleanText(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

function isHttpUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

// Result URLs arrive as `//duckduckgo.com/l/?uddg=<urlencoded>&rut=...`;
// unwrap to the real target. Plain hrefs pass through unchanged.
function unwrapResultUrl(href: string): string | null {
	if (!href.includes("duckduckgo.com/l/")) return href;
	const match = /[?&]uddg=([^&#]+)/.exec(href);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}

// Match the class attr as a word inside a possibly multi-valued class list
// (DDG sometimes appends modifier classes); the {0,500} bound on the prefix
// keeps the scan from going quadratic on malformed markup.
const RESULT_LINK_RE =
	/<a\b[^>]{0,500}class="[^"]*\bresult__a\b[^>]*>([\s\S]*?)<\/a>/g;
const RESULT_SNIPPET_RE =
	/<a\b[^>]{0,500}class="[^"]*\bresult__snippet\b[^>]*>([\s\S]*?)<\/a>/g;

// Prefix match on the quoted attribute so result text merely *mentioning*
// the marker strings can never trigger a false positive.
const ANTI_BOT_MARKERS = [
	'class="anomaly-modal',
	'id="anomaly-modal"',
	'class="challenge-form',
	'id="challenge-form"',
];

const MAX_HTML_BYTES = 1_000_000;

export function parseDdgHtml(
	html: string,
): Array<{ url: string; title: string; snippet: string }> {
	// CPU budget: real DDG results pages are a few tens of KB; anything
	// past 1MB is pathological input that would burn the Workers CPU limit
	// in the per-link scan, so bail out cheaply.
	if (html.length > MAX_HTML_BYTES) return [];
	if (ANTI_BOT_MARKERS.some((marker) => html.includes(marker))) {
		throw new DdgAntiBotError();
	}
	const links = [...html.matchAll(RESULT_LINK_RE)];
	const snippets = [...html.matchAll(RESULT_SNIPPET_RE)];
	const results: Array<{ url: string; title: string; snippet: string }> = [];
	for (let i = 0; i < links.length; i += 1) {
		const link = links[i];
		const rawHref = /\shref="([^"]*)"/.exec(link[0])?.[1] ?? "";
		const url = unwrapResultUrl(decodeEntities(rawHref));
		if (url === null || !isHttpUrl(url)) continue;
		// The snippet for a result sits between its title link and the next
		// result's title link.
		const linkStart = link.index ?? 0;
		const nextLinkStart = links[i + 1]?.index ?? html.length;
		const snippet = snippets.find(
			(match) =>
				(match.index ?? -1) > linkStart && (match.index ?? -1) < nextLinkStart,
		);
		results.push({
			url,
			title: cleanText(link[1]),
			snippet: snippet ? cleanText(snippet[1]) : "",
		});
	}
	return results;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function requestHeaders(
	input: SearchInput,
	extra?: Record<string, string>,
): Record<string, string> {
	return {
		"User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
		Accept: "text/html,application/xhtml+xml",
		"Accept-Language": input.lang ?? "en",
		...extra,
	};
}

async function requestPage(url: string, init: RequestInit): Promise<string> {
	const response = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
	});
	// DDG serves 202 for bot challenges — never parsed, never retried.
	if (response.status === 202) throw new DdgAntiBotError();
	if (!response.ok) throw new DdgHttpError(response.status);
	return await response.text();
}

async function fetchPageWithRetry(
	url: string,
	init: RequestInit,
): Promise<string> {
	try {
		return await requestPage(url, init);
	} catch (error) {
		// Retry once on network error or 5xx; never retry 4xx or the challenge
		if (error instanceof DdgAntiBotError) throw error;
		if (error instanceof DdgHttpError && error.status < 500) throw error;
		await delay(RETRY_DELAY_MS);
		return await requestPage(url, init);
	}
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

// Same normalization as searxng (copied, not imported): lowercase host,
// trailing slash collapsed, search kept, hash dropped.
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

function renumberPositions(items: WebResult[]): WebResult[] {
	return items.map((item, index) => ({ ...item, position: index + 1 }));
}

export async function ddgWebSearch(
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
	const kp = input.safe === true ? "1" : "-2";

	const collected: Array<{ url: string; title: string; snippet: string }> = [];
	const seen = new Set<string>();
	let hitPageCap = true;

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		if (page > 1) await delay(INTERPAGE_DELAY_MS);
		let body: string;
		if (page === 1) {
			const params = new URLSearchParams({ q: query, kl, kp });
			if (mapped.df) params.set("df", mapped.df);
			body = await fetchPageWithRetry(`${DDG_HTML_URL}?${params.toString()}`, {
				method: "GET",
				headers: requestHeaders(input),
			});
		} else {
			const form = new URLSearchParams({
				q: query,
				s: String(10 + (page - 2) * 15),
				kl,
				kp,
			});
			if (mapped.df) form.set("df", mapped.df);
			body = await fetchPageWithRetry(DDG_HTML_URL, {
				method: "POST",
				headers: requestHeaders(input, {
					"Content-Type": "application/x-www-form-urlencoded",
				}),
				body: form.toString(),
			});
		}

		const fresh = parseDdgHtml(body).filter((item) => {
			const key = normalizeUrlKey(item.url);
			if (key === null) return true;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		if (fresh.length === 0) {
			hitPageCap = false;
			break;
		}
		collected.push(...fresh);
		if (collected.length >= input.limit) {
			hitPageCap = false;
			break;
		}
	}

	const items = renumberPositions(
		collected
			.flatMap((item, index) => {
				const parsed = webResultSchema.safeParse({
					url: item.url,
					title: item.title,
					description: item.snippet,
					position: index + 1, // provisional — renumbered after slice
				});
				return parsed.success ? [parsed.data] : [];
			})
			.slice(0, input.limit),
	);

	if (items.length === 0) {
		warnings.push("ddg: no results");
		return { results: {}, warnings };
	}
	if (hitPageCap && items.length < input.limit) {
		warnings.push(
			`ddg: stopped at page cap ${MAX_PAGES}, returning ${items.length} < ${input.limit} results`,
		);
	}
	return { results: { web: items }, warnings };
}
