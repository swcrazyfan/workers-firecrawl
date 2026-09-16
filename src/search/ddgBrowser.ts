import { getBrowser } from "../browser";
import type { Env } from "../index";
import { buildDomainQuery, klFrom, mapTbs } from "./params";
import {
	type SearchInput,
	type SearchOutcome,
	type WebResult,
	webResultSchema,
} from "./types";

const RESULT_TIMEOUT_MS = 10000;

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

function renumberPositions(items: WebResult[]): WebResult[] {
	return items.map((item, index) => ({ ...item, position: index + 1 }));
}

export async function ddgBrowserSearch(
	input: SearchInput,
	env: Env,
): Promise<SearchOutcome> {
	const browser = await getBrowser(env);
	try {
		const page = await browser.newPage();
		try {
			// DDG's SPA serves an empty shell to the default headless UA
			// (verified in production: results never render without this).
			// Legacy deployment proved this UA + viewport combination works.
			await page.setViewport({ width: 1920, height: 1080 });
			await page.setUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
			);
			// Same query/param mapping as ddg.ts: domain filters fold into q,
			// kl from the region hints, df from tbs, kp from safe.
			const mapped = mapTbs(input.tbs);
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
			});
			if (mapped.df) params.set("df", mapped.df);

			await page.goto(`https://duckduckgo.com/?${params.toString()}`, {
				waitUntil: "domcontentloaded",
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

			const seen = new Set<string>();
			const items = renumberPositions(
				raw
					.filter((item) => {
						if (!isHttpUrl(item.url)) return false;
						const key = normalizeUrlKey(item.url);
						if (key === null) return true;
						if (seen.has(key)) return false;
						seen.add(key);
						return true;
					})
					.flatMap((item, index) => {
						const parsed = webResultSchema.safeParse({
							url: item.url,
							title: item.title,
							description: "",
							position: index + 1, // provisional — renumbered after slice
						});
						return parsed.success ? [parsed.data] : [];
					})
					.slice(0, input.limit),
			);

			if (items.length === 0) {
				return { results: {}, warnings: ["ddg-browser: no results"] };
			}
			return { results: { web: items }, warnings: [] };
		} finally {
			await page.close();
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`ddg-browser: search failed: ${message}`);
	} finally {
		// Upstream bug e836594 leaked the browser on every failed search —
		// close it no matter how the attempt ends.
		await browser.close();
	}
}
