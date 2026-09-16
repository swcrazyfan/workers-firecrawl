import type { Env } from "../index";
import { ddgWebSearch } from "./ddg";
import { ddgBrowserSearch } from "./ddgBrowser";
import { ddgMediaSearch } from "./ddgMedia";
import { searxngSearch } from "./searxng";
import type { SearchInput, SearchOutcome, SearchResults } from "./types";

export class SearchUnavailableError extends Error {
	constructor(details: string) {
		super(`search backend unavailable: ${details}`);
	}
}

type Source = "web" | "news" | "images";

const PROVIDER_CAPABILITIES: Record<string, Source[]> = {
	ddg: ["web"],
	"ddg-media": ["news", "images"],
	searxng: ["web", "news", "images"],
	browser: ["web"],
};

const DEFAULT_SEARCH_CHAIN = ["ddg", "ddg-media", "browser"];

type ProviderRunner = (input: SearchInput, env: Env) => Promise<SearchOutcome>;

const PROVIDERS: Record<string, ProviderRunner> = {
	ddg: ddgWebSearch,
	"ddg-media": ddgMediaSearch,
	searxng: searxngSearch,
	browser: ddgBrowserSearch,
};

// ddgBrowserSearch already prefixes its messages with "ddg-browser"; every
// other provider uses its provider id. Matching "<prefix>:" avoids
// double-prefixing messages that are already labelled.
const PROVIDER_MESSAGE_PREFIXES: Record<string, string[]> = {
	ddg: ["ddg"],
	"ddg-media": ["ddg-media"],
	searxng: ["searxng"],
	browser: ["browser", "ddg-browser"],
};

function prefixReason(id: string, message: string): string {
	const prefixes = PROVIDER_MESSAGE_PREFIXES[id] ?? [id];
	if (prefixes.some((prefix) => message.startsWith(`${prefix}:`))) {
		return message;
	}
	return `${id}: ${message}`;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Kept in one place because the resolution loop only ever fills a source with
// a matching result type — the union-indexed write needs the generic hand.
function assignSource<K extends Source>(
	results: SearchResults,
	source: K,
	items: NonNullable<SearchResults[K]>,
): void {
	results[source] = items;
}

/**
 * Parse `SEARCH_CHAIN` into the ordered provider list.
 * `searxngEndpoint` is passed in (rather than read from env) so the chain
 * parser stays pure and testable; searxng is dropped when it is unset.
 */
export function parseSearchChain(
	raw: string | undefined,
	searxngEndpoint?: string,
): { chain: string[]; warnings: string[] } {
	const warnings: string[] = [];
	const chain: string[] = [];
	for (const token of (raw ?? "").split(",")) {
		const id = token.trim().toLowerCase();
		if (id.length === 0) continue;
		if (!(id in PROVIDER_CAPABILITIES)) {
			warnings.push(`unknown search provider "${id}" skipped`);
			continue;
		}
		chain.push(id);
	}
	if (chain.length === 0) chain.push(...DEFAULT_SEARCH_CHAIN);

	// searxng is dormant unless an endpoint is configured — drop it up front
	// instead of letting it fail at call time.
	if (chain.includes("searxng") && !searxngEndpoint) {
		warnings.push("searxng skipped: SEARXNG_ENDPOINT not configured");
		const usable = chain.filter((id) => id !== "searxng");
		return {
			chain: usable.length > 0 ? usable : [...DEFAULT_SEARCH_CHAIN],
			warnings,
		};
	}

	return { chain, warnings };
}

export async function searchWithFallback(
	input: SearchInput,
	env: Env,
): Promise<SearchOutcome> {
	if (input.sources.length === 0) {
		return { results: {}, warnings: [] };
	}

	const parsed = parseSearchChain(env.SEARCH_CHAIN, env.SEARXNG_ENDPOINT);
	const warnings = [...parsed.warnings];
	const results: SearchResults = {};
	const missing = new Set<Source>(input.sources);
	const requestedCount = missing.size;
	const reasons: string[] = [];

	// Per-source resolution: each provider is asked once for the sources it
	// can serve that are still missing. First provider to return >=1 result
	// for a source wins it.
	for (const id of parsed.chain) {
		if (missing.size === 0) break;
		const capabilities = PROVIDER_CAPABILITIES[id];
		const runner = PROVIDERS[id];
		if (capabilities === undefined || runner === undefined) continue;
		const servable = [...missing].filter((source) =>
			capabilities.includes(source),
		);
		// Providers that cannot serve any missing source are skipped silently.
		if (servable.length === 0) continue;

		let filled = false;
		try {
			const outcome = await runner({ ...input, sources: servable }, env);
			warnings.push(...outcome.warnings);
			for (const source of servable) {
				const items = outcome.results[source];
				if (items === undefined || items.length === 0) continue;
				assignSource(results, source, items);
				missing.delete(source);
				filled = true;
			}
			if (!filled) {
				// Prefer the provider's own no-results wording (e.g.
				// "ddg-browser: no results") over a second label.
				reasons.push(
					outcome.warnings.find((warning) =>
						warning.endsWith(": no results"),
					) ?? `${id}: no results`,
				);
			}
		} catch (error) {
			const reason = prefixReason(id, messageOf(error));
			warnings.push(reason);
			reasons.push(reason);
		}
	}

	if (missing.size === requestedCount) {
		const details =
			reasons.length > 0
				? reasons.join("; ")
				: [...missing]
						.map((source) => `no provider available for ${source}`)
						.join("; ");
		throw new SearchUnavailableError(details);
	}

	// Partial fill: report each source nobody could serve.
	for (const source of missing) {
		warnings.push(`no provider returned results for ${source}`);
	}
	return { results, warnings };
}
