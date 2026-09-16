import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { extractStructured } from "../ai/extract";
import { normalizeJsonSchema, validateAgainstSchema } from "../ai/schema";
import { getJob, listActiveJobs, listJobErrors } from "../crawler/store";
import type { AppContext } from "../index";
import { notFound } from "./crawlStatus";

const MAX_LIMIT = 1000;

// `params-preview` generation bounds. The defaults mirror the crawl engine's
// (`DEFAULT_LIMIT` / `DEFAULT_MAX_DISCOVERY_DEPTH` in `src/crawler/engine.ts`);
// the ceilings keep a hallucinated number out of the response.
const DEFAULT_GENERATED_LIMIT = 10000;
const MAX_GENERATED_LIMIT = 100000;
const MAX_GENERATED_DEPTH = 10;

const sitemapSchema = z.enum(["skip", "include", "only"]);

const crawlStatusSchema = z.enum([
	"scraping",
	"completed",
	"failed",
	"cancelled",
]);

// Placeholder team id for the active-crawls contract. This deployment has no
// multi-tenant teams, so the required `teamId` field is a constant marker.
const SELF_HOSTED_TEAM_ID = "self-hosted";

// The parameters `/crawl/params-preview` returns. Field-for-field the vendored
// contract's `data` object.
const generatedParamsSchema = z.object({
	allowExternalLinks: z.boolean(),
	allowSubdomains: z.boolean(),
	crawlEntireDomain: z.boolean(),
	deduplicateSimilarURLs: z.boolean(),
	delay: z.number(),
	excludePaths: z.array(z.string()),
	ignoreQueryParameters: z.boolean(),
	ignoreRobotsTxt: z.boolean(),
	includePaths: z.array(z.string()),
	limit: z.number(),
	maxDepth: z.number(),
	maxDiscoveryDepth: z.number(),
	robotsUserAgent: z.string(),
	sitemap: sitemapSchema,
	url: z.string(),
});

type GeneratedParams = z.infer<typeof generatedParamsSchema>;

// JSON Schema handed to the model. `normalizeJsonSchema` marks every property
// required and forbids extras, so a partial or invented result fails validation
// and falls back to the defaults.
const PARAMS_PREVIEW_JSON_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		allowExternalLinks: { type: "boolean" },
		allowSubdomains: { type: "boolean" },
		crawlEntireDomain: { type: "boolean" },
		deduplicateSimilarURLs: { type: "boolean" },
		delay: { type: "number" },
		excludePaths: { type: "array", items: { type: "string" } },
		ignoreQueryParameters: { type: "boolean" },
		ignoreRobotsTxt: { type: "boolean" },
		includePaths: { type: "array", items: { type: "string" } },
		limit: { type: "integer" },
		maxDepth: { type: "integer" },
		maxDiscoveryDepth: { type: "integer" },
		robotsUserAgent: { type: "string" },
		sitemap: { type: "string", enum: ["skip", "include", "only"] },
		url: { type: "string" },
	},
};

const normalizedParamsSchema = normalizeJsonSchema(
	PARAMS_PREVIEW_JSON_SCHEMA,
).schema;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The engine defaults, used verbatim when generation is unavailable. `url` is
// the caller's, never the model's, so it is always the requested target.
function defaultParams(url: string): GeneratedParams {
	return {
		allowExternalLinks: false,
		allowSubdomains: false,
		crawlEntireDomain: false,
		deduplicateSimilarURLs: true,
		delay: 0,
		excludePaths: [],
		ignoreQueryParameters: false,
		ignoreRobotsTxt: false,
		includePaths: [],
		limit: DEFAULT_GENERATED_LIMIT,
		maxDepth: MAX_GENERATED_DEPTH,
		maxDiscoveryDepth: MAX_GENERATED_DEPTH,
		robotsUserAgent: "",
		sitemap: "include",
		url,
	};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asBoundedInt(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function asSitemap(value: unknown): z.infer<typeof sitemapSchema> {
	return value === "skip" || value === "only" ? value : "include";
}

// Clamp/normalise a validated model result into legal crawl ranges. Anything
// unreadable falls back to the corresponding default.
function normalizeParams(raw: unknown, url: string): GeneratedParams {
	const source = isRecord(raw) ? raw : {};
	const base = defaultParams(url);
	return {
		allowExternalLinks: asBoolean(
			source.allowExternalLinks,
			base.allowExternalLinks,
		),
		allowSubdomains: asBoolean(source.allowSubdomains, base.allowSubdomains),
		crawlEntireDomain: asBoolean(
			source.crawlEntireDomain,
			base.crawlEntireDomain,
		),
		deduplicateSimilarURLs: asBoolean(
			source.deduplicateSimilarURLs,
			base.deduplicateSimilarURLs,
		),
		delay: asBoundedInt(source.delay, base.delay, 0, Number.MAX_SAFE_INTEGER),
		excludePaths: asStringArray(source.excludePaths),
		ignoreQueryParameters: asBoolean(
			source.ignoreQueryParameters,
			base.ignoreQueryParameters,
		),
		ignoreRobotsTxt: asBoolean(source.ignoreRobotsTxt, base.ignoreRobotsTxt),
		includePaths: asStringArray(source.includePaths),
		limit: asBoundedInt(source.limit, base.limit, 1, MAX_GENERATED_LIMIT),
		maxDepth: asBoundedInt(
			source.maxDepth,
			base.maxDepth,
			0,
			MAX_GENERATED_DEPTH,
		),
		maxDiscoveryDepth: asBoundedInt(
			source.maxDiscoveryDepth,
			base.maxDiscoveryDepth,
			0,
			MAX_GENERATED_DEPTH,
		),
		robotsUserAgent: asString(source.robotsUserAgent, base.robotsUserAgent),
		sitemap: asSitemap(source.sitemap),
		// The target is authoritative; a model-supplied URL is ignored.
		url,
	};
}

function isValidParams(raw: unknown): boolean {
	return !("errors" in validateAgainstSchema(raw, normalizedParamsSchema));
}

// `GET /v2/crawl/:id/errors` — per-job failure log. The job is looked up first
// so an unknown id is a 404 rather than an empty (and misleading) list.
export class V2CrawlErrors extends OpenAPIRoute {
	schema = {
		request: {
			params: z.object({ id: z.string().min(1) }),
			query: z.object({
				limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
			}),
		},
		responses: {
			200: {
				description: "Crawl job errors",
				...contentJson({
					success: z.literal(true),
					errors: z.array(
						z.object({
							// The contract types this as a string (the D1 row id is a
							// number); convert at the response boundary.
							id: z.string(),
							// ISO-8601 `date-time` at the response boundary (D1 keeps
							// epoch millis), matching the PR #14 timestamp decision.
							timestamp: z.string(),
							url: z.string(),
							error: z.string(),
						}),
					),
					robotsBlocked: z.array(z.string()),
				}),
			},
			404: {
				description: "Crawl job not found",
				...contentJson({
					success: z.literal(false),
					error: z.string(),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const id = c.req.param("id");
		const job = await getJob(c.env.DB, id);
		if (!job) {
			return notFound();
		}

		const { errors, robotsBlocked } = await listJobErrors(
			c.env.DB,
			id,
			data.query.limit,
		);

		return {
			success: true as const,
			errors: errors.map((item) => ({
				id: String(item.id),
				timestamp: new Date(item.timestamp).toISOString(),
				url: item.url,
				error: item.error,
			})),
			robotsBlocked,
		};
	}
}

// `GET /v2/crawl/active` — in-flight jobs. Pagination-free: a bounded chunk of
// the oldest still-scraping jobs, not a cursor contract.
export class V2CrawlActive extends OpenAPIRoute {
	schema = {
		request: {
			query: z.object({
				limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
			}),
		},
		responses: {
			200: {
				description: "Active crawl jobs",
				...contentJson({
					success: z.literal(true),
					crawls: z.array(
						z.object({
							id: z.string(),
							teamId: z.string(),
							url: z.string(),
							status: crawlStatusSchema,
							total: z.number(),
							completed: z.number(),
							createdAt: z.string(),
						}),
					),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const jobs = await listActiveJobs(c.env.DB, Date.now(), data.query.limit);

		return {
			success: true as const,
			crawls: jobs.map((job) => ({
				id: job.id,
				// The contract requires `teamId`; this deployment has no teams, so
				// this is a documented self-hosted placeholder, not real data.
				teamId: SELF_HOSTED_TEAM_ID,
				url: job.url,
				status: job.status as z.infer<typeof crawlStatusSchema>,
				total: job.total,
				completed: job.completed,
				createdAt: new Date(job.created_at).toISOString(),
				// `options` is intentionally omitted: it can carry a webhook URL
				// (a secret), and the contract only needs it for client-side echo.
			})),
		};
	}
}

// `POST /v2/crawl/params-preview` — a PURE, prompt-driven parameter generator.
// It validates `{url, prompt}`, asks the AI pipeline for crawl parameters that
// satisfy the prompt, normalises them, and returns them. It never fetches or
// crawls the URL, writes a job row, enqueues a seed, or calls the Workflow.
// When AI is unavailable or generation fails it returns the engine defaults
// with a `warning`; it never throws.
export class V2CrawlParamsPreview extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							url: z.string().url(),
							prompt: z.string().min(1).max(10000),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Generated crawl parameters",
				...contentJson({
					success: z.literal(true),
					data: generatedParamsSchema,
					warning: z.string().optional(),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { url, prompt } = data.body;

		const instruction = [
			"Generate the crawl parameters that best satisfy the user's request for the target URL.",
			`Target URL: ${url}`,
			`User request: ${prompt}`,
			"Do not fetch or browse the URL; choose the parameters from the request alone.",
		].join("\n");

		let generated: unknown;
		let reason: string | undefined;
		try {
			const result = await extractStructured(
				{
					// The URL is passed as text only — nothing is fetched.
					content: `Target URL: ${url}\nUser request: ${prompt}`,
					jsonSchema: normalizedParamsSchema,
					prompt: instruction,
				},
				c.env,
			);
			generated = result.data;
			reason = result.warning;
		} catch (error) {
			generated = undefined;
			reason = `parameter generation failed: ${(error as Error).message}`;
		}

		if (generated !== undefined && isValidParams(generated)) {
			const payload: {
				success: true;
				data: GeneratedParams;
				warning?: string;
			} = { success: true, data: normalizeParams(generated, url) };
			if (reason !== undefined) {
				payload.warning = reason;
			}
			return payload;
		}

		return {
			success: true as const,
			data: defaultParams(url),
			warning: `parameter generation unavailable (${
				reason ?? "no result"
			}); returned engine default crawl parameters, not generated values`,
		};
	}
}
