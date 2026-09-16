# Spec 004 — DDG fetch search provider (web results)

Task slug: `ddg-provider`. Branch: `feat/v2-port-004-ddg-provider`.
Depends on: `src/search/params.ts` (already merged — `mapTbs`, `klFrom`,
`buildDomainQuery`) and `src/search/types.ts` (`SearchOutcome`, `SearchInput`).

## Why
SearXNG is primary, DDG is the fetch-based fallback. Target endpoint
`html.duckduckgo.com/html/` is server-rendered with stable classes (verified
live): result blocks `div.result.web-result`, titles `a.result__a`, snippets
`.result__snippet`, result URLs wrapped as
`//duckduckgo.com/l/?uddg=<urlencoded>&rut=...`. Web results only — news/images
are NOT in this task.

## Scope — create EXACTLY these files

### 1. `src/search/ddg.ts`

```ts
export class DdgAntiBotError extends Error { constructor() { super("ddg: anti-bot challenge"); } }
export function parseDdgHtml(html: string): Array<{ url: string; title: string; snippet: string }>
export async function ddgWebSearch(input: SearchInput, env: Env): Promise<SearchOutcome>
```

**`parseDdgHtml`** — pure function, no fetch. Parse with regex (the HTML is
stable and server-rendered; regex over `<a rel="nofollow" class="result__a" href="...">title</a>`
plus adjacent `.result__snippet` blocks). For every result link:
- Extract `href`; if it contains `duckduckgo.com/l/` or starts with `//duckduckgo.com/l/`,
  unwrap: parse the `uddg` query param and `decodeURIComponent` it → the real URL.
  Skip results whose unwrapped URL is not http(s).
- HTML-entity-decode titles and snippets (minimal `&amp; &lt; &gt; &quot; &#x27;` decode —
  no dependency).
- Return `[]` on no matches. If the html contains `anomaly-modal` or `challenge-form`,
  throw `DdgAntiBotError`.
- Decode any `&#x27;`-style entities in hrefs too.

**`ddgWebSearch`**:
- URL: `https://html.duckduckgo.com/html/` — page 1 via GET with params:
  `q` (from `buildDomainQuery`), `kl` (from `klFrom`), `df` (from `mapTbs`, only
  when present), `kp` (`input.safe === true ? "1" : "-2"`). Bubble `mapTbs` warnings.
- Pages 2+: POST the same URL with `application/x-www-form-urlencoded` body
  `q=<query>&s=<offset>&kl=<kl>&df=<df>` where `offset = 10 + (page - 2) * 15`.
  Sleep 1100ms between pages. Stop when: collected ≥ `input.limit`, a page adds
  0 new (post-dedupe) results, or `MAX_PAGES = 5` reached (then push warning
  `ddg: stopped at page cap ${MAX_PAGES}, returning N < limit results` when short).
- Headers: `User-Agent` picked at random from a 4-entry desktop-Chrome/Firefox pool,
  `Accept: text/html,application/xhtml+xml`, `Accept-Language: ${input.lang ?? "en"}`.
- Per-page: `AbortSignal.timeout(10000)`; retry ONCE after 250ms on network error
  or 5xx only; never retry 4xx.
- Response handling: HTTP 202 OR `anomaly-modal`/`challenge-form` in body →
  throw `DdgAntiBotError` (do not retry the challenge; the provider chain falls back).
- After collecting: dedupe by normalized URL (reuse the same normalization rules as
  `searxng.ts` — copy the helper, do not import from searxng), assign contiguous
  `position` 1..N after dedupe + slice to `input.limit`, validate each item with
  `webResultSchema.safeParse` (drop invalid).
- `sources` other than `"web"` are ignored (this provider serves web only; the
  chain handles the rest). Zero results → `{ results: {}, warnings: ["ddg: no results"] }`.

### 2. `tests/unit/search-ddg.test.ts`

No network. Two layers:
- **`parseDdgHtml`** against inline HTML fixtures (write them as template strings
  modeled on the real markup):
  - happy path: 3 results, one with a `uddg`-wrapped redirect, one plain href,
    one non-http (skipped) → 2 kept, entities decoded
  - anomaly page (contains `anomaly-modal`) → throws `DdgAntiBotError`
  - empty/garbage page → `[]`
- **`ddgWebSearch`** with `globalThis.fetch` mocked (follow
  `tests/unit/search-searxng.test.ts` patterns — `vi.stubGlobal("fetch", ...)`,
  default mock returns an empty results page so pagination stops):
  - GET URL + params on page 1 (q/kl/df/kp); `kp=1` when `safe:true` else `-2`
  - POST body offset math for page 2 (`s=10`) when page 1 returns < limit
  - stops early when a page adds no new results
  - 202 response → throws `DdgAntiBotError`
  - positions contiguous 1..N after dedupe (duplicate URL across pages kept once)
  - page-cap warning when limit unreachable within mock's pages

## Acceptance
`npm run lint`, `npm test`, and `npx tsc --noEmit` clean (NOTE: if 004a has not
merged yet, the 5 known pre-existing errors in `src/browser.ts`/`src/webSearch.ts`
are the ONLY permitted tsc output). Files: exactly 2 new files.

## Do NOT
- implement news/images (later task), touch `searxng.ts`/`params.ts`/`index.ts`,
  add dependencies, or use a DOM parser dependency — regex + string ops only.
