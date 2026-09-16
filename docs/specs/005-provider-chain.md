# Spec 005 (rev 3) — Configurable self-contained search chain

Task slug: `provider-chain`. Branch: `feat/v2-port-005-provider-chain` (existing PR #6 —
this REVISES it).
Depends on (merged on `feat/v2-port`): `src/search/params.ts`, `src/search/types.ts`,
`src/search/ddg.ts`, and `src/search/ddgMedia.ts` (PR #7 — rebase onto it; drop your stub).

## Design change (supersedes the "delete searxng" instruction in the previous revision)

- **SearXNG is NOT deleted.** It stays as an OPTIONAL backend, dormant unless
  `SEARXNG_ENDPOINT` is configured. Restore it on your branch: take
  `src/search/searxng.ts` and `tests/unit/search-searxng.test.ts` from
  `origin/feat/v2-port` and restore the `SEARXNG_ENDPOINT`, `SEARXNG_ENGINES`,
  `SEARXNG_HEADERS` fields in the `Env` type.
- **The chain is configurable**, replacing `SEARCH_PROVIDER`/`SEARCH_FALLBACK` with one var:
  `SEARCH_CHAIN` — comma-separated provider ids, tried in order.
  Providers: `ddg` (web), `ddg-media` (news, images), `searxng` (web, news, images),
  `browser` (web).
  Default when unset: `ddg,ddg-media,browser`.
  Unknown ids are skipped with a warning. Remove `SEARCH_PROVIDER` and `SEARCH_FALLBACK`
  from `Env`.
- **Per-source resolution, first success wins:** for each requested source independently,
  walk the chain in order and take the first provider whose capabilities cover that
  source and that returns ≥1 result. Providers that cannot serve a source are skipped
  silently (they are not "failures"). This is what makes
  `SEARCH_CHAIN=ddg,searxng,browser` mean "ddg primary for web; searxng fills news/images
  (which ddg cannot serve), never primary."

## Scope

### 1. `src/search/provider.ts` — rewrite

```ts
export class SearchUnavailableError extends Error { constructor(details: string) { super(`search backend unavailable: ${details}`); } }
export function parseSearchChain(raw: string | undefined): { chain: string[]; warnings: string[] }  // exported for tests
export async function searchWithFallback(input: SearchInput, env: Env): Promise<SearchOutcome>
```

- Capabilities map (module constant): `{ ddg: ["web"], "ddg-media": ["news","images"], searxng: ["web","news","images"], browser: ["web"] }`.
- `parseSearchChain`: split on `,`, trim, lowercase, drop empties, drop unknown ids with
  warning `unknown search provider "<id>" skipped`. Empty/undefined → default
  `["ddg","ddg-media","browser"]`. `searxng` present but `SEARXNG_ENDPOINT` unset →
  drop with warning `searxng skipped: SEARXNG_ENDPOINT not configured` (do NOT call it).
- Resolution loop:
  - `missing` = set of `input.sources`.
  - For each provider id in chain order: `servable = missing ∩ capabilities[id]`; if empty
    → continue. Call that provider ONCE with `{...input, sources: [...servable]}`.
  - Merge returned `results` keys; remove filled sources from `missing`; accumulate
    warnings prefixed with the provider id (e.g. `ddg: anti-bot challenge`).
  - A throw from a provider → warning `<id>: <message>`, continue to next provider.
  - Stop early when `missing` is empty.
- Finish: if ALL requested sources are still missing → throw `SearchUnavailableError` with
  the joined reasons/warnings. If only some are missing → return the partial results plus
  one warning per unfilled source: `no provider returned results for <source>`.
- Empty `input.sources` → `{ results: {}, warnings: [] }` (no throw).

### 2. `src/search/ddgBrowser.ts` — keep as-is (already in PR #6, per previous spec revision)

### 3. `tests/unit/search-provider.test.ts` — extend

`vi.mock` `./ddg`, `./ddgBrowser`, `./ddgMedia`, `./searxng`. Cases (keep existing, add):
- `parseSearchChain`: default; whitespace/case; unknown ids dropped + warning; empty string → default
- `searxng` in chain without `SEARXNG_ENDPOINT` → skipped with warning, not called
- `searxng` in chain with endpoint → called for news/images (after ddg cannot serve them)
  and NOT called for web when ddg already filled web
- per-source independence: `sources:["web","news"]`, chain `ddg,ddg-media`: ddg called with
  `["web"]`, ddg-media called with `["news"]`; result contains both keys
- first-success-wins: chain `ddg,browser` + ddg returns web → browser NOT called
- ddg fails (anti-bot) → browser called for web; both warnings present
- all sources unfilled → `SearchUnavailableError`; partially unfilled → partial +
  `no provider returned results for <source>`
- `SEARCH_CHAIN=none`-style single-provider list respected (no implicit browser added —
  the default only applies when the var is UNSET)

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — all FULLY clean (tsc is a hard gate).
Expected file delta vs `origin/feat/v2-port`: `searxng.ts` + its test UNCHANGED (restored),
`ddgBrowser.ts`/`provider.ts`/`search-provider.test.ts` created, `ddgMedia.ts` stub removed
(real file comes from PR #7), `src/index.ts` Env = `SEARCH_CHAIN` + `SEARXNG_*` fields.

## Do NOT
- delete searxng, add dependencies, call real network/browsers in tests, or touch
  `webSearch.ts` / `ddg.ts` / `params.ts` / `ddgMedia.ts`
