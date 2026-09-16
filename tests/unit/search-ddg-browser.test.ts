import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowser } from "../../src/browser";
import type { Env } from "../../src/index";
import { ddgBrowserSearch } from "../../src/search/ddgBrowser";
import type { SearchInput } from "../../src/search/types";

// Mocking the module keeps puppeteer entirely out of the test worker.
vi.mock("../../src/browser", () => ({
	getBrowser: vi.fn(),
}));

function makeEnv(): Env {
	return {} as unknown as Env;
}

const input: SearchInput = {
	query: "firecrawl",
	limit: 5,
	sources: ["web"],
};

const newsInput: SearchInput = {
	query: "firecrawl",
	limit: 5,
	sources: ["news"],
};

function makeBrowser() {
	const page = {
		setViewport: vi.fn().mockResolvedValue(undefined),
		setUserAgent: vi.fn().mockResolvedValue(undefined),
		goto: vi.fn().mockResolvedValue(null),
		waitForSelector: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockResolvedValue([]),
		close: vi.fn().mockResolvedValue(undefined),
	};
	const browser = {
		newPage: vi.fn().mockResolvedValue(page),
		close: vi.fn().mockResolvedValue(undefined),
	};
	return { browser, page };
}

function stubBrowser(browser: ReturnType<typeof makeBrowser>["browser"]) {
	vi.mocked(getBrowser).mockResolvedValue(browser as never);
}

// Minimal element stubs so the real evaluate callbacks can run in-page
// style: the callback only needs querySelectorAll/querySelector, innerText,
// href and src.
function fakeNewsArticle(options: {
	text: string;
	anchors?: Array<{ href: string; innerText: string }>;
	image?: { src: string };
}) {
	const anchors = options.anchors ?? [];
	return {
		innerText: options.text,
		querySelector: (selector: string) => {
			if (selector.includes("a[href]")) return anchors[0] ?? null;
			if (selector.includes("img[src]")) return options.image ?? null;
			return null;
		},
	};
}

// Runs the real evaluate callback (fn) with the real serialized arguments
// instead of faking its return value.
function evaluateInPage(page: ReturnType<typeof makeBrowser>["page"]) {
	page.evaluate.mockImplementation(
		async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
			fn(...args),
	);
}

describe("ddgBrowserSearch", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("navigates with the mapped query parameters and waits for results", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		await ddgBrowserSearch(
			{ ...input, tbs: "qdr:w", lang: "de", country: "DE", safe: true },
			makeEnv(),
		);
		const url = new URL(String(page.goto.mock.calls[0][0]));
		expect(url.origin).toBe("https://duckduckgo.com");
		expect(url.searchParams.get("q")).toBe("firecrawl");
		expect(url.searchParams.get("kl")).toBe("de-de");
		expect(url.searchParams.get("df")).toBe("w");
		expect(url.searchParams.get("kp")).toBe("1");
		expect(page.waitForSelector).toHaveBeenCalledWith(
			'[data-testid="result-title-a"]',
			{ timeout: 10000 },
		);
	});

	it("returns the no-results warning when the result selector times out", async () => {
		const { browser, page } = makeBrowser();
		page.waitForSelector.mockRejectedValue(
			new Error("Waiting failed: timeout 10000ms exceeded"),
		);
		stubBrowser(browser);
		const outcome = await ddgBrowserSearch(input, makeEnv());
		expect(outcome).toEqual({
			results: {},
			warnings: ["ddg-browser: no results"],
		});
		expect(page.close).toHaveBeenCalled();
		expect(browser.close).toHaveBeenCalled();
	});

	it("isolates a navigation failure into a per-source warning and still closes the page and browser", async () => {
		const { browser, page } = makeBrowser();
		page.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
		stubBrowser(browser);
		const outcome = await ddgBrowserSearch(input, makeEnv());
		expect(outcome).toEqual({
			results: {},
			warnings: ["ddg-browser: web failed: net::ERR_CONNECTION_REFUSED"],
		});
		expect(page.waitForSelector).not.toHaveBeenCalled();
		expect(page.close).toHaveBeenCalled();
		expect(browser.close).toHaveBeenCalled();
	});

	it("still throws when the browser launch itself fails", async () => {
		vi.mocked(getBrowser).mockRejectedValue(new Error("no binder"));
		await expect(ddgBrowserSearch(input, makeEnv())).rejects.toThrow(
			"ddg-browser: search failed: no binder",
		);
	});

	it("dedupes normalized URLs, drops non-http results and renumbers positions 1..N", async () => {
		const { browser, page } = makeBrowser();
		page.evaluate.mockResolvedValue([
			{ url: "https://a.com/1", title: "One" },
			{ url: "https://a.com/1/", title: "Duplicate trailing slash" },
			{ url: "javascript:alert(1)", title: "Bad scheme" },
			{ url: "https://b.com/2", title: "Two" },
			{ url: "https://c.com/3", title: "Three" },
		]);
		stubBrowser(browser);
		const outcome = await ddgBrowserSearch({ ...input, limit: 2 }, makeEnv());
		expect(outcome.warnings).toEqual([]);
		expect(outcome.results.web).toEqual([
			{ url: "https://a.com/1", title: "One", description: "", position: 1 },
			{ url: "https://b.com/2", title: "Two", description: "", position: 2 },
		]);
		expect(page.evaluate).toHaveBeenCalledTimes(1);
	});

	it("isolates an extraction failure into a per-source warning and still closes the browser", async () => {
		const { browser, page } = makeBrowser();
		page.evaluate.mockRejectedValue(new Error("execution context destroyed"));
		stubBrowser(browser);
		const outcome = await ddgBrowserSearch(input, makeEnv());
		expect(outcome).toEqual({
			results: {},
			warnings: ["ddg-browser: web failed: execution context destroyed"],
		});
		expect(page.close).toHaveBeenCalled();
		expect(browser.close).toHaveBeenCalled();
	});

	it("navigates to the news tab with iar/ia and the mapped region/date parameters", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		await ddgBrowserSearch(
			{ ...newsInput, tbs: "qdr:w", lang: "de", country: "DE" },
			makeEnv(),
		);
		const url = new URL(String(page.goto.mock.calls[0][0]));
		expect(url.origin).toBe("https://duckduckgo.com");
		expect(url.searchParams.get("q")).toBe("firecrawl");
		expect(url.searchParams.get("kl")).toBe("de-de");
		expect(url.searchParams.get("df")).toBe("w");
		expect(url.searchParams.get("kp")).toBe("-2");
		expect(url.searchParams.get("iar")).toBe("news");
		expect(url.searchParams.get("ia")).toBe("news");
		expect(page.waitForSelector).toHaveBeenCalledWith("article", {
			timeout: 10000,
		});
	});

	it("maps news articles to results with url, title, snippet, ISO date and image", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockResolvedValue([
			{
				url: "https://news.example/story",
				title: "Big Story",
				snippet: "Something happened and then more of it\n41 minutes ago",
				timestamp: "41 minutes ago",
				image: "https://news.example/story.jpg",
			},
		]);
		const outcome = await ddgBrowserSearch(newsInput, makeEnv());
		const item = outcome.results.news?.[0];
		expect(item?.url).toBe("https://news.example/story");
		expect(item?.title).toBe("Big Story");
		expect(item?.snippet).toBe(
			"Something happened and then more of it\n41 minutes ago",
		);
		expect(item?.imageUrl).toBe("https://news.example/story.jpg");
		// "41 minutes ago" -> now - 41min, rounded to the minute.
		const age = Date.now() - new Date(item?.date ?? 0).getTime();
		expect(age).toBeGreaterThanOrEqual(40 * 60_000);
		expect(age).toBeLessThanOrEqual(42 * 60_000);
		expect(outcome.warnings).toEqual([]);
	});

	it("omits the date when an article has no relative timestamp", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockResolvedValue([
			{
				url: "https://news.example/other",
				title: "Other Story",
				snippet: "Just the facts",
				timestamp: null,
				image: null,
			},
		]);
		const outcome = await ddgBrowserSearch(newsInput, makeEnv());
		expect(outcome.results.news?.[0]).toEqual({
			url: "https://news.example/other",
			title: "Other Story",
			snippet: "Just the facts",
			position: 1,
		});
	});

	it("dedupes news URLs, drops non-http links, applies the limit and renumbers", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockResolvedValue([
			{
				url: "https://a.com/1",
				title: "One",
				snippet: "first",
				timestamp: "1 hour ago",
				image: null,
			},
			{
				url: "https://a.com/1/",
				title: "Duplicate trailing slash",
				snippet: "dup",
				timestamp: null,
				image: null,
			},
			{
				url: "javascript:alert(1)",
				title: "Bad scheme",
				snippet: "bad",
				timestamp: null,
				image: null,
			},
			{
				url: "https://b.com/2",
				title: "Two",
				snippet: "second",
				timestamp: null,
				image: null,
			},
			{
				url: "https://c.com/3",
				title: "Three",
				snippet: "third",
				timestamp: null,
				image: null,
			},
		]);
		const outcome = await ddgBrowserSearch(
			{ ...newsInput, limit: 2 },
			makeEnv(),
		);
		expect(outcome.results.news).toEqual([
			{
				url: "https://a.com/1",
				title: "One",
				snippet: "first",
				date: expect.any(String),
				position: 1,
			},
			{ url: "https://b.com/2", title: "Two", snippet: "second", position: 2 },
		]);
	});

	it("caps news snippets at 300 characters", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockResolvedValue([
			{
				url: "https://a.com/long",
				title: "Long",
				snippet: "x".repeat(400),
				timestamp: null,
				image: null,
			},
		]);
		const outcome = await ddgBrowserSearch(newsInput, makeEnv());
		expect(outcome.results.news?.[0]?.snippet).toHaveLength(300);
	});

	it("returns the no-results warning for an empty news page", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockResolvedValue([]);
		const outcome = await ddgBrowserSearch(newsInput, makeEnv());
		expect(outcome).toEqual({
			results: {},
			warnings: ["ddg-browser: no results"],
		});
	});

	it("serves web and news in one browser session with two pages", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate
			.mockResolvedValueOnce([{ url: "https://a.com/1", title: "One" }])
			.mockResolvedValueOnce([
				{
					url: "https://news.example/story",
					title: "A Story",
					snippet: "happened today",
					timestamp: "2 hours ago",
					image: null,
				},
			]);
		const outcome = await ddgBrowserSearch(
			{ ...input, sources: ["web", "news"] },
			makeEnv(),
		);
		expect(getBrowser).toHaveBeenCalledTimes(1);
		expect(browser.newPage).toHaveBeenCalledTimes(2);
		// The empty-shell bug (SPA serves no results to the default headless
		// UA) must stay pinned: every page gets the UA + viewport treatment.
		expect(page.setUserAgent).toHaveBeenCalledTimes(2);
		expect(page.setViewport).toHaveBeenCalledTimes(2);
		expect(page.close).toHaveBeenCalledTimes(2);
		expect(browser.close).toHaveBeenCalledTimes(1);
		const webUrl = new URL(String(page.goto.mock.calls[0][0]));
		const newsUrl = new URL(String(page.goto.mock.calls[1][0]));
		expect(webUrl.searchParams.get("iar")).toBeNull();
		expect(newsUrl.searchParams.get("iar")).toBe("news");
		expect(newsUrl.searchParams.get("ia")).toBe("news");
		expect(outcome.results.web?.[0]?.url).toBe("https://a.com/1");
		expect(outcome.results.news?.[0]?.url).toBe("https://news.example/story");
		expect(outcome.warnings).toEqual([]);
	});

	it("returns web results with a news warning when only news fails", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate
			.mockResolvedValueOnce([{ url: "https://a.com/1", title: "One" }])
			.mockRejectedValueOnce(new Error("news boom"));
		const outcome = await ddgBrowserSearch(
			{ ...input, sources: ["web", "news"] },
			makeEnv(),
		);
		expect(outcome.results.web?.[0]?.url).toBe("https://a.com/1");
		expect(outcome.results.news).toBeUndefined();
		expect(outcome.warnings).toEqual(["ddg-browser: news failed: news boom"]);
		expect(page.close).toHaveBeenCalledTimes(2);
		expect(browser.close).toHaveBeenCalledTimes(1);
	});

	it("returns news results with a web warning when only web fails", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate
			.mockRejectedValueOnce(new Error("web boom"))
			.mockResolvedValueOnce([
				{
					url: "https://news.example/story",
					title: "A Story",
					snippet: "happened today",
					timestamp: null,
					image: null,
				},
			]);
		const outcome = await ddgBrowserSearch(
			{ ...input, sources: ["web", "news"] },
			makeEnv(),
		);
		expect(outcome.results.web).toBeUndefined();
		expect(outcome.results.news?.[0]?.url).toBe("https://news.example/story");
		expect(outcome.warnings).toEqual(["ddg-browser: web failed: web boom"]);
		expect(browser.close).toHaveBeenCalledTimes(1);
	});

	it("warns for both sources and returns empty results when both fail", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockRejectedValue(new Error("boom"));
		const outcome = await ddgBrowserSearch(
			{ ...input, sources: ["web", "news"] },
			makeEnv(),
		);
		expect(outcome).toEqual({
			results: {},
			warnings: ["ddg-browser: web failed: boom", "ddg-browser: news failed: boom"],
		});
		expect(page.close).toHaveBeenCalledTimes(2);
		expect(browser.close).toHaveBeenCalledTimes(1);
	});

	it("runs the real news extraction callback against a stubbed DOM", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		evaluateInPage(page);
		vi.stubGlobal("document", {
			querySelectorAll: (selector: string) =>
				selector === "article"
					? [
							fakeNewsArticle({
								// Publisher/timestamp lines first — the title line sits
								// in the middle, so removal must be line-based.
								text: "Reuters\n41 Minutes ago\nBig Story\nSomething happened and then more of it",
								anchors: [
									{ href: "https://news.example/story", innerText: "Big Story" },
									{ href: "https://news.example/ignored", innerText: "Ignored" },
								],
								image: { src: "https://news.example/story.jpg" },
							}),
							fakeNewsArticle({
								text: "No anchor story\nSome text",
							}),
							fakeNewsArticle({
								text: "Bad scheme\nSkipped",
								anchors: [
									{ href: "javascript:alert(1)", innerText: "Bad scheme" },
								],
							}),
						]
					: [],
		});
		const outcome = await ddgBrowserSearch(newsInput, makeEnv());
		expect(outcome.results.news).toHaveLength(1);
		const item = outcome.results.news?.[0];
		// First anchor wins, its innerText is the title.
		expect(item?.url).toBe("https://news.example/story");
		expect(item?.title).toBe("Big Story");
		// Title line removed wherever it sits; other lines preserved.
		expect(item?.snippet).toBe(
			"Reuters\n41 Minutes ago\nSomething happened and then more of it",
		);
		// Mixed-case "41 Minutes ago" matches via the serialized pattern's i flag.
		expect(item?.imageUrl).toBe("https://news.example/story.jpg");
		const age = Date.now() - new Date(item?.date ?? 0).getTime();
		expect(age).toBeGreaterThanOrEqual(40 * 60_000);
		expect(age).toBeLessThanOrEqual(42 * 60_000);
		expect(outcome.warnings).toEqual([]);
	});

	it("runs the real web extraction callback against a stubbed DOM", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		evaluateInPage(page);
		vi.stubGlobal("document", {
			querySelectorAll: () => [
				{ href: "https://a.com/1", innerText: "One" },
				{ href: "javascript:alert(1)", innerText: "Bad scheme" },
				{ href: "https://b.com/2", innerText: "Two" },
			],
		});
		const outcome = await ddgBrowserSearch(input, makeEnv());
		expect(outcome.results.web).toEqual([
			{ url: "https://a.com/1", title: "One", description: "", position: 1 },
			{ url: "https://b.com/2", title: "Two", description: "", position: 2 },
		]);
		expect(outcome.warnings).toEqual([]);
	});

	it("warns and does no browser work for the images source", async () => {
		const { browser } = makeBrowser();
		stubBrowser(browser);
		const outcome = await ddgBrowserSearch(
			{ ...input, sources: ["images"] },
			makeEnv(),
		);
		expect(outcome).toEqual({
			results: {},
			warnings: ["browser fallback does not support source images"],
		});
		expect(getBrowser).not.toHaveBeenCalled();
		expect(browser.newPage).not.toHaveBeenCalled();
	});

	it("still serves news when images is requested alongside it", async () => {
		const { browser, page } = makeBrowser();
		stubBrowser(browser);
		page.evaluate.mockResolvedValue([
			{
				url: "https://news.example/story",
				title: "A Story",
				snippet: "happened today",
				timestamp: null,
				image: null,
			},
		]);
		const outcome = await ddgBrowserSearch(
			{ ...input, sources: ["news", "images"] },
			makeEnv(),
		);
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.warnings).toEqual([
			"browser fallback does not support source images",
		]);
	});
});
