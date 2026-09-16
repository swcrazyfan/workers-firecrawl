import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CRAWL_USER_AGENT,
	type RobotsRules,
	fetchRobots,
	isPathAllowed,
	parseRobotsTxt,
} from "../../src/crawler/robots";

function rules(allow: string[], disallow: string[]): RobotsRules {
	return { allow, disallow };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("parseRobotsTxt", () => {
	it("prefers our exact user-agent group over the wildcard", () => {
		const text = [
			"User-agent: *",
			"Disallow: /all",
			"",
			"User-agent: workers-firecrawl",
			"Disallow: /private",
			"Allow: /private/public",
		].join("\n");

		const parsed = parseRobotsTxt(text, "workers-firecrawl");

		expect(parsed.disallow).toEqual(["/private"]);
		expect(parsed.allow).toEqual(["/private/public"]);
	});

	it("falls back to the wildcard group when our UA has no group", () => {
		const parsed = parseRobotsTxt(
			"User-agent: *\nDisallow: /nope\n",
			"workers-firecrawl",
		);
		expect(parsed).toEqual({ allow: [], disallow: ["/nope"] });
	});

	it("shares consecutive user-agent lines in one group", () => {
		const text = [
			"User-agent: bot-a",
			"User-agent: bot-b",
			"Disallow: /shared",
			"User-agent: other",
			"Disallow: /other-only",
		].join("\n");

		const parsed = parseRobotsTxt(text, "bot-b");

		expect(parsed.disallow).toEqual(["/shared"]);
	});

	it("is case-insensitive and ignores comments, blanks and empty rules", () => {
		const text = [
			"# top comment",
			"USER-AGENT: *",
			"",
			"DISALLOW: /private   # inline comment",
			"Allow: # empty allow is ignored",
			"Crawl-delay: 2.5",
		].join("\n");

		const parsed = parseRobotsTxt(text);

		expect(parsed.disallow).toEqual(["/private"]);
		expect(parsed.allow).toEqual([]);
		expect(parsed.crawlDelaySec).toBe(2.5);
	});

	it("matches a named group by our product token instead of failing open", () => {
		const text = "User-agent: workers-firecrawl\nDisallow: /private\n";

		// The default UA carries a version/comment; the product token must match.
		expect(parseRobotsTxt(text, CRAWL_USER_AGENT).disallow).toEqual([
			"/private",
		]);
		// Without a UA the named group is skipped: this is the documented
		// fail-open fallback that passing the UA fixes.
		expect(parseRobotsTxt(text)).toEqual({ allow: [], disallow: [] });
	});

	it("allows everything when neither our group nor a wildcard exists", () => {
		expect(
			parseRobotsTxt(
				"User-agent: Googlebot\nDisallow: /\n",
				CRAWL_USER_AGENT,
			),
		).toEqual({ allow: [], disallow: [] });
	});

	it("returns empty rules when nothing matches", () => {
		expect(
			parseRobotsTxt("User-agent: someone-else\nDisallow: /x\n", "us"),
		).toEqual({ allow: [], disallow: [] });
	});
});

describe("isPathAllowed", () => {
	it("allows paths with no matching rule", () => {
		expect(isPathAllowed(rules([], ["/private"]), "/public")).toBe(true);
	});

	it("applies longest-match-wins with an allow winning a tie", () => {
		expect(isPathAllowed(rules([], ["/folder"]), "/folder/secret")).toBe(false);
		expect(
			isPathAllowed(rules(["/folder/public"], ["/folder"]), "/folder/public"),
		).toBe(true);
		// Same length: the allow rule wins.
		expect(isPathAllowed(rules(["/folder"], ["/folder"]), "/folder")).toBe(true);
		// The allow rule does not match, so the disallow governs.
		expect(
			isPathAllowed(rules(["/folder/page"], ["/folder"]), "/folder/other"),
		).toBe(false);
	});

	it("supports * and $ wildcards", () => {
		expect(isPathAllowed(rules([], ["/*.pdf$"]), "/docs/report.pdf")).toBe(false);
		expect(isPathAllowed(rules([], ["/*.pdf$"]), "/docs/report.pdf.html")).toBe(
			true,
		);
		expect(
			isPathAllowed(rules([], ["/private/*/secret"]), "/private/a/secret"),
		).toBe(false);
		expect(isPathAllowed(rules([], ["/tmp"]), "/tmp/anything")).toBe(false);
	});

	it("accepts a full URL as well as a path", () => {
		expect(
			isPathAllowed(rules([], ["/private"]), "https://example.com/private?x=1"),
		).toBe(false);
	});
});

describe("fetchRobots", () => {
	it("parses a fetched robots.txt", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("User-agent: *\nDisallow: /x\n")),
		);

		const parsed = await fetchRobots("https://example.com/page");

		expect(parsed?.disallow).toEqual(["/x"]);
	});

	it("returns null on a 404", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 404 })),
		);

		expect(await fetchRobots("https://example.com")).toBeNull();
	});

	it("returns null on a network error and for an invalid url", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);

		expect(await fetchRobots("https://example.com")).toBeNull();
		expect(await fetchRobots("not a url")).toBeNull();
	});

	it("requests {origin}/robots.txt with an abort signal", async () => {
		const mock = vi.fn(async () => new Response("User-agent: *\n"));
		vi.stubGlobal("fetch", mock);

		await fetchRobots("https://example.com/a/b", "us");

		expect(mock.mock.calls[0][0]).toBe("https://example.com/robots.txt");
		const init = mock.mock.calls[0][1] as RequestInit;
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});
});
