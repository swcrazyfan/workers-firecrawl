# Spec 011 — Crawl storage (D1) + crawl endpoints

Task slug: `crawl-core`. Branch: `feat/v2-port-011-crawl-core`.
Depends on (merged): `src/v2/scrape.ts` (reuse its format normalization/`extractContent` wiring),
`src/crawler/sitemap.ts`, `src/search/params.ts` (domain-query/param helpers if needed).

## Why
Crawl needs durable state. Per the plan: **D1 for storage, Cloudflare Workflows for the loop**
(no Durable Object). This task lands the storage layer and the three HTTP endpoints; the Workflow
engine itself is task 012, so the enqueue call must degrade gracefully when the binding is absent.

## Known infrastructure (already provisioned in the user's account)
- D1 database: name `workers-firecrawl`, id `637dfc08-e6e8-490f-ba9c-8c452168709f` (currently 0 tables).

## Scope

### 1. NEW `migrations/0001_crawl.sql`
```sql
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scraping',
  options TEXT, error TEXT, total INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS crawl_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
  UNIQUE(job_id, url)
);
CREATE TABLE IF NOT EXISTS crawl_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, url TEXT NOT NULL,
  status TEXT NOT NULL, status_code INTEGER, markdown TEXT, html TEXT, raw_html TEXT,
  links TEXT, metadata TEXT, json TEXT, error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_job_status ON crawl_queue(job_id, status);
CREATE INDEX IF NOT EXISTS idx_crawl_results_job_id ON crawl_results(job_id, id);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_expires ON crawl_jobs(expires_at);
```
(Timestamps = epoch milliseconds. `json` column stores JSON-mode extraction output.)

### 2. NEW `src/crawler/store.ts`
Pure D1 access layer — every function takes `db: D1Database` first so it is testable against the
real local D1 in tests:
```ts
export type CrawlStatus = "scraping" | "completed" | "failed" | "cancelled";
export interface CrawlJobRow { id: string; url: string; status: CrawlStatus; total: number; completed: number; error: string | null; created_at: number; updated_at: number; expires_at: number; completed_at: number | null }
export async function createJob(db: D1Database, row: { id: string; url: string; options: unknown; now: number; expiresAt: number }): Promise<void>
export async function getJob(db: D1Database, id: string): Promise<CrawlJobRow | null>
export async function setJobStatus(db: D1Database, id: string, status: CrawlStatus, patch?: { error?: string | null; completedAt?: number | null }): Promise<void>
export async function bumpJobCounters(db: D1Database, id: string, patch: { total?: number; completed?: number; now: number }): Promise<void>   // additive increments, single statement
export async function enqueueUrls(db: D1Database, jobId: string, urls: { url: string; depth: number }[], now: number): Promise<number>        // INSERT OR IGNORE, returns inserted count
export async function claimNextBatch(db: D1Database, jobId: string, limit: number): Promise<{ id: number; url: string; depth: number }[]>    // atomically flip pending→processing and return the batch
export async function markQueueItem(db: D1Database, id: number, status: "done" | "failed"): Promise<void>
export async function pendingQueueCount(db: D1Database, jobId: string): Promise<number>
export async function insertResult(db: D1Database, row: { jobId: string; url: string; status: string; statusCode?: number | null; markdown?: string | null; html?: string | null; rawHtml?: string | null; links?: unknown; metadata?: unknown; json?: unknown; error?: string | null; now: number }): Promise<void>
export async function listResults(db: D1Database, jobId: string, opts: { afterId?: number; limit: number }): Promise<{ id: number; url: string; status: string; status_code: number | null; markdown: string | null; html: string | null; raw_html: string | null; links: string[] | null; metadata: unknown; json: unknown; error: string | null }[]>
export async function purgeExpired(db: D1Database, now: number, keepSeconds: number): Promise<void>   // delete jobs+queue+results older than the retention window
```
- `claimNextBatch` must be safe against concurrent callers: use a single atomic statement
  (`UPDATE crawl_queue SET status='processing' WHERE id IN (SELECT id FROM crawl_queue WHERE job_id=? AND status='pending' ORDER BY id LIMIT ?) RETURNING id, url, depth`).
  `RETURNING` is supported by D1 — verify in tests; if it misbehaves, fall back to a
  transaction-style claim with a status guard.
- Never interpolate values into SQL — always `.bind()`.
- Parse JSON columns defensively (invalid JSON → null, never throw).

### 3. NEW `src/v2/crawl.ts` — `POST /v2/crawl`
Request (zod):
- `url: z.string().url()` (required)
- `limit: z.number().int().min(1).max(100000).default(10000).optional()`
- `maxDiscoveryDepth: z.number().int().min(0).max(10).optional()`
- `allowExternalLinks: z.boolean().default(false).optional()`, `allowSubdomains: z.boolean().default(false).optional()`
- `includePaths: z.string().array().optional()`, `excludePaths: z.string().array().optional()`
- `ignoreRobotsTxt: z.boolean().default(false).optional()`
- `sitemap: z.enum(["skip","include","only"]).default("include").optional()`
- `scrapeOptions: z.object({ formats: <reuse the v2 scrape format union from src/v2/scrape.ts — export it if needed> }).optional()`
- `webhook: z.string().url().optional()`
- Accepted-and-ignored (document in code + warn): `crawlEntireDomain`, `delay`, `maxConcurrency`,
  `regexOnFullURL`, `robotsUserAgent`, `zeroDataRetention`, `prompt`, `excludeTags`, `includeTags`.

Behaviour:
- Job id: `crawl_<epochms>_<8 hex chars>` (use `crypto.getRandomValues`).
- `expiresAt = now + 7 days` (ms).
- Insert the job row, then enqueue the seed URL (`status:"pending"`, depth 0).
- Enqueue via `env.CRAWL_WORKFLOW?.create({ id: jobId, params: { jobId } })`. If the binding is
  missing or `create` throws → mark the job `failed` with a clear error and return
  **503** `{ success:false, error:"crawl engine not configured" }`. (Task 012 adds the real engine;
  until then this endpoint is deployable but inert.)
- Success → `200 { success: true, id: jobId, url }` (v2 contract shape — top-level `id`, NOT nested under `data`).

### 4. NEW `src/v2/crawlStatus.ts` — `GET /v2/crawl/:id` and `DELETE /v2/crawl/:id`
- GET: `?limit` (default 50, max 200) + `?skip` (default 0) for results pagination.
  Job row → `{ success: true, status, total, completed, creditsUsed: 0, expiresAt, createdAt, completedAt,
  data: [...], next: <url or null> }` where `data[]` items are
  `{ url, markdown?, html?, rawHtml?, links?, metadata?, json?, status, error? }` and `next` is the
  relative URL for the following page (`/v2/crawl/<id>?skip=<n>&limit=<m>`) or `null`.
  Status enum is exactly `scraping|completed|failed|cancelled`. Unknown id → 404
  `{ success:false, error:"crawl job not found" }`.
  **`creditsUsed` is always 0** — we are self-hosted; include the field for contract shape and
  document why it is 0 (never fake a number).
- DELETE: terminate via `env.CRAWL_WORKFLOW?.get(id)?.terminate()` (guard when absent), set status
  `cancelled`, return `{ success: true, status: "cancelled" }` (contract shape).
  Unknown id → 404.

### 5. `src/index.ts`
Register `openapi.post("/v2/crawl", V2Crawl)`, `openapi.get("/v2/crawl/:id", V2CrawlStatus)`,
`openapi.delete("/v2/crawl/:id", V2CrawlStatus)`. Add `DB: D1Database` and
`CRAWL_WORKFLOW?: Workflow` to `Env` (optional binding so the worker still boots without task 012).

### 6. `wrangler.toml` (prod) + `tests/wrangler.toml`
- prod: add `[[d1_databases]] binding = "DB", database_name = "workers-firecrawl", database_id = "637dfc08-e6e8-490f-ba9c-8c452168709f"`.
  Do NOT add the workflow binding yet (task 012 owns it).
- tests: add the same D1 binding block (local test DB) and wire migrations so tests run against
  real SQL — use `cloudflare:test`'s `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` with a
  `[[d1_migrations]]`-style setup, or a `beforeAll` that executes the SQL file; follow the
  documented vitest-pool-workers D1 pattern. Update `tests/bindings.d.ts` `ProvidedEnv` with `DB`.

## Tests
NEW `tests/unit/crawl-store.test.ts` (against the real local D1 binding):
- createJob/getJob roundtrip incl. JSON options; `setJobStatus` + counters; `enqueueUrls`
  dedupe (`UNIQUE(job_id,url)` → INSERT OR IGNORE returns the inserted count); `claimNextBatch`
  flips exactly N pending→processing and a second call returns the NEXT batch (no double-claim);
  `markQueueItem`/`pendingQueueCount`; `insertResult` + `listResults` pagination with `afterId`
  ordering and JSON-column roundtrip (invalid JSON → null); `purgeExpired` removes old rows only.
NEW `tests/unit/v2-crawl.test.ts`:
- POST: validation (bad url → 400, limit bounds), job row created with enqueued seed,
  workflow `create` called with `{id, params:{jobId}}` (mock the binding), **binding absent → 503
  with the job marked failed**, response is `{success,id,url}` with top-level `id`.
- GET: shape (`status/total/completed/creditsUsed/expiresAt/createdAt/completedAt/data/next`),
  status enum values, `next` present/absent at page boundaries, 404 unknown id, `data[]` item shape.
- DELETE: terminate called, status → `cancelled`, 404 unknown id, works when the binding is absent.
- Ignored-field warning present when those fields are sent.

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — FULLY clean. Existing 421 tests unaffected.
No new dependencies.

## Do NOT
- implement the Workflow class or its loop (task 012), invent a `creditsUsed` value,
  add the workflow binding to wrangler.toml, or interpolate values into SQL
