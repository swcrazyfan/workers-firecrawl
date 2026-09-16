import { env } from "cloudflare:test";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	bumpJobCounters,
	createJob,
	getJob,
	insertResult,
	setJobStatus,
} from "../../src/crawler/store";
import type { Env } from "../../src/index";
import { V2Crawl } from "../../src/v2/crawl";
import { V2CrawlStatus } from "../../src/v2/crawlStatus";

// src/index.ts pulls in puppeteer/node-html-markdown through the v1 routes and
// the other v2 routes; replace them with trivial chanfana endpoints so the real
// route table can be exercised in tests. The crawl routes themselves are NOT
// mocked.
vi.mock("../../src/browser", () => ({
	getBrowser: vi.fn(),
	extractContent: vi.fn(),
}));
vi.mock("../../src/scrape", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		WebScrape: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: {} };
			}
		},
	};
});
vi.mock("../../src/webMap", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		WebMap: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: {} };
			}
		},
	};
});
vi.mock("../../src/webSearch", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		WebSearch: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: [] };
			}
		},
	};
});
vi.mock("../../src/v2/search", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		V2Search: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: {} };
			}
		},
	};
});

import app from "../../src/index";

const NOW = 1_700_000_000_000;
const SEED = "https://example.com";

interface WorkflowMock {
	create: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
}

// Bindings come from the real test env (D1); the optional Workflow binding is
// layered on top so both "configured" and "absent" cases are exercisable.
function makeEnv(workflow?: WorkflowMock | null): Env {
	const testEnv = { ...env } as unknown as Env;
	if (workflow) {
		testEnv.CRAWL_WORKFLOW = workflow as unknown as Env["CRAWL_WORKFLOW"];
	}
	return testEnv;
}

function workflowMock(): WorkflowMock {
	return { create: vi.fn().mockResolvedValue({}), get: vi.fn() };
}

function createApp() {
	const hono = new Hono<{ Bindings: Env }>();
	const openapi = fromHono(hono, { docs_url: "/" });
	openapi.post("/v2/crawl", V2Crawl);
	openapi.get("/v2/crawl/:id", V2CrawlStatus);
	openapi.delete("/v2/crawl/:id", V2CrawlStatus);
	return hono;
}

function postCrawl(body: unknown, testEnv: Env) {
	return createApp().request(
		"/v2/crawl",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		testEnv,
	);
}

async function seedJob(id: string, status: Parameters<typeof setJobStatus>[2]) {
	await createJob(env.DB, {
		id,
		url: `${SEED}/${id}`,
		options: {},
		now: NOW,
		expiresAt: NOW + 1000,
	});
	await setJobStatus(env.DB, id, status);
}

beforeEach(() => {
	vi.resetAllMocks();
});

describe("POST /v2/crawl", () => {
	it("creates a job, enqueues the seed and starts the workflow", async () => {
		const workflow = workflowMock();
		const res = await postCrawl({ url: SEED }, makeEnv(workflow));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.id).toMatch(/^crawl_\d+_[0-9a-f]{8}$/);
		expect(body.url).toContain(body.id);
		expect(body.warning).toBeUndefined();

		const row = await getJob(env.DB, body.id);
		expect(row).toMatchObject({ id: body.id, url: SEED, status: "scraping" });

		const raw = await env.DB.prepare(
			"SELECT options FROM crawl_jobs WHERE id = ?",
		)
			.bind(body.id)
			.first<{ options: string }>();
		const options = JSON.parse(raw.options);
		expect(options.url).toBe(SEED);
		expect(options.limit).toBe(10000);
		expect(options.sitemap).toBe("include");

		const queue = await env.DB.prepare(
			"SELECT url, depth, status FROM crawl_queue WHERE job_id = ?",
		)
			.bind(body.id)
			.all<{ url: string; depth: number; status: string }>();
		expect(queue.results).toEqual([
			{ url: SEED, depth: 0, status: "pending" },
		]);

		expect(workflow.create).toHaveBeenCalledTimes(1);
		expect(workflow.create).toHaveBeenCalledWith({
			id: body.id,
			params: { jobId: body.id },
		});
	});

	it("accepts scrapeOptions formats using the v2 scrape union", async () => {
		const res = await postCrawl(
			{
				url: SEED,
				scrapeOptions: {
					formats: ["markdown", "links", { type: "json", prompt: "price" }],
				},
			},
			makeEnv(workflowMock()),
		);
		expect(res.status).toBe(200);
	});

	it("returns 400 for an unknown format", async () => {
		const res = await postCrawl(
			{ url: SEED, scrapeOptions: { formats: ["nope"] } },
			makeEnv(workflowMock()),
		);
		expect(res.status).toBe(400);
	});

	it("returns 400 for missing or invalid urls", async () => {
		expect((await postCrawl({}, makeEnv(workflowMock()))).status).toBe(400);
		expect(
			(await postCrawl({ url: "not a url" }, makeEnv(workflowMock()))).status,
		).toBe(400);
	});

	it("enforces limit and maxDiscoveryDepth bounds", async () => {
		expect(
			(await postCrawl({ url: SEED, limit: 0 }, makeEnv(workflowMock()))).status,
		).toBe(400);
		expect(
			(await postCrawl({ url: SEED, limit: 100001 }, makeEnv(workflowMock())))
				.status,
		).toBe(400);
		expect(
			(await postCrawl({ url: SEED, limit: 1 }, makeEnv(workflowMock()))).status,
		).toBe(200);
		expect(
			(
				await postCrawl(
					{ url: SEED, maxDiscoveryDepth: 11 },
					makeEnv(workflowMock()),
				)
			).status,
		).toBe(400);
	});

	it("marks the job failed and returns 503 when the binding is absent", async () => {
		const res = await postCrawl({ url: SEED }, makeEnv());
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({
			success: false,
			error: "crawl engine not configured",
		});

		const rows = await env.DB.prepare(
			"SELECT status, error, completed_at FROM crawl_jobs",
		).all<{ status: string; error: string; completed_at: number | null }>();
		expect(rows.results).toHaveLength(1);
		expect(rows.results[0].status).toBe("failed");
		expect(rows.results[0].error).toBe("crawl engine not configured");
		expect(rows.results[0].completed_at).toEqual(expect.any(Number));
	});

	it("marks the job failed and returns 503 when create throws", async () => {
		const workflow: WorkflowMock = {
			create: vi.fn().mockRejectedValue(new Error("workflow unavailable")),
			get: vi.fn(),
		};
		const res = await postCrawl({ url: SEED }, makeEnv(workflow));
		expect(res.status).toBe(503);

		const rows = await env.DB.prepare(
			"SELECT status, error FROM crawl_jobs",
		).all<{ status: string; error: string }>();
		expect(rows.results[0]).toEqual({
			status: "failed",
			error: "crawl engine not configured",
		});
	});

	it("warns about accepted-and-ignored fields", async () => {
		const res = await postCrawl(
			{ url: SEED, maxConcurrency: 3, delay: 1 },
			makeEnv(workflowMock()),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.warning).toBe(
			"unsupported fields ignored: delay, maxConcurrency",
		);
	});
});

describe("GET /v2/crawl/:id", () => {
	it("returns the documented status shape", async () => {
		await seedJob("job-shape", "completed");
		await bumpJobCounters(env.DB, "job-shape", {
			total: 1,
			completed: 1,
			now: NOW + 10,
		});
		await setJobStatus(env.DB, "job-shape", "completed", {
			completedAt: NOW + 20,
		});
		await insertResult(env.DB, {
			jobId: "job-shape",
			url: `${SEED}/job-shape`,
			status: "completed",
			statusCode: 200,
			markdown: "# Hello",
			links: ["https://example.com/a"],
			metadata: { title: "Hello" },
			now: NOW + 20,
		});

		const res = await createApp().request(
			"/v2/crawl/job-shape",
			{ method: "GET" },
			makeEnv(),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			success: true,
			status: "completed",
			total: 1,
			completed: 1,
			creditsUsed: 0,
			expiresAt: NOW + 1000,
			createdAt: NOW,
			completedAt: NOW + 20,
			next: null,
		});
		expect(body.data).toHaveLength(1);
		expect(body.data[0]).toMatchObject({
			url: `${SEED}/job-shape`,
			status: "completed",
			markdown: "# Hello",
			links: ["https://example.com/a"],
			metadata: { title: "Hello" },
		});
	});

	it("emits every status enum value", async () => {
		for (const status of [
			"scraping",
			"completed",
			"failed",
			"cancelled",
		] as const) {
			await seedJob(`job-${status}`, status);
			const res = await createApp().request(
				`/v2/crawl/job-${status}`,
				{ method: "GET" },
				makeEnv(),
			);
			expect((await res.json()).status).toBe(status);
		}
	});

	it("omits optional result fields that are null", async () => {
		await seedJob("job-minimal", "scraping");
		await insertResult(env.DB, {
			jobId: "job-minimal",
			url: `${SEED}/minimal`,
			status: "completed",
			now: NOW,
		});
		const res = await createApp().request(
			"/v2/crawl/job-minimal",
			{ method: "GET" },
			makeEnv(),
		);
		const { data } = await res.json();
		expect(Object.keys(data[0]).sort()).toEqual(["status", "url"]);
	});

	it("paginates with a relative next link", async () => {
		await seedJob("job-next", "scraping");
		for (let i = 1; i <= 3; i++) {
			await insertResult(env.DB, {
				jobId: "job-next",
				url: `${SEED}/${i}`,
				status: "completed",
				now: NOW + i,
			});
		}

		const first = await createApp().request(
			"/v2/crawl/job-next?limit=2",
			{ method: "GET" },
			makeEnv(),
		);
		const firstBody = await first.json();
		expect(firstBody.data.map((item: { url: string }) => item.url)).toEqual([
			`${SEED}/1`,
			`${SEED}/2`,
		]);
		expect(firstBody.next).toMatch(/^\/v2\/crawl\/job-next\?skip=\d+&limit=2$/);

		const second = await createApp().request(
			firstBody.next,
			{ method: "GET" },
			makeEnv(),
		);
		const secondBody = await second.json();
		expect(secondBody.data.map((item: { url: string }) => item.url)).toEqual([
			`${SEED}/3`,
		]);
		expect(secondBody.next).toBeNull();
	});

	it("defaults limit to 50 and enforces the 200 cap", async () => {
		await seedJob("job-limit", "scraping");
		const ok = await createApp().request(
			"/v2/crawl/job-limit",
			{ method: "GET" },
			makeEnv(),
		);
		expect(ok.status).toBe(200);

		expect(
			(
				await createApp().request(
					"/v2/crawl/job-limit?limit=201",
					{ method: "GET" },
					makeEnv(),
				)
			).status,
		).toBe(400);
		expect(
			(
				await createApp().request(
					"/v2/crawl/job-limit?skip=-1",
					{ method: "GET" },
					makeEnv(),
				)
			).status,
		).toBe(400);
	});

	it("returns 404 for an unknown id", async () => {
		const res = await createApp().request(
			"/v2/crawl/does-not-exist",
			{ method: "GET" },
			makeEnv(),
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			success: false,
			error: "crawl job not found",
		});
	});
});

describe("DELETE /v2/crawl/:id", () => {
	it("terminates the workflow and cancels the job", async () => {
		await seedJob("job-delete", "scraping");
		const terminate = vi.fn().mockResolvedValue(undefined);
		const workflow: WorkflowMock = {
			create: vi.fn(),
			get: vi.fn().mockResolvedValue({ terminate }),
		};

		const res = await createApp().request(
			"/v2/crawl/job-delete",
			{ method: "DELETE" },
			makeEnv(workflow),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, status: "cancelled" });
		expect(workflow.get).toHaveBeenCalledWith("job-delete");
		expect(terminate).toHaveBeenCalledTimes(1);

		expect((await getJob(env.DB, "job-delete")).status).toBe("cancelled");
	});

	it("still cancels when the binding is absent", async () => {
		await seedJob("job-delete-nobind", "scraping");
		const res = await createApp().request(
			"/v2/crawl/job-delete-nobind",
			{ method: "DELETE" },
			makeEnv(),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, status: "cancelled" });
		expect((await getJob(env.DB, "job-delete-nobind")).status).toBe(
			"cancelled",
		);
	});

	it("still cancels when terminate throws", async () => {
		await seedJob("job-delete-throw", "scraping");
		const workflow: WorkflowMock = {
			create: vi.fn(),
			get: vi.fn().mockResolvedValue({
				terminate: vi.fn().mockRejectedValue(new Error("already complete")),
			}),
		};
		const res = await createApp().request(
			"/v2/crawl/job-delete-throw",
			{ method: "DELETE" },
			makeEnv(workflow),
		);
		expect(res.status).toBe(200);
		expect((await getJob(env.DB, "job-delete-throw")).status).toBe(
			"cancelled",
		);
	});

	it("returns 404 for an unknown id", async () => {
		const res = await createApp().request(
			"/v2/crawl/does-not-exist",
			{ method: "DELETE" },
			makeEnv(),
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			success: false,
			error: "crawl job not found",
		});
	});
});

describe("crawl routing", () => {
	it("registers the crawl routes on the real app", async () => {
		const created = await app.request(
			"/v2/crawl",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: SEED }),
			},
			makeEnv(),
		);
		// Registered but inert until task 012 provides the binding.
		expect(created.status).toBe(503);

		const status = await app.request(
			"/v2/crawl/unknown",
			{ method: "GET" },
			makeEnv(),
		);
		expect(status.status).toBe(404);
		expect((await status.json()).error).toBe("crawl job not found");

		const removed = await app.request(
			"/v2/crawl/unknown",
			{ method: "DELETE" },
			makeEnv(),
		);
		expect(removed.status).toBe(404);
	});

	it("does not expose GET or DELETE without an id", async () => {
		expect(
			(await app.request("/v2/crawl", { method: "GET" }, makeEnv())).status,
		).toBe(404);
		expect(
			(await app.request("/v2/crawl", { method: "DELETE" }, makeEnv())).status,
		).toBe(404);
	});
});
