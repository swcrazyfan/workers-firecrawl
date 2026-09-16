import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	bumpJobCounters,
	claimNextBatch,
	createJob,
	enqueueUrls,
	getJob,
	insertResult,
	listResults,
	markQueueItem,
	pendingQueueCount,
	purgeExpired,
	setJobStatus,
} from "../../src/crawler/store";

const NOW = 1_700_000_000_000;

function newJob(id: string, expiresAt = NOW + 60_000) {
	return { id, url: `https://example.com/${id}`, options: null, now: NOW, expiresAt };
}

describe("crawl store: jobs", () => {
	it("round-trips a job row including JSON options", async () => {
		await createJob(env.DB, {
			id: "job-1",
			url: "https://example.com",
			options: { limit: 5, sitemap: "only", scrapeOptions: { formats: ["markdown"] } },
			now: NOW,
			expiresAt: NOW + 1000,
		});

		const row = await getJob(env.DB, "job-1");
		expect(row).toEqual({
			id: "job-1",
			url: "https://example.com",
			status: "scraping",
			total: 0,
			completed: 0,
			error: null,
			created_at: NOW,
			updated_at: NOW,
			expires_at: NOW + 1000,
			completed_at: null,
		});

		const raw = await env.DB.prepare(
			"SELECT options FROM crawl_jobs WHERE id = ?",
		)
			.bind("job-1")
			.first<{ options: string }>();
		expect(JSON.parse(raw.options)).toEqual({
			limit: 5,
			sitemap: "only",
			scrapeOptions: { formats: ["markdown"] },
		});

		expect(await getJob(env.DB, "missing")).toBeNull();
	});

	it("stores null options when none are provided", async () => {
		await createJob(env.DB, newJob("job-null"));
		const raw = await env.DB.prepare(
			"SELECT options FROM crawl_jobs WHERE id = ?",
		)
			.bind("job-null")
			.first<{ options: string | null }>();
		expect(raw.options).toBeNull();
	});

	it("updates status, error and completedAt independently", async () => {
		await createJob(env.DB, newJob("job-status"));

		await setJobStatus(env.DB, "job-status", "completed", {
			completedAt: NOW + 5,
		});
		let row = await getJob(env.DB, "job-status");
		expect(row.status).toBe("completed");
		expect(row.completed_at).toBe(NOW + 5);

		await setJobStatus(env.DB, "job-status", "failed", { error: "boom" });
		row = await getJob(env.DB, "job-status");
		expect(row.status).toBe("failed");
		expect(row.error).toBe("boom");
		// completedAt is untouched when not supplied.
		expect(row.completed_at).toBe(NOW + 5);

		await setJobStatus(env.DB, "job-status", "cancelled", {
			error: null,
			completedAt: null,
		});
		row = await getJob(env.DB, "job-status");
		expect(row.status).toBe("cancelled");
		expect(row.error).toBeNull();
		expect(row.completed_at).toBeNull();
	});

	it("increments counters additively in a single statement", async () => {
		await createJob(env.DB, newJob("job-counters"));

		await bumpJobCounters(env.DB, "job-counters", {
			total: 3,
			completed: 1,
			now: NOW + 10,
		});
		let row = await getJob(env.DB, "job-counters");
		expect({ total: row.total, completed: row.completed }).toEqual({
			total: 3,
			completed: 1,
		});
		expect(row.updated_at).toBe(NOW + 10);

		await bumpJobCounters(env.DB, "job-counters", {
			total: 2,
			completed: 2,
			now: NOW + 11,
		});
		row = await getJob(env.DB, "job-counters");
		expect({ total: row.total, completed: row.completed }).toEqual({
			total: 5,
			completed: 3,
		});

		// No counters: only the timestamp moves.
		await bumpJobCounters(env.DB, "job-counters", { now: NOW + 12 });
		row = await getJob(env.DB, "job-counters");
		expect({ total: row.total, completed: row.completed }).toEqual({
			total: 5,
			completed: 3,
		});
	});
});

describe("crawl store: queue", () => {
	it("dedupes enqueued urls and returns the inserted count", async () => {
		await createJob(env.DB, newJob("job-queue"));

		const inserted = await enqueueUrls(
			env.DB,
			"job-queue",
			[
				{ url: "https://example.com/a", depth: 0 },
				{ url: "https://example.com/b", depth: 1 },
				{ url: "https://example.com/a", depth: 0 },
			],
			NOW,
		);
		expect(inserted).toBe(2);

		// Re-enqueueing an existing url is ignored; a new one is inserted.
		const insertedAgain = await enqueueUrls(
			env.DB,
			"job-queue",
			[
				{ url: "https://example.com/a", depth: 0 },
				{ url: "https://example.com/c", depth: 2 },
			],
			NOW + 1,
		);
		expect(insertedAgain).toBe(1);

		const rows = await env.DB.prepare(
			"SELECT url, depth, status FROM crawl_queue WHERE job_id = ? ORDER BY url",
		)
			.bind("job-queue")
			.all<{ url: string; depth: number; status: string }>();
		expect(rows.results).toEqual([
			{ url: "https://example.com/a", depth: 0, status: "pending" },
			{ url: "https://example.com/b", depth: 1, status: "pending" },
			{ url: "https://example.com/c", depth: 2, status: "pending" },
		]);
	});

	it("returns 0 for an empty enqueue list", async () => {
		await createJob(env.DB, newJob("job-empty"));
		expect(await enqueueUrls(env.DB, "job-empty", [], NOW)).toBe(0);
	});

	it("claims batches atomically without double-claiming", async () => {
		await createJob(env.DB, newJob("job-claim"));
		await enqueueUrls(
			env.DB,
			"job-claim",
			["a", "b", "c", "d", "e"].map((url) => ({ url, depth: 0 })),
			NOW,
		);

		expect(await pendingQueueCount(env.DB, "job-claim")).toBe(5);

		const first = await claimNextBatch(env.DB, "job-claim", 2);
		expect(first.map((item) => item.url).sort()).toEqual(["a", "b"]);
		expect(await pendingQueueCount(env.DB, "job-claim")).toBe(3);

		const second = await claimNextBatch(env.DB, "job-claim", 2);
		expect(second.map((item) => item.url).sort()).toEqual(["c", "d"]);

		const third = await claimNextBatch(env.DB, "job-claim", 2);
		expect(third.map((item) => item.url)).toEqual(["e"]);

		expect(await claimNextBatch(env.DB, "job-claim", 2)).toEqual([]);
		expect(await pendingQueueCount(env.DB, "job-claim")).toBe(0);

		const claiming = await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM crawl_queue WHERE job_id = ? AND status = 'processing'",
		)
			.bind("job-claim")
			.first<{ count: number }>();
		expect(claiming.count).toBe(5);
	});

	it("never hands the same row to concurrent claimers", async () => {
		await createJob(env.DB, newJob("job-concurrent"));
		await enqueueUrls(
			env.DB,
			"job-concurrent",
			["a", "b", "c", "d", "e"].map((url) => ({ url, depth: 0 })),
			NOW,
		);

		const [left, right] = await Promise.all([
			claimNextBatch(env.DB, "job-concurrent", 3),
			claimNextBatch(env.DB, "job-concurrent", 3),
		]);
		const urls = [...left, ...right].map((item) => item.url);
		expect(urls).toHaveLength(5);
		expect(new Set(urls).size).toBe(5);
		expect(await pendingQueueCount(env.DB, "job-concurrent")).toBe(0);
	});

	it("marks queue items done or failed", async () => {
		await createJob(env.DB, newJob("job-mark"));
		await enqueueUrls(
			env.DB,
			"job-mark",
			[
				{ url: "a", depth: 0 },
				{ url: "b", depth: 0 },
			],
			NOW,
		);
		const [a, b] = await claimNextBatch(env.DB, "job-mark", 2);
		await markQueueItem(env.DB, a.id, "done");
		await markQueueItem(env.DB, b.id, "failed");

		const rows = await env.DB.prepare(
			"SELECT url, status FROM crawl_queue WHERE job_id = ? ORDER BY url",
		)
			.bind("job-mark")
			.all<{ url: string; status: string }>();
		expect(rows.results).toEqual([
			{ url: "a", status: "done" },
			{ url: "b", status: "failed" },
		]);
		expect(await pendingQueueCount(env.DB, "job-mark")).toBe(0);
	});
});

describe("crawl store: results", () => {
	function result(url: string, extra: Record<string, unknown> = {}) {
		return {
			jobId: "job-results",
			url,
			status: "completed",
			statusCode: 200,
			markdown: `# ${url}`,
			now: NOW,
			...extra,
		};
	}

	it("inserts and paginates results by afterId, preserving JSON columns", async () => {
		await createJob(env.DB, newJob("job-results"));
		await insertResult(
			env.DB,
			result("u1", {
				links: ["a", "b"],
				metadata: { title: "t" },
				json: { price: 1 },
				html: "<h1>u1</h1>",
			}),
		);
		await insertResult(env.DB, result("u2"));
		await insertResult(env.DB, result("u3"));
		await insertResult(env.DB, result("u4"));
		await insertResult(env.DB, result("u5", { error: "partial" }));

		const page1 = await listResults(env.DB, "job-results", { limit: 2 });
		expect(page1.map((row) => row.url)).toEqual(["u1", "u2"]);
		expect(page1[0]).toMatchObject({
			status: "completed",
			status_code: 200,
			links: ["a", "b"],
			metadata: { title: "t" },
			json: { price: 1 },
			html: "<h1>u1</h1>",
			error: null,
		});
		expect(page1[1].links).toBeNull();
		expect(page1[1].metadata).toBeNull();

		const page2 = await listResults(env.DB, "job-results", {
			afterId: page1[1].id,
			limit: 2,
		});
		expect(page2.map((row) => row.url)).toEqual(["u3", "u4"]);
		expect(page2[0].id).toBeGreaterThan(page1[1].id);

		const page3 = await listResults(env.DB, "job-results", {
			afterId: page2[1].id,
			limit: 2,
		});
		expect(page3.map((row) => row.url)).toEqual(["u5"]);
		expect(page3[0].error).toBe("partial");

		expect(
			await listResults(env.DB, "job-results", {
				afterId: page3[0].id,
				limit: 2,
			}),
		).toEqual([]);
	});

	it("treats invalid JSON columns as null instead of throwing", async () => {
		await createJob(env.DB, newJob("job-bad-json"));
		await env.DB.prepare(
			"INSERT INTO crawl_results (job_id, url, status, links, metadata, json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("job-bad-json", "bad", "completed", "not-json", "{oops", "[unclosed", NOW)
			.run();

		const rows = await listResults(env.DB, "job-bad-json", { limit: 10 });
		expect(rows).toHaveLength(1);
		expect(rows[0].links).toBeNull();
		expect(rows[0].metadata).toBeNull();
		expect(rows[0].json).toBeNull();
	});

	it("scopes results to the requested job", async () => {
		await createJob(env.DB, newJob("job-a"));
		await createJob(env.DB, newJob("job-b"));
		await insertResult(env.DB, { ...result("a1"), jobId: "job-a" });
		await insertResult(env.DB, { ...result("b1"), jobId: "job-b" });

		const rows = await listResults(env.DB, "job-a", { limit: 10 });
		expect(rows.map((row) => row.url)).toEqual(["a1"]);
	});
});

describe("crawl store: purgeExpired", () => {
	it("removes only jobs that expired beyond the keep window", async () => {
		await createJob(env.DB, newJob("job-old", NOW - 10_000));
		await createJob(env.DB, newJob("job-new", NOW + 10_000));
		await enqueueUrls(
			env.DB,
			"job-old",
			[{ url: "old-seed", depth: 0 }],
			NOW,
		);
		await enqueueUrls(
			env.DB,
			"job-new",
			[{ url: "new-seed", depth: 0 }],
			NOW,
		);
		await insertResult(env.DB, {
			jobId: "job-old",
			url: "old-seed",
			status: "completed",
			now: NOW,
		});
		await insertResult(env.DB, {
			jobId: "job-new",
			url: "new-seed",
			status: "completed",
			now: NOW,
		});

		// keepSeconds=5 → cutoff NOW-5000; job-old expired at NOW-10000.
		await purgeExpired(env.DB, NOW, 5);

		expect(await getJob(env.DB, "job-old")).toBeNull();
		expect(await getJob(env.DB, "job-new")).not.toBeNull();

		const oldRows = await env.DB.prepare(
			"SELECT (SELECT COUNT(*) FROM crawl_queue WHERE job_id = 'job-old') AS queue, (SELECT COUNT(*) FROM crawl_results WHERE job_id = 'job-old') AS results",
		).first<{ queue: number; results: number }>();
		expect(oldRows.queue).toBe(0);
		expect(oldRows.results).toBe(0);

		const newRows = await env.DB.prepare(
			"SELECT (SELECT COUNT(*) FROM crawl_queue WHERE job_id = 'job-new') AS queue, (SELECT COUNT(*) FROM crawl_results WHERE job_id = 'job-new') AS results",
		).first<{ queue: number; results: number }>();
		expect(newRows.queue).toBe(1);
		expect(newRows.results).toBe(1);
	});

	it("keeps jobs that expired within the keep window", async () => {
		await createJob(env.DB, newJob("job-recent", NOW - 1_000));
		await purgeExpired(env.DB, NOW, 60);
		expect(await getJob(env.DB, "job-recent")).not.toBeNull();
	});
});
