import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { SearchUnavailableError, searchWithFallback } from "../search/provider";
import {
	type SearchResults,
	imageResultSchema,
	newsResultSchema,
	webResultSchema,
} from "../search/types";

const UNAVAILABLE_PREFIX = "search backend unavailable: ";

// `SearchUnavailableError` only carries the combined message, so peel the
// shared prefix back off to surface the provider reasons as `details`.
function unavailableDetails(error: SearchUnavailableError): string {
	return error.message.startsWith(UNAVAILABLE_PREFIX)
		? error.message.slice(UNAVAILABLE_PREFIX.length)
		: error.message;
}

// The grouped envelope never emits empty source keys (`"web": []` is a v1
// shape and the SDK treats an empty array as "no result block").
function pruneEmptySources(results: SearchResults): SearchResults {
	const pruned: SearchResults = {};
	if (results.web?.length) pruned.web = results.web;
	if (results.news?.length) pruned.news = results.news;
	if (results.images?.length) pruned.images = results.images;
	return pruned;
}

const sourceTypeSchema = z.enum(["web", "news", "images"]);
type SourceType = z.infer<typeof sourceTypeSchema>;

// The vendor SDK sends sources as objects (`{type:"web"}`) while older callers
// send bare strings; both are accepted. Per-source `location`/`tbs` are
// accepted-and-ignored — only `type` is read, and the top-level `location`/`tbs`
// remain the ones forwarded to the provider.
const sourceSchema = z.union([
	sourceTypeSchema,
	z.object({
		type: sourceTypeSchema,
		location: z.string().optional(),
		tbs: z.string().optional(),
	}),
]);

// Collapse both source forms to the string list the provider expects, deduping
// repeats while preserving first-seen order.
function normalizeSources(
	entries: z.infer<typeof sourceSchema>[],
): SourceType[] {
	const seen = new Set<SourceType>();
	const sources: SourceType[] = [];
	for (const entry of entries) {
		const type = typeof entry === "string" ? entry : entry.type;
		if (seen.has(type)) continue;
		seen.add(type);
		sources.push(type);
	}
	return sources;
}

// Accepted-and-ignored contract fields (Cloud-only vendor features / future
// tasks) are deliberately absent below, so zod strips them before `handle`
// runs instead of rejecting the request: `categories`, `highlights`,
// `enterprise`, `threatProtection`, `domainTools`, `integration`, `origin`,
// and `scrapeOptions` (a separate future task).
const searchBodySchema = z
	.object({
		query: z.string().max(500),
		limit: z.number().int().min(1).max(100).default(10),
		sources: z.array(sourceSchema).default(["web"]),
		tbs: z.string().optional(),
		lang: z.string().default("en"),
		country: z.string().optional(),
		location: z.string().optional(),
		safe: z.boolean().optional(),
		includeDomains: z.string().array().optional(),
		excludeDomains: z.string().array().optional(),
		// Accepted for contract compatibility but bounds nothing extra today:
		// providers own their own request timeouts.
		timeout: z.number().int().positive().optional(),
		// Providers always drop non-http/unparseable result URLs, so an explicit
		// `false` cannot be honoured; `handle` reports it as a warning instead.
		ignoreInvalidURLs: z.boolean().optional(),
	})
	.refine(
		(body) => !(body.includeDomains?.length && body.excludeDomains?.length),
		{
			message: "includeDomains and excludeDomains are mutually exclusive",
			path: ["includeDomains"],
		},
	);

export class V2Search extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: searchBodySchema,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Grouped search results",
				...contentJson({
					success: z.literal(true),
					data: z.object({
						web: webResultSchema.array().optional(),
						news: newsResultSchema.array().optional(),
						images: imageResultSchema.array().optional(),
					}),
					warning: z.string().optional(),
				}),
			},
			503: {
				description: "Search backend unavailable",
				...contentJson({
					success: z.literal(false),
					error: z.string(),
					details: z.string().optional(),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const body = data.body;
		const sources = normalizeSources(body.sources);

		try {
			// Forward exactly the fields `SearchInput` understands; `timeout` and
			// `ignoreInvalidURLs` are validated but not part of that contract.
			const outcome = await searchWithFallback(
				{
					query: body.query,
					limit: body.limit,
					sources,
					tbs: body.tbs,
					lang: body.lang,
					country: body.country,
					location: body.location,
					safe: body.safe,
					includeDomains: body.includeDomains,
					excludeDomains: body.excludeDomains,
				},
				c.env,
			);

			const warnings = [...outcome.warnings];
			if (body.ignoreInvalidURLs === false) {
				warnings.push(
					"ignoreInvalidURLs:false is not supported; invalid URLs are always skipped",
				);
			}

			const payload: {
				success: true;
				data: SearchResults;
				warning?: string;
			} = {
				success: true,
				data: pruneEmptySources(outcome.results),
			};
			if (warnings.length > 0) {
				payload.warning = warnings.join("; ");
			}
			return payload;
		} catch (error) {
			if (error instanceof SearchUnavailableError) {
				return Response.json(
					{
						success: false,
						error: "Search backend unavailable",
						details: unavailableDetails(error),
					},
					{ status: 503 },
				);
			}
			throw error;
		}
	}
}
