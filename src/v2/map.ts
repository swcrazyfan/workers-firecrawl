import type { Browser } from "@cloudflare/puppeteer";
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { getBrowser } from "../browser";
import { fetchSitemapUrls } from "../crawler/sitemap";
import type { AppContext } from "../index";
import { discoverLinks } from "../webMap";

export class V2Map extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							url: z.string(),
							search: z.string().optional(),
							sitemap: z.enum(["skip", "include", "only"]).default("include"),
							includeSubdomains: z.boolean().default(true).optional(),
							ignoreQueryParameters: z.boolean().default(true).optional(),
							limit: z.number().int().min(1).max(5000).default(5000).optional(),
							timeout: z.number().default(60000).optional(),
							location: z.string().optional(),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "response",
				...contentJson({
					success: z.literal(true),
					links: z
						.object({
							url: z.string(),
							title: z.string().optional(),
							description: z.string().optional(),
						})
						.array(),
				}),
			},
			500: {
				description: "Map failed",
				...contentJson({
					success: z.literal(false),
					error: z.string(),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const body = data.body;
		// `.default(x).optional()` short-circuits on missing input, so re-apply
		// the documented default here.
		const limit = body.limit ?? 5000;

		let sitemapLinks: string[] = [];
		if (body.sitemap === "include" || body.sitemap === "only") {
			sitemapLinks = await fetchSitemapUrls(body.url, { limit });
		}

		let pageLinks: string[] = [];
		let browserFailed = false;
		if (body.sitemap !== "only") {
			let browser: Browser | undefined;
			try {
				browser = await getBrowser(c.env);
				pageLinks = await discoverLinks(
					browser,
					body.url,
					body.includeSubdomains ?? true,
				);
			} catch {
				browserFailed = true;
			} finally {
				if (browser) {
					try {
						await browser.close();
					} catch {
						// Closing a dead browser is not actionable.
					}
				}
			}
		}

		// Browser failure is only fatal when the sitemap branch produced nothing
		// to fall back on.
		if (browserFailed && sitemapLinks.length === 0) {
			return Response.json(
				{ success: false, error: "Map failed" },
				{ status: 500 },
			);
		}

		// Browser discovery order wins; sitemap URLs fill in the gaps.
		const seen = new Set<string>();
		const merged: string[] = [];
		for (const link of [...pageLinks, ...sitemapLinks]) {
			const key = dedupeKey(link, body.ignoreQueryParameters ?? true);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(link);
		}

		let links = merged;
		if (body.search) {
			const needle = body.search.toLowerCase();
			links = links.filter((link) => link.toLowerCase().includes(needle));
		}
		links = links.slice(0, limit);

		return {
			success: true,
			links: links.map((url) => ({ url })),
		};
	}
}

function dedupeKey(link: string, ignoreQueryParameters: boolean): string {
	if (!ignoreQueryParameters) return link;
	try {
		const parsed = new URL(link);
		parsed.search = "";
		return parsed.toString();
	} catch {
		return link;
	}
}
