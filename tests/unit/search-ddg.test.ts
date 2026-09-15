import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";
import type { SearchInput } from "../../src/search/types";
import {
	DdgAntiBotError,
	ddgWebSearch,
	parseDdgHtml,
} from "../../src/search/ddg";

// Minimal env stub — the DDG provider reads no env vars; cast per spec 003
function makeEnv(overrides: Record<string, string> = {}): Env {
	return { ...overrides } as unknown as Env;
}

function htmlResponse(html: string, status = 200): Response {
	return new Response(html, {
		status,
		headers: { "content-type": "text/html" },
	});
}

// Modeled on real html.duckduckgo.com markup: title anchor carries
// rel="nofollow" class="result__a", snippet anchor class="result__snippet".
function resultBlock(href: string, title: string, snippet?: string): string {
	const snippetHtml = snippet
		? `<a class="result__snippet" href="${href}">${snippet}</a>`
		: "";
	return `<div class="result results_links web-result">
	<h2 class="result__title">
		<a rel="nofollow" class="result__a" href="${href}">${title}</a>
	</h2>
	${snippetHtml}
</div>`;
}

function resultsPage(...blocks: string[]): string {
	return `<!DOCTYPE html><html><body><div class="results">${blocks.join("")}</div></body></html>`;
}

const emptyPage = () => htmlResponse(resultsPage());

function callAt(
	mock: ReturnType<typeof vi.fn>,
	index: number,
): { url: URL; init: RequestInit } {
	const calls = mock.mock.calls as unknown as [string, RequestInit?][];
	return { url: new URL(calls[index][0]), init: calls[index][1] ?? {} };
}

const baseInput: SearchInput = {
	query: "firecrawl",
	limit: 5,
	sources: ["web"],
};

describe("parseDdgHtml", () => {
	it("unwraps uddg redirects, skips non-http results, decodes entities and strips tags", () => {
		const html = resultsPage(
			resultBlock(
				"//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fq%3D1%26x%3D2&amp;rut=abc",
				"Docs &amp; Guides for <b>Firecrawl</b>",
				"Tom &lt; Jerry &quot;vs&quot; &#x27;the&#x27; &amp; me",
			),
			resultBlock("https://plain.example/page", "Plain Page", "no redirect"),
			resultBlock(
				"//duckduckgo.com/l/?uddg=javascript%3Aalert(1)&rut=xyz",
				"Bad",
				"skipped",
			),
		);
		expect(parseDdgHtml(html)).toEqual([
			{
				url: "https://example.com/docs?q=1&x=2",
				title: "Docs & Guides for Firecrawl",
				snippet: "Tom < Jerry \"vs\" 'the' & me",
			},
			{
				url: "https://plain.example/page",
				title: "Plain Page",
				snippet: "no redirect",
			},
		]);
	});

	it("defaults the snippet to empty string when a result has none", () => {
		const html = resultsPage(
			resultBlock("https://a.com/no-snippet", "Title Only"),
			resultBlock("https://b.com/with-snippet", "Has One", "present"),
		);
		expect(parseDdgHtml(html)).toEqual([
			{ url: "https://a.com/no-snippet", title: "Title Only", snippet: "" },
			{ url: "https://b.com/with-snippet", title: "Has One", snippet: "present" },
		]);
	});

	it("throws DdgAntiBotError on anomaly-modal", () => {
		expect(() =>
			parseDdgHtml('<div class="anomaly-modal">bot check</div>'),
		).toThrow(DdgAntiBotError);
	});

	it("throws DdgAntiBotError on challenge-form", () => {
		expect(() =>
			parseDdgHtml('<form class="challenge-form">are you human?</form>'),
		).toThrow("ddg: anti-bot challenge");
	});

	it("returns [] for empty or garbage pages", () => {
		expect(parseDdgHtml("")).toEqual([]);
		expect(parseDdgHtml("<html><body>nothing to see</body></html>")).toEqual([]);
	});
});

describe("ddgWebSearch", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		// Default: empty results page, so pagination stops when a test only
		// stubs page 1 (an exhausted vi.fn would return undefined).
		fetchMock.mockImplementation(() => Promise.resolve(emptyPage()));
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches page 1 via GET with q/kl/df/kp params and browser-like headers", async () => {
		await ddgWebSearch(
			{
				...baseInput,
				tbs: "qdr:w",
				lang: "de",
				country: "DE",
				includeDomains: ["a.com"],
			},
			makeEnv(),
		);
		const { url, init } = callAt(fetchMock, 0);
		expect(url.origin).toBe("https://html.duckduckgo.com");
		expect(url.pathname).toBe("/html/");
		expect(url.searchParams.get("q")).toBe("firecrawl site:a.com");
		expect(url.searchParams.get("kl")).toBe("de-de");
		expect(url.searchParams.get("df")).toBe("w");
		expect(url.searchParams.get("kp")).toBe("-2");
		expect(init.method).toBe("GET");
		const headers = new Headers(init.headers);
		expect(headers.get("Accept")).toBe("text/html,application/xhtml+xml");
		expect(headers.get("Accept-Language")).toBe("de");
		expect(headers.get("User-Agent")).toBeTruthy();
	});

	it("sends kp=1 when safe is true, kp=-2 otherwise with Accept-Language defaulting to en", async () => {
		await ddgWebSearch({ ...baseInput, safe: true }, makeEnv());
		expect(callAt(fetchMock, 0).url.searchParams.get("kp")).toBe("1");

		await ddgWebSearch(baseInput, makeEnv());
		const { url, init } = callAt(fetchMock, 1);
		expect(url.searchParams.get("kp")).toBe("-2");
		expect(new Headers(init.headers).get("Accept-Language")).toBe("en");
	});

	it("POSTs page 2 with s=10 form body when page 1 is short of the limit", async () => {
		vi.useFakeTimers();
		try {
			fetchMock.mockImplementationOnce(() =>
				Promise.resolve(
					htmlResponse(
						resultsPage(resultBlock("https://a.com/1", "One", "first hit")),
					),
				),
			);
			const promise = ddgWebSearch({ ...baseInput, limit: 5 }, makeEnv());
			await vi.advanceTimersByTimeAsync(1200);
			const outcome = await promise;
			expect(fetchMock).toHaveBeenCalledTimes(2);
			const { url, init } = callAt(fetchMock, 1);
			expect(url.toString()).toBe("https://html.duckduckgo.com/html/");
			expect(init.method).toBe("POST");
			expect(new Headers(init.headers).get("content-type")).toBe(
				"application/x-www-form-urlencoded",
			);
			const body = new URLSearchParams(String(init.body));
			expect(body.get("q")).toBe("firecrawl");
			expect(body.get("s")).toBe("10");
			expect(body.get("kl")).toBe("us-en");
			expect(body.get("df")).toBeNull();
			expect(outcome.results.web).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops paginating when a page adds no new (post-dedupe) results", async () => {
		vi.useFakeTimers();
		try {
			fetchMock
				.mockImplementationOnce(() =>
					Promise.resolve(
						htmlResponse(
							resultsPage(
								resultBlock("https://a.com/1", "One", "s1"),
								resultBlock("https://a.com/2", "Two", "s2"),
							),
						),
					),
				)
				.mockImplementationOnce(() =>
					Promise.resolve(
						// trailing slash — same normalized URL as https://a.com/1
						htmlResponse(resultsPage(resultBlock("https://a.com/1/", "Dup", "dup"))),
					),
				);
			const promise = ddgWebSearch({ ...baseInput, limit: 10 }, makeEnv());
			await vi.advanceTimersByTimeAsync(1200);
			const outcome = await promise;
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(outcome.results.web?.map((r) => r.url)).toEqual([
				"https://a.com/1",
				"https://a.com/2",
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("throws DdgAntiBotError on HTTP 202 without retrying", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(new Response("challenge", { status: 202 })),
		);
		await expect(ddgWebSearch(baseInput, makeEnv())).rejects.toThrow(
			DdgAntiBotError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws DdgAntiBotError when the page body contains a challenge marker", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				htmlResponse('<div class="anomaly-modal">bot check</div>'),
			),
		);
		await expect(ddgWebSearch(baseInput, makeEnv())).rejects.toThrow(
			"ddg: anti-bot challenge",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps duplicate URLs across pages once and renumbers positions 1..N", async () => {
		vi.useFakeTimers();
		try {
			fetchMock
				.mockImplementationOnce(() =>
					Promise.resolve(
						htmlResponse(
							resultsPage(
								resultBlock("https://a.com/x", "First", "s1"),
								resultBlock("https://b.com/y", "Second", "s2"),
							),
						),
					),
				)
				.mockImplementationOnce(() =>
					Promise.resolve(
						htmlResponse(
							resultsPage(
								resultBlock("https://a.com/x/", "First again", "dup"),
								resultBlock("https://c.com/z", "Third", "s3"),
							),
						),
					),
				);
			const promise = ddgWebSearch({ ...baseInput, limit: 10 }, makeEnv());
			await vi.advanceTimersByTimeAsync(2300);
			const outcome = await promise;
			// page 3 comes back empty (default mock) and stops the loop
			expect(fetchMock).toHaveBeenCalledTimes(3);
			const web = outcome.results.web ?? [];
			expect(web.map((r) => r.url)).toEqual([
				"https://a.com/x",
				"https://b.com/y",
				"https://c.com/z",
			]);
			expect(web.map((r) => r.position)).toEqual([1, 2, 3]);
			expect(web.map((r) => r.description)).toEqual(["s1", "s2", "s3"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("warns when the 5-page cap is hit before the limit is reached", async () => {
		vi.useFakeTimers();
		try {
			let n = 0;
			fetchMock.mockImplementation(() => {
				n += 1;
				return Promise.resolve(
					htmlResponse(
						resultsPage(resultBlock(`https://cap.com/p${n}`, `Hit ${n}`, `s${n}`)),
					),
				);
			});
			const promise = ddgWebSearch({ ...baseInput, limit: 50 }, makeEnv());
			await vi.advanceTimersByTimeAsync(4 * 1100 + 200);
			const outcome = await promise;
			expect(fetchMock).toHaveBeenCalledTimes(5);
			expect(outcome.results.web).toHaveLength(5);
			expect(outcome.warnings).toContain(
				"ddg: stopped at page cap 5, returning 5 < 50 results",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns the no-results warning for an empty results page", async () => {
		const outcome = await ddgWebSearch(baseInput, makeEnv());
		expect(outcome.results).toEqual({});
		expect(outcome.warnings).toEqual(["ddg: no results"]);
	});

	it("bubbles mapTbs warnings", async () => {
		const outcome = await ddgWebSearch({ ...baseInput, tbs: "qdr:h" }, makeEnv());
		expect(outcome.warnings).toEqual([
			"qdr:h unsupported, using day",
			"ddg: no results",
		]);
		const { url } = callAt(fetchMock, 0);
		expect(url.searchParams.get("df")).toBe("d");
	});

	it("retries once after 250ms on 5xx and succeeds", async () => {
		vi.useFakeTimers();
		try {
			fetchMock
				.mockImplementationOnce(() => Promise.resolve(new Response("boom", { status: 502 })))
				.mockImplementationOnce(() => Promise.resolve(emptyPage()));
			const promise = ddgWebSearch({ ...baseInput, limit: 1 }, makeEnv());
			await vi.advanceTimersByTimeAsync(300);
			const outcome = await promise;
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(outcome.warnings).toEqual(["ddg: no results"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("never retries 4xx", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(new Response("nope", { status: 404 })),
		);
		await expect(ddgWebSearch(baseInput, makeEnv())).rejects.toThrow(
			"ddg: HTTP 404",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("ignores non-web sources, always performs a web search", async () => {
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				htmlResponse(
					resultsPage(resultBlock("https://a.com/1", "One", "web only")),
				),
			),
		);
		const outcome = await ddgWebSearch(
			{ ...baseInput, limit: 1, sources: ["news", "images"] },
			makeEnv(),
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(outcome.results.web).toEqual([
			{
				url: "https://a.com/1",
				title: "One",
				description: "web only",
				position: 1,
			},
		]);
		expect(outcome.results.news).toBeUndefined();
		expect(outcome.results.images).toBeUndefined();
	});
});
