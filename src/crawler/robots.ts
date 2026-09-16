/**
 * Clean-room robots.txt parser and matcher.
 *
 * Implemented from the directive grammar directly (no library / AGPL source):
 * - `User-agent` groups (consecutive user-agent lines start a group; a
 *   user-agent line after a rule line opens a new group).
 * - For our user agent the matching group is the first exact match, otherwise
 *   the first `*` group.
 * - `Allow` / `Disallow` with `*` and `$` wildcards, longest match wins, an
 *   `Allow` of equal specificity overrides a `Disallow`.
 * - `Crawl-delay` (seconds).
 *
 * `fetchRobots` never throws and resolves to `null` on 404/network error.
 */

export interface RobotsRules {
	allow: string[];
	disallow: string[];
	crawlDelaySec?: number;
}

// Default product token/UA used when fetching robots.txt and scraping. Sites
// commonly write `User-agent: workers-firecrawl` (the product token) while the
// request UA carries a version/comment, so group matching accepts either the
// full UA or its leading product token (see `matchesAgent`).
export const CRAWL_USER_AGENT =
	"workers-firecrawl/1.0 (+https://github.com/swcrazyfan/workers-firecrawl)";

interface RobotsGroup {
	agents: string[];
	allow: string[];
	disallow: string[];
	crawlDelaySec?: number;
}

const ROBOTS_TIMEOUT_MS = 5000;

function stripComment(line: string): string {
	const hash = line.indexOf("#");
	return hash === -1 ? line : line.slice(0, hash);
}

// A robots group agent matches when it equals our UA or its product token
// (`workers-firecrawl/1.0 (...) -> workers-firecrawl`).
function matchesAgent(agent: string, wanted: string): boolean {
	if (agent === wanted) return true;
	const token = wanted.split(/[\s/]/)[0] ?? "";
	return token !== "" && agent === token;
}

export function parseRobotsTxt(text: string, userAgent?: string): RobotsRules {
	const groups: RobotsGroup[] = [];
	let current: RobotsGroup | null = null;
	let previousWasAgent = false;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = stripComment(rawLine).trim();
		if (line === "") continue;

		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();

		if (key === "user-agent") {
			// Consecutive user-agent lines share a group; any user-agent line
			// after a rule starts a new one.
			if (!current || !previousWasAgent) {
				current = { agents: [], allow: [], disallow: [] };
				groups.push(current);
			}
			if (value) current.agents.push(value.toLowerCase());
			previousWasAgent = true;
			continue;
		}

		previousWasAgent = false;
		if (!current) continue;

		if (key === "allow") {
			if (value) current.allow.push(value);
		} else if (key === "disallow") {
			if (value) current.disallow.push(value);
		} else if (key === "crawl-delay") {
			const delay = Number.parseFloat(value);
			if (Number.isFinite(delay) && delay >= 0) current.crawlDelaySec = delay;
		}
	}

	const wanted = (userAgent ?? "").trim().toLowerCase();
	const exact = wanted
		? groups.find((group) =>
				group.agents.some(
					(agent) => agent !== "*" && matchesAgent(agent, wanted),
				),
			)
		: undefined;
	const wildcard = groups.find((group) => group.agents.includes("*"));
	// Standard behaviour when nothing matches (a named-URL site with neither our
	// UA nor `*`): allow everything. Documented deliberate choice, not a bug.
	const chosen = exact ?? wildcard;

	if (!chosen) return { allow: [], disallow: [] };
	const rules: RobotsRules = {
		allow: [...chosen.allow],
		disallow: [...chosen.disallow],
	};
	if (chosen.crawlDelaySec !== undefined) {
		rules.crawlDelaySec = chosen.crawlDelaySec;
	}
	return rules;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
}

function buildMatcher(pattern: string): RegExp {
	// A trailing `$` anchors the end of the path; anything else is a prefix
	// match, which is why the regex is deliberately left open at the end.
	const anchored = pattern.endsWith("$");
	const body = anchored ? pattern.slice(0, -1) : pattern;
	const source = escapeRegExp(body).replace(/\*/g, ".*");
	return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

// Returns the specificity (pattern length) when the pattern matches, else null.
function matchLength(pattern: string, path: string): number | null {
	if (pattern === "") return null;
	try {
		if (buildMatcher(pattern).test(path)) return pattern.length;
	} catch {
		// A pattern that cannot be compiled is treated as non-matching.
	}
	return null;
}

function normalizePath(path: string): string {
	let value = path || "/";
	try {
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
			const url = new URL(value);
			value = `${url.pathname}${url.search}`;
		}
	} catch {
		// Keep the raw value.
	}
	if (!value.startsWith("/")) value = `/${value}`;
	return value;
}

export function isPathAllowed(rules: RobotsRules, path: string): boolean {
	const target = normalizePath(path);
	let allowed = true;
	let bestLength = -1;

	// Disallow first, then Allow: `>=` lets an Allow of equal specificity win.
	for (const pattern of rules.disallow) {
		const length = matchLength(pattern, target);
		if (length !== null && length > bestLength) {
			bestLength = length;
			allowed = false;
		}
	}
	for (const pattern of rules.allow) {
		const length = matchLength(pattern, target);
		if (length !== null && length >= bestLength) {
			bestLength = length;
			allowed = true;
		}
	}

	return allowed;
}

export async function fetchRobots(
	siteUrl: string,
	userAgent?: string,
): Promise<RobotsRules | null> {
	let origin: string;
	try {
		origin = new URL(siteUrl).origin;
	} catch {
		return null;
	}

	try {
		const response = await fetch(`${origin}/robots.txt`, {
			signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const text = await response.text();
		return parseRobotsTxt(text, userAgent);
	} catch {
		return null;
	}
}
