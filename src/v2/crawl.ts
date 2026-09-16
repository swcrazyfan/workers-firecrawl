import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { createJob, enqueueUrls, setJobStatus } from "../crawler/store";
import type { AppContext } from "../index";
import { scrapeFormatSchema } from "./scrape";

const DEFAULT_LIMIT = 10000;
const MAX_LIMIT = 100000;
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The engine (Cloudflare Workflows) is task 012. Until its binding exists this
// endpoint is deployable but inert: the job is recorded, marked failed and the
// caller gets a 503 instead of a job that never progresses.
const ENGINE_NOT_CONFIGURED = "crawl engine not configured";

// v2 crawl fields this deployment validates for SDK compatibility but does not
// act on. `handle` reports them through the response `warning`.
const IGNORED_FIELDS = [
	"crawlEntireDomain",
	"delay",
	"maxConcurrency",
	"regexOnFullURL",
	"robotsUserAgent",
	"zeroDataRetention",
	"prompt",
	"excludeTags",
	"includeTags",
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
							includePaths: z.string().array().optional(),
							excludePaths: z.string().array().optional(),
							ignoreRobotsTxt: z.boolean().default(false).optional(),
							sitemap: z
								.enum(["skip", "include", "only"])
								.default("include")
								.optional(),
							scrapeOptions: z
								.object({ formats: z.array(scrapeFormatSchema).optional() })
								.optional(),
							webhook: z.string().url().optional(),
							// Accepted-and-ignored: see IGNORED_FIELDS.
							crawlEntireDomain: z.boolean().optional(),
							delay: z.number().optional(),
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
			sitemap: body.sitemap ?? "include",
		};

		// The job and its seed URL are persisted before enqueueing so a failed
		// enqueue still leaves an inspectable, failed job row.
		await createJob(c.env.DB, {
			id: jobId,
			url: body.url,
			options,
			now,
			expiresAt,
		});
		await enqueueUrls(c.env.DB, jobId, [{ url: body.url, depth: 0 }], now);

		try {
			const workflow = c.env.CRAWL_WORKFLOW;
			if (!workflow) {
				throw new Error(ENGINE_NOT_CONFIGURED);
			}
			await workflow.create({ id: jobId, params: { jobId } });
		} catch (error) {
			console.error(
				`Crawl enqueue failed for ${jobId}: ${(error as Error).message}`,
			);
			await setJobStatus(c.env.DB, jobId, "failed", {
				error: ENGINE_NOT_CONFIGURED,
				completedAt: now,
			});
			return Response.json(
				{ success: false, error: ENGINE_NOT_CONFIGURED },
				{ status: 503 },
			);
		}

		const ignored = IGNORED_FIELDS.filter(
			(field) => (body as Record<string, unknown>)[field] !== undefined,
		);

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
