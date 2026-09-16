import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { parseCrawlOptions } from "../crawler/engine";
import { getJob, listActiveJobs, listJobErrors } from "../crawler/store";
import type { AppContext } from "../index";
import { collectIgnoredFields, crawlRequestSchema } from "./crawl";

const MAX_LIMIT = 1000;
const NOT_FOUND = "crawl job not found";
const PREVIEW_WARNING = "params-preview does not verify reachability";

const crawlStatusSchema = z.enum([
	"scraping",
	"completed",
	"failed",
	"cancelled",
]);

const notFound = () =>
	Response.json({ success: false, error: NOT_FOUND }, { status: 404 });

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
							id: z.number(),
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
				id: item.id,
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
				url: job.url,
				status: job.status as z.infer<typeof crawlStatusSchema>,
				total: job.total,
				completed: job.completed,
				createdAt: new Date(job.created_at).toISOString(),
			})),
		};
	}
}

// `POST /v2/crawl/params-preview` — a PURE preview: it validates the same body
// as `POST /v2/crawl`, resolves the defaults the engine would apply, and
// returns them. It deliberately never writes a job row, enqueues a seed, or
// calls the Workflow binding.
export class V2CrawlParamsPreview extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: crawlRequestSchema,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Resolved crawl parameters (preview only)",
				...contentJson({
					success: z.literal(true),
					data: z.object({
						url: z.string(),
						limit: z.number(),
						maxDiscoveryDepth: z.number(),
						allowExternalLinks: z.boolean(),
						allowSubdomains: z.boolean(),
						includePaths: z.array(z.string()),
						excludePaths: z.array(z.string()),
						ignoreRobotsTxt: z.boolean(),
						sitemap: z.enum(["skip", "include", "only"]),
						scrapeFormats: z.array(z.string()),
						ignoredFields: z.array(z.string()),
					}),
					warning: z.string().optional(),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const body = data.body;
		// Reuse the engine's own resolver so the preview cannot drift from what
		// a real crawl would do with the same body.
		const resolved = parseCrawlOptions(body);

		return {
			success: true as const,
			data: {
				url: body.url,
				limit: resolved.limit,
				maxDiscoveryDepth: resolved.maxDiscoveryDepth,
				allowExternalLinks: resolved.allowExternalLinks,
				allowSubdomains: resolved.allowSubdomains,
				includePaths: resolved.includePaths ?? [],
				excludePaths: resolved.excludePaths ?? [],
				ignoreRobotsTxt: resolved.ignoreRobotsTxt,
				sitemap: resolved.sitemap,
				scrapeFormats: resolved.scrapeFormats,
				ignoredFields: collectIgnoredFields(body as Record<string, unknown>),
			},
			warning: PREVIEW_WARNING,
		};
	}
}
