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

const searchBodySchema = z
	.object({
		query: z.string(),
		limit: z.number().int().min(1).max(100).default(10),
		sources: z.enum(["web", "news", "images"]).array().default(["web"]),
		tbs: z.string().optional(),
		lang: z.string().default("en").optional(),
		country: z.string().optional(),
		location: z.string().optional(),
		safe: z.boolean().optional(),
		includeDomains: z.string().array().optional(),
		excludeDomains: z.string().array().optional(),
		// Accepted for SDK compatibility; providers own their request timeouts
		// today, so this value does not bound anything beyond validation yet.
		timeout: z.number().default(60000).optional(),
		ignoreInvalidURLs: z.boolean().default(false).optional(),
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

		try {
			// Forward exactly the fields `SearchInput` understands; `timeout` and
			// `ignoreInvalidURLs` are validated but not part of that contract.
			const outcome = await searchWithFallback(
				{
					query: body.query,
					limit: body.limit,
					sources: body.sources,
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

			const payload: {
				success: true;
				data: SearchResults;
				warning?: string;
			} = {
				success: true,
				data: pruneEmptySources(outcome.results),
			};
			if (outcome.warnings.length > 0) {
				payload.warning = outcome.warnings.join("; ");
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
