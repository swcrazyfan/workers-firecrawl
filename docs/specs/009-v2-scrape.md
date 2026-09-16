# Spec 009 — `/v2/scrape` with v2 format objects

Task slug: `v2-scrape`. Branch: `feat/v2-port-009-v2-scrape`.

## Why
v2 changed `formats` from plain strings to a list of strings and/or typed objects
(`{type:"screenshot",fullPage:true}`, `{type:"json",schema,prompt}`, `{type:"summary"}`),
and `screenshot@fullPage` (a v1 string) is gone. The AI-backed formats (`json`, `summary`)
land in the AI task (010); this task implements everything else and leaves an explicit,
tested warning path for the AI ones.

## Scope

### 1. NEW `src/v2/scrape.ts`
```ts
export class V2Scrape extends OpenAPIRoute { schema = {...}; async handle(c: AppContext) {...} }
```

Request (zod) — a focused subset of the contract, with everything else enumerated as
accepted-and-ignored in a code comment:
- `url: z.string()` (required)
- `formats: z.array(z.union([ z.enum(["markdown","html","rawHtml","links","screenshot","summary"]), z.object({ type: z.literal("screenshot"), fullPage: z.boolean().optional(), quality: z.number().int().min(1).max(100).optional() }), z.object({ type: z.literal("json"), schema: z.unknown().optional(), prompt: z.string().optional() }), z.object({ type: z.literal("summary") }) ])).default(["markdown"]).optional()`
- `onlyMainContent: z.boolean().default(true).optional()`
- `waitFor: z.number().default(0).optional()`, `timeout: z.number().optional()`
- `headers: z.record(z.string()).optional()`
- `includeTags: z.string().array().optional()`, `excludeTags: z.string().array().optional()`
- `mobile: z.boolean().optional()`, `removeBase64Images: z.boolean().optional()`, `blockAds: z.boolean().optional()`
- Accepted-and-ignored (comment + PR body): `actions`, `location`, `proxy`, `maxAge`,
  `minAge`, `storeInCache`, `parsers`, `profile`, `lockdown`, `redactPII`, `zeroDataRetention`,
  `threatProtection`, `auditMetadata`, `skipTlsVerification`.

Format normalization (pure helper, exported for tests):
```ts
export function normalizeFormats(input: unknown[]): { strings: string[]; screenshotFullPage: boolean; wantsJson: {schema?: unknown; prompt?: string} | null; wantsSummary: boolean; warnings: string[] }
```
- `"screenshot@fullPage"` → map to `screenshotFullPage: true` + warning
  `"screenshot@fullPage is v1; use {type:'screenshot',fullPage:true}"` (accept it, don't reject).
- `{type:"screenshot", fullPage:true}` → `screenshotFullPage: true`.
- `{type:"json", ...}` → `wantsJson` payload; `{type:"summary"}` → `wantsSummary: true`.
- Dedupe repeated formats; unknown strings/objects → 400 (chanfana validation handles the enum;
  the helper additionally guards runtime input).

Response 200:
```ts
{ success: z.literal(true), data: z.object({
    markdown: z.string().optional(), html: z.string().optional(), rawHtml: z.string().optional(),
    links: z.string().array().optional(), screenshot: z.string().nullable().optional(),
    summary: z.string().optional(), json: z.unknown().optional(),
    metadata: z.object({ title: z.string(), description: z.string(), sourceURL: z.string(), statusCode: z.number().int(), error: z.string().nullable(), language: z.string().optional(), keywords: z.string().optional() }),
  }), warning: z.string().optional() }
```
Error: 500 `{ success: z.literal(false), error: z.string() }`; 400 via chanfana.

Behaviour:
- Reuse the existing scrape pipeline: `getBrowser(env.BROWSER)` + `extractContent` from
  `src/browser.ts` (same as `src/scrape.ts`) — do NOT duplicate the extraction logic.
- Map normalized formats onto what `extractContent` accepts. `screenshotFullPage` must
  produce a full-page screenshot (same mechanism `screenshot@fullPage` used in `src/scrape.ts` —
  read that file and reuse its approach).
- `wantsJson` / `wantsSummary` → for now: omit the data key and append warning
  `"<format> format requires AI configuration (not yet available)"`. (Task 010 replaces this.)
- Close the browser in `finally` (never leak).
- `onlyMainContent` default true must match the contract default (`true`) — the underlying
  `extractContent` has different defaults; be explicit.

### 2. `src/index.ts`
`import { V2Scrape } from "./v2/scrape";` + `openapi.post("/v2/scrape", V2Scrape);`. Nothing else.

### 3. NEW `tests/unit/v2-scrape.test.ts`
Mock `../../src/browser` (no puppeteer). Cases:
- `normalizeFormats` unit tests: string-only, object screenshot (fullPage true/false),
  `screenshot@fullPage` legacy string → warning + fullPage, dedupe, json payload capture,
  summary flag, unknown input → 400.
- route: default formats `["markdown"]`; multi-format response keys; object screenshot
  fullPage equivalence vs the legacy string; `wantsJson`/`wantsSummary` → key absent +
  warning present (and the browser/extract call still happened); `onlyMainContent` default
  true passed through; 400 on bad format object (`{type:"nope"}`); 500 when extraction
  throws; response `links` is a string array (v1 regression guard); metadata shape.
- routing: `/v2/scrape` registered alongside `/v1/scrape` (mocked v1 modules, pattern from
  `tests/unit/v2-search.test.ts`).

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — FULLY clean. `/v1/scrape` tests unchanged.

## Do NOT
- touch `/v1/scrape` or `src/scrape.ts` behaviour, implement AI extraction (task 010),
  implement `actions`, or add dependencies

## Amendments (post-review, authoritative)

1. **`warning` goes INSIDE `data`** for scrape (`data.warning`, nullable) per
   `spec/v2-openapi.json` — NOT top-level. (Top-level `warning` is correct for
   `/v2/search`; the two contracts differ.)
2. **Unimplemented formats are accept-and-warn, not 400** (SDK compatibility):
   `images`, `rawBase64`, `changeTracking`, `branding`, `product`, `menu`, `audio`, `video`,
   `question`, `highlights` → do not fetch them; add warning
   `"format <type> is not supported by this deployment"`.
   Also accept object forms of the SUPPORTED formats (`{type:"markdown"}` etc.) as equivalent
   to their string form.
3. **`{type:"screenshot",quality:N}` and `viewport`**: accepted, applied on a best-effort basis,
   and when the pipeline cannot honour them emit
   `"screenshot quality/viewport options are ignored"`.
4. **`timeout`**: `z.number().int().min(1000).max(300000).default(60000)` — pass it to the
   extraction pipeline (do not leave it unused).
5. **`url`**: `z.string().url()` (contract `format: uri`).
6. Wrap browser acquisition so a launch failure returns the 500 envelope
   `{success:false,error}` instead of an unhandled Hono error.
