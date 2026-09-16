import type { Browser } from "@cloudflare/puppeteer";
import { getBrowser } from "../browser";
import type { Env } from "../index";
import { buildDomainQuery, klFrom, mapTbs } from "./params";
import {
	type NewsResult,
	type SearchInput,
	type SearchOutcome,
	type SearchResults,
	type WebResult,
	newsResultSchema,
	webResultSchema,
} from "./types";

const RESULT_TIMEOUT_MS = 10000;

// DDG's SPA serves an empty shell to the default headless UA
// (verified in production: results never render without this).
// Legacy deployment proved this UA + viewport combination works — the news
// tab renders under it too.
const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };

// News-tab selectors kept in one exported place so production drift is a
// one-line fix (production research: news results are `li > article`
// elements with direct article URLs and relative timestamps).
export const DDG_NEWS_SELECTORS = {
	article: "article",
	link: "article a[href]",
	image: "article img[src]",
} as const;

const RELATIVE_TIME_PATTERN =
	/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;

const RELATIVE_UNIT_MS: Record<string, number> = {
	second: 1000,
	minute: 60000,
	hour: 3600000,
	day: 86400000,
	week: 604800000,
};

interface RawNewsItem {
	url: string;
	title: string;
	snippet: string;
	timestamp: string | null;
	image: string | null;
}

// Same normalization as ddg.ts (copied, not imported): lowercase host,
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

function isHttpUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

// Typed per result shape (not generically): the repo's strictNullChecks-off
// zod inference needs the concrete contextual signature.
function renumberWebPositions(items: WebResult[]): WebResult[] {
	return items.map((item, index) => ({ ...item, position: index + 1 }));
}

function renumberNewsPositions(items: NewsResult[]): NewsResult[] {
	return items.map((item, index) => ({ ...item, position: index + 1 }));
}

// Shared http(s) filter + URL dedupe for both source paths.
function dedupeUrls<T extends { url: string }>(raw: T[]): T[] {
	const seen = new Set<string>();
	return raw.filter((item) => {
		if (!isHttpUrl(item.url)) return false;
		const key = normalizeUrlKey(item.url);
		if (key === null) return true;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function capSnippet(text: string): string {
	const trimmed = text.trim();
	return trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed;
}

// "41 minutes ago" -> ISO date-time relative to `now`, rounded to the unit.
// Months and years are calendar units, so they subtract on the calendar and
// floor to the day instead of stepping a fixed number of milliseconds.
function relativeTimeToDate(
	raw: string,
	now: number = Date.now(),
): string | undefined {
	const match = raw.match(RELATIVE_TIME_PATTERN);
	if (match === null) return undefined;
	const count = Number.parseInt(match[1] ?? "", 10);
	const unit = (match[2] ?? "").toLowerCase();
	if (Number.isNaN(count)) return undefined;
	if (unit === "month" || unit === "year") {
		const date = new Date(now);
		if (unit === "month") {
			date.setMonth(date.getMonth() - count);
		} else {
			date.setFullYear(date.getFullYear() - count);
		}
		date.setHours(0, 0, 0, 0);
		return date.toISOString();
	}
	const unitMs = RELATIVE_UNIT_MS[unit];
	if (unitMs === undefined) return undefined;
	return new Date(
		Math.round((now - count * unitMs) / unitMs) * unitMs,
	).toISOString();
}

// Same query/param mapping as ddg.ts: domain filters fold into q, kl from the
// region hints, df from tbs, kp from safe.
function ddgParams(
	input: SearchInput,
	extra: Record<string, string> = {},
): URLSearchParams {
	const params = new URLSearchParams({
		q: buildDomainQuery(input.query, {
			includeDomains: input.includeDomains,
			excludeDomains: input.excludeDomains,
		}),
		kl: klFrom({
			country: input.country,
			lang: input.lang,
			location: input.location,
		}),
		kp: input.safe === true ? "1" : "-2",
		...extra,
	});
	const mapped = mapTbs(input.tbs);
	if (mapped.df) params.set("df", mapped.df);
	return params;
}

async function webItems(
	browser: Browser,
	input: SearchInput,
): Promise<WebResult[]> {
	const page = await browser.newPage();
	try {
		await page.setViewport({ ...DESKTOP_VIEWPORT });
		await page.setUserAgent(CHROME_UA);
		await page.goto(`https://duckduckgo.com/?${ddgParams(input).toString()}`, {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});
		try {
			// Wait for result title links
			await page.waitForSelector('[data-testid="result-title-a"]', {
				timeout: RESULT_TIMEOUT_MS,
			});
		} catch {
			// Selector never rendered — a no-results page; fall through to
			// the (empty) extraction below instead of failing the chain.
		}

		const raw = await page.evaluate(() => {
			const anchors = Array.from(
				document.querySelectorAll<HTMLAnchorElement>(
					'li[data-layout="organic"] [data-testid="result-title-a"]',
				),
			);
			return anchors.map((anchor) => ({
				url: anchor.href,
				title: anchor.innerText,
			}));
		});

		const validated: WebResult[] = dedupeUrls(raw).flatMap((item, index) => {
			const parsed = webResultSchema.safeParse({
				url: item.url,
				title: item.title,
				description: "",
				position: index + 1, // provisional — renumbered after slice
			});
			return parsed.success ? [parsed.data] : [];
		});
		return renumberWebPositions(validated.slice(0, input.limit));
	} finally {
		await page.close();
	}
}

async function newsItems(
	browser: Browser,
	input: SearchInput,
): Promise<NewsResult[]> {
	const page = await browser.newPage();
	try {
		await page.setViewport({ ...DESKTOP_VIEWPORT });
		await page.setUserAgent(CHROME_UA);
		await page.goto(
			`https://duckduckgo.com/?${ddgParams(input, { iar: "news", ia: "news" }).toString()}`,
			{ waitUntil: "domcontentloaded", timeout: 30000 },
		);
		try {
			// Wait for news article elements
			await page.waitForSelector(DDG_NEWS_SELECTORS.article, {
				timeout: RESULT_TIMEOUT_MS,
			});
		} catch {
			// Same swallow-to-empty semantics as the web path.
		}

		const raw: RawNewsItem[] = await page.evaluate(
			(selectors, timePatternSource) => {
				const articles = Array.from(
					document.querySelectorAll<HTMLElement>(selectors.article),
				);
				return articles.map((article) => {
					const anchor = article.querySelector<HTMLAnchorElement>(
						selectors.link,
					);
					const image = article.querySelector<HTMLImageElement>(
						selectors.image,
					);
					const text = article.innerText.trim();
					const title = anchor === null ? "" : anchor.innerText.trim();
					// Line-based: the title can sit anywhere in the article text
					// (publisher/timestamp lines often come first), so drop the
					// line equal to the title instead of assuming a prefix.
					const snippet =
						title !== ""
							? text
									.split("\n")
									.filter((line) => line.trim() !== title)
									.join("\n")
							: text;
					const timePattern = new RegExp(timePatternSource, "i");
					const ago = text.match(timePattern);
					return {
						url: anchor === null ? "" : anchor.href,
						title: title,
						snippet: snippet,
						timestamp: ago === null ? null : ago[0],
						image: image === null ? null : image.src,
					};
				});
			},
			DDG_NEWS_SELECTORS,
			RELATIVE_TIME_PATTERN.source,
		);

		const validated: NewsResult[] = dedupeUrls(raw).flatMap((item, index) => {
			const candidate: NewsResult = {
				url: item.url,
				title: item.title,
				snippet: capSnippet(item.snippet),
				position: index + 1, // provisional — renumbered after slice
			};
			const date =
				item.timestamp === null
					? undefined
					: relativeTimeToDate(item.timestamp);
			if (date !== undefined) candidate.date = date;
			if (item.image !== null && isHttpUrl(item.image)) {
				candidate.imageUrl = item.image;
			}
			const parsed = newsResultSchema.safeParse(candidate);
			return parsed.success ? [parsed.data] : [];
		});
		return renumberNewsPositions(validated.slice(0, input.limit));
	} finally {
		await page.close();
	}
}

export async function ddgBrowserSearch(
	input: SearchInput,
	env: Env,
): Promise<SearchOutcome> {
	const warnings: string[] = [];
	if (input.sources.includes("images")) {
		warnings.push("browser fallback does not support source images");
	}
	// Fixed web-before-news order keeps the sequential page flow
	// deterministic; both pages share one browser session.
	const sources = (["web", "news"] as const).filter((source) =>
		input.sources.includes(source),
	);
	if (sources.length === 0) {
		return { results: {}, warnings };
	}

	// Only the browser launch can fail the whole chain: a source that throws
	// after launch is isolated so the other source's results survive (a
	// partial success must not regress into a 503).
	let browser: Browser;
	try {
		browser = await getBrowser(env);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`ddg-browser: search failed: ${message}`);
	}
	const results: SearchResults = {};
	try {
		for (const source of sources) {
			try {
				if (source === "web") {
					const items = await webItems(browser, input);
					if (items.length === 0) {
						warnings.push("ddg-browser: no results");
						continue;
					}
					results.web = items;
				} else {
					const items = await newsItems(browser, input);
					if (items.length === 0) {
						warnings.push("ddg-browser: no results");
						continue;
					}
					results.news = items;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warnings.push(`ddg-browser: ${source} failed: ${message}`);
			}
		}
		return { results, warnings };
	} finally {
		// Upstream bug e836594 leaked the browser on every failed search —
		// close it no matter how the attempt ends.
		await browser.close();
	}
}
