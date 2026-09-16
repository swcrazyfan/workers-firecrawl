import { OpenAPIRoute, fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractContent, getBrowser } from "../../src/browser";
import type { Env } from "../../src/index";
import {
	FormatValidationError,
	V2Scrape,
	normalizeFormats,
} from "../../src/v2/scrape";

// The route depends on the shared extraction pipeline only; stub the browser
// module so these tests never touch puppeteer or a real browser.
vi.mock("../../src/browser", () => ({
	getBrowser: vi.fn(),
	extractContent: vi.fn(),
}));

// src/index.ts imports the v1 routes and /v2/search, which pull in
// puppeteer/node-html-markdown and the whole search stack. Replace them with
// trivial chanfana endpoints so the real route table can be exercised without a
// browser or network.
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
vi.mock("../../src/v2/search", async () => {
	const { OpenAPIRoute } = await import("chanfana");
	return {
		V2Search: class extends OpenAPIRoute {
			schema = {};
			async handle() {
				return { success: true, data: {} };
			}
		},
	};
});

import app from "../../src/index";

const env = {} as Env;

const scrapeResult = {
	title: "Example Domain",
	description: "Example description",
	url: "https://example.com",
	markdown: "# Example Domain",
	html: "<main><h1>Example Domain</h1></main>",
	rawHtml: "<html><body>Example</body></html>",
	links: ["https://example.com/one", "https://example.com/two"],
	screenshot: "iVBORw0KGgo=",
	metadata: {
		title: "Example Domain",
		description: "Example description",
		sourceURL: "https://example.com",
		statusCode: 200,
		error: null,
	},
};

let browserClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetAllMocks();
	browserClose = vi.fn().mockResolvedValue(undefined);
	vi.mocked(getBrowser).mockResolvedValue({ close: browserClose } as never);
	vi.mocked(extractContent).mockResolvedValue(scrapeResult as never);
});

function createApp() {
	const hono = new Hono<{ Bindings: Env }>();
	const openapi = fromHono(hono, { docs_url: "/" });
	openapi.post("/v2/scrape", V2Scrape);
	return hono;
}

async function postScrape(body: unknown) {
	return createApp().request(
		"/v2/scrape",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		env,
	);
}

describe("normalizeFormats", () => {
	it("passes through plain string formats", () => {
		expect(normalizeFormats(["markdown", "links"])).toEqual({
			strings: ["markdown", "links"],
			screenshotFullPage: false,
			screenshotOptionsIgnored: false,
			wantsJson: null,
			wantsSummary: false,
			warnings: [],
		});
	});

	it("marks a full-page screenshot object", () => {
		const result = normalizeFormats([{ type: "screenshot", fullPage: true }]);
		expect(result.strings).toEqual(["screenshot"]);
		expect(result.screenshotFullPage).toBe(true);
		expect(result.warnings).toEqual([]);
	});

	it("keeps viewport screenshots when fullPage is false or omitted", () => {
		expect(
			normalizeFormats([{ type: "screenshot", fullPage: false }])
				.screenshotFullPage,
		).toBe(false);
		expect(
			normalizeFormats([{ type: "screenshot" }]).screenshotFullPage,
		).toBe(false);
	});

	it("flags screenshot quality/viewport options as ignored", () => {
		expect(
			normalizeFormats([{ type: "screenshot", quality: 80 }])
				.screenshotOptionsIgnored,
		).toBe(true);
		expect(
			normalizeFormats([
				{ type: "screenshot", viewport: { width: 800, height: 600 } },
			]).screenshotOptionsIgnored,
		).toBe(true);
		expect(
			normalizeFormats([{ type: "screenshot" }]).screenshotOptionsIgnored,
		).toBe(false);
	});

	it("maps the legacy screenshot@fullPage string with a warning", () => {
		const result = normalizeFormats(["screenshot@fullPage"]);
		expect(result.strings).toEqual(["screenshot"]);
		expect(result.screenshotFullPage).toBe(true);
		expect(result.warnings).toEqual([
			"screenshot@fullPage is v1; use {type:'screenshot',fullPage:true}",
		]);
	});

	it("dedupes repeated formats, including screenshot objects", () => {
		const result = normalizeFormats([
			"markdown",
			"markdown",
			{ type: "screenshot", fullPage: true },
			{ type: "screenshot" },
			"screenshot@fullPage",
		]);
		expect(result.strings).toEqual(["markdown", "screenshot"]);
		expect(result.screenshotFullPage).toBe(true);
		expect(result.warnings).toHaveLength(1);
	});

	it("captures the json payload", () => {
		const result = normalizeFormats([
			{ type: "json", schema: { type: "object" }, prompt: "get the price" },
		]);
		expect(result.wantsJson).toEqual({
			schema: { type: "object" },
			prompt: "get the price",
		});
		expect(result.strings).toEqual([]);
	});

	it("captures a prompt-only json format without inventing a schema", () => {
		const result = normalizeFormats([{ type: "json", prompt: "hi" }]);
		expect(result.wantsJson).toEqual({ prompt: "hi" });
		expect(result.wantsJson).not.toHaveProperty("schema");
	});

	it("flags summary", () => {
		const result = normalizeFormats([{ type: "summary" }]);
		expect(result.wantsSummary).toBe(true);
		expect(result.strings).toEqual(["summary"]);
	});

	it("accepts object forms of supported string formats", () => {
		const result = normalizeFormats([
			{ type: "markdown" },
			{ type: "html" },
			{ type: "rawHtml" },
			{ type: "links" },
		]);
		expect(result.strings).toEqual(["markdown", "html", "rawHtml", "links"]);
		expect(result.warnings).toEqual([]);
	});

	it("accepts unimplemented string formats with a warning", () => {
		const result = normalizeFormats(["images", "images", "highlights"]);
		expect(result.strings).toEqual([]);
		expect(result.warnings).toEqual([
			"format images is not supported by this deployment",
			"format highlights is not supported by this deployment",
		]);
	});

	it("accepts unimplemented object formats with a warning", () => {
		const result = normalizeFormats([{ type: "branding" }, { type: "video" }]);
		expect(result.warnings).toEqual([
			"format branding is not supported by this deployment",
			"format video is not supported by this deployment",
		]);
	});

	it("rejects unknown string formats", () => {
		expect(() => normalizeFormats(["nope"])).toThrow(FormatValidationError);
	});

	it("rejects unknown object formats", () => {
		expect(() => normalizeFormats([{ type: "nope" }])).toThrow(
			FormatValidationError,
		);
	});

	it("rejects non string/object entries", () => {
		expect(() => normalizeFormats([42])).toThrow(FormatValidationError);
	});
});

describe("V2Scrape response", () => {
	it("defaults to markdown, onlyMainContent true and timeout 60000", async () => {
		const res = await postScrape({ url: "https://example.com" });
		expect(res.status).toBe(200);

		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({
				formats: ["markdown"],
				onlyMainContent: true,
				timeout: 60000,
			}),
		);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.markdown).toBe("# Example Domain");
		expect("html" in body.data).toBe(false);
		expect("links" in body.data).toBe(false);
		expect("screenshot" in body.data).toBe(false);
		expect("warning" in body.data).toBe(false);
		expect("warning" in body).toBe(false);
	});

	it("returns every requested format key", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: ["markdown", "html", "links"],
		});
		const body = await res.json();
		expect(body.data.markdown).toBe("# Example Domain");
		expect(body.data.html).toBe("<main><h1>Example Domain</h1></main>");
		expect(body.data.links).toEqual(scrapeResult.links);
		expect("rawHtml" in body.data).toBe(false);
	});

	it("accepts object forms of supported formats like their string form", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "markdown" }, { type: "links" }],
		});
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({ formats: ["markdown", "links"] }),
		);
		const body = await res.json();
		expect(body.data.markdown).toBe("# Example Domain");
		expect(body.data.links).toEqual(scrapeResult.links);
	});

	it("includes rawHtml only when requested", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: ["rawHtml"],
		});
		const body = await res.json();
		expect(body.data.rawHtml).toBe("<html><body>Example</body></html>");
		expect("markdown" in body.data).toBe(false);
	});

	it("returns links as a string array (v1 regression guard)", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: ["links"],
		});
		const body = await res.json();
		expect(Array.isArray(body.data.links)).toBe(true);
		for (const link of body.data.links) {
			expect(typeof link).toBe("string");
		}
	});

	it("emits the metadata shape from the extraction result", async () => {
		const res = await postScrape({ url: "https://example.com" });
		const body = await res.json();
		expect(body.data.metadata).toEqual(scrapeResult.metadata);
	});

	it("surfaces a nullable screenshot", async () => {
		vi.mocked(extractContent).mockResolvedValue({
			...scrapeResult,
			screenshot: null,
		} as never);
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "screenshot" }],
		});
		const body = await res.json();
		expect(body.data.screenshot).toBeNull();
	});

	it("passes waitFor, timeout and headers through", async () => {
		await postScrape({
			url: "https://example.com",
			formats: ["markdown"],
			waitFor: 1500,
			timeout: 30000,
			headers: { "User-Agent": "CustomBot/1.0" },
		});
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({
				waitFor: 1500,
				timeout: 30000,
				headers: { "User-Agent": "CustomBot/1.0" },
			}),
		);
	});

	it("honours an explicit onlyMainContent false", async () => {
		await postScrape({
			url: "https://example.com",
			onlyMainContent: false,
		});
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({ onlyMainContent: false }),
		);
	});
});

describe("V2Scrape screenshots", () => {
	it("maps the fullPage object to the legacy full-page extraction format", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "screenshot", fullPage: true }],
		});
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({ formats: ["screenshot@fullPage"] }),
		);
		const body = await res.json();
		expect(body.data.screenshot).toBe("iVBORw0KGgo=");
		expect("warning" in body.data).toBe(false);
	});

	it("treats the legacy string the same as the fullPage object", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: ["screenshot@fullPage"],
		});
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({ formats: ["screenshot@fullPage"] }),
		);
		const body = await res.json();
		expect(body.data.screenshot).toBe("iVBORw0KGgo=");
		expect(body.data.warning).toBe(
			"screenshot@fullPage is v1; use {type:'screenshot',fullPage:true}",
		);
	});

	it("keeps viewport screenshots for the non-fullPage object", async () => {
		await postScrape({
			url: "https://example.com",
			formats: [{ type: "screenshot", fullPage: false }],
		});
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({ formats: ["screenshot"] }),
		);
	});

	it("warns when screenshot quality is requested", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "screenshot", quality: 80 }],
		});
		const body = await res.json();
		expect(body.data.warning).toBe(
			"screenshot quality/viewport options are ignored",
		);
	});

	it("warns when a screenshot viewport is requested", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [
				{ type: "screenshot", viewport: { width: 800, height: 600 } },
			],
		});
		const body = await res.json();
		expect(body.data.warning).toBe(
			"screenshot quality/viewport options are ignored",
		);
	});
});

describe("V2Scrape unimplemented formats", () => {
	it("accepts an unimplemented string format with a warning", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: ["markdown", "images"],
		});
		expect(res.status).toBe(200);
		expect(extractContent).toHaveBeenCalledWith(
			expect.anything(),
			"https://example.com",
			expect.objectContaining({ formats: ["markdown"] }),
		);
		const body = await res.json();
		expect(body.data.markdown).toBe("# Example Domain");
		expect("images" in body.data).toBe(false);
		expect(body.data.warning).toBe(
			"format images is not supported by this deployment",
		);
	});

	it("accepts an unimplemented object format with a warning", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "branding" }],
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.warning).toBe(
			"format branding is not supported by this deployment",
		);
	});
});

describe("V2Scrape AI placeholders", () => {
	it("omits json and warns while still scraping", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "json", prompt: "price" }],
		});
		const body = await res.json();
		expect("json" in body.data).toBe(false);
		expect(body.data.warning).toBe(
			"json format requires AI configuration (not yet available)",
		);
		expect(extractContent).toHaveBeenCalledTimes(1);
	});

	it("omits summary and warns while still scraping", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "summary" }],
		});
		const body = await res.json();
		expect("summary" in body.data).toBe(false);
		expect(body.data.warning).toBe(
			"summary format requires AI configuration (not yet available)",
		);
		expect(extractContent).toHaveBeenCalledTimes(1);
	});

	it("joins every warning into one string inside data", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [
				"screenshot@fullPage",
				{ type: "screenshot", quality: 90 },
				{ type: "json" },
			],
		});
		const body = await res.json();
		expect(body.data.warning).toBe(
			"screenshot@fullPage is v1; use {type:'screenshot',fullPage:true}; " +
				"screenshot quality/viewport options are ignored; " +
				"json format requires AI configuration (not yet available)",
		);
	});
});

describe("V2Scrape errors", () => {
	it("returns 400 for an unknown format object", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: [{ type: "nope" }],
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(extractContent).not.toHaveBeenCalled();
	});

	it("returns 400 for an unknown format string", async () => {
		const res = await postScrape({
			url: "https://example.com",
			formats: ["screenshot@viewport"],
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for an invalid url", async () => {
		const res = await postScrape({ url: "not a url" });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
	});

	it("returns 400 for a missing url", async () => {
		const res = await postScrape({ formats: ["markdown"] });
		expect(res.status).toBe(400);
	});

	it("returns 400 for a timeout below 1000", async () => {
		const res = await postScrape({
			url: "https://example.com",
			timeout: 500,
		});
		expect(res.status).toBe(400);
	});

	it("returns 400 for a timeout above 300000", async () => {
		const res = await postScrape({
			url: "https://example.com",
			timeout: 300001,
		});
		expect(res.status).toBe(400);
	});

	it("accepts the timeout bounds", async () => {
		expect(
			(
				await postScrape({ url: "https://example.com", timeout: 1000 })
			).status,
		).toBe(200);
		expect(
			(
				await postScrape({ url: "https://example.com", timeout: 300000 })
			).status,
		).toBe(200);
	});

	it("returns 500 when the browser fails to launch", async () => {
		vi.mocked(getBrowser).mockRejectedValue(new Error("launch failed"));
		const res = await postScrape({ url: "https://example.com" });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Failed to scrape URL");
		expect(extractContent).not.toHaveBeenCalled();
		expect(browserClose).not.toHaveBeenCalled();
	});

	it("returns 500 when extraction throws", async () => {
		vi.mocked(extractContent).mockRejectedValue(new Error("boom"));
		const res = await postScrape({ url: "https://example.com" });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Failed to scrape URL");
		expect(browserClose).toHaveBeenCalledTimes(1);
	});

	it("returns 500 when extraction yields no result", async () => {
		vi.mocked(extractContent).mockResolvedValue(null as never);
		const res = await postScrape({ url: "https://example.com" });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(browserClose).toHaveBeenCalledTimes(1);
	});

	it("closes the browser on success", async () => {
		await postScrape({ url: "https://example.com" });
		expect(browserClose).toHaveBeenCalledTimes(1);
	});
});

describe("V2Scrape routing", () => {
	it("registers POST /v2/scrape alongside POST /v1/scrape", async () => {
		const v2 = await app.request(
			"/v2/scrape",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: "https://example.com" }),
			},
			env,
		);
		expect(v2.status).toBe(200);
		const v2Body = await v2.json();
		expect(v2Body.success).toBe(true);

		const v1 = await app.request(
			"/v1/scrape",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: "https://example.com" }),
			},
			env,
		);
		expect(v1.status).toBe(200);
	});

	it("returns 404 for GET /v2/scrape (only POST is registered)", async () => {
		const res = await app.request("/v2/scrape", { method: "GET" }, env);
		expect(res.status).toBe(404);
	});
});