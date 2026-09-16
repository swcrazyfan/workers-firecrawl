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
	filterDiscoveredLinks,
	initializeCrawl,
	isTerminal,
	loadCrawlOptions,
	parseCrawlOptions,
	processCrawlBatch,
} from "../../src/crawler/engine";
import { fetchRobots } from "../../src/crawler/robots";
import {
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

async function makeJob(id: string, urls: CrawlBatch[]) {
	await createJob(testEnv.DB, {
		id,
		url: urls[0]?.url ?? BASE,
		options: {},
		now: NOW,
		expiresAt: NOW + 600_000,
	});
	await enqueueUrls(testEnv.DB, id, urls, NOW);
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
		});
		expect(parsed.scrapeFormats).toEqual(["markdown"]);
		expect(parsed.jsonFormat).toMatchObject({ prompt: "price" });
		expect(parsed.webhook?.url).toBe("https://hooks.example.com/crawl");
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

describe("processCrawlBatch", () => {
	it("inserts results, bumps counters and enqueues discoveries", async () => {
		const batch = await makeJob("job-happy", [
			{ url: "https://example.com/a", depth: 0 },
			{ url: "https://example.com/b", depth: 0 },
		]);

		const result = await processCrawlBatch(env, "job-happy", batch, opts());

		expect(result).toEqual({ completed: 2, failed: 0, discovered: 2 });

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

	it("fails robots-disallowed urls without scraping them", async () => {
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

describe("isTerminal", () => {
	it("reports the terminal statuses", () => {
		expect(isTerminal("completed")).toBe(true);
		expect(isTerminal("failed")).toBe(true);
		expect(isTerminal("cancelled")).toBe(true);
		expect(isTerminal("scraping")).toBe(false);
		expect(isTerminal("unknown")).toBe(false);
	});
});