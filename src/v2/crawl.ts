import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import {
	bumpJobCounters,
	createJob,
	enqueueUrls,
	setJobStatus,
} from "../crawler/store";
import type { AppContext } from "../index";
import { scrapeFormatSchema } from "./scrape";

const DEFAULT_LIMIT = 10000;
const MAX_LIMIT = 100000;
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The engine (Cloudflare Workflows) is task 012. Until its binding exists this
// endpoint is deployable but inert: the job is recorded, marked failed and the
// caller gets a 503 instead of a job that never progresses.
const ENGINE_NOT_CONFIGURED = "crawl engine not configured";

// Raised when D1 rejects the job row or the seed enqueue. The job never reaches
// a runnable state, so the caller gets a structured 500 instead of a bare
// runtime error with the row stuck in `scraping`.
const CREATION_ERROR = "crawl job could not be created";

// v2 crawl fields this deployment validates for SDK compatibility but does not
// act on. `handle` reports them through the response `warning`.
const IGNORED_FIELDS = [
	"crawlEntireDomain",
	"delay",
	"ignoreQueryParameters",
	"excludeTags",
	"includeTags",
	"maxConcurrency",
	"prompt",
	"regexOnFullURL",
	"zeroDataRetention",
] as const;

// `crawl_<epochms>_<8 hex chars>`; the id doubles as the Workflow instance id.
function randomJobId(now: number): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const suffix = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `crawl_${now}_${suffix}`;
}

export class V2Crawl extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							url: z.string().url(),
							limit: z
								.number()
								.int()
								.min(1)
								.max(MAX_LIMIT)
								.default(DEFAULT_LIMIT)
								.optional(),
							maxDiscoveryDepth: z.number().int().min(0).max(10).optional(),
							allowExternalLinks: z.boolean().default(false).optional(),
							allowSubdomains: z.boolean().default(false).optional(),
							// Contract bounds: each entry at most 2000 chars, at most 1000
							// entries per field.
							includePaths: z.string().max(2000).array().max(1000).optional(),
							excludePaths: z.string().max(2000).array().max(1000).optional(),
							ignoreRobotsTxt: z.boolean().default(false).optional(),
							sitemap: z
								.enum(["skip", "include", "only"])
								.default("include")
								.optional(),
							// Only `formats` is implemented; `.passthrough()` keeps any
							// other scrape sub-field so `handle` can name it in the warning.
							scrapeOptions: z
								.object({ formats: z.array(scrapeFormatSchema).optional() })
								.passthrough()
								.optional(),
							// Contract of record: `webhook` is an object (url required).
							webhook: z
								.object({
									url: z.string().url(),
									headers: z.record(z.string()).optional(),
									metadata: z.record(z.unknown()).optional(),
									events: z.string().array().optional(),
								})
								.optional(),
							// Accepted-and-ignored: see IGNORED_FIELDS.
							crawlEntireDomain: z.boolean().optional(),
							delay: z.number().optional(),
							ignoreQueryParameters: z.boolean().default(false).optional(),
							maxConcurrency: z.number().int().optional(),
							regexOnFullURL: z.boolean().optional(),
							robotsUserAgent: z.string().optional(),
							zeroDataRetention: z.boolean().optional(),
							prompt: z.string().optional(),
							excludeTags: z.string().array().optional(),
							includeTags: z.string().array().optional(),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Crawl job accepted",
				...contentJson({
					success: z.literal(true),
					id: z.string(),
					url: z.string(),
					warning: z.string().optional(),
				}),
			},
			500: {
				description: "Crawl job could not be created",
				...contentJson({
					success: z.literal(false),
					error: z.string(),
				}),
			},
			503: {
				description: "Crawl engine is not configured",
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
		const now = Date.now();
		const jobId = randomJobId(now);
		const expiresAt = now + JOB_TTL_MS;
		const sitemap = body.sitemap ?? "include";

		// The schema mirrors src/v2/scrape.ts (`.default(x).optional()`), where
		// the default is nominal and consumers resolve it with `??`. Persist the
		// resolved values so the Workflow engine (task 012) reads concrete
		// options instead of re-deriving them.
		const options: Record<string, unknown> = {
			...body,
			limit: body.limit ?? DEFAULT_LIMIT,
			allowExternalLinks: body.allowExternalLinks ?? false,
			allowSubdomains: body.allowSubdomains ?? false,
			ignoreRobotsTxt: body.ignoreRobotsTxt ?? false,
			sitemap,
		};

		// The job row is the anchor for every later step: if it cannot be written
		// there is nothing to mark failed, so fail loudly with a structured error.
		try {
			await createJob(c.env.DB, {
				id: jobId,
				url: body.url,
				options,
				now,
				expiresAt,
			});
		} catch (error) {
			console.error(
				`Crawl job creation failed for ${jobId}: ${(error as Error).message}`,
			);
			return creationFailed();
		}

		// The row exists now, so a failed seed enqueue is recoverable: mark the job
		// failed so it is never left stuck in `scraping`, then surface the error.
		// `sitemap:"only"` deliberately does not enqueue the seed: only sitemap
		// URLs are crawled. The seed is otherwise enqueued here (before the
		// workflow's sitemap URLs) and counted toward `total`.
		try {
			if (sitemap !== "only") {
				const seeded = await enqueueUrls(
					c.env.DB,
					jobId,
					[{ url: body.url, depth: 0 }],
					now,
				);
				if (seeded > 0) {
					await bumpJobCounters(c.env.DB, jobId, { total: seeded, now });
				}
			}
		} catch (error) {
			console.error(
				`Crawl seed enqueue failed for ${jobId}: ${(error as Error).message}`,
			);
			await markJobFailed(c.env.DB, jobId, CREATION_ERROR, now);
			return creationFailed();
		}

		try {
			const workflow = c.env.CRAWL_WORKFLOW;
			if (!workflow) {
				throw new Error(ENGINE_NOT_CONFIGURED);
			}
			await workflow.create({ id: jobId, params: { jobId } });
		} catch (error) {
			const reason = (error as Error).message ?? String(error);
			console.error(`Crawl enqueue failed for ${jobId}: ${reason}`);
			await setJobStatus(c.env.DB, jobId, "failed", {
				error: `${ENGINE_NOT_CONFIGURED}: ${reason}`,
				completedAt: now,
			});
			return Response.json(
				{ success: false, error: ENGINE_NOT_CONFIGURED, details: reason },
				{ status: 503 },
			);
		}

		const ignored: string[] = IGNORED_FIELDS.filter(
			(field) => (body as Record<string, unknown>)[field] !== undefined,
		);

		// `scrapeOptions` is only honoured for `formats`; name any other sub-field
		// it carried so callers are not misled into thinking it took effect.
		const scrapeOptions = body.scrapeOptions as
			| Record<string, unknown>
			| undefined;
		if (scrapeOptions) {
			for (const key of Object.keys(scrapeOptions)) {
				if (key !== "formats") {
					ignored.push(`scrapeOptions.${key}`);
				}
			}
		}
		ignored.sort();

		const payload: {
			success: true;
			id: string;
			url: string;
			warning?: string;
		} = {
			success: true,
			id: jobId,
			url: new URL(`/v2/crawl/${jobId}`, c.req.url).toString(),
		};
		if (ignored.length > 0) {
			payload.warning = `unsupported fields ignored: ${ignored.join(", ")}`;
		}
		return payload;
	}
}

function creationFailed() {
	return Response.json(
		{ success: false, error: CREATION_ERROR },
		{ status: 500 },
	);
}

// Best-effort failure marking: if D1 is unavailable this may also throw, but the
// caller must still receive the structured 500 rather than a second stack trace.
async function markJobFailed(
	db: D1Database,
	jobId: string,
	error: string,
	now: number,
): Promise<void> {
	try {
		await setJobStatus(db, jobId, "failed", { error, completedAt: now });
	} catch (markError) {
		console.error(
			`Crawl job ${jobId} could not be marked failed: ${(markError as Error).message}`,
		);
	}
}
