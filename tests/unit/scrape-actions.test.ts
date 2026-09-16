import type { Page } from "@cloudflare/puppeteer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	filterExecutableActions,
	runScrapeActions,
	scrapeActionSchema,
} from "../../src/scrapeActions";

// The runner drives the live page; these tests exercise it against a fake
// built from vi.fn()s (cast to Page), never real Browser Rendering code. The
// puppeteer import above is type-only.

interface FakePage {
	waitForTimeout: ReturnType<typeof vi.fn>;
	waitForSelector: ReturnType<typeof vi.fn>;
	click: ReturnType<typeof vi.fn>;
	$$: ReturnType<typeof vi.fn>;
	keyboard: {
		type: ReturnType<typeof vi.fn>;
		press: ReturnType<typeof vi.fn>;
	};
	evaluate: ReturnType<typeof vi.fn>;
	setViewport: ReturnType<typeof vi.fn>;
	screenshot: ReturnType<typeof vi.fn>;
}

function fakePage(): FakePage {
	return {
		waitForTimeout: vi.fn().mockResolvedValue(undefined),
		waitForSelector: vi.fn().mockResolvedValue(undefined),
		click: vi.fn().mockResolvedValue(undefined),
		$$: vi.fn().mockResolvedValue([]),
		keyboard: {
			type: vi.fn().mockResolvedValue(undefined),
			press: vi.fn().mockResolvedValue(undefined),
		},
		// Runs the serialized page function locally so scroll math is testable.
		evaluate: vi.fn().mockImplementation((fn, ...args) => fn(...args)),
		setViewport: vi.fn().mockResolvedValue(undefined),
		screenshot: vi.fn().mockResolvedValue("BASE64"),
	};
}

function asPage(page: FakePage): Page {
	return page as unknown as Page;
}

const originalWindow = globalThis.window;

beforeEach(() => {
	// The scroll page functions reference `window`; provide a stub realm.
	globalThis.window = {
		innerHeight: 800,
		scrollBy: vi.fn(),
	} as unknown as typeof globalThis.window;
});

afterEach(() => {
	globalThis.window = originalWindow as typeof globalThis.window;
	vi.restoreAllMocks();
});

describe("runScrapeActions", () => {
	it("waits by duration", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{ type: "wait", milliseconds: 500 },
		]);
		expect(page.waitForTimeout).toHaveBeenCalledWith(500);
		expect(page.waitForSelector).not.toHaveBeenCalled();
	});

	it("waits for a selector with the default 30s timeout", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{ type: "wait", selector: "#target" },
		]);
		expect(page.waitForSelector).toHaveBeenCalledWith("#target", {
			timeout: 30000,
		});
	});

	it("threads the caller timeout into selector waits", async () => {
		const page = fakePage();
		await runScrapeActions(
			asPage(page),
			[{ type: "wait", selector: "#target" }],
			{ timeout: 5000 },
		);
		expect(page.waitForSelector).toHaveBeenCalledWith("#target", {
			timeout: 5000,
		});
	});

	it("clicks the first match by default", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{ type: "click", selector: "#load-more" },
		]);
		expect(page.click).toHaveBeenCalledWith("#load-more");
		expect(page.$$).not.toHaveBeenCalled();
	});

	it("clicks every handle for all:true and skips page.click", async () => {
		const page = fakePage();
		const first = { click: vi.fn().mockResolvedValue(undefined) };
		const second = { click: vi.fn().mockResolvedValue(undefined) };
		page.$$.mockResolvedValue([first, second]);
		await runScrapeActions(asPage(page), [
			{ type: "click", selector: ".item", all: true },
		]);
		expect(page.$$).toHaveBeenCalledWith(".item");
		expect(first.click).toHaveBeenCalledTimes(1);
		expect(second.click).toHaveBeenCalledTimes(1);
		expect(page.click).not.toHaveBeenCalled();
	});

	it("treats zero matches for all:true as a no-op, not an error", async () => {
		const page = fakePage();
		page.$$.mockResolvedValue([]);
		await expect(
			runScrapeActions(asPage(page), [
				{ type: "click", selector: ".missing", all: true },
			]),
		).resolves.toEqual({ screenshots: [] });
	});

	it("types write text through the keyboard", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{ type: "write", text: "Hello, world!" },
		]);
		expect(page.keyboard.type).toHaveBeenCalledWith("Hello, world!");
	});

	it("presses keys through the keyboard", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [{ type: "press", key: "Enter" }]);
		expect(page.keyboard.press).toHaveBeenCalledWith("Enter");
	});

	it("scrolls the page down a viewport by default", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [{ type: "scroll" }]);
		expect(globalThis.window.scrollBy).toHaveBeenCalledWith(0, 800);
	});

	it("scrolls the page up when directed", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{ type: "scroll", direction: "up" },
		]);
		expect(globalThis.window.scrollBy).toHaveBeenCalledWith(0, -800);
	});

	it("scrolls a matching element by its client height", async () => {
		const page = fakePage();
		const element = { clientHeight: 400, scrollTop: 0 };
		const querySelector = vi.fn().mockReturnValue(element);
		const originalDocument = globalThis.document;
		globalThis.document = { querySelector } as unknown as Document;
		try {
			await runScrapeActions(asPage(page), [
				{ type: "scroll", selector: "#feed", direction: "down" },
			]);
			expect(querySelector).toHaveBeenCalledWith("#feed");
			expect(element.scrollTop).toBe(400);
		} finally {
			globalThis.document = originalDocument;
		}
	});

	it("throws when a scroll selector matches nothing", async () => {
		const page = fakePage();
		const querySelector = vi.fn().mockReturnValue(null);
		const originalDocument = globalThis.document;
		globalThis.document = { querySelector } as unknown as Document;
		try {
			await expect(
				runScrapeActions(asPage(page), [
					{ type: "scroll", selector: "#missing" },
				]),
			).rejects.toThrow("scroll selector not found: #missing");
		} finally {
			globalThis.document = originalDocument;
		}
	});

	it("captures a viewport screenshot as base64 png", async () => {
		const page = fakePage();
		const result = await runScrapeActions(asPage(page), [
			{ type: "screenshot" },
		]);
		expect(page.setViewport).not.toHaveBeenCalled();
		expect(page.screenshot).toHaveBeenCalledWith({
			encoding: "base64",
			fullPage: false,
		});
		expect(result.screenshots).toEqual(["BASE64"]);
	});

	it("sets the viewport before a screenshot that requests one", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{
				type: "screenshot",
				viewport: { width: 1280, height: 720 },
			},
		]);
		expect(page.setViewport).toHaveBeenCalledWith({
			width: 1280,
			height: 720,
		});
	});

	it("uses jpeg with quality only when quality is set", async () => {
		const page = fakePage();
		await runScrapeActions(asPage(page), [
			{ type: "screenshot", fullPage: true, quality: 60 },
		]);
		expect(page.screenshot).toHaveBeenCalledWith({
			encoding: "base64",
			fullPage: true,
			type: "jpeg",
			quality: 60,
		});
	});

	it("keeps screenshot order across multiple actions", async () => {
		const page = fakePage();
		page.screenshot
			.mockResolvedValueOnce("FIRST")
			.mockResolvedValueOnce("SECOND");
		const result = await runScrapeActions(asPage(page), [
			{ type: "wait", milliseconds: 1 },
			{ type: "screenshot" },
			{ type: "screenshot", fullPage: true },
		]);
		expect(result.screenshots).toEqual(["FIRST", "SECOND"]);
	});

	it("propagates a failing selector wait", async () => {
		const page = fakePage();
		page.waitForSelector.mockRejectedValue(new Error("timeout exceeded"));
		await expect(
			runScrapeActions(asPage(page), [{ type: "wait", selector: "#never" }]),
		).rejects.toThrow("timeout exceeded");
	});

	it("executes actions strictly in order", async () => {
		const page = fakePage();
		const order: string[] = [];
		page.waitForTimeout.mockImplementation(async () => {
			order.push("wait");
		});
		page.click.mockImplementation(async () => {
			order.push("click");
		});
		page.screenshot.mockImplementation(async () => {
			order.push("screenshot");
			return "B64";
		});
		await runScrapeActions(asPage(page), [
			{ type: "click", selector: "#a" },
			{ type: "wait", milliseconds: 10 },
			{ type: "screenshot" },
		]);
		expect(order).toEqual(["click", "wait", "screenshot"]);
	});
});

describe("filterExecutableActions", () => {
	it("returns empty for no actions", () => {
		expect(filterExecutableActions(undefined)).toEqual({
			executable: [],
			warnings: [],
		});
		expect(filterExecutableActions([])).toEqual({
			executable: [],
			warnings: [],
		});
	});

	it("keeps executable actions and drops the unimplemented three", () => {
		const plan = filterExecutableActions([
			{ type: "click", selector: "#a" },
			{ type: "pdf", format: "A4" },
			{ type: "executeJavascript", script: "1+1" },
			{ type: "scrape" },
			{ type: "wait", milliseconds: 5 },
		]);
		expect(plan.executable).toEqual([
			{ type: "click", selector: "#a" },
			{ type: "wait", milliseconds: 5 },
		]);
		expect(plan.warnings).toEqual([
			"action pdf is not supported by this deployment",
			"action executeJavascript is not supported by this deployment",
			"action scrape is not supported by this deployment",
		]);
	});

	it("dedupes repeated unimplemented warnings", () => {
		const plan = filterExecutableActions([
			{ type: "pdf" },
			{ type: "pdf", format: "Letter" },
			{ type: "scrape" },
		]);
		expect(plan.warnings).toEqual([
			"action pdf is not supported by this deployment",
			"action scrape is not supported by this deployment",
		]);
	});
});

describe("scrapeActionSchema", () => {
	it("accepts every documented action shape", () => {
		const valid = [
			{ type: "wait", milliseconds: 100 },
			{ type: "wait", selector: "#el" },
			{ type: "click", selector: "#el", all: true },
			{ type: "write", text: "hi" },
			{ type: "press", key: "Enter" },
			{ type: "scroll", direction: "up", selector: "#el" },
			{ type: "scroll" },
			{
				type: "screenshot",
				fullPage: true,
				quality: 80,
				viewport: { width: 800, height: 600 },
			},
			{ type: "pdf", format: "A4", landscape: true, scale: 1.5 },
			{ type: "executeJavascript", script: "console.log(1)" },
			{ type: "scrape" },
		];
		for (const action of valid) {
			expect(scrapeActionSchema.safeParse(action).success).toBe(true);
		}
	});

	it("rejects malformed actions", () => {
		const invalid = [
			{ type: "nope" },
			{ type: "wait" },
			{ type: "wait", milliseconds: 0 },
			{ type: "click" },
			{ type: "write" },
			{ type: "press" },
			{ type: "scroll", direction: "sideways" },
			{ type: "screenshot", quality: 0 },
			{ type: "screenshot", viewport: { width: 800 } },
			{ type: "pdf", format: "Z9" },
			{ type: "executeJavascript" },
		];
		for (const action of invalid) {
			expect(scrapeActionSchema.safeParse(action).success).toBe(false);
		}
	});
});
