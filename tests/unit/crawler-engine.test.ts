import { env as testEnv } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The engine must never touch a real browser or AI provider in tests.
vi.mock("../../src/browser", () => ({
	getBrowser: vi.fn(),
	extractContent: vi.fn(),
}));

vi.mock("../../src/ai/extract", () => ({
	extractStructured: vi.fn(),
	summarize: vi.fn(),
}));

// Keep the real path matcher; only the network fetch is stubbed so tests can
// decide which robots rules (if any) an origin returns.
vi.mock("../../src/crawler/robots", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/crawler/robots")>();
	return { ...actual, fetchRobots: vi.fn() };
});

import { extractStructured } from "../../src/ai/extract";
import { extractContent, getBrowser } from "../../src/browser";
import {
	type CrawlBatch,
	type CrawlOptions,
	ROBOTS_DISALLOWED,
	buildTerminalPayload,
	decideTerminalStatus,
	filterDiscoveredLinks,
	finalizeCrawl,
	initializeCrawl,
	isTerminal,
	loadCrawlOptions,
	parseCrawlOptions,
	postWebhook,
	processCrawlBatch,
	runCrawlBatch,
} from "../../src/crawler/engine";
import { CRAWL_USER_AGENT, fetchRobots } from "../../src/crawler/robots";
import {
	bumpJobCounters,
	claimNextBatch,
	createJob,
	enqueueUrls,
	getJob,
	listResults,
	setJobStatus,
} from "../../src/crawler/store";
import type { Env } from "../../src/index";

const env = { DB: testEnv.DB } as unknown as Env;
const BASE = "https://example.com";
const NOW = 1_700_000_000_000;

function opts(overrides: Partial<CrawlOptions> = {}): CrawlOptions {
	return {
		limit: 100,
		maxDiscoveryDepth: 3,
		allowExternalLinks: false,
		allowSubdomains: false,
		ignoreRobotsTxt: true,
		sitemap: "include",
		scrapeFormats: ["markdown"],
		jsonFormat: null,
		...overrides,
	};
}

function scrapeFor(url: string) {
	const page = url.replace(/\/$/, "");
	return {
		title: "Example",
		description: "desc",
		url,
		markdown: `# ${url}`,
		html: `<h1>${url}</h1>`,
		rawHtml: "<html></html>",
		links: [`${page}/child`],
		screenshot: null,
		metadata: {
			title: "Example",
			description: "desc",
			sourceURL: url,
			statusCode: 200,
			error: null,
		},
	};
}

async function enqueueJob(id: string, urls: CrawlBatch[]) {
	await createJob(testEnv.DB, {
		id,
		url: urls[0]?.url ?? BASE,
		options: {},
		now: NOW,
		expiresAt: NOW + 600_000,
	});
	await enqueueUrls(testEnv.DB, id, urls, NOW);
}

async function makeJob(id: string, urls: CrawlBatch[]) {
	await enqueueJob(id, urls);
	return await claimNextBatch(testEnv.DB, id, 10);
}

async function queueRows(jobId: string) {
	const { results } = await testEnv.DB.prepare(
		"SELECT url, status FROM crawl_queue WHERE job_id = ? ORDER BY id",
	)
		.bind(jobId)
		.all<{ url: string; status: string }>();
	return results;
}

// Minimal D1 stand-in that forwards to the real test database but throws from
// `prepare` for statements matching `match`, simulating a mid-batch failure.
function failingDb(match: (sql: string) => boolean): D1Database {
	const real = testEnv.DB;
	return {
		prepare: (sql: string) => {
			if (match(sql)) throw new Error("d1 unavailable");
			return real.prepare(sql);
		},
		batch: (statements: D1PreparedStatement[]) => real.batch(statements),
	} as unknown as D1Database;
}

function stubSitemap(urls: string[]) {
	const mock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.endsWith("/sitemap.xml")) {
			const body = `<?xml version="1.0"?><urlset>${urls
				.map((loc) => `<url><loc>${loc}</loc></url>`)
				.join("")}</urlset>`;
			return new Response(body, {
				headers: { "content-type": "application/xml" },
			});
		}
		return new Response("not found", { status: 404 });
	});
	vi.stubGlobal("fetch", mock);
	return mock;
}

let browserClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetAllMocks();
	browserClose = vi.fn().mockResolvedValue(undefined);
	vi.mocked(getBrowser).mockResolvedValue({ close: browserClose } as never);
	vi.mocked(extractContent).mockImplementation(
		async (_browser, url) => scrapeFor(url) as never,
	);
	vi.mocked(fetchRobots).mockResolvedValue(null);
	vi.mocked(extractStructured).mockResolvedValue({ attempts: 0 } as never);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("filterDiscoveredLinks", () => {
	it("resolves relative urls and preserves first-seen order", () => {
		const found = filterDiscoveredLinks(
			"https://example.com/dir/page",
			["a", "/b", "c?x=1", "./d"],
			new Set(),
			1,
			opts(),
		);

		expect(found).toEqual([
			{ url: "https://example.com/dir/a", depth: 1 },
			{ url: "https://example.com/b", depth: 1 },
			{ url: "https://example.com/dir/c?x=1", depth: 1 },
			{ url: "https://example.com/dir/d", depth: 1 },
		]);
	});

	it("drops asset and binary extensions", () => {
		const found = filterDiscoveredLinks(
			BASE,
			["/a.png", "/b.js", "/c.css", "/d.pdf", "https://example.com/logo.svg"],
			new Set(),
			1,
			opts(),
		);

		expect(found.map((item) => item.url)).toEqual(["https://example.com/d.pdf"]);
	});

	it("drops mailto/tel/javascript targets and fragment-only links", () => {
		const found = filterDiscoveredLinks(
			BASE,
			["mailto:a@b.com", "tel:+123", "javascript:void(0)", "#section", "/ok"],
			new Set(),
			1,
			opts(),
		);

		expect(found.map((item) => item.url)).toEqual(["https://example.com/ok"]);
	});

	it("strips fragments so anchors collapse onto their page", () => {
		const found = filterDiscoveredLinks(
			BASE,
			["/page#top"],
			new Set(),
			1,
			opts(),
		);

		expect(found.map((item) => item.url)).toEqual(["https://example.com/page"]);
	});

	it("drops external links unless allowExternalLinks is set", () => {
		const candidates = ["https://other.example.com/x"];

		expect(filterDiscoveredLinks(BASE, candidates, new Set(), 1, opts())).toEqual(
			[],
		);
		expect(
			filterDiscoveredLinks(
				BASE,
				candidates,
				new Set(),
				1,
				opts({ allowExternalLinks: true }),
			).map((item) => item.url),
		).toEqual(["https://other.example.com/x"]);
	});

	it("follows subdomains only when allowSubdomains is set", () => {
		const candidates = ["https://blog.example.com/post"];

		expect(filterDiscoveredLinks(BASE, candidates, new Set(), 1, opts())).toEqual(
			[],
		);
		expect(
			filterDiscoveredLinks(
				BASE,
				candidates,
				new Set(),
				1,
				opts({ allowSubdomains: true }),
			).map((item) => item.url),
		).toEqual(["https://blog.example.com/post"]);
	});

	it("applies includePaths and excludePaths globs", () => {
		const candidates = ["/blog/post", "/about", "/admin/panel"];

		const included = filterDiscoveredLinks(
			BASE,
			candidates,
			new Set(),
			1,
			opts({ includePaths: ["/blog/*"] }),
		);
		expect(included.map((item) => item.url)).toEqual([
			"https://example.com/blog/post",
		]);

		const excluded = filterDiscoveredLinks(
			BASE,
			candidates,
			new Set(),
			1,
			opts({ excludePaths: ["/admin/*"] }),
		);
		expect(excluded.map((item) => item.url)).toEqual([
			"https://example.com/blog/post",
			"https://example.com/about",
		]);
	});

	it("caps discovery at maxDiscoveryDepth", () => {
		// The default cap is 3, so depth 4 is too deep.
		expect(
			filterDiscoveredLinks(BASE, ["/too-deep"], new Set(), 4, opts()),
		).toEqual([]);
		// Depth exactly at the cap is still kept.
		expect(
			filterDiscoveredLinks(
				BASE,
				["/at-cap"],
				new Set(),
				3,
				opts({ maxDiscoveryDepth: 3 }),
			).map((item) => item.url),
		).toEqual(["https://example.com/at-cap"]);
	});

	it("dedupes within candidates and against the seen set", () => {
		const seen = new Set(["https://example.com/a"]);
		const found = filterDiscoveredLinks(
			BASE,
			["/a", "/b", "/b", "/c"],
			seen,
			1,
			opts(),
		);

		expect(found.map((item) => item.url)).toEqual([
			"https://example.com/b",
			"https://example.com/c",
		]);
	});

	it("returns nothing for an unparseable base url", () => {
		expect(
			filterDiscoveredLinks("not a url", ["/a"], new Set(), 1, opts()),
		).toEqual([]);
	});
});

describe("parseCrawlOptions", () => {
	it("maps a stored request onto concrete engine options", () => {
		const parsed = parseCrawlOptions({
			limit: 25,
			maxDiscoveryDepth: 1,
			allowSubdomains: true,
			ignoreRobotsTxt: true,
			sitemap: "only",
			includePaths: ["/blog/*"],
			robotsUserAgent: "mybot",
			scrapeOptions: { formats: [{ type: "json", prompt: "price" }, "markdown"] },
			webhook: {
				url: "https://hooks.example.com/crawl",
				headers: { "X-A": "1" },
			},
		});

		expect(parsed).toMatchObject({
			limit: 25,
			maxDiscoveryDepth: 1,
			allowExternalLinks: false,
			allowSubdomains: true,
			ignoreRobotsTxt: true,
			sitemap: "only",
			includePaths: ["/blog/*"],
			excludePaths: [],
			robotsUserAgent: "mybot",
			summaryRequested: false,
		});
		expect(parsed.scrapeFormats).toEqual(["markdown"]);
		expect(parsed.jsonFormat).toMatchObject({ prompt: "price" });
		expect(parsed.webhook?.url).toBe("https://hooks.example.com/crawl");
	});

	it("flags a requested summary that crawl cannot produce", () => {
		const parsed = parseCrawlOptions({
			scrapeOptions: { formats: ["markdown", { type: "summary" }] },
		});

		expect(parsed.summaryRequested).toBe(true);
		expect(parsed.scrapeFormats).toEqual(["markdown"]);
	});

	it("falls back to defaults for an empty options blob", () => {
		const parsed = parseCrawlOptions(null);

		expect(parsed).toMatchObject({
			limit: 10000,
			maxDiscoveryDepth: 10,
			allowExternalLinks: false,
			allowSubdomains: false,
			ignoreRobotsTxt: false,
			sitemap: "include",
			scrapeFormats: ["markdown"],
			jsonFormat: null,
			robotsUserAgent: undefined,
			webhook: null,
		});
	});

	it("loads the options column from the job row", async () => {
		await createJob(testEnv.DB, {
			id: "job-options",
			url: BASE,
			options: { limit: 7, sitemap: "skip" },
			now: NOW,
			expiresAt: NOW + 1000,
		});

		const loaded = await loadCrawlOptions(env, "job-options");
		expect(loaded?.limit).toBe(7);
		expect(loaded?.sitemap).toBe("skip");
		expect(await loadCrawlOptions(env, "missing")).toBeNull();
	});
});

describe("initializeCrawl", () => {
	it("enqueues the seed first, then filtered sitemap urls", async () => {
		vi.mocked(fetchRobots).mockResolvedValue(null);
		stubSitemap([
			"https://example.com/sitemap-a",
			"https://example.com/logo.png",
			"https://other.example.com/external",
		]);
		await createJob(testEnv.DB, {
			id: "job-init",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});

		const result = await initializeCrawl(env, "job-init", BASE, opts());

		expect(result.seeded).toBe(2);
		expect((await queueRows("job-init")).map((row) => row.url)).toEqual([
			"https://example.com",
			"https://example.com/sitemap-a",
		]);
		expect((await getJob(testEnv.DB, "job-init"))?.total).toBe(2);
	});

	it("skips the seed and only enqueues sitemap urls in sitemap:only", async () => {
		vi.mocked(fetchRobots).mockResolvedValue(null);
		stubSitemap(["https://example.com/only-a"]);
		await createJob(testEnv.DB, {
			id: "job-only",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});

		const result = await initializeCrawl(
			env,
			"job-only",
			BASE,
			opts({ sitemap: "only" }),
		);

		expect(result.seeded).toBe(1);
		expect((await queueRows("job-only")).map((row) => row.url)).toEqual([
			"https://example.com/only-a",
		]);
	});

	it("skips the sitemap entirely in sitemap:skip", async () => {
		const fetchMock = stubSitemap([]);
		await createJob(testEnv.DB, {
			id: "job-skip",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});

		const result = await initializeCrawl(
			env,
			"job-skip",
			BASE,
			opts({ sitemap: "skip" }),
		);

		expect(result.seeded).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("honours ignoreRobotsTxt and otherwise drops disallowed sitemap urls", async () => {
		stubSitemap([]);
		await createJob(testEnv.DB, {
			id: "job-ignore",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});
		await initializeCrawl(
			env,
			"job-ignore",
			BASE,
			opts({ ignoreRobotsTxt: true, sitemap: "only" }),
		);
		expect(fetchRobots).not.toHaveBeenCalled();

		vi.mocked(fetchRobots).mockResolvedValue({
			allow: [],
			disallow: ["/blocked"],
		});
		stubSitemap(["https://example.com/blocked", "https://example.com/ok"]);
		await createJob(testEnv.DB, {
			id: "job-robots",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});
		await initializeCrawl(
			env,
			"job-robots",
			BASE,
			opts({ ignoreRobotsTxt: false, sitemap: "only" }),
		);

		expect(fetchRobots).toHaveBeenCalledTimes(1);
		expect((await queueRows("job-robots")).map((row) => row.url)).toEqual([
			"https://example.com/ok",
		]);
	});
});

describe("sitemap:only end-to-end", () => {
	it("never enqueues or crawls the seed, only sitemap urls", async () => {
		vi.mocked(fetchRobots).mockResolvedValue(null);
		stubSitemap(["https://example.com/from-sitemap"]);
		// Replicates the endpoint path: the seed is not enqueued for `only`.
		await createJob(testEnv.DB, {
			id: "job-only-e2e",
			url: BASE,
			options: { sitemap: "only" },
			now: NOW,
			expiresAt: NOW + 1000,
		});

		await initializeCrawl(env, "job-only-e2e", BASE, opts({ sitemap: "only" }));
		const result = await runCrawlBatch(
			env,
			"job-only-e2e",
			opts({ sitemap: "only" }),
			5,
		);

		expect(result.completed).toBe(1);
		// The seed was never scraped; only the sitemap URL produced a result.
		expect(vi.mocked(extractContent).mock.calls.map((call) => call[1])).toEqual([
			"https://example.com/from-sitemap",
		]);
		expect(
			(await listResults(testEnv.DB, "job-only-e2e", { limit: 10 })).map(
				(row) => row.url,
			),
		).toEqual(["https://example.com/from-sitemap"]);
		expect((await queueRows("job-only-e2e")).some((row) => row.url === BASE)).toBe(
			false,
		);
	});

	it("skips a pre-existing seed row under sitemap:only", async () => {
		const batch = await makeJob("job-only-legacy", [
			{ url: BASE, depth: 0 },
			{ url: "https://example.com/from-sitemap", depth: 0 },
		]);

		const result = await processCrawlBatch(
			env,
			"job-only-legacy",
			batch,
			opts({ sitemap: "only" }),
		);

		expect(result.completed).toBe(1);
		expect(vi.mocked(extractContent).mock.calls.map((call) => call[1])).toEqual([
			"https://example.com/from-sitemap",
		]);
	});
});

describe("processCrawlBatch", () => {
	it("inserts results, bumps counters and enqueues discoveries", async () => {
		const batch = await makeJob("job-happy", [
			{ url: "https://example.com/a", depth: 0 },
			{ url: "https://example.com/b", depth: 0 },
		]);

		const result = await processCrawlBatch(env, "job-happy", batch, opts());

		expect(result).toMatchObject({ completed: 2, failed: 0, discovered: 2 });

		const rows = await listResults(testEnv.DB, "job-happy", { limit: 10 });
		expect(rows.map((row) => row.url)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
		expect(rows.every((row) => row.status === "completed")).toBe(true);
		expect(rows[0].links).toEqual(["https://example.com/a/child"]);

		const queue = await queueRows("job-happy");
		expect(
			queue.filter((row) => row.status === "done").map((row) => row.url),
		).toEqual(["https://example.com/a", "https://example.com/b"]);
		expect(
			queue.filter((row) => row.status === "pending").map((row) => row.url),
		).toEqual([
			"https://example.com/a/child",
			"https://example.com/b/child",
		]);

		const job = await getJob(testEnv.DB, "job-happy");
		expect(job?.completed).toBe(2);
		expect(job?.total).toBe(2);
		expect(browserClose).toHaveBeenCalledTimes(1);
	});

	it("marks a scrape failure failed and continues the batch", async () => {
		vi.mocked(extractContent).mockImplementation(async (_browser, url) => {
			if (url.endsWith("/broken")) return null as never;
			return scrapeFor(url) as never;
		});
		const batch = await makeJob("job-fail", [
			{ url: "https://example.com/broken", depth: 0 },
			{ url: "https://example.com/ok", depth: 0 },
		]);

		const result = await processCrawlBatch(env, "job-fail", batch, opts());

		expect(result).toMatchObject({ completed: 1, failed: 1 });
		const queue = await queueRows("job-fail");
		expect(
			queue.find((row) => row.url === "https://example.com/broken")?.status,
		).toBe("failed");
		expect(
			queue.find((row) => row.url === "https://example.com/ok")?.status,
		).toBe("done");
		expect((await getJob(testEnv.DB, "job-fail"))?.completed).toBe(1);
	});

	it("records a failed result with the robots reason and does not scrape", async () => {
		vi.mocked(fetchRobots).mockResolvedValue({
			allow: [],
			disallow: ["/blocked"],
		});
		const batch = await makeJob("job-robots", [
			{ url: "https://example.com/blocked", depth: 0 },
			{ url: "https://example.com/ok", depth: 0 },
		]);

		const result = await processCrawlBatch(
			env,
			"job-robots",
			batch,
			opts({ ignoreRobotsTxt: false }),
		);

		expect(result).toMatchObject({ completed: 1, failed: 1 });
		// Rules are fetched once per origin, even for two items.
		expect(fetchRobots).toHaveBeenCalledTimes(1);
		expect(vi.mocked(extractContent).mock.calls.map((call) => call[1])).toEqual([
			"https://example.com/ok",
		]);
		const queue = await queueRows("job-robots");
		expect(
			queue.find((row) => row.url === "https://example.com/blocked")?.status,
		).toBe("failed");

		const rows = await listResults(testEnv.DB, "job-robots", { limit: 10 });
		const blocked = rows.find((row) => row.url === "https://example.com/blocked");
		expect(blocked?.status).toBe("failed");
		expect(blocked?.error).toBe(ROBOTS_DISALLOWED);
	});

	it("fetches robots and scrapes with the default crawl user agent", async () => {
		vi.mocked(fetchRobots).mockResolvedValue(null);
		const batch = await makeJob("job-ua", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		await processCrawlBatch(
			env,
			"job-ua",
			batch,
			opts({ ignoreRobotsTxt: false }),
		);

		expect(fetchRobots).toHaveBeenCalledWith(
			"https://example.com/a",
			CRAWL_USER_AGENT,
		);
		const call = vi.mocked(extractContent).mock.calls[0];
		const extractOpts = call[2] as { headers?: Record<string, string> };
		expect(extractOpts.headers?.["User-Agent"]).toBe(CRAWL_USER_AGENT);
	});

	it("honours a robotsUserAgent override", async () => {
		vi.mocked(fetchRobots).mockResolvedValue(null);
		const batch = await makeJob("job-ua-override", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		await processCrawlBatch(
			env,
			"job-ua-override",
			batch,
			opts({ ignoreRobotsTxt: false, robotsUserAgent: "mybot" }),
		);

		expect(fetchRobots).toHaveBeenCalledWith("https://example.com/a", "mybot");
	});

	it("reports the robots crawl-delay so the workflow can pace", async () => {
		vi.mocked(fetchRobots).mockResolvedValue({
			allow: [],
			disallow: [],
			crawlDelaySec: 3,
		});
		const batch = await makeJob("job-delay", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		const result = await processCrawlBatch(
			env,
			"job-delay",
			batch,
			opts({ ignoreRobotsTxt: false }),
		);

		expect(result.crawlDelaySec).toBe(3);
	});

	it("degrades an AI json failure to a stored warning", async () => {
		vi.mocked(extractStructured).mockResolvedValue({
			warning: "AI not configured: missing key",
			attempts: 0,
		} as never);
		const batch = await makeJob("job-json", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		const result = await processCrawlBatch(
			env,
			"job-json",
			batch,
			opts({ jsonFormat: { prompt: "price" } }),
		);

		expect(result.completed).toBe(1);
		const rows = await listResults(testEnv.DB, "job-json", { limit: 10 });
		expect(rows[0].json).toBeNull();
		expect(rows[0].metadata).toMatchObject({
			warning: "AI not configured: missing key",
		});
		expect(vi.mocked(extractStructured)).toHaveBeenCalledWith(
			expect.objectContaining({
				content: "# https://example.com/a",
				prompt: "price",
			}),
			env,
		);
	});

	it("warns when a requested summary is not produced", async () => {
		const batch = await makeJob("job-summary", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		const result = await processCrawlBatch(
			env,
			"job-summary",
			batch,
			opts({ summaryRequested: true }),
		);

		expect(result.completed).toBe(1);
		const rows = await listResults(testEnv.DB, "job-summary", { limit: 10 });
		expect(rows[0].metadata).toMatchObject({
			warning: expect.stringContaining("summary"),
		});
	});

	it("does not enqueue discoveries in sitemap:only", async () => {
		const batch = await makeJob("job-only-batch", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		const result = await processCrawlBatch(
			env,
			"job-only-batch",
			batch,
			opts({ sitemap: "only" }),
		);

		expect(result.discovered).toBe(0);
		expect(await queueRows("job-only-batch")).toHaveLength(1);
	});

	it("stops early once the job is cancelled mid-batch", async () => {
		let first = true;
		vi.mocked(extractContent).mockImplementation(async (_browser, url) => {
			if (first) {
				first = false;
				await setJobStatus(testEnv.DB, "job-cancel", "cancelled", {
					completedAt: NOW,
				});
			}
			return scrapeFor(url) as never;
		});
		const batch = await makeJob("job-cancel", [
			{ url: "https://example.com/a", depth: 0 },
			{ url: "https://example.com/b", depth: 0 },
		]);

		const result = await processCrawlBatch(env, "job-cancel", batch, opts());

		expect(result.completed).toBe(1);
		expect(vi.mocked(extractContent)).toHaveBeenCalledTimes(1);
		expect(browserClose).toHaveBeenCalledTimes(1);
	});

	it("closes the browser when extraction throws", async () => {
		vi.mocked(extractContent).mockRejectedValue(new Error("page crashed"));
		const batch = await makeJob("job-throw", [
			{ url: "https://example.com/a", depth: 0 },
		]);

		const result = await processCrawlBatch(env, "job-throw", batch, opts());

		expect(result.failed).toBe(1);
		expect(browserClose).toHaveBeenCalledTimes(1);
	});
});

describe("runCrawlBatch", () => {
	it("releases claimed rows when it throws, so a retry processes them", async () => {
		await enqueueJob("job-retry", [
			{ url: "https://example.com/a", depth: 0 },
		]);
		const broken = {
			DB: failingDb((sql) => sql.includes("INSERT INTO crawl_results")),
		} as unknown as Env;

		await expect(runCrawlBatch(broken, "job-retry", opts(), 5)).rejects.toThrow(
			"d1 unavailable",
		);
		expect((await queueRows("job-retry"))[0].status).toBe("pending");

		const retry = await runCrawlBatch(env, "job-retry", opts(), 5);
		expect(retry.completed).toBe(1);
		expect(
			(await listResults(testEnv.DB, "job-retry", { limit: 10 })).map(
				(row) => row.url,
			),
		).toEqual(["https://example.com/a"]);
	});

	it("enforces limit within a batch and leaves the remainder pending", async () => {
		await enqueueJob(
			"job-limit",
			[1, 2, 3, 4, 5].map((n) => ({
				url: `https://example.com/${n}`,
				depth: 0,
			})),
		);

		const result = await runCrawlBatch(
			env,
			"job-limit",
			opts({ limit: 2, maxDiscoveryDepth: 0 }),
			5,
		);

		expect(result.completed).toBe(2);
		expect(await listResults(testEnv.DB, "job-limit", { limit: 10 })).toHaveLength(
			2,
		);
		const queue = await queueRows("job-limit");
		expect(queue.filter((row) => row.status === "pending")).toHaveLength(3);
	});

	it("caches robots per batch and refetches for the next batch", async () => {
		vi.mocked(fetchRobots).mockResolvedValue({ allow: [], disallow: [] });
		await enqueueJob("job-cache", [
			{ url: "https://example.com/a", depth: 0 },
			{ url: "https://example.com/b", depth: 0 },
		]);

		await runCrawlBatch(env, "job-cache", opts({ ignoreRobotsTxt: false }), 2);
		expect(fetchRobots).toHaveBeenCalledTimes(1);

		vi.mocked(fetchRobots).mockClear();
		await runCrawlBatch(env, "job-cache", opts({ ignoreRobotsTxt: false }), 2);
		expect(fetchRobots).toHaveBeenCalledTimes(1);
	});
});

describe("finalizeCrawl", () => {
	it("never overwrites a cancelled job", async () => {
		await createJob(testEnv.DB, {
			id: "job-finalize-cancel",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});
		await setJobStatus(testEnv.DB, "job-finalize-cancel", "cancelled", {
			completedAt: NOW,
		});

		const status = await finalizeCrawl(env, "job-finalize-cancel", 1, 0);

		expect(status).toBe("cancelled");
		expect((await getJob(testEnv.DB, "job-finalize-cancel"))?.status).toBe(
			"cancelled",
		);
	});

	it("finalizes a scraping job from the run counters", async () => {
		await createJob(testEnv.DB, {
			id: "job-finalize-allfail",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});
		expect(await finalizeCrawl(env, "job-finalize-allfail", 3, 0)).toBe("failed");

		await createJob(testEnv.DB, {
			id: "job-finalize-ok",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});
		expect(await finalizeCrawl(env, "job-finalize-ok", 0, 0)).toBe("completed");
	});
});

describe("decideTerminalStatus", () => {
	it("keeps explicit terminal statuses and derives failed/completed", () => {
		expect(decideTerminalStatus(3, 0, "scraping")).toBe("failed");
		expect(decideTerminalStatus(3, 1, "scraping")).toBe("completed");
		expect(decideTerminalStatus(0, 0, "scraping")).toBe("completed");
		expect(decideTerminalStatus(3, 3, "cancelled")).toBe("cancelled");
		expect(decideTerminalStatus(3, 0, "failed")).toBe("failed");
	});
});

describe("webhook", () => {
	it("builds a typed payload and honours the events filter", async () => {
		await createJob(testEnv.DB, {
			id: "job-hook",
			url: BASE,
			options: {},
			now: NOW,
			expiresAt: NOW + 1000,
		});
		await setJobStatus(testEnv.DB, "job-hook", "failed", { completedAt: NOW });

		const payload = await buildTerminalPayload(env, "job-hook", "crawl.failed", {
			tenant: "acme",
		});
		expect(payload.type).toBe("crawl.failed");
		expect(payload.status).toBe("failed");
		expect(payload.metadata).toEqual({ tenant: "acme" });

		const fetchMock = vi.fn(async () => new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);

		const filtered = await postWebhook(
			{ url: "https://hooks.example.com/x", events: ["completed"] },
			payload,
		);
		expect(filtered).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();

		const sent = await postWebhook(
			{ url: "https://hooks.example.com/x" },
			payload,
		);
		expect(sent).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("total accounting", () => {
	it("counts the seed in total so total === completed after a crawl", async () => {
		vi.mocked(fetchRobots).mockResolvedValue(null);
		// Replicates the endpoint path: the seed is enqueued and counted at
		// creation time, before the workflow runs.
		await createJob(testEnv.DB, {
			id: "job-total",
			url: BASE,
			options: { sitemap: "skip" },
			now: NOW,
			expiresAt: NOW + 1000,
		});
		const seeded = await enqueueUrls(
			testEnv.DB,
			"job-total",
			[{ url: BASE, depth: 0 }],
			NOW,
		);
		await bumpJobCounters(testEnv.DB, "job-total", { total: seeded, now: NOW });

		const runOpts = opts({ sitemap: "skip", maxDiscoveryDepth: 0 });
		await initializeCrawl(env, "job-total", BASE, runOpts);
		const result = await runCrawlBatch(env, "job-total", runOpts, 5);

		expect(result.completed).toBe(1);
		const job = await getJob(testEnv.DB, "job-total");
		expect(job?.total).toBe(1);
		expect(job?.completed).toBe(1);
	});
});

describe("isTerminal", () => {
	it("reports the terminal statuses", () => {
		expect(isTerminal("completed")).toBe(true);
		expect(isTerminal("failed")).toBe(true);
		expect(isTerminal("cancelled")).toBe(true);
		expect(isTerminal("scraping")).toBe(false);
		expect(isTerminal("unknown")).toBe(false);
	});
});
