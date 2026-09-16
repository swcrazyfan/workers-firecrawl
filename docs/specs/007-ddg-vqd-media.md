# Spec 007 — DDG vqd media provider (news + images), self-contained

Task slug: `ddg-vqd-media`. Branch: `feat/v2-port-007-ddg-vqd-media`.
Depends on (merged): `src/search/params.ts` (`mapTbs`, `klFrom`), `src/search/types.ts`.
Parallel task 005 (provider chain) imports this module — exact contract below.

## Why
With SearXNG dropped, news/images come from DDG's own JSON endpoints. These require a
session `vqd` token scraped from the search page (the flow used by the `ddgs` library):

1. `GET https://duckduckgo.com/?q=<urlencoded>&kl=<kl>` → regex `vqd="([^"]+)"` (fall
   back to `vqd=([0-9-]+)&` if the quoted form is absent) from the HTML.
2. News: `GET https://duckduckgo.com/news.js` with params
   `l=<kl>, o=json, noamp=1, q=<query>, vqd=<token>, p=<page>, df=<df>, s=<(page-1)*30>`
3. Images: `GET https://duckduckgo.com/i.js` with params
   `o=json, q=<query>, l=<kl>, vqd=<token>, p=<page>, f=<filters>, s=<(page-1)*100>, ct=AT`

Response shapes (from the `ddgs` reference implementation):
- news.js `results[]`: `{ date, title, excerpt, url, image, source }`
- i.js `results[]`: `{ title, image, thumbnail, url, height, width, source }`

Known risk (accepted): these endpoints 403 sessions DDG considers bot-flagged, and
Workers egress reputation is untested. This provider must therefore fail SOFTLY:
errors become warnings; web search must never depend on it. Verification of live
behavior happens at preview-deploy time, not in tests.

## Scope — create EXACTLY these files

### 1. `src/search/ddgMedia.ts`

```ts
export async function extractVqd(query: string, kl: string): Promise<string>   // throws DdgVqdError on failure
export class DdgVqdError extends Error { constructor(reason: string) { super(`ddg-vqd: ${reason}`); } }
export async function ddgMediaSearch(input: SearchInput, env: Env): Promise<SearchOutcome>
```

- `extractVqd`: GET the search page with the same UA/header set as `ddg.ts` uses
  (pool + Accept/Accept-Language), `AbortSignal.timeout(10000)`, retry ONCE on
  network/5xx only. No `vqd` match in body → throw `DdgVqdError("token not found")`.
- `ddgMediaSearch` serves ONLY the `"news"` and `"images"` entries of `input.sources`
  (ignore `"web"`). One shared `extractVqd` call; news and images then run via
  `Promise.allSettled` (per-source fail-soft).
- News mapping → `NewsResult`: `{ url, title, snippet: excerpt ?? "", date: date ?? undefined,
  imageUrl: image ?? undefined, position }`. Images mapping → `ImageResult`:
  `{ imageUrl: image, url: url !== image ? url : undefined, title, imageWidth: width,
  imageHeight: height, position }`. Filter non-http(s) urls / missing `image`,
  dedupe by `normalizeUrlKey` (copy the helper), positions contiguous 1..N after
  dedupe + slice to `limit`, validate with `newsResultSchema` / `imageResultSchema`.
- Pagination: `p` starts at 1; fetch next page while collected (post-dedupe) < limit,
  cap `MAX_PAGES = 3` per source; 400ms sleep between pages. Stop early on a page
  that adds nothing.
- `df` from `mapTbs` when present (news only). Images time filter: map via
  `f=time:Day|Week|Month|Year` from `mapTbs().timeRange` (capitalize; absent → omit).
- `q` uses `buildDomainQuery`. `kl` from `klFrom`.
- 403 from news.js/i.js → per-source warning `ddg-media news: 403 blocked` and stop
  that source (keep partials). `DdgVqdError` → BOTH sources get warning
  `ddg-media: <reason>`; return whatever partials exist (usually none) — the provider
  chain decides fallback messaging. Never throw out of `ddgMediaSearch` for HTTP-level
  failures; only propagate unexpected programming errors.
- Zero usable results overall → `{ results: {}, warnings: ["ddg-media: no results"] }`.

### 2. `tests/unit/search-ddg-media.test.ts`

Mocked `globalThis.fetch` (searxng/ddg test patterns; default mock returns an empty
JSON page so pagination stops). Fixture bodies inline. Cases:
- vqd extraction: quoted form, fallback unquoted form, absent → `DdgVqdError`
- news mapping incl. date/imageUrl/position; images mapping incl. width/height and
  `url !== image` distinction
- request param correctness: news.js gets `o=json&vqd=...&s=0` on page 1 and
  `s=30` on page 2; i.js page 2 `s=100`; `df` on news when `tbs=qdr:w`;
  images `f=time:Week` when `tbs=qdr:w`
- 403 on i.js → images warning, news still returned
- vqd failure → both-source warnings, no throw
- dedupe + contiguous positions across pages
- page cap: stops at 3 pages per source

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — all FULLY clean. Exactly 2 new files.

## Do NOT
- implement web results, touch other search files or `src/index.ts`, add dependencies,
  or make real network calls in tests
