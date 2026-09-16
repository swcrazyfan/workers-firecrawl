# Spec 017 — `/v1/search` browser UA/viewport backport

Task slug: `v1-search-ua`. Branch: `feat/v2-port-017-v1-search-ua`.

## Why

`/v1/search` (`src/webSearch.ts` `performSearch`) navigates DDG with the
default headless UA and no viewport — DDG's SPA serves an empty shell to that
client, the selector wait times out, and the route 500s in production today.
`/v2`'s `browser` provider already proved the fix (spec 015): desktop
viewport + Chrome/140 UA. This backports the exact pattern so v1 works again.

## Scope

### 1. `src/search/ddgBrowser.ts` — export the proven constants

`CHROME_UA` and `DESKTOP_VIEWPORT` become exports (values unchanged — they
are the production-verified combination):

```ts
export const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
```

One source of truth: if DDG ever needs a newer UA, both v1 and v2 follow.

### 2. `src/webSearch.ts` — apply them in `performSearch`

Immediately after `browser.newPage()` and BEFORE `page.goto`:

```ts
await page.setViewport({ ...DESKTOP_VIEWPORT });
await page.setUserAgent(CHROME_UA);
```

Nothing else changes: same URL, same selectors, same timeouts, same error
envelope, `/v2` untouched.

### 3. Tests

New `tests/unit/web-search.test.ts`, following the v2-scrape mocked-browser
pattern (`vi.mock("../../src/browser")`, fake page built from `vi.fn()`s — no
puppeteer import):

- viewport 1920x1080 set and Chrome/140 UA set, both BEFORE `goto`
- results flow through: URLs from the fake page, one `extractContent` per
  URL, `success: true` with the filtered data array
- page closed, browser closed

## Acceptance

`npm run lint`, `npm test`, `npx tsc --noEmit` — fully clean.

## Do NOT

- touch `/v2` search, the provider chain, ddg fetch providers, or add
  dependencies.
