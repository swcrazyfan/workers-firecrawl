import { OpenAPIRoute, fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractContent, getBrowser } from "../../src/browser";
import type { Env } from "../../src/index";
import { WebSearch } from "../../src/webSearch";

// The route depends on the shared browser pipeline only; stub the browser
// module so these tests never touch puppeteer or a real browser (same pattern
// as tests/unit/v2-scrape.test.ts).
vi.mock("../../src/browser", () => ({
	getBrowser: vi.fn(),
	extractContent: vi.fn(),
}));

const env = {} as Env;

let pageClose: ReturnType<typeof vi.fn>;
let browserClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetAllMocks();
});

function createApp() {
	const hono = new Hono<{ Bindings: Env }>();
	const openapi = fromHono(hono, { docs_url: "/" });
	openapi.post("/v1/search", WebSearch);
	return hono;
}

// Fake page that records the call order so the UA/viewport-before-goto
// guarantee (the production fix) is asserted, not just the calls.
function fakePage(urls: string[]) {
	const order: string[] = [];
	return {
		order,
		setViewport: vi.fn(async () => {
			order.push("setViewport");
		}),
		setUserAgent: vi.fn(async () => {
			order.push("setUserAgent");
		}),
		goto: vi.fn(async () => {
			order.push("goto");
		}),
		waitForSelector: vi.fn(async () => {
			order.push("waitForSelector");
		}),
		evaluate: vi.fn(async () => {
			order.push("evaluate");
			return urls;
		}),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

function stubBrowser(page: ReturnType<typeof fakePage>) {
	browserClose = vi.fn().mockResolvedValue(undefined);
	vi.mocked(getBrowser).mockResolvedValue({
		newPage: vi.fn().mockResolvedValue(page),
		close: browserClose,
	} as never);
}

async function postSearch(body: unknown) {
	return createApp().request(
		"/v1/search",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		env,
	);
}

const scrapeResult = {
	title: "Result",
	description: "Description",
	url: "https://a.example/",
	markdown: "# Result",
	metadata: {
		title: "Result",
		description: "Description",
		sourceURL: "https://a.example/",
		statusCode: 200,
		error: null,
	},
};

describe("WebSearch client hardening", () => {
	it("sets the desktop viewport and Chrome UA before navigation", async () => {
		const page = fakePage(["https://a.example/", "https://b.example/"]);
		stubBrowser(page);
		vi.mocked(extractContent).mockResolvedValue(scrapeResult as never);

		const res = await postSearch({ query: "cloudflare workers", limit: 2 });
		expect(res.status).toBe(200);

		expect(page.setViewport).toHaveBeenCalledWith({
			width: 1920,
			height: 1080,
		});
		expect(page.setUserAgent).toHaveBeenCalledWith(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
		);
		// The exact guarantee DDG needs: a real client identity BEFORE goto.
		expect(page.order.indexOf("setViewport")).toBeLessThan(
			page.order.indexOf("goto"),
		);
		expect(page.order.indexOf("setUserAgent")).toBeLessThan(
			page.order.indexOf("goto"),
		);
	});

	it("scrapes each organic result and returns the data array", async () => {
		const page = fakePage(["https://a.example/", "https://b.example/"]);
		stubBrowser(page);
		vi.mocked(extractContent).mockResolvedValue(scrapeResult as never);

		const res = await postSearch({ query: "cloudflare workers" });
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(2);
		const urls = vi
			.mocked(extractContent)
			.mock.calls.map((call) => call[1] as string);
		expect(urls).toEqual(["https://a.example/", "https://b.example/"]);
	});

	it("closes the page and the browser", async () => {
		const page = fakePage(["https://a.example/"]);
		stubBrowser(page);
		vi.mocked(extractContent).mockResolvedValue(scrapeResult as never);

		await postSearch({ query: "cloudflare workers" });
		expect(page.close).toHaveBeenCalledTimes(1);
		expect(browserClose).toHaveBeenCalledTimes(1);
	});
});
