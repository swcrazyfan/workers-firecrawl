# Spec 007 (rev 2) — DDG vqd media provider (news + images), self-contained

Task slug: `ddg-vqd-media`. Branch: `feat/v2-port-007-ddg-vqd-media` (existing PR #7 —
this REVISES it).
Depends on (merged): `src/search/params.ts` (`mapTbs`, `klFrom`), `src/search/types.ts`.

## Rev-2 corrections (these supersede rev 1 — the code currently follows rev 1)

1. **`p` is the SAFESEARCH code, not the page number.** Page offsets are carried ONLY by `s`.
   Per-endpoint values (from the `ddgs` reference, authoritative):
   - `news.js`: on/strict `1`, moderate `-1`, off `-2`
   - `i.js`:    on/strict `1`, moderate `1`,  off `-1`
   Mapping of `input.safe`: `true → on`, `false → off`, `undefined → moderate`.
   Never send `p=<page>`.
2. **Keep partial results on a later-page failure.** If page 1 yields items and page 2
   returns 403 or a network/parse error, return the page-1 items plus the warning —
   never discard `collected`. (Rev 1 said "keep partials"; the implementation dropped them.)
3. **Cap the vqd page body** before regexing it: bail at `> 1_000_000` chars (same guard as
   `ddg.ts:MAX_HTML_BYTES`), throwing `DdgVqdError("page too large")`.
4. **Add the single-quoted vqd form** as a third fallback: `vqd='([^']+)'`.
5. **Send `Referer: https://duckduckgo.com/`** on the `news.js` / `i.js` requests
   (plausible 403 mitigation; harmless if not).
6. **Honor `input.lang`** for the vqd page's `Accept-Language` (currently hardcoded `en`) —
   thread `lang` into `extractVqd` (add a param; it is exported, so update its signature
   to `extractVqd(query, kl, lang?)`).

## Why
No SearXNG. News/images come from DDG's own JSON endpoints, which require a session
`vqd` token scraped from the search page:

1. `GET https://duckduckgo.com/?q=<urlencoded>&kl=<kl>` → regex the token:
   `vqd="([^"]+)"`, else `vqd=([0-9-]+)&`, else `vqd='([^']+)'`.
2. News: `GET https://duckduckgo.com/news.js` with
   `l=<kl>, o=json, noamp=1, q=<query>, vqd=<token>, p=<safesearch>, df=<df>, s=<(page-1)*30>`
3. Images: `GET https://duckduckgo.com/i.js` with
   `o=json, q=<query>, l=<kl>, vqd=<token>, p=<safesearch>, f=<filters>, s=<(page-1)*100>, ct=AT`

Response shapes: news `results[]` = `{ date, title, excerpt, url, image, source }`;
images `results[]` = `{ title, image, thumbnail, url, height, width, source }`.

Known risk (accepted): these endpoints 403 bot-flagged sessions and Workers egress
reputation is untested. This provider fails SOFTLY — web search never depends on it.
Live verification happens at preview-deploy time, not in tests.

## Scope — files

### `src/search/ddgMedia.ts`
```ts
export class DdgVqdError extends Error { constructor(reason: string) { super(`ddg-vqd: ${reason}`); } }
export async function extractVqd(query: string, kl: string, lang?: string): Promise<string>
export async function ddgMediaSearch(input: SearchInput, env: Env): Promise<SearchOutcome>
```
- Serves ONLY `"news"` and `"images"` from `input.sources` (ignores `"web"`).
  One shared `extractVqd`; news + images via `Promise.allSettled` (per-source fail-soft).
- Mapping → `NewsResult` `{ url, title, snippet: excerpt ?? "", date ?? undefined,
  imageUrl: image ?? undefined, position }`; → `ImageResult` `{ imageUrl: image,
  url: url !== image ? url : undefined, title, imageWidth, imageHeight, position }`.
  Accept numeric strings for width/height (coerce; keep the existing `asInt` behavior).
- Filter non-http(s)/missing-image, dedupe by `normalizeUrlKey` (copy the helper),
  contiguous positions 1..N after dedupe + slice to `limit`, validate with the zod schemas.
- Pagination: `s = (page-1)*30` news / `(page-1)*100` images; `MAX_PAGES = 3` per source;
  400ms inter-page sleep; stop early when a page adds nothing post-dedupe.
  `df` from `mapTbs` (news only); images `f=time:Day|Week|Month|Year` from `mapTbs().timeRange`
  (capitalize; omit when absent). `q` via `buildDomainQuery`; `kl` via `klFrom`.
- Errors: 403 → per-source warning `ddg-media <source>: 403 blocked`, STOP that source,
  **keep partials**; `DdgVqdError` → warning `ddg-media: <reason>` for both sources and
  return whatever partials exist; never throw out for HTTP-level failures.
- Usable results empty across both sources → append `ddg-media: no results` to warnings.

### `tests/unit/search-ddg-media.test.ts`
Update/extend (mock `globalThis.fetch`, inline fixtures, default mock = empty JSON page):
- `p` correctness per endpoint: news `p=1` when `safe:true`, `-1` when unset, `-2` when
  `safe:false`; images `1` / `1` / `-1`. Assert page 2 keeps the same `p` and uses `s=30`/`s=100`.
- partial retention: page 1 returns 2 items, page 2 → 403 ⇒ 2 items returned AND warning present
- 403 on `news.js` (in addition to the existing `i.js` case)
- vqd single-quoted form; `>1MB` page → `DdgVqdError("page too large")`
- `Referer` header present on news.js/i.js requests; `Accept-Language` follows `input.lang`
- keep all rev-1 cases (dedupe, positions, cap, mapping, offset math)

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — all FULLY clean. Exactly 2 files in the PR.

## Do NOT
- implement web results, touch other search files or `src/index.ts`, add dependencies,
  or make real network calls in tests
