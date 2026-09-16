import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSitemapUrls } from "../../src/crawler/sitemap";
import type { Env } from "../../src/index";
import { V2Map } from "../../src/v2/map";
import { discoverLinks, getBrowser } from "../../src/webMap";

// Keep puppeteer and every network call out of the test worker. The route's
// browser surface lives on webMap (the shared v1 discovery module), so that is
// the boundary we stub.
vi.mock("../../src/webMap", () => ({
	discoverLinks: vi.fn(),
	getBrowser: vi.fn(),
}));
vi.mock("../../src/crawler/sitemap", () => ({ fetchSitemapUrls: vi.fn() }));

function makeBrowser() {
	return {
		newPage: vi.fn(),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

function createApp() {
	const app = new Hono<{ Bindings: Env }>();
	const openapi = fromHono(app, { docs_url: "/" });
	openapi.post("/v2/map", V2Map);
	return app;
}

function post(body: unknown) {
	return createApp().request(
		"/v2/map",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		{} as Env,
	);
}

describe("V2Map request validation", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it("rejects a request without a url", async () => {
		const res = await post({ search: "docs" });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
	});

	it("rejects an invalid url", async () => {
		const res = await post({ url: "not-a-url" });
		expect(res.status).toBe(400);
	});

	it("rejects limit above 100000", async () => {
		const res = await post({ url: "https://example.com", limit: 100001 });
		expect(res.status).toBe(400);
	});

	it("accepts limit of 6000", async () => {
		const res = await post({ url: "https://example.com", limit: 6000 });
		expect(res.status).toBe(200);
	});

	it("rejects an unknown sitemap mode", async () => {
		const res = await post({
			url: "https://example.com",
			sitemap: "always",
		});
		expect(res.status).toBe(400);
	});

	it("accepts a location object", async () => {
		const res = await post({
			url: "https://example.com",
			location: { country: "US", languages: ["en"] },
		});
		expect(res.status).toBe(200);
	});

	it("rejects a string location (search route form does not apply)", async () => {
		const res = await post({ url: "https://example.com", location: "US" });
		expect(res.status).toBe(400);
	});

	it("rejects a location country that is not an ISO alpha-2 code", async () => {
		const res = await post({
			url: "https://example.com",
			location: { country: "usa" },
		});
		expect(res.status).toBe(400);
	});

	it("accepts a url-only request and defaults sitemap to include", async () => {
		const res = await post({ url: "https://example.com" });
		expect(res.status).toBe(200);
		expect(fetchSitemapUrls).toHaveBeenCalledWith("https://example.com", {
			limit: 5000,
		});
	});
});

describe("V2Map response shape", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it("returns links as objects, not v1 flat strings", async () => {
		vi.mocked(discoverLinks).mockResolvedValue([
			"https://example.com/one",
			"https://example.com/two",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "skip",
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.links).toEqual([
			{ url: "https://example.com/one" },
			{ url: "https://example.com/two" },
		]);
		// Regression guard against the v1 `links: string[]` form.
		expect(typeof body.links[0]).toBe("object");
		expect(typeof body.links[0]).not.toBe("string");
	});
});

describe("V2Map sitemap modes", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it('"only" returns sitemap URLs and never touches the browser', async () => {
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/from-sitemap",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "only",
		});
		const body = await res.json();

		expect(body.links).toEqual([{ url: "https://example.com/from-sitemap" }]);
		expect(fetchSitemapUrls).toHaveBeenCalledWith("https://example.com", {
			limit: 5000,
		});
		expect(getBrowser).not.toHaveBeenCalled();
		expect(discoverLinks).not.toHaveBeenCalled();
	});

	it('"skip" uses browser discovery only and never fetches a sitemap', async () => {
		vi.mocked(discoverLinks).mockResolvedValue(["https://example.com/page"]);
		const res = await post({
			url: "https://example.com",
			sitemap: "skip",
		});
		const body = await res.json();

		expect(body.links).toEqual([{ url: "https://example.com/page" }]);
		expect(fetchSitemapUrls).not.toHaveBeenCalled();
	});

	it('"include" merges browser and sitemap links in discovery order', async () => {
		vi.mocked(discoverLinks).mockResolvedValue([
			"https://example.com/a",
			"https://example.com/b",
		]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/b",
			"https://example.com/c",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(body.links).toEqual([
			{ url: "https://example.com/a" },
			{ url: "https://example.com/b" },
			{ url: "https://example.com/c" },
		]);
	});

	it("ignores query strings for dedupe but keeps the original URL", async () => {
		vi.mocked(discoverLinks).mockResolvedValue(["https://example.com/p?x=1"]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/p?x=2",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(body.links).toEqual([{ url: "https://example.com/p?x=1" }]);
	});

	it("keeps query-distinct URLs when ignoreQueryParameters is false", async () => {
		vi.mocked(discoverLinks).mockResolvedValue(["https://example.com/p?x=1"]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/p?x=2",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
			ignoreQueryParameters: false,
		});
		const body = await res.json();

		expect(body.links).toEqual([
			{ url: "https://example.com/p?x=1" },
			{ url: "https://example.com/p?x=2" },
		]);
	});

	it("passes includeSubdomains through to browser discovery (default true)", async () => {
		await post({ url: "https://example.com", sitemap: "skip" });
		expect(discoverLinks).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			true,
		);
	});

	it("applies limit by slicing the merged list", async () => {
		vi.mocked(discoverLinks).mockResolvedValue([
			"https://example.com/1",
			"https://example.com/2",
			"https://example.com/3",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "skip",
			limit: 2,
		});
		const body = await res.json();

		expect(body.links).toHaveLength(2);
		expect(body.links).toEqual([
			{ url: "https://example.com/1" },
			{ url: "https://example.com/2" },
		]);
	});

	it("closes the browser after discovery", async () => {
		const browser = makeBrowser();
		vi.mocked(getBrowser).mockResolvedValue(browser as never);
		await post({ url: "https://example.com", sitemap: "skip" });
		expect(browser.close).toHaveBeenCalledTimes(1);
	});
});

describe("V2Map discovery semantics", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it("merges sitemap results when browser discovery returns no links", async () => {
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/from-sitemap",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.links).toEqual([{ url: "https://example.com/from-sitemap" }]);
		expect(body.warning).toBeUndefined();
	});

	it("returns 200 with an empty list and a warning when discovery and sitemap are both empty", async () => {
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.links).toEqual([]);
		expect(body.warning).toBe("browser discovery returned no links");
	});

	it("warns for empty discovery under sitemap=skip too", async () => {
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		const res = await post({
			url: "https://example.com",
			sitemap: "skip",
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.links).toEqual([]);
		expect(body.warning).toBe("browser discovery returned no links");
	});

	it("returns 500 only when getBrowser launch throws", async () => {
		vi.mocked(getBrowser).mockRejectedValue(new Error("launch failed"));
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(res.status).toBe(500);
		expect(body).toEqual({ success: false, error: "Map failed" });
	});
});

describe("V2Map search", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it("filters the full candidate set before slicing and warns", async () => {
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/blog/1",
			"https://example.com/other",
			"https://example.com/blog/2",
			"https://example.com/blog/3",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
			search: "blog",
			limit: 2,
		});
		const body = await res.json();

		// Parser is asked for more than the final limit so filtering can't
		// under-return; the two matches come from positions 1 and 3.
		expect(fetchSitemapUrls).toHaveBeenCalledWith("https://example.com", {
			limit: 100000,
		});
		expect(body.links).toEqual([
			{ url: "https://example.com/blog/1" },
			{ url: "https://example.com/blog/2" },
		]);
		expect(body.warning).toContain(
			"search relevance ordering is not supported; results are filtered by substring",
		);
	});
});

describe("V2Map ignored contract fields", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockResolvedValue(["https://example.com/page"]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it("warns for accepted-but-ignored fields", async () => {
		const res = await post({
			url: "https://example.com",
			sitemap: "skip",
			ignoreCache: true,
			auditMetadata: { username: "siem-user" },
			threatProtection: { mode: "normal" },
			timeout: 1000,
			location: { country: "US", languages: ["en"] },
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.warning).toBe(
			"unsupported fields ignored: ignoreCache, auditMetadata, threatProtection, timeout, location",
		);
	});

	it("emits no warning when no ignored field is supplied", async () => {
		const res = await post({ url: "https://example.com", sitemap: "skip" });
		const body = await res.json();
		expect(body.warning).toBeUndefined();
	});
});