import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ddgBrowserSearch", () => {
	beforeEach(() => {
		vi.resetAllMocks();
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

	it("wraps navigation errors and still closes the page and browser", async () => {
		const { browser, page } = makeBrowser();
		page.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
		stubBrowser(browser);
		await expect(ddgBrowserSearch(input, makeEnv())).rejects.toThrow(
			"ddg-browser: search failed: net::ERR_CONNECTION_REFUSED",
		);
		expect(page.waitForSelector).not.toHaveBeenCalled();
		expect(page.close).toHaveBeenCalled();
		expect(browser.close).toHaveBeenCalled();
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

	it("closes the browser when the result extraction throws", async () => {
		const { browser, page } = makeBrowser();
		page.evaluate.mockRejectedValue(new Error("execution context destroyed"));
		stubBrowser(browser);
		await expect(ddgBrowserSearch(input, makeEnv())).rejects.toThrow(
			"ddg-browser: search failed: execution context destroyed",
		);
		expect(page.close).toHaveBeenCalled();
		expect(browser.close).toHaveBeenCalled();
	});
});
