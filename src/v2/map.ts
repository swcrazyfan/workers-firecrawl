import type { Browser } from "@cloudflare/puppeteer";
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { fetchSitemapUrls } from "../crawler/sitemap";
import type { AppContext } from "../index";
import { discoverLinks, getBrowser } from "../webMap";

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 100000;

const BROWSER_EMPTY_WARNING = "browser discovery returned no links";
const SEARCH_WARNING =
	"search relevance ordering is not supported; results are filtered by substring";

export class V2Map extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							url: z.string().url(),
							search: z.string().optional(),
							sitemap: z.enum(["skip", "include", "only"]).default("include"),
							includeSubdomains: z.boolean().default(true),
							ignoreQueryParameters: z.boolean().default(true),
							limit: z
								.number()
								.int()
								.min(1)
								.max(MAX_LIMIT)
								.default(DEFAULT_LIMIT),
							timeout: z.number().int().positive().optional(),
							location: z
								.object({
									country: z
										.string()
										.regex(/^[A-Z]{2}$/)
										.optional(),
									languages: z.string().array().optional(),
								})
								.optional(),
							// Accepted for contract compatibility but ignored by this
							// implementation; `handle` warns when they are supplied.
							ignoreCache: z.boolean().optional(),
							auditMetadata: z.unknown().optional(),
							threatProtection: z.unknown().optional(),
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
					warning: z.string().optional(),
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
		const warnings: string[] = [];

		const ignoredFields: string[] = [];
		if (body.ignoreCache !== undefined) ignoredFields.push("ignoreCache");
		if (body.auditMetadata !== undefined) ignoredFields.push("auditMetadata");
		if (body.threatProtection !== undefined) {
			ignoredFields.push("threatProtection");
		}
		if (body.timeout !== undefined) ignoredFields.push("timeout");
		if (body.location !== undefined) ignoredFields.push("location");
		if (ignoredFields.length > 0) {
			warnings.push(`unsupported fields ignored: ${ignoredFields.join(", ")}`);
		}

		let sitemapLinks: string[] = [];
		if (body.sitemap !== "skip") {
			// When `search` filters the pool, the parser must collect more than the
			// final `limit` or filtering can under-return.
			sitemapLinks = await fetchSitemapUrls(body.url, {
				limit: body.search ? MAX_LIMIT : body.limit,
			});
		}

		let pageLinks: string[] = [];
		if (body.sitemap !== "only") {
			let browser: Browser | undefined;
			try {
				browser = await getBrowser(c.env);
			} catch {
				// A real launch failure is the only fatal browser error; discovery
				// itself fails soft and resolves to [].
				return Response.json(
					{ success: false, error: "Map failed" },
					{ status: 500 },
				);
			}
			try {
				pageLinks = await discoverLinks(
					browser,
					body.url,
					body.includeSubdomains,
				);
			} finally {
				try {
					await browser.close();
				} catch {
					// Closing a dead browser is not actionable.
				}
			}
		}

		// Browser discovery order wins; sitemap URLs fill in the gaps.
		const seen = new Set<string>();
		const merged: string[] = [];
		for (const link of [...pageLinks, ...sitemapLinks]) {
			const key = dedupeKey(link, body.ignoreQueryParameters);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(link);
		}

		if (
			body.sitemap !== "only" &&
			pageLinks.length === 0 &&
			merged.length === 0
		) {
			warnings.push(BROWSER_EMPTY_WARNING);
		}

		let links = merged;
		if (body.search) {
			const needle = body.search.toLowerCase();
			links = links.filter((link) => link.toLowerCase().includes(needle));
			warnings.push(SEARCH_WARNING);
		}
		links = links.slice(0, body.limit);

		const payload: {
			success: true;
			links: { url: string }[];
			warning?: string;
		} = {
			success: true,
			links: links.map((url) => ({ url })),
		};
		if (warnings.length > 0) {
			payload.warning = warnings.join("; ");
		}
		return payload;
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
