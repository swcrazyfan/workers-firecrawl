import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSitemapUrls } from "../../src/crawler/sitemap";

// Gzipped: <?xml ...?><urlset><url><loc>https://gzip.example.com/one</loc></url>
// <url><loc>https://gzip.example.com/two</loc></url></urlset>
const GZIP_URLSET_BASE64 =
	"H4sIAAAAAAAAA7Oxr8jNUShLLSrOzM+zVTLUM1BSSM1Lzk/JzEu3VQoNcdO1ULK3syktyilOLQHTdjY5+cl2GSUlBcVW+vrpVZkFeqkVibkFOal6yfm5+vl5qTb6IBU2+mDFhHWUlOej6NCHWgYA7DzEIZsAAAA=";

function gunzipFixture(): Uint8Array {
	const binary = atob(GZIP_URLSET_BASE64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function xmlResponse(xml: string, status = 200): Response {
	return new Response(xml, {
		status,
		headers: { "content-type": "application/xml" },
	});
}

function urlset(...locs: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs
		.map((loc) => `<url><loc>${loc}</loc></url>`)
		.join("")}</urlset>`;
}

function sitemapIndex(...locs: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex>${locs
		.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
		.join("")}</sitemapindex>`;
}

type Route = Response | (() => Response | Promise<Response>);

function stubFetch(routes: Record<string, Route>) {
	const mock = vi.fn(async (input: RequestInfo | URL) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const route = routes[url];
		if (route === undefined) return new Response("not found", { status: 404 });
		return typeof route === "function" ? route() : route;
	});
	vi.stubGlobal("fetch", mock);
	return mock;
}

function fetchedUrls(mock: ReturnType<typeof stubFetch>): string[] {
	return mock.mock.calls.map((call) => call[0] as string);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("fetchSitemapUrls", () => {
	it("honours robots.txt Sitemap directives and parses a urlset", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"User-agent: *\nSitemap: https://example.com/main-sitemap.xml\n",
			),
			"https://example.com/main-sitemap.xml": xmlResponse(
				urlset("https://example.com/a", "https://example.com/b"),
			),
		});

		const urls = await fetchSitemapUrls("https://example.com");

		expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
		// Default /sitemap.xml is only a fallback once robots lists nothing.
		expect(fetchedUrls(fetchMock)).not.toContain(
			"https://example.com/sitemap.xml",
		);
	});

	it("falls back to /sitemap.xml when robots.txt is missing", async () => {
		stubFetch({
			"https://example.com/sitemap.xml": xmlResponse(
				urlset("https://example.com/fallback"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/fallback",
		]);
	});

	it("falls back to /sitemap.xml when robots.txt has no Sitemap directive", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"User-agent: *\nDisallow: /private\n",
			),
			"https://example.com/sitemap.xml": xmlResponse(
				urlset("https://example.com/from-default"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/from-default",
		]);
		expect(fetchedUrls(fetchMock)).toContain("https://example.com/sitemap.xml");
	});

	it("resolves relative Sitemap directives and relative <loc> values", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: /sitemaps/root.xml\n",
			),
			"https://example.com/sitemaps/root.xml": xmlResponse(
				urlset("page", "/absolute", "https://other.example/x"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/sitemaps/page",
			"https://example.com/absolute",
			"https://other.example/x",
		]);
	});

	it("recurses through sitemap index files", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/root.xml\n",
			),
			"https://example.com/root.xml": xmlResponse(
				sitemapIndex(
					"https://example.com/child-1.xml",
					"https://example.com/child-2.xml",
				),
			),
			"https://example.com/child-1.xml": xmlResponse(
				urlset("https://example.com/one", "https://example.com/two"),
			),
			"https://example.com/child-2.xml": xmlResponse(
				urlset("https://example.com/three"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/one",
			"https://example.com/two",
			"https://example.com/three",
		]);
		expect(fetchedUrls(fetchMock)).toContain("https://example.com/child-2.xml");
	});

	it("stops recursing once maxDepth is reached", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/root-index.xml\n",
			),
			"https://example.com/root-index.xml": xmlResponse(
				sitemapIndex("https://example.com/child-index.xml"),
			),
			"https://example.com/child-index.xml": xmlResponse(
				sitemapIndex("https://example.com/leaf.xml"),
			),
			"https://example.com/leaf.xml": xmlResponse(
				urlset("https://example.com/deep"),
			),
		});

		expect(
			await fetchSitemapUrls("https://example.com", { maxDepth: 1 }),
		).toEqual([]);
		expect(fetchedUrls(fetchMock)).not.toContain("https://example.com/leaf.xml");
	});

	it("decompresses gzipped sitemaps via DecompressionStream", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/sitemap.xml.gz\n",
			),
			"https://example.com/sitemap.xml.gz": new Response(gunzipFixture(), {
				headers: { "content-encoding": "gzip" },
			}),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://gzip.example.com/one",
			"https://gzip.example.com/two",
		]);
	});

	it("decompresses a .xml.gz body detected by its gzip magic bytes", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/sitemap.xml.gz\n",
			),
			// No content-encoding header — detection must come from the payload.
			"https://example.com/sitemap.xml.gz": new Response(gunzipFixture()),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://gzip.example.com/one",
			"https://gzip.example.com/two",
		]);
	});

	it("dedupes URLs and decodes XML entities", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/a.xml\nSitemap: https://example.com/b.xml\n",
			),
			"https://example.com/a.xml": xmlResponse(
				urlset(
					"https://example.com/a?x=1&amp;y=2",
					"https://example.com/dup",
				),
			),
			"https://example.com/b.xml": xmlResponse(
				urlset(
					"https://example.com/dup",
					"https://example.com/a?x=1&y=2",
				),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/a?x=1&y=2",
			"https://example.com/dup",
		]);
	});

	it("caps the returned URL count at limit", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/sitemap.xml\n",
			),
			"https://example.com/sitemap.xml": xmlResponse(
				urlset(
					"https://example.com/1",
					"https://example.com/2",
					"https://example.com/3",
					"https://example.com/4",
				),
			),
		});

		expect(
			await fetchSitemapUrls("https://example.com", { limit: 2 }),
		).toEqual(["https://example.com/1", "https://example.com/2"]);
	});

	it("filters non-http(s) locations", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/sitemap.xml\n",
			),
			"https://example.com/sitemap.xml": xmlResponse(
				urlset("ftp://example.com/file", "mailto:hi@example.com", "https://ok.example"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://ok.example/",
		]);
	});

	it("fails soft on a 404 sitemap", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/gone.xml\n",
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([]);
	});

	it("fails soft on malformed XML", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/broken.xml\n",
			),
			"https://example.com/broken.xml": xmlResponse("<urlset><url><loc>"),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([]);
	});

	it("keeps collecting when one child sitemap fetch throws", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/root.xml\n",
			),
			"https://example.com/root.xml": xmlResponse(
				sitemapIndex(
					"https://example.com/boom.xml",
					"https://example.com/ok.xml",
				),
			),
			"https://example.com/boom.xml": () => {
				throw new Error("network down");
			},
			"https://example.com/ok.xml": xmlResponse(
				urlset("https://example.com/survivor"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/survivor",
		]);
	});

	it("is case-insensitive and ignores commented-out Sitemap lines", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				[
					"# Sitemap: https://example.com/commented.xml",
					"SITEMAP: https://example.com/upper.xml",
					"sitemap: https://example.com/inline.xml # trailing note",
				].join("\n"),
			),
			"https://example.com/upper.xml": xmlResponse(
				urlset("https://example.com/upper"),
			),
			"https://example.com/inline.xml": xmlResponse(
				urlset("https://example.com/inline"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/upper",
			"https://example.com/inline",
		]);
		expect(fetchedUrls(fetchMock)).not.toContain(
			"https://example.com/commented.xml",
		);
	});

	it("decodes named and numeric XML entities", async () => {
		stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/sitemap.xml\n",
			),
			"https://example.com/sitemap.xml": xmlResponse(
				urlset(
					"https://example.com/a?x=1&amp;y=2",
					"https://example.com/b?x=1&#38;y=2",
					"https://example.com/c?x=1&#x26;y=2",
				),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([
			"https://example.com/a?x=1&y=2",
			"https://example.com/b?x=1&y=2",
			"https://example.com/c?x=1&y=2",
		]);
	});

	it("terminates on a self-referencing sitemap index", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/self.xml\n",
			),
			"https://example.com/self.xml": xmlResponse(
				sitemapIndex("https://example.com/self.xml"),
			),
		});

		expect(await fetchSitemapUrls("https://example.com")).toEqual([]);
		const selfFetches = fetchMock.mock.calls.filter(
			(call) => call[0] === "https://example.com/self.xml",
		);
		expect(selfFetches).toHaveLength(1);
	});

	it("caps collected URLs across multiple sitemap files", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/a.xml\nSitemap: https://example.com/b.xml\n",
			),
			"https://example.com/a.xml": xmlResponse(
				urlset(
					"https://example.com/1",
					"https://example.com/2",
					"https://example.com/3",
				),
			),
			"https://example.com/b.xml": xmlResponse(
				urlset(
					"https://example.com/4",
					"https://example.com/5",
					"https://example.com/6",
				),
			),
		});

		expect(
			await fetchSitemapUrls("https://example.com", { limit: 4 }),
		).toEqual([
			"https://example.com/1",
			"https://example.com/2",
			"https://example.com/3",
			"https://example.com/4",
		]);
		expect(fetchedUrls(fetchMock)).toContain("https://example.com/b.xml");
	});

	it("caps the number of sitemap files fetched", async () => {
		const children = ["one.xml", "two.xml", "three.xml"].map(
			(name) => `https://example.com/${name}`,
		);
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/root.xml\n",
			),
			"https://example.com/root.xml": xmlResponse(sitemapIndex(...children)),
			"https://example.com/one.xml": xmlResponse(
				urlset("https://example.com/one"),
			),
			"https://example.com/two.xml": xmlResponse(
				urlset("https://example.com/two"),
			),
			"https://example.com/three.xml": xmlResponse(
				urlset("https://example.com/three"),
			),
		});

		// root.xml is file 1, one.xml is file 2; the cap stops the rest.
		expect(
			await fetchSitemapUrls("https://example.com", { maxFiles: 2 }),
		).toEqual(["https://example.com/one"]);
		expect(fetchedUrls(fetchMock)).not.toContain("https://example.com/two.xml");
	});

	it("requests each sitemap with an abort signal", async () => {
		const fetchMock = stubFetch({
			"https://example.com/robots.txt": new Response(
				"Sitemap: https://example.com/sitemap.xml\n",
			),
			"https://example.com/sitemap.xml": xmlResponse(
				urlset("https://example.com/a"),
			),
		});

		await fetchSitemapUrls("https://example.com", { timeoutMs: 1234 });

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("returns an empty array for an invalid site URL", async () => {
		const fetchMock = stubFetch({});
		expect(await fetchSitemapUrls("not a url")).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
