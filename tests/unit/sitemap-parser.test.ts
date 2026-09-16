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
		expect(fetchMock).not.toHaveBeenCalledWith(
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
		expect(fetchMock).toHaveBeenCalledWith("https://example.com/sitemap.xml");
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
		expect(fetchMock).toHaveBeenCalledWith("https://example.com/child-2.xml");
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
		expect(fetchMock).not.toHaveBeenCalledWith("https://example.com/leaf.xml");
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

	it("returns an empty array for an invalid site URL", async () => {
		const fetchMock = stubFetch({});
		expect(await fetchSitemapUrls("not a url")).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
