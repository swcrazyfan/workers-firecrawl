import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";
import type { SearchInput } from "../../src/search/types";
import { searxngSearch } from "../../src/search/searxng";

// Minimal env stub — cast through unknown per spec 003
function makeEnv(overrides: Record<string, string> = {}): Env {
	return {
		SEARXNG_ENDPOINT: "https://sx.example",
		...overrides,
	} as unknown as Env;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function pageOf(items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
	return jsonResponse({ results: items, ...extra });
}

const emptyPage = () => jsonResponse({ results: [] });

function lastUrl(mock: ReturnType<typeof vi.fn>, index = 0): URL {
	const calls = mock.mock.calls as unknown as [string, RequestInit?][];
	return new URL(calls[index][0]);
}

const baseInput: SearchInput = {
	query: "firecrawl",
	limit: 5,
	sources: ["web"],
};

describe("searxngSearch", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		// Default: empty result page, so pagination loops stop cleanly when a
		// test only stubs page 1 (an exhausted vi.fn would return undefined).
		fetchMock.mockImplementation(() => Promise.resolve(emptyPage()));
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("normalizes web results with 1-based positions and hits the stripped-endpoint URL", async () => {
		fetchMock.mockResolvedValueOnce(
			pageOf([
				{ url: "https://a.com/x", title: "A", content: "alpha" },
				{ url: "https://b.com/y", title: "B" },
			]),
		);
		const outcome = await searxngSearch(baseInput, makeEnv({ SEARXNG_ENDPOINT: "https://sx.example/" }));
		const url = lastUrl(fetchMock);
		expect(url.origin).toBe("https://sx.example");
		expect(url.pathname).toBe("/search");
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.searchParams.get("categories")).toBe("general");
		expect(outcome.warnings).toEqual([]);
		expect(outcome.results.web).toEqual([
			{ url: "https://a.com/x", title: "A", description: "alpha", position: 1 },
			{ url: "https://b.com/y", title: "B", description: "", position: 2 },
		]);
	});

	it("maps news publishedDate to date and prefers thumbnail_src for imageUrl", async () => {
		fetchMock.mockResolvedValueOnce(
			pageOf([
				{
					url: "https://news.com/story",
					title: "Story",
					content: "breaking",
					publishedDate: "2026-09-14T10:00:00Z",
					thumbnail_src: "https://cdn.com/thumb.jpg",
					img_src: "https://cdn.com/full.jpg",
				},
				{ url: "https://news.com/other", title: "Other", img_src: "https://cdn.com/other.jpg" },
			]),
		);
		const outcome = await searxngSearch({ ...baseInput, sources: ["news"] }, makeEnv());
		const url = lastUrl(fetchMock);
		expect(url.searchParams.get("categories")).toBe("news");
		expect(outcome.results.news).toEqual([
			{
				url: "https://news.com/story",
				title: "Story",
				snippet: "breaking",
				date: "2026-09-14T10:00:00Z",
				imageUrl: "https://cdn.com/thumb.jpg",
				position: 1,
			},
			{
				url: "https://news.com/other",
				title: "Other",
				snippet: "",
				imageUrl: "https://cdn.com/other.jpg",
				position: 2,
			},
		]);
	});

	it("parses image resolution, drops items without img_src, and omits url when equal to img_src", async () => {
		fetchMock.mockResolvedValueOnce(
			pageOf([
				{
					url: "https://page.com/post",
					title: "Pic",
					img_src: "https://img.com/pic.jpg",
					resolution: "1920 x 1080",
				},
				{ title: "NoSrc" },
				{ url: "https://img.com/same.jpg", title: "Same", img_src: "https://img.com/same.jpg" },
			]),
		);
		const outcome = await searxngSearch({ ...baseInput, sources: ["images"] }, makeEnv());
		const url = lastUrl(fetchMock);
		expect(url.searchParams.get("categories")).toBe("images");
		expect(outcome.results.images).toEqual([
			{
				url: "https://page.com/post",
				title: "Pic",
				imageUrl: "https://img.com/pic.jpg",
				imageWidth: 1920,
				imageHeight: 1080,
				position: 1,
			},
			{ title: "Same", imageUrl: "https://img.com/same.jpg", position: 2 },
		]);
	});

	it("dedupes per source by normalized URL (lowercase host, trailing slash/hash ignored), first wins", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				pageOf([
					{ url: "https://Example.com/page#frag", title: "First", content: "1" },
					{ url: "https://example.com/page/", title: "Dup", content: "2" },
					{ url: "https://example.com/page?a=1", title: "KeptDistinct", content: "3" },
				]),
			),
		);
		const outcome = await searxngSearch(baseInput, makeEnv());
		expect(outcome.results.web?.map((r) => r.title)).toEqual(["First", "KeptDistinct"]);
	});

	it("stops paginating when a page comes back empty", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(pageOf([{ url: "https://a.com/1", title: "One" }])),
		);
		const outcome = await searxngSearch({ ...baseInput, limit: 10 }, makeEnv());
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(lastUrl(fetchMock, 1).searchParams.get("pageno")).toBe("2");
		expect(outcome.results.web).toHaveLength(1);
	});

	it("stops paginating once limit is reached and slices to limit", async () => {
		const page1 = Array.from({ length: 5 }, (_, i) => ({ url: `https://a.com/${i}`, title: `T${i}` }));
		fetchMock.mockResolvedValueOnce(pageOf(page1));
		const outcome = await searxngSearch({ ...baseInput, limit: 3 }, makeEnv());
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(outcome.results.web).toHaveLength(3);
		expect(outcome.results.web?.[2].position).toBe(3);
	});

	it("builds the domain filter query from include/exclude domains", async () => {
		fetchMock.mockResolvedValueOnce(emptyPage());
		await searxngSearch(
			{
				...baseInput,
				includeDomains: ["a.com", "b.com"],
				excludeDomains: ["x.com"],
			},
			makeEnv(),
		);
		expect(lastUrl(fetchMock).searchParams.get("q")).toBe("firecrawl site:a.com OR site:b.com -site:x.com");
	});

	it("sends safesearch=2 only when safe is true, and maps tbs time_range", async () => {
		fetchMock.mockResolvedValueOnce(emptyPage());
		await searxngSearch({ ...baseInput, safe: true, tbs: "qdr:w" }, makeEnv());
		const params = lastUrl(fetchMock).searchParams;
		expect(params.get("safesearch")).toBe("2");
		expect(params.get("time_range")).toBe("week");

		fetchMock.mockResolvedValueOnce(emptyPage());
		await searxngSearch({ ...baseInput }, makeEnv());
		expect(lastUrl(fetchMock, 1).searchParams.get("safesearch")).toBeNull();
		expect(lastUrl(fetchMock, 1).searchParams.get("time_range")).toBeNull();
	});

	it("sends engines only when SEARXNG_ENGINES is set, and forwards lang", async () => {
		fetchMock.mockResolvedValueOnce(emptyPage());
		await searxngSearch({ ...baseInput, lang: "de" }, makeEnv({ SEARXNG_ENGINES: "google,bing" }));
		const withEngines = lastUrl(fetchMock).searchParams;
		expect(withEngines.get("engines")).toBe("google,bing");
		expect(withEngines.get("language")).toBe("de");

		fetchMock.mockResolvedValueOnce(emptyPage());
		await searxngSearch(baseInput, makeEnv());
		expect(lastUrl(fetchMock, 1).searchParams.get("engines")).toBeNull();
	});

	it("produces the 403 json-format warning and fails soft when another source works", async () => {
		fetchMock.mockImplementation((rawUrl: string) => {
			const url = new URL(rawUrl);
			if (url.searchParams.get("categories") === "general") {
				return Promise.resolve(new Response("forbidden", { status: 403 }));
			}
			if (url.searchParams.get("pageno") === "1") {
				return Promise.resolve(pageOf([{ url: "https://news.com/a", title: "News" }]));
			}
			return Promise.resolve(emptyPage());
		});
		const outcome = await searxngSearch({ ...baseInput, sources: ["web", "news"] }, makeEnv());
		expect(outcome.warnings).toContain("SearXNG returned 403 — enable 'json' in settings.yml search.formats");
		expect(outcome.results.web).toBeUndefined();
		expect(outcome.results.news).toHaveLength(1);
	});

	it("throws when all requested sources fail", async () => {
		fetchMock.mockResolvedValue(new Response("down", { status: 500 }));
		await expect(searxngSearch({ ...baseInput, sources: ["web", "news"] }, makeEnv())).rejects.toThrow(
			"searxng: all sources failed",
		);
	});

	it("fails soft: news fails with an error while web still returns results", async () => {
		fetchMock.mockImplementation((rawUrl: string) => {
			const url = new URL(rawUrl);
			if (url.searchParams.get("categories") === "news" && url.searchParams.get("pageno") === "1") {
				return Promise.resolve(new Response("bad request detail", { status: 400 }));
			}
			if (url.searchParams.get("categories") === "general" && url.searchParams.get("pageno") === "1") {
				return Promise.resolve(pageOf([{ url: "https://a.com/x", title: "Web" }]));
			}
			return Promise.resolve(emptyPage());
		});
		const outcome = await searxngSearch({ ...baseInput, sources: ["web", "news"] }, makeEnv());
		expect(outcome.results.web).toHaveLength(1);
		expect(outcome.results.news).toBeUndefined();
		expect(outcome.warnings.some((w) => w.includes("SearXNG returned 400: bad request detail"))).toBe(true);
	});

	it("retries once after 250ms on 5xx and succeeds", async () => {
		vi.useFakeTimers();
		try {
			fetchMock
				.mockImplementationOnce(() => Promise.resolve(new Response("boom", { status: 502 })))
				.mockImplementationOnce(() =>
					Promise.resolve(pageOf([{ url: "https://a.com/x", title: "AfterRetry" }])),
				);
			const promise = searxngSearch({ ...baseInput, limit: 1 }, makeEnv());
			await vi.advanceTimersByTimeAsync(300);
			const outcome = await promise;
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(outcome.results.web).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("never retries 4xx", async () => {
		// news is the live source; web returns 403 and must not be retried
		fetchMock.mockImplementation((rawUrl: string) => {
			const url = new URL(rawUrl);
			if (url.searchParams.get("categories") === "general") {
				return Promise.resolve(new Response("forbidden", { status: 403 }));
			}
			if (url.searchParams.get("categories") === "news" && url.searchParams.get("pageno") === "1") {
				return Promise.resolve(pageOf([{ url: "https://news.com/a", title: "News" }]));
			}
			return Promise.resolve(emptyPage());
		});
		const outcome = await searxngSearch({ ...baseInput, sources: ["web", "news"] }, makeEnv());
		expect(outcome.results.web).toBeUndefined();
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.warnings).toContain(
			"SearXNG returned 403 — enable 'json' in settings.yml search.formats",
		);
		const webCalls = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([u]) =>
			u.includes("categories=general"),
		);
		expect(webCalls).toHaveLength(1);
	});

	it("warns when page 1 is empty and engines report unresponsive errors", async () => {
		fetchMock.mockImplementation((rawUrl: string) => {
			const url = new URL(rawUrl);
			if (url.searchParams.get("categories") === "general") {
				return Promise.resolve(
					jsonResponse({
						results: [],
						unresponsive_engines: [
							["duckduckgo", "Timeout"],
							["bing", "HTTP 429"],
						],
					}),
				);
			}
			if (url.searchParams.get("categories") === "news" && url.searchParams.get("pageno") === "1") {
				return Promise.resolve(pageOf([{ url: "https://news.com/a", title: "News" }]));
			}
			return Promise.resolve(emptyPage());
		});
		const outcome = await searxngSearch({ ...baseInput, sources: ["web", "news"] }, makeEnv());
		expect(outcome.results.web).toBeUndefined();
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.warnings.some((w) => w.includes("duckduckgo") && w.includes("Timeout"))).toBe(true);
	});

	it("drops invalid items silently and filters non-http(s) URLs", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				pageOf([
					{ url: "javascript:alert(1)", title: "Bad" },
					{ url: "https://ok.com/", title: "Ok" },
					{ title: "NoUrl" },
				]),
			),
		);
		const outcome = await searxngSearch(baseInput, makeEnv());
		expect(outcome.results.web).toEqual([{ url: "https://ok.com/", title: "Ok", description: "", position: 1 }]);
		expect(outcome.warnings).toEqual([]);
	});

	it("surfaces a mid-pagination failure warning alongside partial results", async () => {
		fetchMock.mockImplementation((rawUrl: string) => {
			const url = new URL(rawUrl);
			if (url.searchParams.get("pageno") === "1") {
				return Promise.resolve(
					pageOf([
						{ url: "https://a.com/1", title: "One" },
						{ url: "https://a.com/2", title: "Two" },
					]),
				);
			}
			return Promise.resolve(new Response("forbidden", { status: 403 }));
		});
		const outcome = await searxngSearch(baseInput, makeEnv());
		expect(outcome.results.web).toEqual([
			{ url: "https://a.com/1", title: "One", description: "", position: 1 },
			{ url: "https://a.com/2", title: "Two", description: "", position: 2 },
		]);
		expect(outcome.warnings.some((w) => w.includes("403"))).toBe(true);
	});

	it("warns on malformed SEARXNG_HEADERS but still sends the base content-type header", async () => {
		fetchMock.mockResolvedValueOnce(emptyPage());
		const outcome = await searxngSearch(
			baseInput,
			makeEnv({ SEARXNG_HEADERS: "{not json" }),
		);
		expect(
			outcome.warnings.some((w) => w.includes("SEARXNG_HEADERS is not valid JSON")),
		).toBe(true);
		const init = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1];
		expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
	});

	it("merges SEARXNG_HEADERS (CF Access service token) into request headers", async () => {
		fetchMock.mockResolvedValueOnce(emptyPage());
		await searxngSearch(
			baseInput,
			makeEnv({
				SEARXNG_HEADERS: JSON.stringify({
					"CF-Access-Client-Id": "id123",
					"CF-Access-Client-Secret": "secret456",
				}),
			}),
		);
		const init = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1];
		const headers = new Headers(init?.headers);
		expect(headers.get("CF-Access-Client-Id")).toBe("id123");
		expect(headers.get("CF-Access-Client-Secret")).toBe("secret456");
	});
});
