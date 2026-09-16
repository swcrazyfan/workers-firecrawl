# Spec 013 — Crawl auxiliary endpoints

Task slug: `crawl-extras`. Branch: `feat/v2-port-013-crawl-extras`.
Depends on (merged): `src/crawler/store.ts`, `src/v2/crawlStatus.ts` (patterns), `src/index.ts`.

## Why
The v2 crawl contract defines three more endpoints beyond POST/GET/DELETE:
`GET /crawl/{id}/errors`, `GET /crawl/active`, `POST /crawl/params-preview`. This closes the
crawl surface so SDK clients that use them do not 404.

## Scope

### 1. `src/crawler/store.ts` — add two read helpers
```ts
export async function listJobErrors(db: D1Database, jobId: string, limit?: number): Promise<{ errors: { id: number; timestamp: number; url: string; error: string }[]; robotsBlocked: string[] }>
export async function listActiveJobs(db: D1Database, now: number, limit?: number): Promise<{ id: string; url: string; status: string; total: number; completed: number; created_at: number }[]>
```
- `listJobErrors`: `errors` = `crawl_results` rows for the job with `status='failed'` and a non-null
  `error` (id, created_at as timestamp, url, error), newest first, capped (default 100).
  `robotsBlocked` = distinct URLs whose recorded error is the robots reason
  (`error = 'robots.txt disallowed'`), also capped. Both bound-only SQL, defensive JSON-free.
- `listActiveJobs`: jobs with `status='scraping'` and `expires_at > now`, oldest first, capped
  (default 100).

### 2. NEW `src/v2/crawlExtras.ts`
```ts
export class V2CrawlErrors extends OpenAPIRoute { ... }   // GET /v2/crawl/:id/errors
export class V2CrawlActive extends OpenAPIRoute { ... }   // GET /v2/crawl/active
export class V2CrawlParamsPreview extends OpenAPIRoute { ... } // POST /v2/crawl/params-preview
```
- **errors**: 404 `{success:false,error:"crawl job not found"}` when the job id is unknown
  (job lookup first, so an unknown id does not return an empty list); otherwise
  `200 { success: true, errors: [{id, timestamp: <ISO date-time string>, url, error}], robotsBlocked: string[] }`.
  `timestamp` is an ISO string at the response boundary (matching the PR #14 timestamp decision).
- **active**: `200 { success: true, crawls: [{id, url, status, total, completed, createdAt: <ISO>}] }`.
  `status` is the crawl status enum; use the same pagination-free cap as the store helper.
- **params-preview**: `POST` with the SAME request schema as `POST /v2/crawl` (import it —
  export the schema from `src/v2/crawl.ts` if it is not already exported; that is the only allowed
  change to that file). Behaviour: validate the body, resolve the defaults the crawl engine would
  use, and return `200 { success: true, data: { url, limit, maxDiscoveryDepth, allowExternalLinks,
  allowSubdomains, includePaths, excludePaths, ignoreRobotsTxt, sitemap, scrapeFormats,
  ignoredFields: string[] }, warning?: "params-preview does not verify reachability" }`.
  It must NOT create a job, enqueue anything, or call the workflow. Document that it is a pure
  preview of resolved parameters.
- All three: validate path/query inputs with zod; follow the repo's chanfana conventions and the
  `Env`/`AppContext` typing already used in `src/v2/crawlStatus.ts`.

### 3. `src/index.ts`
Register:
`openapi.get("/v2/crawl/:id/errors", V2CrawlErrors)`,
`openapi.get("/v2/crawl/active", V2CrawlActive)`,
`openapi.post("/v2/crawl/params-preview", V2CrawlParamsPreview)`.
**Route-order note**: `/v2/crawl/active` and `/v2/crawl/params-preview` are literal segments; the
existing `/v2/crawl/:id` route is registered before them, so verify with a test that
`GET /v2/crawl/active` is NOT swallowed by `:id` (if it is, reorder registrations so literal
paths come first — that reordering is permitted and should be noted in the PR body).

### 4. Tests — NEW `tests/unit/v2-crawl-extras.test.ts`
Real local D1 binding (same pattern as `tests/unit/v2-crawl.test.ts`):
- errors: unknown job → 404; job with mixed results → only `status='failed'` rows with errors,
  ISO timestamps, newest first, cap respected; robots-disallowed rows appear in BOTH `errors` and
  `robotsBlocked` (document/assert the intended overlap); no failed rows → empty arrays with 200.
- active: only `status='scraping'` jobs; expired jobs excluded; ISO `createdAt`; cap.
- params-preview: defaults resolved (limit 10000, sitemap `include`, etc.); supplied values echoed;
  `ignoredFields` lists the accepted-and-ignored request fields; **no job row created and the
  workflow binding never called** (assert both); invalid body → 400; warning present.
- routing: `GET /v2/crawl/active` reaches the active handler (not `:id`) — assert a distinguishing
  field; same for `/v2/crawl/:id/errors` vs `/v2/crawl/:id`.

## Acceptance
`npm run lint`, `npm test` (538 baseline + new), `npx tsc --noEmit` — FULLY clean.
No new dependencies.

## Do NOT
- create jobs/enqueue from params-preview, change `POST /v2/crawl` behaviour, add per-page webhook
  events, or touch the engine/search/AI modules
