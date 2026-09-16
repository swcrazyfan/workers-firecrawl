# Spec 015 — News via Browser Rendering fallback

Task slug: `browser-news`. Branch: `feat/v2-port-015-browser-news`.

## Why
Production verified: `ddg-media` (news.js fetch) is intermittently 403-throttled per egress
IP, and when it fails the news source has no fallback → 503. The DDG SPA **news tab renders
correctly under Browser Rendering** (verified in production research: news results are
`li > article` elements with direct article URLs and relative timestamps). This task gives the
existing `browser` provider a `news` capability so the chain falls back to it automatically.

## Scope

### 1. `src/search/ddgBrowser.ts` — add a news path
The module currently serves `web` only. Extend:

```ts
export async function ddgBrowserSearch(input: SearchInput, env: Env): Promise<SearchOutcome>
```
now serves `"web"` AND `"news"` from `input.sources` (images remain unsupported →
warning `browser fallback does not support source images` only if images was requested):

- Same browser lifecycle as the web path: `getBrowser`, ONE page per source, viewport
  1920x1080 + the Chrome/140 UA (the legacy-proven combination — without it DDG serves an
  empty shell), browser closed in `finally`.
- News navigation: `https://duckduckgo.com/?q=<buildDomainQuery>&kl=<klFrom>&iar=news&ia=news`
  (+ `&df=` from `mapTbs` when present, `&kp=` same mapping as the web path).
- Wait for news article elements. Keep selectors in ONE exported constant so production
  drift is a one-line fix:
  ```ts
  export const DDG_NEWS_SELECTORS = {
    article: "article",
    link: "article a[href]",
    image: "article img[src]",
  } as const;
  ```
  Wait for `article` with the same 10s timeout + swallow-to-empty semantics as the web path.
- Extraction (in `page.evaluate`, passed the selectors): for each `article` element take the
  FIRST `a[href]` as the story URL (absolute after rendering), its `innerText` as title;
  snippet = the article's text content minus the title line, trimmed and capped at 300 chars;
  timestamp: match `/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i` anywhere in
  the article text and convert to an ISO date-time relative to `Date.now()` (round to the
  unit; omit when absent); image: first `img[src]` if absolute http(s).
- Map to `NewsResult`: `{ url, title, snippet, date?, imageUrl?, position }`. Filter
  non-http(s) URLs, dedupe by the module's `normalizeUrlKey`, contiguous positions 1..N after
  dedupe + slice to `limit`, validate with `newsResultSchema.safeParse` (drop invalid).
- Both sources requested: run web and news pages sequentially in the SAME browser session
  (launch once), then close. Return combined `{ web?, news? }` + accumulated warnings
  (`ddg-browser: no results` per empty source).
- Zero results for a requested source keeps the existing per-source warning semantics.

### 2. `src/search/provider.ts` — capability update
`browser` capabilities: `["web"]` → `["web", "news"]`. Nothing else changes: the chain order
already places `browser` last, so news resolution becomes `ddg-media` → `browser`.

### 3. Tests
Update `tests/unit/search-provider.test.ts`: browser is now servable for news (the existing
"fallback does not support source news" cases change meaning — news IS supported now; images
is the remaining unsupported one). New cases:
- news source with `SEARCH_CHAIN` default: ddg-media fails (mock throw) → browser called with
  `sources:["news"]` → news results returned
- `SEARCH_CHAIN=browser` + news → browser only, no ddg-media call
Extend `tests/unit/search-ddg-browser.test.ts`:
- news navigation URL includes `iar=news&ia=news`, `kl`, `df` when tbs set
- article extraction from a realistic fixture (`li > article` with title link, relative
  timestamp, image): title/url/snippet/date-ISO/imageUrl mapped
- "41 minutes ago" → ISO ≈ now-41min (fake timers or tolerance window)
- no-timestamp article → `date` omitted
- dedupe + contiguous positions + limit slice on news items
- both web+news: one browser launch, two pages, closed once
- images source → unsupported warning, no news/web work for it

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — FULLY clean (560 baseline).

## Do NOT
- implement images, touch `ddgMedia.ts`/`ddg.ts`, add dependencies, or change the chain order
