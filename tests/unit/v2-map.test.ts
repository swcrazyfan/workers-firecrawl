import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowser } from "../../src/browser";
import { fetchSitemapUrls } from "../../src/crawler/sitemap";
import type { Env } from "../../src/index";
import { V2Map } from "../../src/v2/map";
import { discoverLinks } from "../../src/webMap";

// Keep puppeteer, node-html-markdown and every network call out of the test
// worker. The route's browser page is stubbed at the webMap boundary.
vi.mock("../../src/browser", () => ({ getBrowser: vi.fn() }));
vi.mock("../../src/webMap", () => ({ discoverLinks: vi.fn() }));
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

	it("rejects limit above 5000", async () => {
		const res = await post({ url: "https://example.com", limit: 5001 });
		expect(res.status).toBe(400);
	});

	it("rejects an unknown sitemap mode", async () => {
		const res = await post({
			url: "https://example.com",
			sitemap: "always",
		});
		expect(res.status).toBe(400);
	});

	it("accepts a url-only request and defaults sitemap to include", async () => {
		const res = await post({ url: "https://example.com" });
		expect(res.status).toBe(200);
		expect(fetchSitemapUrls).toHaveBeenCalledTimes(1);
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

		expect(body.links).toEqual([
			{ url: "https://example.com/from-sitemap" },
		]);
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
		vi.mocked(discoverLinks).mockResolvedValue([
			"https://example.com/p?x=1",
		]);
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
		vi.mocked(discoverLinks).mockResolvedValue([
			"https://example.com/p?x=1",
		]);
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

describe("V2Map browser failure handling", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(discoverLinks).mockResolvedValue([]);
		vi.mocked(fetchSitemapUrls).mockResolvedValue([]);
	});

	it("falls back to sitemap-only results when the browser fails", async () => {
		vi.mocked(getBrowser).mockRejectedValue(new Error("launch failed"));
		vi.mocked(fetchSitemapUrls).mockResolvedValue([
			"https://example.com/sitemap-only",
		]);
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.links).toEqual([
			{ url: "https://example.com/sitemap-only" },
		]);
	});

	it("returns 500 when the browser fails and the sitemap is skipped", async () => {
		vi.mocked(getBrowser).mockRejectedValue(new Error("launch failed"));
		const res = await post({
			url: "https://example.com",
			sitemap: "skip",
		});
		const body = await res.json();

		expect(res.status).toBe(500);
		expect(body).toEqual({ success: false, error: "Map failed" });
	});

	it("returns 500 when discovery throws and the sitemap produced nothing", async () => {
		vi.mocked(getBrowser).mockResolvedValue(makeBrowser() as never);
		vi.mocked(discoverLinks).mockRejectedValue(new Error("navigation failed"));
		const res = await post({
			url: "https://example.com",
			sitemap: "include",
		});
		const body = await res.json();

		expect(res.status).toBe(500);
		expect(body.success).toBe(false);
	});
});
