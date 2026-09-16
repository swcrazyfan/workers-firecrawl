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
	browser: ["web", "news"],
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

// Own-property lookups everywhere: `in`/bare indexing would walk
// Object.prototype, so `SEARCH_CHAIN=constructor` would look like a known
// provider and blow up on `capabilities.includes`.
function knownProvider(id: string): boolean {
	return (
		Object.hasOwn(PROVIDER_CAPABILITIES, id) && Object.hasOwn(PROVIDERS, id)
	);
}

function aliasesFor(id: string): string[] {
	return Object.hasOwn(PROVIDER_MESSAGE_PREFIXES, id)
		? PROVIDER_MESSAGE_PREFIXES[id]
		: [id];
}

function prefixWarning(id: string, message: string): string {
	if (aliasesFor(id).some((prefix) => message.startsWith(`${prefix}:`))) {
		return message;
	}
	return `${id}: ${message}`;
}

// A provider's generic "nothing found" line — usable as a last-resort reason
// but never preferred over a real diagnostic (vqd failure, 403, ...).
function isGenericNoResults(id: string, warning: string): boolean {
	return aliasesFor(id).some((prefix) => warning === `${prefix}: no results`);
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
	const ids = (raw ?? "")
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter((id) => id.length > 0);

	// Unset or blank config → the documented default chain. A configured-but-
	// unusable chain does NOT silently fall back to the default: swapping in
	// providers the operator never asked for hides the misconfiguration.
	if (ids.length === 0) {
		return { chain: [...DEFAULT_SEARCH_CHAIN], warnings };
	}

	const chain: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (!Object.hasOwn(PROVIDER_CAPABILITIES, id)) {
			warnings.push(`unknown search provider "${id}" skipped`);
			continue;
		}
		if (seen.has(id)) continue; // dedupe, first occurrence wins
		seen.add(id);
		chain.push(id);
	}

	// searxng is dormant unless an endpoint is configured — drop it up front
	// instead of letting it fail at call time.
	if (chain.includes("searxng") && !searxngEndpoint) {
		warnings.push("searxng skipped: SEARXNG_ENDPOINT not configured");
		return { chain: chain.filter((id) => id !== "searxng"), warnings };
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
	// Nothing left after parsing means the configuration itself is broken —
	// say so rather than reporting a provider failure.
	if (parsed.chain.length === 0) {
		throw new SearchUnavailableError(
			[
				"no usable providers configured (SEARCH_CHAIN resolved empty)",
				...parsed.warnings,
			].join("; "),
		);
	}

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
		if (!knownProvider(id)) continue;
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
			const providerWarnings = outcome.warnings.map((warning) =>
				prefixWarning(id, warning),
			);
			warnings.push(...providerWarnings);
			for (const source of servable) {
				const items = outcome.results[source];
				if (items === undefined || items.length === 0) continue;
				assignSource(results, source, items);
				missing.delete(source);
				filled = true;
			}
			// A provider must not widen the result set beyond what it was
			// asked for, even if it returns extra keys.
			for (const key of Object.keys(outcome.results)) {
				const items = outcome.results[key as Source];
				if (
					servable.includes(key as Source) ||
					!Array.isArray(items) ||
					items.length === 0
				) {
					continue;
				}
				warnings.push(`${id}: ignoring unrequested source "${key}"`);
			}
			if (!filled) {
				// Carry the provider's real diagnostic (vqd failure, 403, ...)
				// instead of the generic "no results" when it has one.
				const meaningful = providerWarnings.filter(
					(warning) => !isGenericNoResults(id, warning),
				);
				reasons.push(
					...(meaningful.length > 0 ? meaningful : providerWarnings),
				);
			}
		} catch (error) {
			const reason = prefixWarning(id, messageOf(error));
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
