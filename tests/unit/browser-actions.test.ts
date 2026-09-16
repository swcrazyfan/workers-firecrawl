import { describe, expect, it, vi } from "vitest";
import { extractContent } from "../../src/browser";

// Lifecycle tests for the actions threading in extractContent. The puppeteer
// package itself is stubbed (extractContent's only runtime use of it is
// puppeteer.launch, which these tests never reach — they pass a fake browser
// directly), and the DOM-dependent page.evaluate callbacks run against a
// minimal document stub. The REAL runScrapeActions executes, so these tests
// pin the "after load, before format extraction" ordering.
vi.mock("@cloudflare/puppeteer", () => ({
	default: { launch: vi.fn() },
}));

// node-html-markdown does not load under the workers vitest pool (css-select
// CJS/ESM interop) — which is why no other test imports src/browser.ts. Stub
// the static translate call; markdown content is irrelevant to the ordering
// assertions.
vi.mock("node-html-markdown", () => ({
	NodeHtmlMarkdown: {
		translate: vi.fn().mockReturnValue("# Example Domain"),
	},
}));

const originalDocument = globalThis.document;

function installDocumentStub() {
	globalThis.document = {
		title: "Example Domain",
		querySelector: () => ({ getAttribute: () => "Example description" }),
		querySelectorAll: () => [],
		body: {
			cloneNode: () => ({
				querySelectorAll: () => [],
				outerHTML: "<main><h1>Example Domain</h1></main>",
			}),
		},
	} as unknown as Document;
}

// Records the ordered event stream so the lifecycle guarantee is asserted:
// actions must run after goto and before the content evaluate.
function fakePage() {
	const events: string[] = [];
	const evaluateCount = () =>
		events.filter((event) => event.startsWith("evaluate")).length;
	return {
		events,
		setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
		goto: vi.fn().mockImplementation(async () => {
			events.push("goto");
			return { status: () => 200 };
		}),
		evaluate: vi.fn().mockImplementation(async (fn, ...args) => {
			events.push(`evaluate${evaluateCount() + 1}`);
			return fn(...args);
		}),
		waitForTimeout: vi.fn().mockResolvedValue(undefined),
		waitForSelector: vi.fn().mockResolvedValue(undefined),
		click: vi.fn().mockResolvedValue(undefined),
		$$: vi.fn().mockResolvedValue([]),
		keyboard: {
			type: vi.fn().mockResolvedValue(undefined),
			press: vi.fn().mockResolvedValue(undefined),
		},
		screenshot: vi.fn().mockImplementation(async () => {
			events.push("screenshot");
			return "B64";
		}),
		content: vi.fn().mockResolvedValue("<html></html>"),
		setViewport: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

describe("extractContent actions threading", () => {
	it("runs actions after load and before format extraction", async () => {
		installDocumentStub();
		const page = fakePage();
		const browser = {
			newPage: vi.fn().mockResolvedValue(page),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const result = await extractContent(browser as never, "https://example.com", {
			formats: ["markdown"],
			actions: [{ type: "screenshot" }],
		});

		// evaluate1 is the popup-close pass, evaluate2 the title/content
		// extraction — the action must sit strictly between goto and evaluate2.
		expect(page.events.indexOf("screenshot")).toBeGreaterThan(
			page.events.indexOf("goto"),
		);
		expect(page.events.indexOf("screenshot")).toBeLessThan(
			page.events.indexOf("evaluate2"),
		);
		expect(result.actions).toEqual({ screenshots: ["B64"] });
		// Formats still extract from the post-action page.
		expect(result.markdown).toContain("Example Domain");
		globalThis.document = originalDocument;
	});

	it("omits the actions key when none are passed (v1 path unchanged)", async () => {
		installDocumentStub();
		const page = fakePage();
		const browser = {
			newPage: vi.fn().mockResolvedValue(page),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const result = await extractContent(browser as never, "https://example.com", {
			formats: ["markdown"],
		});

		expect("actions" in result).toBe(false);
		expect(page.screenshot).not.toHaveBeenCalled();
		globalThis.document = originalDocument;
	});

	it("omits the actions key for non-screenshot action lists", async () => {
		installDocumentStub();
		const page = fakePage();
		const browser = {
			newPage: vi.fn().mockResolvedValue(page),
			close: vi.fn().mockResolvedValue(undefined),
		};

		const result = await extractContent(browser as never, "https://example.com", {
			formats: ["markdown"],
			actions: [{ type: "click", selector: "#load-more" }],
		});

		expect(page.click).toHaveBeenCalledWith("#load-more");
		expect("actions" in result).toBe(false);
		globalThis.document = originalDocument;
	});
});
