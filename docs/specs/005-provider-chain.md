# Spec 005 — Self-contained search provider chain (+ searxng removal)

Task slug: `provider-chain`. Branch: `feat/v2-port-005-provider-chain`.
Depends on (merged on `feat/v2-port`): `src/search/params.ts`, `src/search/types.ts`,
`src/search/ddg.ts` (exports `DdgAntiBotError`).
Parallel task 007 (`src/search/ddgMedia.ts`: `ddgMediaSearch`) is being built against
the same contract — program against its exact signature below; if the file is missing
on your branch, create a minimal stub matching it and flag that in the PR body.

## Why
Decision reversed: NO SearXNG. The Worker must be fully self-contained. Search chain:
DDG html fetch (primary) → DDG via Browser Rendering (the currently-proven logic) →
structured failure. News/images come from task 007's vqd-based provider, invoked by
this chain for non-web sources.

## Scope

### 1. DELETE the SearXNG provider (reverted decision)
- `git rm src/search/searxng.ts tests/unit/search-searxng.test.ts`
- In `src/index.ts`, remove the `SEARXNG_ENDPOINT`, `SEARXNG_ENGINES`,
  `SEARXNG_HEADERS` fields from `Env`. Keep `SEARCH_PROVIDER` and `SEARCH_FALLBACK`
  but update their comments to `// "ddg" | "browser"` and `// "browser" | "none"`.
- Do not remove anything else (params/types/ddg stay).

### 2. CREATE `src/search/ddgBrowser.ts`

```ts
export async function ddgBrowserSearch(input: SearchInput, env: Env): Promise<SearchOutcome>
```

- Port the browser flow from `src/webSearch.ts:8-32` (`performSearch`): launch via
  `getBrowser(env.BROWSER)` (import from `../browser`), new page, navigate
  `https://duckduckgo.com/?q=<encoded>&kl=<klFrom(...)>` (+ `&df=` / `&kp=` when
  `mapTbs`/`safe` supply them — same mapping as `ddg.ts`), `waitUntil: "domcontentloaded"`,
  wait for `[data-testid="result-title-a"]` (10s timeout).
- Extract from `li[data-layout="organic"] [data-testid="result-title-a"]`: the `href`
  AND the anchor's `innerText` as `title` (improvement over `webSearch.ts`, URLs-only).
  `description: ""`.
- Filter non-http(s), dedupe by the same `normalizeUrlKey` rules (copy the helper),
  positions contiguous 1..N after dedupe + slice to `limit`. Validate with `webResultSchema.safeParse`.
- **Close the browser in `finally`** (upstream bug `e836594` was a leak here).
- `sources` other than `"web"`: skip here (the chain routes news/images to 007); push
  no warning from this module — chain handles coverage messaging.
- Zero web results → `{ results: {}, warnings: ["ddg-browser: no results"] }`.
- Do NOT modify `src/webSearch.ts` (`/v1/search` stays frozen).

### 3. CREATE `src/search/provider.ts`

```ts
export class SearchUnavailableError extends Error { constructor(details: string) { super(`search backend unavailable: ${details}`); } }
export async function searchWithFallback(input: SearchInput, env: Env): Promise<SearchOutcome>
```

Resolution:
- primary = `env.SEARCH_PROVIDER ?? "ddg"` (values: `"ddg" | "browser"`; unknown values → `"ddg"`)
- web chain: `[primary, "browser"]` deduped, unless `env.SEARCH_FALLBACK === "none"`.
- Flow:
  1. If `input.sources` includes `"news"` or `"images"`, call
     `ddgMediaSearch(input, env)` (from `./ddgMedia`) FIRST for those sources.
     Its outcome (results + warnings) is merged into the final outcome. If it throws,
     capture as warning `ddg-media: <reason>` and continue (web still attempted).
     Media is best-effort: never blocks web results, never triggers web fallback by itself.
  2. If `input.sources` includes `"web"`: try each provider in the web chain
     (`ddgWebSearch`, then `ddgBrowserSearch`). Catch throws (`DdgAntiBotError`,
     network, etc.) as provider failure. Advance to the next provider only when the
     current attempt produced ZERO web results (threw or returned no `results.web`).
     Partial results are final.
  3. Warnings accumulate prefixed by provider name (`ddg: anti-bot challenge`,
     `ddg-browser: no results`, `ddg-media: ...`).
  4. Web requested + web chain exhausted with zero web results AND media also empty →
     throw `SearchUnavailableError` with the joined reasons. If media returned
     something but web failed entirely, return the media results + warnings (do not throw).

### 4. CREATE `tests/unit/search-provider.test.ts`

`vi.mock("./ddg")`, `vi.mock("./ddgBrowser")`, `vi.mock("./ddgMedia")` with controlled
outcomes/throws (including `DdgAntiBotError`). Cases:
- ddg success → no browser call
- ddg throws anti-bot → browser called, result + `ddg:` warning
- both fail → `SearchUnavailableError` with both reasons
- ddg partial (web: 2 results) → browser NOT called
- `SEARCH_FALLBACK=none` → browser never called
- sources ["web","news"] → `ddgMediaSearch` called once with the same input; media
  results merged alongside web results in one outcome
- `ddgMediaSearch` throws → warning, web results still returned, no throw
- sources ["news"] only → ddg/ddgBrowser NOT called; media outcome returned; if media
  empty/throws → `SearchUnavailableError`
- unknown `SEARCH_PROVIDER` value → treated as `"ddg"`

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — all FULLY clean. Net file delta:
2 files deleted, 3 created. `src/index.ts` diff = Env fields only.

## Do NOT
- modify `webSearch.ts`, `ddg.ts`, `params.ts`; launch browsers; make network calls in tests
