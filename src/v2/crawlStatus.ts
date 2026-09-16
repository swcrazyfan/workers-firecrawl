import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import {
	type CrawlResultRow,
	getJob,
	listResults,
	setJobStatus,
} from "../crawler/store";
import type { AppContext } from "../index";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const NOT_FOUND = "crawl job not found";

const dataItemSchema = z.object({
	url: z.string(),
	markdown: z.string().optional(),
	html: z.string().optional(),
	rawHtml: z.string().optional(),
	links: z.string().array().optional(),
	metadata: z.unknown().optional(),
	json: z.unknown().optional(),
	status: z.string(),
	error: z.string().optional(),
});

// Shapes an internal result row into the v2 `data[]` contract: optional fields
// are omitted rather than emitted as null.
function toDataItem(row: CrawlResultRow): z.infer<typeof dataItemSchema> {
	const item: z.infer<typeof dataItemSchema> = {
		url: row.url,
		status: row.status,
	};
	if (row.markdown !== null) item.markdown = row.markdown;
	if (row.html !== null) item.html = row.html;
	if (row.raw_html !== null) item.rawHtml = row.raw_html;
	if (row.links !== null) item.links = row.links;
	if (row.metadata !== null) item.metadata = row.metadata;
	if (row.json !== null) item.json = row.json;
	if (row.error !== null) item.error = row.error;
	return item;
}

export class V2CrawlStatus extends OpenAPIRoute {
	schema = {
		request: {
			query: z.object({
				limit: z.coerce
					.number()
					.int()
					.min(1)
					.max(MAX_LIMIT)
					.default(DEFAULT_LIMIT)
					.optional(),
				skip: z.coerce.number().int().min(0).default(0).optional(),
			}),
		},
		responses: {
			200: {
				description: "Crawl job status",
				...contentJson(
					z.union([
						z.object({
							success: z.literal(true),
							status: z.enum(["scraping", "completed", "failed", "cancelled"]),
							total: z.number(),
							completed: z.number(),
							creditsUsed: z.literal(0),
							expiresAt: z.number(),
							createdAt: z.number(),
							completedAt: z.number().nullable(),
							data: z.array(dataItemSchema),
							next: z.string().nullable(),
						}),
						z.object({
							success: z.literal(true),
							status: z.literal("cancelled"),
						}),
					]),
				),
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
		if (c.req.method === "DELETE") {
			return this.handleDelete(c);
		}
		return this.handleGet(c);
	}

	private async handleGet(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const id = c.req.param("id");
		const job = await getJob(c.env.DB, id);
		if (!job) {
			return notFound();
		}

		const limit = data.query.limit ?? DEFAULT_LIMIT;
		const skip = data.query.skip ?? 0;

		// `skip` is the cursor carried by `next`: the id of the last result the
		// caller already has (0/absent starts at the beginning). This keeps
		// pagination stable while new results are inserted mid-crawl, which an
		// OFFSET would not.
		const rows = await listResults(c.env.DB, id, {
			afterId: skip > 0 ? skip : undefined,
			limit: limit + 1,
		});
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];
		const next =
			hasMore && last
				? `/v2/crawl/${encodeURIComponent(id)}?skip=${last.id}&limit=${limit}`
				: null;

		return {
			success: true,
			status: job.status,
			total: job.total,
			completed: job.completed,
			// Self-hosted: no credit metering exists, so this is always the real
			// value (0) rather than a fabricated estimate. Kept for contract shape.
			creditsUsed: 0,
			expiresAt: job.expires_at,
			createdAt: job.created_at,
			completedAt: job.completed_at,
			data: page.map(toDataItem),
			next,
		};
	}

	private async handleDelete(c: AppContext) {
		const id = c.req.param("id");
		const job = await getJob(c.env.DB, id);
		if (!job) {
			return notFound();
		}

		// Best-effort terminate: the instance may already be complete/errored and
		// `terminate` then throws. Cancellation must still succeed.
		const workflow = c.env.CRAWL_WORKFLOW;
		if (workflow) {
			try {
				const instance = await workflow.get(id);
				await instance.terminate();
			} catch (error) {
				console.warn(
					`Crawl terminate failed for ${id}: ${(error as Error).message}`,
				);
			}
		}

		await setJobStatus(c.env.DB, id, "cancelled", { completedAt: Date.now() });
		return { success: true, status: "cancelled" as const };
	}
}

function notFound() {
	return Response.json({ success: false, error: NOT_FOUND }, { status: 404 });
}
