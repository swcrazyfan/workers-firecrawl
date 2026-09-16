# Spec 006 — `/v2/search` route

Task slug: `v2-search-route`. Branch: `feat/v2-port-006-v2-search-route`.
Depends on: `src/search/provider.ts` (`searchWithFallback`, `SearchUnavailableError`)
— being built in parallel under spec 005. Program against those exact exports; if
`provider.ts` is missing from your branch, create a minimal stub matching spec 005's
signatures and flag it in the PR body.

## Why
The v2 search endpoint with the grouped response envelope. This is the contract the
official Firecrawl SDK expects: `POST /v2/search` → `{success, data:{web,news,images}}`
— NEVER a flat array (that's v1).

## Scope — create/modify EXACTLY these files

### 1. `src/v2/search.ts`

```ts
export class V2Search extends OpenAPIRoute { schema = {...}; async handle(c: AppContext) {...} }
```

Follow the patterns in `src/scrape.ts` / `src/webSearch.ts` (chanfana `OpenAPIRoute`,
zod schemas inline, `contentJson` responses, tabs).

Request schema (zod):
- `query: z.string()` (required)
- `limit: z.number().int().min(1).max(100).default(10)`
- `sources: z.enum(["web","news","images"]).array().default(["web"])`
- `tbs: z.string().optional()`, `lang: z.string().default("en").optional()`,
  `country: z.string().optional()`, `location: z.string().optional()`,
  `safe: z.boolean().optional()`
- `includeDomains: z.string().array().optional()`, `excludeDomains: z.string().array().optional()`
  — add a `.refine` on the body object: mutually exclusive (400 when both non-empty)
- `timeout: z.number().default(60000).optional()`, `ignoreInvalidURLs: z.boolean().default(false).optional()`
  (accepted; `timeout` bounds nothing extra today — note in code comment)

Response schemas:
- 200: `{ success: z.literal(true), data: z.object({ web: webResultSchema.array().optional(), news: newsResultSchema.array().optional(), images: imageResultSchema.array().optional() }), warning: z.string().optional() }`
  (import the result schemas from `src/search/types.ts`)
- 503: `{ success: z.literal(false), error: z.string(), details: z.string().optional() }`

`handle`:
1. Validate; on validation error return chanfana's 400 flow (match how `src/scrape.ts` handles it).
2. Call `searchWithFallback({...body}, c.env)` inside try/catch.
3. `SearchUnavailableError` → `503 { success:false, error: "Search backend unavailable", details: <joined provider reasons> }`.
4. Success → `200 { success:true, data: outcome.results, ...(outcome.warnings.length ? { warning: outcome.warnings.join("; ") } : {}) }`.
   Omit empty source keys (never emit `"web": []`).

### 2. `src/index.ts` — minimal diff

Add `import { V2Search } from "./v2/search";` and register
`openapi.post("/v2/search", V2Search);` next to the `/v1` routes. Nothing else.

### 3. `tests/unit/v2-search.test.ts`

Follow the stub conventions of `tests/unit/search-validation.test.ts` and `routing.test.ts`
(stub the endpoint's dependencies — `vi.mock("../../src/search/provider")` returning
controlled outcomes; no real network/browser):
- 200 envelope: `data` is an OBJECT with `web` array (flat-array regression guard — assert
  `Array.isArray(body.data) === false` and `Array.isArray(body.data.web)`)
- default `limit` 10 / custom limit passthrough to the provider input
- `limit: 101` → 400; invalid `sources` value → 400; `includeDomains`+`excludeDomains` → 400
- warnings joined into single `warning` string; empty warnings → no `warning` key
- empty source arrays omitted from `data`
- `SearchUnavailableError` → 503 with `success:false` and `details`
- routing: `POST /v2/search` registered alongside `/v1/search` (extend the pattern in
  `routing.test.ts` if it asserts the route table)

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — all FULLY clean. Files: 1 new route file,
1 new test file, 1 minimal `src/index.ts` diff.

## Do NOT
- implement scrapeOptions (explicitly out of scope — later task)
- touch `/v1/search` behavior, `src/webSearch.ts`, or the search provider modules

## Amendments (post-review, authoritative)

1. **`sources` accepts BOTH forms**: `"web"|"news"|"images"` strings AND objects
   `{type:"web"|"news"|"images"}` (the vendor SDK sends the object form; rejecting it is a
   contract violation). Extract `type`; per-source `location`/`tbs` are accepted-and-ignored
   (note in PR body).
2. **`query` max length 500** (`z.string().max(500)`) — contract fidelity.
3. **`ignoreInvalidURLs` semantics**: providers always drop non-http/unparseable result URLs,
   so this route always behaves as `ignoreInvalidURLs:true`. When the caller explicitly sends
   `false`, add a warning: `ignoreInvalidURLs:false is not supported; invalid URLs are always skipped`.
4. **Status 503 for `SearchUnavailableError` is an intentional contract amendment** (the
   vendor spec lists only 200/408/500). Document it in the PR body.
5. **Accepted-and-ignored contract fields** (must be enumerated in a code comment + PR body,
   NOT silently forgotten): `categories`, `highlights`, `enterprise`, `threatProtection`,
   `domainTools`, `integration`, `origin`, and `scrapeOptions` (scrapeOptions is a separate
   future task; the rest are Cloud-only features).
6. Do not use `.default(x).optional()` (the `.optional()` makes the default dead) — either
   `.default(x)` or `.optional()`.
