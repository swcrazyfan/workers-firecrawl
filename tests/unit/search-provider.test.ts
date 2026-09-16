import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";
import { DdgAntiBotError, ddgWebSearch } from "../../src/search/ddg";
import { ddgBrowserSearch } from "../../src/search/ddgBrowser";
import { ddgMediaSearch } from "../../src/search/ddgMedia";
import {
	SearchUnavailableError,
	parseSearchChain,
	searchWithFallback,
} from "../../src/search/provider";
import { searxngSearch } from "../../src/search/searxng";
import type {
	ImageResult,
	NewsResult,
	SearchInput,
	SearchOutcome,
	WebResult,
} from "../../src/search/types";

vi.mock("../../src/search/ddg", () => ({
	ddgWebSearch: vi.fn(),
	DdgAntiBotError: class DdgAntiBotError extends Error {
		constructor() {
			super("ddg: anti-bot challenge");
		}
	},
}));
vi.mock("../../src/search/ddgBrowser", () => ({
	ddgBrowserSearch: vi.fn(),
}));
vi.mock("../../src/search/ddgMedia", () => ({
	ddgMediaSearch: vi.fn(),
}));
vi.mock("../../src/search/searxng", () => ({
	searxngSearch: vi.fn(),
}));

// Minimal env stub — only SEARCH_CHAIN / SEARXNG_ENDPOINT are read; cast per
// spec 003 convention.
function makeEnv(overrides: Record<string, string> = {}): Env {
	return { ...overrides } as unknown as Env;
}

const baseInput: SearchInput = {
	query: "firecrawl",
	limit: 5,
	sources: ["web"],
};

function webOutcome(urls: string[]): SearchOutcome {
	const web: WebResult[] = urls.map((url, index) => ({
		url,
		title: `Title ${index + 1}`,
		description: "",
		position: index + 1,
	}));
	return { results: { web }, warnings: [] };
}

const newsOutcome = (): SearchOutcome => {
	const news: NewsResult[] = [
		{
			url: "https://news.example/story",
			title: "A Story",
			snippet: "happened today",
			position: 1,
		},
	];
	return { results: { news }, warnings: [] };
};

const imageOutcome = (): SearchOutcome => {
	const images: ImageResult[] = [
		{ imageUrl: "https://img.example/pic.png", position: 1 },
	];
	return { results: { images }, warnings: [] };
};

const emptyOutcome = (...warnings: string[]): SearchOutcome => ({
	results: {},
	warnings,
});

describe("parseSearchChain", () => {
	it("falls back to the default chain when unset", () => {
		expect(parseSearchChain(undefined)).toEqual({
			chain: ["ddg", "ddg-media", "browser"],
			warnings: [],
		});
	});

	it("falls back to the default for a blank string", () => {
		expect(parseSearchChain("   ")).toEqual({
			chain: ["ddg", "ddg-media", "browser"],
			warnings: [],
		});
	});

	it("trims, lowercases and preserves the declared order", () => {
		expect(parseSearchChain(" BROWSER , ddg ")).toEqual({
			chain: ["browser", "ddg"],
			warnings: [],
		});
	});

	it("drops unknown ids with a warning", () => {
		expect(parseSearchChain("ddg,bing,ddg-media,brave")).toEqual({
			chain: ["ddg", "ddg-media"],
			warnings: [
				'unknown search provider "bing" skipped',
				'unknown search provider "brave" skipped',
			],
		});
	});

	it("keeps searxng when SEARXNG_ENDPOINT is configured", () => {
		expect(parseSearchChain("ddg,searxng", "https://sx.example")).toEqual({
			chain: ["ddg", "searxng"],
			warnings: [],
		});
	});

	it("drops searxng with a warning when SEARXNG_ENDPOINT is unset", () => {
		expect(parseSearchChain("ddg,searxng")).toEqual({
			chain: ["ddg"],
			warnings: ["searxng skipped: SEARXNG_ENDPOINT not configured"],
		});
	});

	it("falls back to the default when the only provider is an unusable searxng", () => {
		expect(parseSearchChain("searxng")).toEqual({
			chain: ["ddg", "ddg-media", "browser"],
			warnings: ["searxng skipped: SEARXNG_ENDPOINT not configured"],
		});
	});

	it("falls back to the default when every id is unknown", () => {
		expect(parseSearchChain("bing,brave")).toEqual({
			chain: ["ddg", "ddg-media", "browser"],
			warnings: [
				'unknown search provider "bing" skipped',
				'unknown search provider "brave" skipped',
			],
		});
	});
});

describe("searchWithFallback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("serves web from ddg and stops the default chain early", async () => {
		const env = makeEnv();
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		const outcome = await searchWithFallback(baseInput, env);
		expect(ddgWebSearch).toHaveBeenCalledTimes(1);
		expect(ddgWebSearch).toHaveBeenCalledWith(
			{ ...baseInput, sources: ["web"] },
			env,
		);
		expect(ddgMediaSearch).not.toHaveBeenCalled();
		expect(ddgBrowserSearch).not.toHaveBeenCalled();
		expect(outcome.results.web?.[0]?.url).toBe("https://a.com/1");
		expect(outcome.warnings).toEqual([]);
	});

	it("resolves each source independently across the chain", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,ddg-media" });
		const input: SearchInput = { ...baseInput, sources: ["web", "news"] };
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		vi.mocked(ddgMediaSearch).mockResolvedValue(newsOutcome());
		const outcome = await searchWithFallback(input, env);
		expect(ddgWebSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["web"] },
			env,
		);
		expect(ddgMediaSearch).toHaveBeenCalledTimes(1);
		expect(ddgMediaSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["news"] },
			env,
		);
		expect(outcome.results.web?.[0]?.url).toBe("https://a.com/1");
		expect(outcome.results.news?.[0]?.url).toBe("https://news.example/story");
		expect(outcome.warnings).toEqual([]);
	});

	it("passes the remaining input through to each provider untouched", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,ddg-media" });
		const input: SearchInput = {
			...baseInput,
			limit: 3,
			tbs: "qdr:w",
			safe: true,
			sources: ["web", "images"],
		};
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		vi.mocked(ddgMediaSearch).mockResolvedValue(imageOutcome());
		await searchWithFallback(input, env);
		expect(ddgWebSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["web"] },
			env,
		);
		expect(ddgMediaSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["images"] },
			env,
		);
	});

	it("calls searxng only for sources ddg cannot serve", async () => {
		const env = makeEnv({
			SEARCH_CHAIN: "ddg,searxng",
			SEARXNG_ENDPOINT: "https://sx.example",
		});
		const input: SearchInput = { ...baseInput, sources: ["news"] };
		vi.mocked(searxngSearch).mockResolvedValue(newsOutcome());
		const outcome = await searchWithFallback(input, env);
		expect(ddgWebSearch).not.toHaveBeenCalled();
		expect(searxngSearch).toHaveBeenCalledTimes(1);
		expect(searxngSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["news"] },
			env,
		);
		expect(outcome.results.news?.[0]?.url).toBe("https://news.example/story");
	});

	it("does not call searxng for web when ddg already filled it", async () => {
		const env = makeEnv({
			SEARCH_CHAIN: "ddg,searxng",
			SEARXNG_ENDPOINT: "https://sx.example",
		});
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		const outcome = await searchWithFallback(baseInput, env);
		expect(searxngSearch).not.toHaveBeenCalled();
		expect(outcome.warnings).toEqual([]);
	});

	it("lets searxng backfill both news and images when configured", async () => {
		const env = makeEnv({
			SEARCH_CHAIN: "ddg,searxng",
			SEARXNG_ENDPOINT: "https://sx.example",
		});
		const input: SearchInput = { ...baseInput, sources: ["news", "images"] };
		vi.mocked(searxngSearch).mockResolvedValue({
			results: {
				news: newsOutcome().results.news,
				images: imageOutcome().results.images,
			},
			warnings: [],
		});
		const outcome = await searchWithFallback(input, env);
		expect(ddgWebSearch).not.toHaveBeenCalled();
		expect(searxngSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["news", "images"] },
			env,
		);
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.results.images).toHaveLength(1);
	});

	it("skips searxng without an endpoint and reports the unfilled source", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,searxng" });
		const input: SearchInput = { ...baseInput, sources: ["web", "news"] };
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		const outcome = await searchWithFallback(input, env);
		expect(searxngSearch).not.toHaveBeenCalled();
		expect(outcome.warnings).toContain(
			"searxng skipped: SEARXNG_ENDPOINT not configured",
		);
		expect(outcome.warnings).toContain(
			"no provider returned results for news",
		);
		expect(outcome.results.web).toHaveLength(1);
		expect(outcome.results.news).toBeUndefined();
	});

	it("does not call the browser when ddg wins web first", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,browser" });
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		const outcome = await searchWithFallback(baseInput, env);
		expect(ddgBrowserSearch).not.toHaveBeenCalled();
		expect(outcome.results.web).toHaveLength(1);
	});

	it("falls back to the browser when ddg throws the anti-bot challenge", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,browser" });
		vi.mocked(ddgWebSearch).mockRejectedValue(new DdgAntiBotError());
		vi.mocked(ddgBrowserSearch).mockResolvedValue(
			webOutcome(["https://b.com/1"]),
		);
		const outcome = await searchWithFallback(baseInput, env);
		expect(ddgBrowserSearch).toHaveBeenCalledTimes(1);
		expect(ddgBrowserSearch).toHaveBeenCalledWith(
			{ ...baseInput, sources: ["web"] },
			env,
		);
		expect(outcome.results.web?.[0]?.url).toBe("https://b.com/1");
		expect(outcome.warnings).toContain("ddg: anti-bot challenge");
	});

	it("falls back to the browser when ddg returns no results", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,browser" });
		vi.mocked(ddgWebSearch).mockResolvedValue(emptyOutcome("ddg: no results"));
		vi.mocked(ddgBrowserSearch).mockResolvedValue(
			webOutcome(["https://b.com/1"]),
		);
		const outcome = await searchWithFallback(baseInput, env);
		expect(outcome.results.web?.[0]?.url).toBe("https://b.com/1");
		expect(outcome.warnings).toContain("ddg: no results");
	});

	it("throws with every provider reason when nothing fills the web source", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,browser" });
		vi.mocked(ddgWebSearch).mockRejectedValue(new DdgAntiBotError());
		vi.mocked(ddgBrowserSearch).mockResolvedValue(
			emptyOutcome("ddg-browser: no results"),
		);
		await expect(searchWithFallback(baseInput, env)).rejects.toThrow(
			"search backend unavailable: ddg: anti-bot challenge; ddg-browser: no results",
		);
	});

	it("returns partials with a warning per unfilled source", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg" });
		const input: SearchInput = { ...baseInput, sources: ["web", "news"] };
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		const outcome = await searchWithFallback(input, env);
		// ddg can only serve web, so news is never sent to it
		expect(ddgWebSearch).toHaveBeenCalledWith(
			{ ...input, sources: ["web"] },
			env,
		);
		expect(ddgBrowserSearch).not.toHaveBeenCalled();
		expect(outcome.results.web).toHaveLength(1);
		expect(outcome.warnings).toEqual([
			"no provider returned results for news",
		]);
	});

	it("respects a single-provider chain with no implicit browser", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg" });
		vi.mocked(ddgWebSearch).mockResolvedValue(emptyOutcome("ddg: no results"));
		await expect(searchWithFallback(baseInput, env)).rejects.toThrow(
			SearchUnavailableError,
		);
		expect(ddgBrowserSearch).not.toHaveBeenCalled();
	});

	it("returns media results when web fails entirely", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,browser,ddg-media" });
		const input: SearchInput = { ...baseInput, sources: ["web", "news"] };
		vi.mocked(ddgWebSearch).mockRejectedValue(new DdgAntiBotError());
		vi.mocked(ddgBrowserSearch).mockResolvedValue(
			emptyOutcome("ddg-browser: no results"),
		);
		vi.mocked(ddgMediaSearch).mockResolvedValue(newsOutcome());
		const outcome = await searchWithFallback(input, env);
		expect(outcome.results.web).toBeUndefined();
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.warnings).toContain("ddg: anti-bot challenge");
		expect(outcome.warnings).toContain(
			"no provider returned results for web",
		);
	});

	it("warns about unknown chain ids and continues", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "bing,ddg" });
		vi.mocked(ddgWebSearch).mockResolvedValue(webOutcome(["https://a.com/1"]));
		const outcome = await searchWithFallback(baseInput, env);
		expect(ddgWebSearch).toHaveBeenCalledTimes(1);
		expect(outcome.results.web).toHaveLength(1);
		expect(outcome.warnings).toEqual([
			'unknown search provider "bing" skipped',
		]);
	});

	it("prefixes provider throws with the provider id", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg-media" });
		vi.mocked(ddgMediaSearch).mockRejectedValue(new Error("vqd quota hit"));
		await expect(
			searchWithFallback({ ...baseInput, sources: ["news"] }, env),
		).rejects.toThrow("search backend unavailable: ddg-media: vqd quota hit");
	});

	it("explains when no chained provider can serve a source", async () => {
		const env = makeEnv({ SEARCH_CHAIN: "ddg,browser" });
		await expect(
			searchWithFallback({ ...baseInput, sources: ["news"] }, env),
		).rejects.toThrow(
			"search backend unavailable: no provider available for news",
		);
		expect(ddgWebSearch).not.toHaveBeenCalled();
		expect(ddgBrowserSearch).not.toHaveBeenCalled();
	});

	it("returns an empty outcome for an empty source list", async () => {
		const outcome = await searchWithFallback(
			{ ...baseInput, sources: [] },
			makeEnv(),
		);
		expect(outcome).toEqual({ results: {}, warnings: [] });
		expect(ddgWebSearch).not.toHaveBeenCalled();
		expect(ddgMediaSearch).not.toHaveBeenCalled();
	});
});
