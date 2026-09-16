export interface FetchSitemapOptions {
	maxDepth?: number;
	limit?: number;
	timeoutMs?: number;
	maxFiles?: number;
}

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_LIMIT = 5000;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_FILES = 50;

// Decode the XML entities that show up inside <loc>/Sitemap values. Without
// this a query string like "?a=1&amp;b=2" would keep the escaped form.
function decodeXmlEntities(value: string): string {
	return value.replace(
		/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
		(match, entity: string) => {
			if (entity.startsWith("#")) {
				const hex = entity[1] === "x" || entity[1] === "X";
				const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
				return Number.isNaN(code) ? match : String.fromCodePoint(code);
			}
			switch (entity) {
				case "amp":
					return "&";
				case "lt":
					return "<";
				case "gt":
					return ">";
				case "quot":
					return '"';
				case "apos":
					return "'";
				default:
					return match;
			}
		},
	);
}

function stripCdata(value: string): string {
	const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
	return cdata ? cdata[1].trim() : value;
}

// Pull <loc> values out of blocks with the given tag name. `\b` after the tag
// keeps <url> from matching <urlset> and <sitemap> from matching <sitemapindex>.
function extractLocs(xml: string, blockTag: string): string[] {
	const locs: string[] = [];
	const blockRegex = new RegExp(
		`<${blockTag}\\b[^>]*>([\\s\\S]*?)</${blockTag}>`,
		"gi",
	);
	const locRegex = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i;
	let block: RegExpExecArray | null = blockRegex.exec(xml);
	while (block !== null) {
		const loc = locRegex.exec(block[1]);
		if (loc && loc[1]) {
			const value = decodeXmlEntities(stripCdata(loc[1]));
			if (value) locs.push(value);
		}
		block = blockRegex.exec(xml);
	}
	return locs;
}

function resolveHttpUrl(value: string, base: string): string | null {
	try {
		const resolved = new URL(value, base);
		if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
			return null;
		}
		return resolved.toString();
	} catch {
		return null;
	}
}

async function fetchWithTimeout(
	url: string,
	timeoutMs: number,
): Promise<Response> {
	return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

async function readBodyText(response: Response): Promise<string> {
	const bytes = new Uint8Array(await response.arrayBuffer());
	const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
	const encoding = (
		response.headers.get("content-encoding") ?? ""
	).toLowerCase();
	if (gzipped || encoding.includes("gzip")) {
		try {
			const stream = new Blob([bytes])
				.stream()
				.pipeThrough(new DecompressionStream("gzip"));
			return await new Response(stream).text();
		} catch {
			// Body was not actually gzipped (e.g. the runtime already decoded
			// it); fall through and treat it as plain text.
		}
	}
	return new TextDecoder().decode(bytes);
}

// robots.txt first: honour every `Sitemap:` directive (absolute or relative,
// case-insensitive, tolerating a trailing inline comment). Fall back to the
// conventional /sitemap.xml when robots is missing or lists nothing usable.
async function discoverSitemapEntries(
	origin: string,
	timeoutMs: number,
): Promise<string[]> {
	const robotsUrl = `${origin}/robots.txt`;
	try {
		const response = await fetchWithTimeout(robotsUrl, timeoutMs);
		if (response.ok) {
			const text = await response.text();
			const entries: string[] = [];
			for (const line of text.split(/\r?\n/)) {
				const match = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
				if (!match || !match[1]) continue;
				const resolved = resolveHttpUrl(match[1], robotsUrl);
				if (resolved) entries.push(resolved);
			}
			if (entries.length > 0) return entries;
		}
	} catch {
		// Fall through to the default location.
	}
	return [`${origin}/sitemap.xml`];
}

export async function fetchSitemapUrls(
	siteUrl: string,
	opts?: FetchSitemapOptions,
): Promise<string[]> {
	let origin: string;
	try {
		origin = new URL(siteUrl).origin;
	} catch {
		return [];
	}

	const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
	const limit = opts?.limit ?? DEFAULT_LIMIT;
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_FILES;

	const urls: string[] = [];
	const seenUrls = new Set<string>();
	const seenSitemaps = new Set<string>();
	let filesFetched = 0;

	const addUrl = (candidate: string) => {
		if (urls.length >= limit || seenUrls.has(candidate)) return;
		seenUrls.add(candidate);
		urls.push(candidate);
	};

	const processSitemap = async (
		sitemapUrl: string,
		depth: number,
	): Promise<void> => {
		if (urls.length >= limit || filesFetched >= maxFiles) return;
		if (seenSitemaps.has(sitemapUrl)) return;
		seenSitemaps.add(sitemapUrl);
		filesFetched += 1;

		let response: Response;
		try {
			response = await fetchWithTimeout(sitemapUrl, timeoutMs);
		} catch {
			return;
		}
		if (!response.ok) return;

		let xml: string;
		try {
			xml = await readBodyText(response);
		} catch {
			return;
		}

		if (/<sitemapindex[\s>]/i.test(xml)) {
			if (depth >= maxDepth) return;
			for (const child of extractLocs(xml, "sitemap")) {
				if (urls.length >= limit || filesFetched >= maxFiles) break;
				const resolved = resolveHttpUrl(child, sitemapUrl);
				if (resolved) await processSitemap(resolved, depth + 1);
			}
			return;
		}

		for (const loc of extractLocs(xml, "url")) {
			if (urls.length >= limit) break;
			const resolved = resolveHttpUrl(loc, sitemapUrl);
			if (resolved) addUrl(resolved);
		}
	};

	for (const entry of await discoverSitemapEntries(origin, timeoutMs)) {
		if (urls.length >= limit || filesFetched >= maxFiles) break;
		await processSitemap(entry, 0);
	}

	return urls;
}
