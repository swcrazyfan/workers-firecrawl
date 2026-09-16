import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractStructured } from "../../src/ai/extract";
import {
	ROBOTS_DISALLOWED,
	createJob,
	insertResult,
	setJobStatus,
} from "../../src/crawler/store";
import type { Env } from "../../src/index";

// src/index.ts pulls in puppeteer/node-html-markdown through the v1 routes and
// the other v2 routes; replace them with trivial chanfana endpoints so the real
// route table can be exercised in tests. The crawl routes themselves are NOT
// mocked, and `src/v2/scrape` stays real so the preview resolves through the
// actual schema helpers. The AI pipeline is mocked so no provider is contacted.
vi.mock("../../src/browser", () => ({
	getBrowser: vi.fn(),
	extractContent: vi.fn(),
}));
vi.mock("../../src/ai/extract", () => ({
	extractStructured: vi.fn(),
	summarize: vi.fn(),
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

// Engine-default parameters, the documented fallback when generation fails.
const DEFAULT_PARAMS = {
	allowExternalLinks: false,
	allowSubdomains: false,
	crawlEntireDomain: false,
	deduplicateSimilarURLs: true,
	delay: 0,
	excludePaths: [],
	ignoreQueryParameters: false,
	ignoreRobotsTxt: false,
	includePaths: [],
	limit: 10000,
	maxDepth: 10,
	maxDiscoveryDepth: 10,
	robotsUserAgent: "",
	sitemap: "include",
	url: SEED,
};

const GENERATED_PARAMS = {
	allowExternalLinks: true,
	allowSubdomains: false,
	crawlEntireDomain: false,
	deduplicateSimilarURLs: true,
	delay: 250,
	excludePaths: ["/logout"],
	ignoreQueryParameters: true,
	ignoreRobotsTxt: false,
	includePaths: ["/blog/.*"],
	limit: 500,
	maxDepth: 3,
	maxDiscoveryDepth: 2,
	robotsUserAgent: "mybot",
	sitemap: "include",
	url: SEED,
};

interface WorkflowMock {
	create: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
}

function makeEnv(workflow?: WorkflowMock): Env {
	const testEnv = { ...env } as unknown as Env;
	if (workflow) {
		testEnv.CRAWL_WORKFLOW = workflow as unknown as Env["CRAWL_WORKFLOW"];
	}
	return testEnv;
}

function workflowMock(): WorkflowMock {
	return { create: vi.fn().mockResolvedValue({}), get: vi.fn() };
}

function get(path: string, testEnv: Env = makeEnv()) {
	return app.request(path, { method: "GET" }, testEnv);
}

function postPreview(body: unknown, testEnv: Env = makeEnv()) {
	return app.request(
		"/v2/crawl/params-preview",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		testEnv,
	);
}

async function seedJob(
	id: string,
	opts?: {
		status?: Parameters<typeof setJobStatus>[2];
		now?: number;
		expiresAt?: number;
	},
) {
	const now = opts?.now ?? NOW;
	await createJob(env.DB, {
		id,
		url: `${SEED}/${id}`,
		options: {},
		now,
		expiresAt: opts?.expiresAt ?? NOW + 1000,
	});
	if (opts?.status && opts.status !== "scraping") {
		await setJobStatus(env.DB, id, opts.status);
	}
}

beforeEach(() => {
	vi.resetAllMocks();
});

describe("GET /v2/crawl/:id/errors", () => {
	it("returns 404 for an unknown job instead of an empty list", async () => {
		const res = await get("/v2/crawl/does-not-exist/errors");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			success: false,
			error: "crawl job not found",
		});
	});

	it("lists only failed rows with an error, newest first, with ISO timestamps", async () => {
		await seedJob("job-mixed");
		await insertResult(env.DB, {
			jobId: "job-mixed",
			url: `${SEED}/ok`,
			status: "completed",
			now: NOW + 1,
		});
		await insertResult(env.DB, {
			jobId: "job-mixed",
			url: `${SEED}/boom-1`,
			status: "failed",
			error: "boom-1",
			now: NOW + 2,
		});
		// A failed row with no error is not reportable.
		await insertResult(env.DB, {
			jobId: "job-mixed",
			url: `${SEED}/no-error`,
			status: "failed",
			now: NOW + 3,
		});
		await insertResult(env.DB, {
			jobId: "job-mixed",
			url: `${SEED}/boom-2`,
			status: "failed",
			error: "boom-2",
			now: NOW + 4,
		});

		const res = await get("/v2/crawl/job-mixed/errors");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.errors.map((item: { error: string }) => item.error)).toEqual([
			"boom-2",
			"boom-1",
		]);
		expect(body.errors.map((item: { url: string }) => item.url)).toEqual([
			`${SEED}/boom-2`,
			`${SEED}/boom-1`,
		]);
		// The contract types `id` as a string even though D1 stores an integer.
		expect(typeof body.errors[0].id).toBe("string");
		expect(body.errors[0].id).toMatch(/^\d+$/);
		// Timestamps are ISO-8601 date-time strings, not epoch millis.
		expect(body.errors[0].timestamp).toBe(new Date(NOW + 4).toISOString());
		expect(body.errors[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(body.robotsBlocked).toEqual([]);
	});

	it("reports robots-disallowed rows in both errors and robotsBlocked", async () => {
		await seedJob("job-robots");
		await insertResult(env.DB, {
			jobId: "job-robots",
			url: `${SEED}/blocked`,
			status: "failed",
			error: ROBOTS_DISALLOWED,
			now: NOW + 1,
		});
		await insertResult(env.DB, {
			jobId: "job-robots",
			url: `${SEED}/timeout`,
			status: "failed",
			error: "timeout",
			now: NOW + 2,
		});

		const body = await (await get("/v2/crawl/job-robots/errors")).json();
		expect(body.errors.map((item: { url: string }) => item.url)).toEqual([
			`${SEED}/timeout`,
			`${SEED}/blocked`,
		]);
		expect(body.robotsBlocked).toEqual([`${SEED}/blocked`]);
		// Intended overlap: a robots block is still an error entry.
		expect(
			body.errors.some(
				(item: { url: string; error: string }) =>
					item.url === `${SEED}/blocked` && item.error === ROBOTS_DISALLOWED,
			),
		).toBe(true);
	});

	it("ignores non-failed rows that happen to carry the robots error", async () => {
		await seedJob("job-robots-status");
		await insertResult(env.DB, {
			jobId: "job-robots-status",
			url: `${SEED}/not-failed`,
			status: "completed",
			error: ROBOTS_DISALLOWED,
			now: NOW + 1,
		});
		const body = await (
			await get("/v2/crawl/job-robots-status/errors")
		).json();
		expect(body.errors).toEqual([]);
		expect(body.robotsBlocked).toEqual([]);
	});

	it("deduplicates the robotsBlocked list", async () => {
		await seedJob("job-robots-dup");
		for (const now of [NOW + 1, NOW + 2]) {
			await insertResult(env.DB, {
				jobId: "job-robots-dup",
				url: `${SEED}/blocked`,
				status: "failed",
				error: ROBOTS_DISALLOWED,
				now,
			});
		}
		const body = await (await get("/v2/crawl/job-robots-dup/errors")).json();
		expect(body.robotsBlocked).toEqual([`${SEED}/blocked`]);
		expect(body.errors).toHaveLength(2);
	});

	it("returns empty arrays with 200 when nothing failed", async () => {
		await seedJob("job-no-errors");
		await insertResult(env.DB, {
			jobId: "job-no-errors",
			url: `${SEED}/ok`,
			status: "completed",
			now: NOW + 1,
		});
		const res = await get("/v2/crawl/job-no-errors/errors");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			errors: [],
			robotsBlocked: [],
		});
	});

	it("caps the error list at 100 by default and honours limit", async () => {
		await seedJob("job-cap");
		for (let i = 1; i <= 105; i++) {
			await insertResult(env.DB, {
				jobId: "job-cap",
				url: `${SEED}/c-${i}`,
				status: "failed",
				error: `e${i}`,
				now: NOW + i,
			});
		}

		const body = await (await get("/v2/crawl/job-cap/errors")).json();
		expect(body.errors).toHaveLength(100);
		expect(body.errors[0].error).toBe("e105");

		const capped = await (
			await get("/v2/crawl/job-cap/errors?limit=3")
		).json();
		expect(capped.errors.map((item: { error: string }) => item.error)).toEqual([
			"e105",
			"e104",
			"e103",
		]);
	});

	it("rejects an out-of-range limit", async () => {
		await seedJob("job-bad-limit");
		expect((await get("/v2/crawl/job-bad-limit/errors?limit=0")).status).toBe(
			400,
		);
		expect(
			(await get("/v2/crawl/job-bad-limit/errors?limit=5000")).status,
		).toBe(400);
	});
});

describe("GET /v2/crawl/active", () => {
	it("returns only unexpired scraping jobs, oldest first, with ISO createdAt", async () => {
		const now = Date.now();
		await seedJob("active-old", {
			now: now - 2000,
			expiresAt: now + 60_000,
		});
		await seedJob("active-new", {
			now: now - 1000,
			expiresAt: now + 60_000,
		});
		await seedJob("active-expired", {
			now: now - 3000,
			expiresAt: now - 1,
		});
		await seedJob("active-done", {
			status: "completed",
			now: now - 4000,
			expiresAt: now + 60_000,
		});

		const res = await get("/v2/crawl/active");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.crawls.map((item: { id: string }) => item.id)).toEqual([
			"active-old",
			"active-new",
		]);
		expect(body.crawls[0]).toMatchObject({
			// Required by the contract; a documented self-hosted placeholder.
			teamId: "self-hosted",
			status: "scraping",
			url: `${SEED}/active-old`,
			total: 0,
			completed: 0,
		});
		// `options` is intentionally not exposed (it can carry a webhook URL).
		expect(body.crawls[0]).not.toHaveProperty("options");
		expect(body.crawls[0].createdAt).toBe(new Date(now - 2000).toISOString());
	});

	it("caps the list at 100 by default and honours limit", async () => {
		const now = Date.now();
		for (let i = 1; i <= 105; i++) {
			await createJob(env.DB, {
				id: `active-cap-${i}`,
				url: `${SEED}/a-${i}`,
				options: {},
				now: now + i,
				expiresAt: now + 60_000,
			});
		}

		const body = await (await get("/v2/crawl/active")).json();
		expect(body.crawls).toHaveLength(100);
		// Oldest first: the five newest jobs fall outside the cap.
		expect(body.crawls[0].url).toBe(`${SEED}/a-1`);
		expect(body.crawls[99].url).toBe(`${SEED}/a-100`);

		const capped = await (await get("/v2/crawl/active?limit=2")).json();
		expect(capped.crawls.map((item: { url: string }) => item.url)).toEqual([
			`${SEED}/a-1`,
			`${SEED}/a-2`,
		]);
	});

	it("rejects an out-of-range limit", async () => {
		expect((await get("/v2/crawl/active?limit=0")).status).toBe(400);
		expect((await get("/v2/crawl/active?limit=5000")).status).toBe(400);
	});
});

describe("POST /v2/crawl/params-preview", () => {
	it("returns parameters generated from the prompt, validated and normalised", async () => {
		vi.mocked(extractStructured).mockResolvedValue({
			data: GENERATED_PARAMS,
			attempts: 1,
			model: "test-model",
		});

		const res = await postPreview({
			url: SEED,
			prompt: "crawl only the blog and allow external links",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toEqual(GENERATED_PARAMS);
		expect(body.warning).toBeUndefined();

		// The model sees the URL and the user prompt; nothing is fetched.
		expect(extractStructured).toHaveBeenCalledTimes(1);
		const [input] = vi.mocked(extractStructured).mock.calls[0];
		expect(input.content).toContain(SEED);
		expect(input.content).toContain("crawl only the blog");
		expect(input.prompt).toContain(SEED);
		expect(input.prompt).toContain("crawl only the blog");
		expect(input.jsonSchema).toBeDefined();
	});

	it("clamps out-of-range generated values to legal ranges", async () => {
		vi.mocked(extractStructured).mockResolvedValue({
			data: {
				...GENERATED_PARAMS,
				limit: 999999,
				maxDepth: 500,
				maxDiscoveryDepth: 500,
				sitemap: "only",
				delay: 12.9,
			},
			attempts: 1,
		});

		const body = await (await postPreview({ url: SEED, prompt: "everything" }))
			.json();
		expect(body.data).toMatchObject({
			limit: 100000,
			maxDepth: 10,
			maxDiscoveryDepth: 10,
			sitemap: "only",
			delay: 12,
		});
	});

	it("falls back to engine defaults with a warning when generation produces no data", async () => {
		vi.mocked(extractStructured).mockResolvedValue({
			warning: "AI not configured: no AI provider configured",
			attempts: 0,
		});

		const res = await postPreview({ url: SEED, prompt: "crawl the docs" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toEqual(DEFAULT_PARAMS);
		expect(body.warning).toContain("engine default");
		expect(body.warning).toContain("AI not configured");
	});

	it("falls back to engine defaults when the generated values fail validation", async () => {
		// A partial/unsafe result must not be returned as if it were generated.
		vi.mocked(extractStructured).mockResolvedValue({
			data: { limit: 5, url: SEED },
			attempts: 1,
		});

		const res = await postPreview({ url: SEED, prompt: "crawl the docs" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual(DEFAULT_PARAMS);
		expect(body.warning).toContain("engine default");
	});

	it("never throws when the AI pipeline rejects", async () => {
		vi.mocked(extractStructured).mockRejectedValue(new Error("provider down"));

		const res = await postPreview({ url: SEED, prompt: "crawl the docs" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual(DEFAULT_PARAMS);
		expect(body.warning).toContain("engine default");
	});

	it("is a pure preview: no job, no enqueue, no workflow, no outbound fetch", async () => {
		const workflow = workflowMock();
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		vi.mocked(extractStructured).mockResolvedValue({
			data: GENERATED_PARAMS,
			attempts: 1,
		});

		const res = await postPreview(
			{ url: SEED, prompt: "crawl the blog" },
			makeEnv(workflow),
		);
		expect(res.status).toBe(200);

		expect(workflow.create).not.toHaveBeenCalled();
		expect(workflow.get).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();

		const jobs = await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM crawl_jobs",
		).first<{ count: number }>();
		expect(jobs.count).toBe(0);
		const queue = await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM crawl_queue",
		).first<{ count: number }>();
		expect(queue.count).toBe(0);

		fetchSpy.mockRestore();
	});

	it("returns 400 for a missing or invalid body", async () => {
		// `prompt` is required.
		expect((await postPreview({ url: SEED })).status).toBe(400);
		expect((await postPreview({ prompt: "crawl the blog" })).status).toBe(400);
		expect(
			(await postPreview({ url: "not a url", prompt: "crawl" })).status,
		).toBe(400);
	});

	it("returns 400 for a prompt longer than 10000 characters", async () => {
		expect(
			(await postPreview({ url: SEED, prompt: "a".repeat(10001) })).status,
		).toBe(400);
		expect(
			(await postPreview({ url: SEED, prompt: "a".repeat(10000) })).status,
		).toBe(200);
	});
});

describe("crawl extras routing", () => {
	it("does not let /v2/crawl/:id swallow GET /v2/crawl/active", async () => {
		const now = Date.now();
		await createJob(env.DB, {
			id: "routed-active",
			url: `${SEED}/routed`,
			options: {},
			now,
			expiresAt: now + 60_000,
		});

		const res = await get("/v2/crawl/active");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.crawls)).toBe(true);
		expect(body.crawls[0].id).toBe("routed-active");
		// The status handler's shape must not be what answered this request.
		expect(body.error).toBeUndefined();
		expect(body.status).toBeUndefined();
	});

	it("routes GET /v2/crawl/:id/errors to the errors handler", async () => {
		await seedJob("routed-err");
		await insertResult(env.DB, {
			jobId: "routed-err",
			url: `${SEED}/f`,
			status: "failed",
			error: "boom",
			now: NOW + 1,
		});

		const res = await get("/v2/crawl/routed-err/errors");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.errors)).toBe(true);
		expect(body.errors[0].error).toBe("boom");
		expect(body.crawls).toBeUndefined();
	});

	it("routes POST /v2/crawl/params-preview to the preview handler", async () => {
		vi.mocked(extractStructured).mockResolvedValue({
			data: GENERATED_PARAMS,
			attempts: 1,
		});
		const res = await postPreview({ url: SEED, prompt: "crawl the blog" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.limit).toBe(500);
	});
});
