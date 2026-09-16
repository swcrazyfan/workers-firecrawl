import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";
import {
	DdgVqdError,
	ddgMediaSearch,
	extractVqd,
} from "../../src/search/ddgMedia";
import type { SearchInput } from "../../src/search/types";

// Minimal env stub — the media provider reads no env vars.
function makeEnv(overrides: Record<string, string> = {}): Env {
	return { ...overrides } as unknown as Env;
}

function htmlResponse(html: string, status = 200): Response {
	return new Response(html, {
		status,
		headers: { "content-type": "text/html" },
	});
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

// Default body for every endpoint — empty results, so pagination stops.
const emptyJson = () => jsonResponse({ results: [] });

function vqdPage(token = "vqd-token-1"): Response {
	return htmlResponse(
		`<!DOCTYPE html><html><body><script>window.vqd="${token}";</script></body></html>`,
	);
}

// No quoted `vqd="..."` anywhere — only the unquoted `vqd=...&` form.
function vqdFallbackPage(token = "987-654"): Response {
	return htmlResponse(
		`<html><body><a href="/?q=x&vqd=${token}&y=1">next</a></body></html>`,
	);
}

// Only a single-quoted `vqd='...'` — neither double-quoted nor unquoted form.
function vqdSingleQuotedPage(token = "abc-789"): Response {
	return htmlResponse(
		`<html><body><script>window.vqd='${token}';</script></body></html>`,
	);
}

function newsItem(overrides: Record<string, unknown> = {}): Record<
	string,
	unknown
> {
	return {
		date: "2 hours ago",
		title: "News Title",
		excerpt: "News excerpt",
		url: "https://news.example/story",
		image: "https://img.example/1.jpg",
		source: "Example News",
		...overrides,
	};
}

function imageItem(overrides: Record<string, unknown> = {}): Record<
	string,
	unknown
> {
	return {
		title: "Image Title",
		image: "https://img.example/photo.jpg",
		thumbnail: "https://img.example/thumb.jpg",
		url: "https://page.example/photo",
		height: 600,
		width: 800,
		source: "Example Images",
		...overrides,
	};
}

interface FetchCall {
	url: URL;
	init: RequestInit;
}

function callsOf(mock: ReturnType<typeof vi.fn>): FetchCall[] {
	return (mock.mock.calls as unknown as [string, RequestInit?][]).map(
		([url, init]) => ({ url: new URL(url), init: init ?? {} }),
	);
}

function callsTo(mock: ReturnType<typeof vi.fn>, pathname: string): FetchCall[] {
	return callsOf(mock).filter((call) => call.url.pathname === pathname);
}

// Route-based fetch mock: per-path response queues consumed in order; any
// unrouted path or exhausted queue falls back to the empty JSON page. This
// matters because news.js and i.js run in parallel — call ORDER between the
// two hosts is nondeterministic, so dispatch must be by URL, not index.
function routeFetch(routes: Record<string, Response[]>): ReturnType<
	typeof vi.fn
> {
	const cursors = new Map<string, number>();
	return vi.fn((url: string) => {
		const { pathname } = new URL(url);
		const index = cursors.get(pathname) ?? 0;
		cursors.set(pathname, index + 1);
		return Promise.resolve(routes[pathname]?.[index] ?? emptyJson());
	});
}

const baseInput: SearchInput = {
	query: "firecrawl",
	limit: 5,
	sources: ["news", "images"],
};

describe("extractVqd", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("extracts the quoted token and sends q/kl with browser headers", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(vqdPage("abc-123")));
		vi.stubGlobal("fetch", fetchMock);
		await expect(extractVqd("firecrawl", "us-en")).resolves.toBe("abc-123");
		const { url, init } = callsOf(fetchMock)[0];
		expect(url.origin).toBe("https://duckduckgo.com");
		expect(url.pathname).toBe("/");
		expect(url.searchParams.get("q")).toBe("firecrawl");
		expect(url.searchParams.get("kl")).toBe("us-en");
		expect(init.method).toBe("GET");
		const headers = new Headers(init.headers);
		expect(headers.get("Accept")).toBe("text/html,application/xhtml+xml");
		expect(headers.get("Accept-Language")).toBe("en");
		expect(headers.get("User-Agent")).toBeTruthy();
	});

	it("falls back to the unquoted vqd form when the quoted one is absent", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(vqdFallbackPage("987-654")));
		vi.stubGlobal("fetch", fetchMock);
		await expect(extractVqd("q", "us-en")).resolves.toBe("987-654");
	});

	it("falls back to the single-quoted vqd form as a third option", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(vqdSingleQuotedPage("abc-789")));
		vi.stubGlobal("fetch", fetchMock);
		await expect(extractVqd("q", "us-en")).resolves.toBe("abc-789");
	});

	it("honors lang for the vqd page Accept-Language", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(vqdPage("tok")));
		vi.stubGlobal("fetch", fetchMock);
		await extractVqd("q", "de-de", "de");
		const headers = new Headers(callsOf(fetchMock)[0].init.headers);
		expect(headers.get("Accept-Language")).toBe("de");
	});

	it("throws DdgVqdError for a page over the 1MB body cap", async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(htmlResponse(`vqd="x"${"a".repeat(1_000_000)}`)),
		);
		vi.stubGlobal("fetch", fetchMock);
		const error = await extractVqd("q", "us-en").then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(DdgVqdError);
		expect((error as Error).message).toBe("ddg-vqd: page too large");
	});

	it("throws DdgVqdError when the page carries no token", async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(htmlResponse("<html><body>nothing</body></html>")),
		);
		vi.stubGlobal("fetch", fetchMock);
		const error = await extractVqd("q", "us-en").then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(DdgVqdError);
		expect((error as Error).message).toBe("ddg-vqd: token not found");
	});

	it("retries once on 5xx and succeeds", async () => {
		const fetchMock = vi.fn();
		fetchMock
			.mockImplementationOnce(() =>
				Promise.resolve(new Response("boom", { status: 502 })),
			)
			.mockImplementationOnce(() => Promise.resolve(vqdPage("after-retry")));
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = extractVqd("q", "us-en");
			await vi.advanceTimersByTimeAsync(300);
			await expect(promise).resolves.toBe("after-retry");
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("never retries 4xx and reports the status", async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(new Response("nope", { status: 404 })),
		);
		vi.stubGlobal("fetch", fetchMock);
		const error = await extractVqd("q", "us-en").then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(DdgVqdError);
		expect((error as Error).message).toBe("ddg-vqd: HTTP 404");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("ddgMediaSearch", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("maps news items incl. date/imageUrl, snippet fallback and positions", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [
				jsonResponse({
					results: [
						newsItem(),
						newsItem({
							url: "https://news.example/two",
							title: "Two",
							excerpt: undefined,
							image: undefined,
							date: undefined,
						}),
						newsItem({ url: "javascript:alert(1)", title: "Bad url" }),
						newsItem({
							url: "https://news.example/three",
							image: "javascript:alert(1)",
						}),
					],
				}),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, limit: 3, sources: ["news"] },
			makeEnv(),
		);
		expect(outcome.results.news).toEqual([
			{
				url: "https://news.example/story",
				title: "News Title",
				snippet: "News excerpt",
				date: "2 hours ago",
				imageUrl: "https://img.example/1.jpg",
				position: 1,
			},
			{
				url: "https://news.example/two",
				title: "Two",
				snippet: "",
				position: 2,
			},
			{
				url: "https://news.example/three",
				title: "News Title",
				snippet: "News excerpt",
				date: "2 hours ago",
				position: 3,
			},
		]);
		expect(outcome.warnings).toEqual([]);
	});

	it("maps image items incl. dimensions and the url!==image distinction", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/i.js": [
				jsonResponse({
					results: [
						imageItem(),
						imageItem({
							image: "https://img.example/same.jpg",
							url: "https://img.example/same.jpg",
						}),
						imageItem({ image: "javascript:alert(1)" }),
						imageItem({
							image: "https://img.example/stringy.jpg",
							width: "640",
							height: "480",
						}),
					],
				}),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, limit: 3, sources: ["images"] },
			makeEnv(),
		);
		expect(outcome.results.images).toEqual([
			{
				imageUrl: "https://img.example/photo.jpg",
				url: "https://page.example/photo",
				title: "Image Title",
				imageWidth: 800,
				imageHeight: 600,
				position: 1,
			},
			{
				imageUrl: "https://img.example/same.jpg",
				title: "Image Title",
				imageWidth: 800,
				imageHeight: 600,
				position: 2,
			},
			{
				imageUrl: "https://img.example/stringy.jpg",
				url: "https://page.example/photo",
				title: "Image Title",
				imageWidth: 640,
				imageHeight: 480,
				position: 3,
			},
		]);
		expect(outcome.warnings).toEqual([]);
		// no tbs → no f filter on i.js
		expect(callsTo(fetchMock, "/i.js")[0].url.searchParams.get("f")).toBeNull();
	});

	it("requests news.js with o=json, vqd, s=0 then s=30, df from qdr:w", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage("tok-1")],
			"/news.js": [
				jsonResponse({
					results: [
						newsItem({ url: "https://n.com/1" }),
						newsItem({ url: "https://n.com/2" }),
					],
				}),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = ddgMediaSearch(
				{
					...baseInput,
					limit: 5,
					sources: ["news"],
					tbs: "qdr:w",
					lang: "de",
					country: "DE",
				},
				makeEnv(),
			);
			await vi.advanceTimersByTimeAsync(500);
			const outcome = await promise;
			const newsCalls = callsTo(fetchMock, "/news.js");
			expect(newsCalls).toHaveLength(2);
			const first = newsCalls[0].url.searchParams;
			expect(first.get("o")).toBe("json");
			expect(first.get("vqd")).toBe("tok-1");
			expect(first.get("s")).toBe("0");
			// p is the safesearch code (moderate when safe is unset), not the page
			expect(first.get("p")).toBe("-1");
			expect(first.get("l")).toBe("de-de");
			expect(first.get("q")).toBe("firecrawl");
			expect(first.get("noamp")).toBe("1");
			expect(first.get("df")).toBe("w");
			const second = newsCalls[1].url.searchParams;
			expect(second.get("s")).toBe("30");
			// page 2 advances only via s — p stays the same safesearch code
			expect(second.get("p")).toBe("-1");
			const headers = new Headers(newsCalls[0].init.headers);
			expect(headers.get("Accept")).toBe("application/json");
			expect(headers.get("Accept-Language")).toBe("de");
			expect(headers.get("Referer")).toBe("https://duckduckgo.com/");
			expect(headers.get("User-Agent")).toBeTruthy();
			expect(outcome.results.news).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("requests i.js with f=time:Week, s=100 on page 2 and ct=AT", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage("tok-2")],
			"/i.js": [
				jsonResponse({
					results: [
						imageItem({ image: "https://i.com/1.jpg" }),
						imageItem({ image: "https://i.com/2.jpg" }),
					],
				}),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = ddgMediaSearch(
				{ ...baseInput, limit: 5, sources: ["images"], tbs: "qdr:w" },
				makeEnv(),
			);
			await vi.advanceTimersByTimeAsync(500);
			await promise;
			const imageCalls = callsTo(fetchMock, "/i.js");
			expect(imageCalls).toHaveLength(2);
			const first = imageCalls[0].url.searchParams;
			expect(first.get("o")).toBe("json");
			expect(first.get("vqd")).toBe("tok-2");
			expect(first.get("s")).toBe("0");
			// images moderate safesearch is 1, same as "on"
			expect(first.get("p")).toBe("1");
			expect(first.get("l")).toBe("us-en");
			expect(first.get("f")).toBe("time:Week");
			expect(first.get("ct")).toBe("AT");
			const second = imageCalls[1].url.searchParams;
			expect(second.get("s")).toBe("100");
			// page 2 advances only via s — p stays the same safesearch code
			expect(second.get("p")).toBe("1");
			const headers = new Headers(imageCalls[0].init.headers);
			expect(headers.get("Referer")).toBe("https://duckduckgo.com/");
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps news results when i.js answers 403", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [jsonResponse({ results: [newsItem()] })],
			"/i.js": [new Response("forbidden", { status: 403 })],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, limit: 1 },
			makeEnv(),
		);
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.results.images).toBeUndefined();
		expect(outcome.warnings).toEqual(["ddg-media images: 403 blocked"]);
		expect(callsTo(fetchMock, "/i.js")).toHaveLength(1);
	});

	it("warns but keeps images when news.js answers 403", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [new Response("forbidden", { status: 403 })],
			"/i.js": [jsonResponse({ results: [imageItem()] })],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, limit: 1 },
			makeEnv(),
		);
		expect(outcome.results.news).toBeUndefined();
		expect(outcome.results.images).toHaveLength(1);
		expect(outcome.warnings).toEqual(["ddg-media news: 403 blocked"]);
		expect(callsTo(fetchMock, "/news.js")).toHaveLength(1);
	});

	it("keeps page-1 items when page 2 is 403 blocked", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [
				jsonResponse({
					results: [
						newsItem({ url: "https://keep.com/1" }),
						newsItem({ url: "https://keep.com/2" }),
					],
				}),
				new Response("forbidden", { status: 403 }),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = ddgMediaSearch(
				{ ...baseInput, limit: 5, sources: ["news"] },
				makeEnv(),
			);
			await vi.advanceTimersByTimeAsync(500);
			const outcome = await promise;
			expect(callsTo(fetchMock, "/news.js")).toHaveLength(2);
			expect(outcome.results.news?.map((r) => r.url)).toEqual([
				"https://keep.com/1",
				"https://keep.com/2",
			]);
			expect(outcome.results.news?.map((r) => r.position)).toEqual([1, 2]);
			expect(outcome.warnings).toEqual(["ddg-media news: 403 blocked"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("maps input.safe to per-endpoint safesearch p (news 1/-1/-2, images 1/1/-1)", async () => {
		const fetchMock = routeFetch({
			"/": [1, 2, 3, 4, 5, 6].map(() => vqdPage("tok-p")),
			"/news.js": [1, 2, 3].map((n) =>
				jsonResponse({ results: [newsItem({ url: `https://p.com/${n}` })] }),
			),
			"/i.js": [1, 2, 3].map((n) =>
				jsonResponse({
					results: [imageItem({ image: `https://p.com/${n}.jpg` })],
				}),
			),
		});
		vi.stubGlobal("fetch", fetchMock);
		for (const safe of [true, undefined, false] as const) {
			await ddgMediaSearch(
				{ ...baseInput, limit: 1, sources: ["news"], safe },
				makeEnv(),
			);
			await ddgMediaSearch(
				{ ...baseInput, limit: 1, sources: ["images"], safe },
				makeEnv(),
			);
		}
		expect(
			callsTo(fetchMock, "/news.js").map((c) => c.url.searchParams.get("p")),
		).toEqual(["1", "-1", "-2"]);
		expect(
			callsTo(fetchMock, "/i.js").map((c) => c.url.searchParams.get("p")),
		).toEqual(["1", "1", "-1"]);
	});

	it("warns on both sources and never throws when vqd extraction fails", async () => {
		const fetchMock = routeFetch({
			"/": [htmlResponse("<html><body>no token</body></html>")],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(baseInput, makeEnv());
		expect(outcome.results).toEqual({});
		expect(outcome.warnings).toEqual([
			"ddg-media: token not found",
			"ddg-media: token not found",
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("dedupes across pages and renumbers positions contiguously", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [
				jsonResponse({
					results: [
						newsItem({ url: "https://a.com/1" }),
						newsItem({ url: "https://b.com/2" }),
					],
				}),
				jsonResponse({
					results: [
						// trailing slash — same normalized URL as https://a.com/1
						newsItem({ url: "https://a.com/1/", title: "Dup" }),
						newsItem({ url: "https://c.com/3" }),
					],
				}),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = ddgMediaSearch(
				{ ...baseInput, limit: 10, sources: ["news"] },
				makeEnv(),
			);
			await vi.advanceTimersByTimeAsync(2 * 400 + 100);
			const outcome = await promise;
			// page 3 comes back empty (default route) and stops the loop
			expect(callsTo(fetchMock, "/news.js")).toHaveLength(3);
			const news = outcome.results.news ?? [];
			expect(news.map((r) => r.url)).toEqual([
				"https://a.com/1",
				"https://b.com/2",
				"https://c.com/3",
			]);
			expect(news.map((r) => r.position)).toEqual([1, 2, 3]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops at 3 pages per source", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [1, 2, 3].map((n) =>
				jsonResponse({ results: [newsItem({ url: `https://cap.com/${n}` })] }),
			),
			"/i.js": [1, 2, 3].map((n) =>
				jsonResponse({
					results: [imageItem({ image: `https://capimg.com/${n}.jpg` })],
				}),
			),
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = ddgMediaSearch({ ...baseInput, limit: 50 }, makeEnv());
			await vi.advanceTimersByTimeAsync(2 * 400 + 100);
			const outcome = await promise;
			expect(callsTo(fetchMock, "/news.js")).toHaveLength(3);
			expect(callsTo(fetchMock, "/i.js")).toHaveLength(3);
			expect(outcome.results.news).toHaveLength(3);
			expect(outcome.results.images).toHaveLength(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns both news and images from one shared vqd call", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage("shared-tok")],
			"/news.js": [jsonResponse({ results: [newsItem()] })],
			"/i.js": [jsonResponse({ results: [imageItem()] })],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, limit: 1 },
			makeEnv(),
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(callsTo(fetchMock, "/")).toHaveLength(1);
		expect(outcome.results.news).toHaveLength(1);
		expect(outcome.results.images).toHaveLength(1);
		expect(outcome.warnings).toEqual([]);
	});

	it("returns the no-results warning when nothing usable comes back", async () => {
		const fetchMock = routeFetch({ "/": [vqdPage()] });
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(baseInput, makeEnv());
		expect(outcome.results).toEqual({});
		expect(outcome.warnings).toEqual(["ddg-media: no results"]);
	});

	it("bubbles mapTbs warnings", async () => {
		const fetchMock = routeFetch({ "/": [vqdPage()] });
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, tbs: "qdr:h" },
			makeEnv(),
		);
		expect(outcome.warnings).toEqual([
			"qdr:h unsupported, using day",
			"ddg-media: no results",
		]);
	});

	it("ignores web sources without fetching anything", async () => {
		const fetchMock = routeFetch({});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, sources: ["web"] },
			makeEnv(),
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(outcome.results).toEqual({});
		expect(outcome.warnings).toEqual([]);
	});

	it("converts exhausted network errors on a source into a warning", async () => {
		const fetchMock = vi.fn((url: string) => {
			const { pathname } = new URL(url);
			if (pathname === "/news.js") {
				return Promise.reject(new TypeError("fetch failed"));
			}
			return Promise.resolve(vqdPage());
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			const promise = ddgMediaSearch(
				{ ...baseInput, sources: ["news"] },
				makeEnv(),
			);
			await vi.advanceTimersByTimeAsync(300);
			const outcome = await promise;
			expect(outcome.results).toEqual({});
			expect(outcome.warnings).toEqual([
				"ddg-media news: network error",
				"ddg-media: no results",
			]);
			// retried exactly once before giving up
			expect(callsTo(fetchMock, "/news.js")).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("warns on an unparseable source response", async () => {
		const fetchMock = routeFetch({
			"/": [vqdPage()],
			"/news.js": [
				new Response("<html>gateway error</html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			],
		});
		vi.stubGlobal("fetch", fetchMock);
		const outcome = await ddgMediaSearch(
			{ ...baseInput, sources: ["news"] },
			makeEnv(),
		);
		expect(outcome.results).toEqual({});
		expect(outcome.warnings).toEqual([
			"ddg-media news: invalid response",
			"ddg-media: no results",
		]);
	});
});
