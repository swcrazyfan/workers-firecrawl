# Spec 016 — `/v2/scrape` actions array

Task slug: `scrape-actions`. Branch: `feat/v2-port-016-scrape-actions`.

## Why

`actions` is part of the v2 scrape contract (`spec/v2-openapi.json` →
`components.schemas.ScrapeOptions.properties.actions`) but is currently
accepted-and-ignored (see the comment block in `src/v2/scrape.ts`). This task
implements the subset that Browser Rendering can serve, executed AFTER page
load and BEFORE format extraction, and keeps the rest as accepted-and-warn —
same compatibility posture as unimplemented formats.

## Contract

Action objects, in execution order:

| type | fields | status |
|---|---|---|
| `wait` | `milliseconds` (int ≥1) XOR `selector` | implemented |
| `click` | `selector`, `all?: boolean` (default false) | implemented |
| `write` | `text` (types into focused element — prior `click` focus is the caller's job, per contract) | implemented |
| `press` | `key` | implemented |
| `scroll` | `direction?: "up"\|"down"` (default `"down"`), `selector?` | implemented |
| `screenshot` | `fullPage?: boolean`, `quality?: int` (unbounded, per vendored contract), `viewport?: {width,height}` | implemented → `data.actions.screenshots` |
| `pdf` | `format?/landscape?/scale?` | accepted-and-warn |
| `executeJavascript` | `script` | accepted-and-warn |
| `scrape` | — | accepted-and-warn |

`screenshot` action results are base64 strings in `data.actions.screenshots`
(array). No other action type produces response data. Warning text for the
unimplemented three mirrors the format convention:
`action <type> is not supported by this deployment` (deduped), joined into
`data.warning` with the other warnings.

## Scope

### 1. New `src/scrapeActions.ts`

No runtime puppeteer import (type-only `import type { Page }`) so unit tests
can import it without pulling Browser Rendering code.

- `scrapeActionSchema`: zod union covering every action object above, shapes
  per the vendored spec (`wait` as two variants; `pdf` fields validated).
- `ExecutableAction` = the six implemented variants; `ScrapeAction` = union
  incl. the three warned ones.
- `filterExecutableActions(actions?): { executable, warnings }` — splits a
  validated array; unknown-to-execution types produce the deduped warnings.
- `runScrapeActions(page: Page, actions: ExecutableAction[], opts?: { timeout?: number }): Promise<{ screenshots: string[] }>`:
  - `wait` ms → `page.waitForTimeout(ms)`; selector → `page.waitForSelector(sel, { timeout: opts.timeout ?? 30000 })`
  - `click` → `page.click(sel)`; `all: true` → `page.$$` then click each
    handle, zero matches is NOT an error
  - `write` → `page.keyboard.type(text)`
  - `press` → `page.keyboard.press(key)`
  - `scroll` page → `window.scrollBy(0, ±window.innerHeight)`; with selector →
    `el.scrollTop ± el.clientHeight` (evaluate)
  - `screenshot` → optional `page.setViewport(viewport)` first, then
    `page.screenshot({ encoding: "base64", fullPage: fullPage ?? false })`,
    plus `type: "jpeg", quality` ONLY when quality is set (PNG rejects quality)
  - executed strictly in array order; a throwing action rejects the runner
    (missing click target, selector timeout) — the caller decides what that
    means

### 2. `src/browser.ts` — thread actions through `extractContent`

`ExtractOptions` gains `actions?: ExecutableAction[]`. When set, run
`runScrapeActions(page, actions, { timeout })` AFTER the existing load +
popup-close + `waitFor` settle, BEFORE the title/description/content
evaluate. The return object gains `actions?: { screenshots: string[] }`,
present only when the array was non-empty and contained at least one
screenshot action. A throwing runner hits the existing catch → `null` → the
documented 500 envelope. `/v1` callers pass no `actions` → byte-identical
behavior.

### 3. `src/v2/scrape.ts` — route wiring

- Body schema: `actions: z.array(scrapeActionSchema).optional()`; invalid
  entries are a 400 like invalid formats.
- `filterExecutableActions` → pass `executable` into `extractContent`
  options; warnings join `data.warning`.
- When the request contained at least one screenshot action, set
  `data.actions = { screenshots: result.actions?.screenshots ?? [] }`;
  otherwise the `actions` key is absent.
- Response zod 200 data gains
  `actions: z.object({ screenshots: z.string().array() }).optional()`.
- Update the accepted-and-ignored comment block (actions moves out of it).

### 4. Tests

New `tests/unit/scrape-actions.test.ts` — fake page built from `vi.fn()`s
(cast `as unknown as Page`), no puppeteer import:

- each action type maps to the right page calls (incl. defaults: scroll down,
  click not-all, screenshot not-fullPage/png)
- `all` click: every handle clicked, `page.click` untouched, zero matches OK
- screenshot: viewport set first, jpeg+quality only with quality, base64
  string pushed in order, multiple screenshots keep order
- selector wait uses threaded timeout, default 30000
- runner propagates a throwing `waitForSelector`
- `filterExecutableActions`: split + deduped warnings + empty input

Extend `tests/unit/v2-scrape.test.ts` (existing mocked-browser patterns):

- executable actions reach `extractContent` options verbatim; warned types do not
- `data.actions.screenshots` mapped from the extraction result; `[]` fallback
  when the mock returns none; key absent without screenshot actions
- unimplemented action warning lands in `data.warning`, joined with others
- 400 for `{type:"nope"}` and for `{type:"wait"}` (neither ms nor selector)
- `/v1/scrape` unaffected (routing test already covers both routes)

## Acceptance

`npm run lint`, `npm test`, `npx tsc --noEmit` — fully clean (577 baseline +
new tests).

## Do NOT

- implement `pdf`/`executeJavascript`/`scrape` result payloads, touch
  `/v1/*` route files, `ddg*`/provider code, add dependencies, or change the
  crawl workflow's scrapeOptions handling.
