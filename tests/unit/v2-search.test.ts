import { OpenAPIRoute, fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index";
import {
	SearchUnavailableError,
	searchWithFallback,
} from "../../src/search/provider";
import { V2Search } from "../../src/v2/search";

// The route only depends on the provider's public surface; stub it so the
// tests never touch a real network/browser. SearchUnavailableError is
// re-declared here (same shape) so the route's `instanceof` check resolves
// against the mocked class.
vi.mock("../../src/search/provider", () => ({
	searchWithFallback: vi.fn(),
	SearchUnavailableError: class SearchUnavailableError extends Error {
		constructor(details: string) {
			super(`search backend unavailable: ${details}`);
		}
	},
}));

// src/index.ts pulls the v1 routes, which import puppeteer/node-html-markdown.
// Replace them with trivial chanfana endpoints so the real route table can be
// exercised without a browser.
vi.mock("../../src/scrape", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		WebScrape: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: {} };
			}
		},
	};
});
vi.mock("../../src/webMap", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		WebMap: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: {} };
			}
		},
	};
});
vi.mock("../../src/webSearch", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		WebSearch: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: [] };
			}
		},
	};
});

import app from "../../src/index";

const env = {} as Env;

const webResults = [
	{
		url: "https://example.com/a",
		title: "Result A",
		description: "first",
		position: 1,
	},
];

const newsResults = [
	{
		url: "https://news.example/story",
		title: "A Story",
		snippet: "it happened",
		position: 1,
	},
];

function createApp() {
	const hono = new Hono<{ Bindings: Env }>();
	const openapi = fromHono(hono, { docs_url: "/" });
	openapi.post("/v2/search", V2Search);
	return hono;
}

async function postSearch(body: unknown) {
	return createApp().request(
		"/v2/search",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		env,
	);
}

describe("V2Search response envelope", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns a grouped object envelope, never a flat array", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults },
			warnings: [],
		});

		const res = await postSearch({ query: "test" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(Array.isArray(body.data)).toBe(false);
		expect(Array.isArray(body.data.web)).toBe(true);
		expect(body.data.web).toEqual(webResults);
	});

	it("returns every requested source under data", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults, news: newsResults },
			warnings: [],
		});

		const res = await postSearch({
			query: "test",
			sources: ["web", "news"],
		});
		const body = await res.json();
		expect(body.data.web).toEqual(webResults);
		expect(body.data.news).toEqual(newsResults);
	});

	it("defaults limit to 10 and sources to web", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		await postSearch({ query: "kittens" });

		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "kittens",
				limit: 10,
				sources: ["web"],
			}),
			env,
		);
	});

	it("passes a custom limit through to the provider input", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		await postSearch({ query: "kittens", limit: 25 });

		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 25 }),
			env,
		);
	});

	it("omits empty source arrays from data", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults, news: [] },
			warnings: [],
		});

		const res = await postSearch({ query: "test", sources: ["web", "news"] });
		const body = await res.json();
		expect(body.data.web).toEqual(webResults);
		expect("news" in body.data).toBe(false);
	});

	it("returns an empty object when no source produced results", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const res = await postSearch({ query: "test" });
		const body = await res.json();
		expect(body.data).toEqual({});
	});
});

describe("V2Search input forwarding", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("forwards every supported contract field exactly as sent", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		await postSearch({
			query: "test",
			limit: 7,
			tbs: "qdr:m",
			lang: "de",
			country: "de",
			location: "Berlin",
			safe: false,
			includeDomains: ["example.com"],
		});

		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "test",
				limit: 7,
				sources: ["web"],
				tbs: "qdr:m",
				lang: "de",
				country: "de",
				location: "Berlin",
				safe: false,
				includeDomains: ["example.com"],
			}),
			env,
		);
	});

	it("forwards excludeDomains when provided", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		await postSearch({
			query: "test",
			excludeDomains: ["spam.example"],
		});

		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({ excludeDomains: ["spam.example"] }),
			env,
		);
	});
});

describe("V2Search sources", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("accepts the typed-object source form and queries both sources", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const res = await postSearch({
			query: "test",
			sources: [{ type: "web" }, { type: "news" }],
		});
		expect(res.status).toBe(200);
		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({ sources: ["web", "news"] }),
			env,
		);
	});

	it("accepts mixed string and object source forms", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const res = await postSearch({
			query: "test",
			sources: ["web", { type: "images" }],
		});
		expect(res.status).toBe(200);
		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({ sources: ["web", "images"] }),
			env,
		);
	});

	it("dedupes repeated sources preserving first-seen order", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		await postSearch({
			query: "test",
			sources: ["web", { type: "web" }, "news", { type: "news" }],
		});

		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({ sources: ["web", "news"] }),
			env,
		);
	});

	it("accepts-and-ignores per-source location and tbs", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const res = await postSearch({
			query: "test",
			sources: [{ type: "web", location: "Portland", tbs: "qdr:w" }],
		});
		expect(res.status).toBe(200);
		expect(searchWithFallback).toHaveBeenCalledWith(
			expect.objectContaining({ sources: ["web"] }),
			env,
		);
	});

	it("rejects an unknown type in the object form", async () => {
		const res = await postSearch({
			query: "test",
			sources: [{ type: "alexandria" }],
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(searchWithFallback).not.toHaveBeenCalled();
	});
});

describe("V2Search warnings", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("joins provider warnings into a single warning string", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults },
			warnings: ["ddg: slow", "no provider returned results for news"],
		});

		const res = await postSearch({ query: "test" });
		const body = await res.json();
		expect(body.warning).toBe(
			"ddg: slow; no provider returned results for news",
		);
	});

	it("omits the warning key when there are no warnings", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults },
			warnings: [],
		});

		const res = await postSearch({ query: "test" });
		const body = await res.json();
		expect("warning" in body).toBe(false);
	});

	it("warns when ignoreInvalidURLs is explicitly false", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults },
			warnings: [],
		});

		const res = await postSearch({ query: "test", ignoreInvalidURLs: false });
		const body = await res.json();
		expect(body.warning).toBe(
			"ignoreInvalidURLs:false is not supported; invalid URLs are always skipped",
		);
	});

	it("does not warn when ignoreInvalidURLs is true or omitted", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: { web: webResults },
			warnings: [],
		});

		const withTrue = await postSearch({
			query: "test",
			ignoreInvalidURLs: true,
		});
		const omitted = await postSearch({ query: "test" });

		expect("warning" in (await withTrue.json())).toBe(false);
		expect("warning" in (await omitted.json())).toBe(false);
	});
});

describe("V2Search validation", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("rejects a limit above 100", async () => {
		const res = await postSearch({ query: "test", limit: 101 });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(searchWithFallback).not.toHaveBeenCalled();
	});

	it("rejects a limit below 1 with a 400 error body", async () => {
		const res = await postSearch({ query: "test", limit: 0 });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(Array.isArray(body.errors)).toBe(true);
		expect(body.errors.length).toBeGreaterThan(0);
		expect(searchWithFallback).not.toHaveBeenCalled();
	});

	it("rejects a query longer than 500 characters", async () => {
		const res = await postSearch({ query: "a".repeat(501) });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(searchWithFallback).not.toHaveBeenCalled();
	});

	it("accepts a query of exactly 500 characters", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const res = await postSearch({ query: "a".repeat(500) });
		expect(res.status).toBe(200);
	});

	it("rejects a non-positive or fractional timeout", async () => {
		const zero = await postSearch({ query: "test", timeout: 0 });
		expect(zero.status).toBe(400);

		const negative = await postSearch({ query: "test", timeout: -1 });
		expect(negative.status).toBe(400);

		const fractional = await postSearch({ query: "test", timeout: 1.5 });
		expect(fractional.status).toBe(400);

		expect(searchWithFallback).not.toHaveBeenCalled();
	});

	it("rejects an unknown source value", async () => {
		const res = await postSearch({ query: "test", sources: ["videos"] });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
	});

	it("rejects includeDomains and excludeDomains together", async () => {
		const res = await postSearch({
			query: "test",
			includeDomains: ["example.com"],
			excludeDomains: ["spam.example"],
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(searchWithFallback).not.toHaveBeenCalled();
	});

	it("accepts empty includeDomains/excludeDomains arrays", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const res = await postSearch({
			query: "test",
			includeDomains: [],
			excludeDomains: [],
		});
		expect(res.status).toBe(200);
	});

	it("rejects a missing query with a 400 error body", async () => {
		const res = await postSearch({});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(Array.isArray(body.errors)).toBe(true);
		expect(body.errors.length).toBeGreaterThan(0);
		expect(searchWithFallback).not.toHaveBeenCalled();
	});
});

describe("V2Search unavailable backend", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns 503 with the provider reasons when search is unavailable", async () => {
		vi.mocked(searchWithFallback).mockRejectedValue(
			new SearchUnavailableError(
				"ddg: anti-bot challenge; ddg-browser: no results",
			),
		);

		const res = await postSearch({ query: "test" });
		expect(res.status).toBe(503);

		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Search backend unavailable");
		expect(body.details).toBe(
			"ddg: anti-bot challenge; ddg-browser: no results",
		);
	});
});

describe("V2Search routing", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("registers POST /v2/search alongside POST /v1/search", async () => {
		vi.mocked(searchWithFallback).mockResolvedValue({
			results: {},
			warnings: [],
		});

		const v2 = await app.request(
			"/v2/search",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			},
			env,
		);
		expect(v2.status).toBe(200);
		const v2Body = await v2.json();
		expect(v2Body.success).toBe(true);

		const v1 = await app.request(
			"/v1/search",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			},
			env,
		);
		expect(v1.status).toBe(200);
	});

	it("returns 404 for GET /v2/search (only POST is registered)", async () => {
		const res = await app.request("/v2/search", { method: "GET" }, env);
		expect(res.status).toBe(404);
	});
});
