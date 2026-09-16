# Spec 012 — Crawl engine (Cloudflare Workflow) + robots.txt

Task slug: `crawl-engine`. Branch: `feat/v2-port-012-crawl-engine`.
Depends on (merged): `src/crawler/store.ts`, `src/v2/crawl.ts` (binds `env.CRAWL_WORKFLOW`),
`src/crawler/sitemap.ts`, `src/browser.ts` (`getBrowser`/`extractContent`), `src/ai/extract.ts`.

## Why
Task 011 landed storage + endpoints with the engine absent (binding-absent → 503). This task is
the engine: a Cloudflare **Workflow** that drives the crawl in bounded, retryable steps.
No Durable Object. Design constraint: the loop body must live in **pure, unit-testable functions**
so the Workflow class stays a thin adapter (Workflows themselves are hard to test).

## Scope

### 1. NEW `src/crawler/robots.ts`
```ts
export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelaySec?: number }
export function parseRobotsTxt(text: string, userAgent?: string): RobotsRules
export function isPathAllowed(rules: RobotsRules, path: string): boolean
export async function fetchRobots(siteUrl: string, userAgent?: string): Promise<RobotsRules | null>   // null on 404/error
```
- Clean-room implementation (do NOT copy any library or AGPL source): parse `User-agent` groups
  (match our exact UA, else `*`), `Disallow`/`Allow` lines, `Crawl-delay`; longest-match-wins
  path matching (an `Allow` that is longer/more specific than a matching `Disallow` wins);
  `*` and `$` wildcard support in paths; ignore comments and blank lines; case-insensitive
  directive names. `fetchRobots` uses `AbortSignal.timeout(5000)` and never throws.

### 2. NEW `src/crawler/engine.ts` — the testable crawl logic
```ts
export interface CrawlOptions { limit: number; maxDiscoveryDepth: number; allowExternalLinks: boolean; allowSubdomains: boolean; includePaths?: string[]; excludePaths?: string[]; ignoreRobotsTxt: boolean; sitemap: "skip" | "include" | "only"; scrapeFormats: string[]; jsonFormat?: { schema?: unknown; prompt?: string } | null }
export function filterDiscoveredLinks(baseUrl: string, candidates: string[], seen: Set<string>, depth: number, opts: CrawlOptions): { url: string; depth: number }[]
export async function initializeCrawl(env: Env, jobId: string, jobUrl: string, opts: CrawlOptions): Promise<{ seeded: number }>
export async function processCrawlBatch(env: Env, jobId: string, batch: { id: number; url: string; depth: number }[], opts: CrawlOptions): Promise<{ completed: number; failed: number; discovered: number }>
export function isTerminal(status: string): boolean
```
- `filterDiscoveredLinks` (pure, the highest-value tests): resolve relative URLs; keep only
  http(s); drop fragments-only/`mailto:`/`tel:`/`javascript:`; same-registrable-domain check for
  internal (use a small clean-room host compare: exact host or subdomain-of when
  `allowSubdomains`); drop externals unless `allowExternalLinks`; drop obvious binary/asset
  extensions (`.png .jpg .jpeg .gif .svg .webp .ico .css .js .woff .woff2 .ttf .eot .mp4 .mp3 .zip .gz .rar .7z .exe .dmg`);
  apply `includePaths`/`excludePaths` (`*` glob → regex, anchored); drop Depth > `maxDiscoveryDepth`;
  dedupe against `seen` AND within `candidates`; preserve first-seen order.
- `initializeCrawl`: fetch robots (unless `ignoreRobotsTxt`), and when `sitemap !== "skip"`,
  `fetchSitemapUrls` and enqueue those (filtered, depth 0). Enqueue the seed URL last so it is
  processed first (queue ordering is by id — enqueue seed BEFORE sitemap URLs). Update the job's
  `total` counter to the number enqueued. `sitemap: "only"` → do NOT enqueue the seed's
  discovered links later; only sitemap URLs are crawled (the batch processor must honour this via
  `opts.sitemap === "only"` → skip link discovery).
- `processCrawlBatch`: for each item — bail out early if the job status is terminal (cancelled);
  fetch robots rules once per batch (cache in a module-level map keyed by origin for the batch);
  skip disallowed URLs (mark queue item `failed` with a robots error, count as failed);
  `getBrowser(env)` ONCE per batch, scrape each URL with `extractContent` (formats:
  `opts.scrapeFormats` + `links` always, since discovery needs links), optionally run
  `extractStructured` when `jsonFormat` is set (reuse `src/ai/extract.ts`; AI failure must degrade
  to a warning, never fail the page), `insertResult`, `markQueueItem` done/failed,
  `bumpJobCounters({ completed, total })`, and collect discoveries via
  `filterDiscoveredLinks`. Close the browser in `finally`. Return counts; `enqueueUrls` the
  discoveries (store dedupes).
- `env` is `Env`; the engine must tolerate `env.AI`/LLM config being absent.

### 3. NEW `src/crawler/workflow.ts` — thin adapter
```ts
export class CrawlWorkflow extends WorkflowEntrypoint<Env> { async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) }
```
- Load the job row (`getJob`); if missing or `cancelled` → return.
- `step.do("initialize", { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" }, ...)` → `initializeCrawl`.
- Loop: `step.do(\`batch ${n}\`, { retries: {limit:2, ...}, timeout: "10 minutes" }, ...)` →
  `claimNextBatch(env, jobId, 5)` then `processCrawlBatch`; break when the claimed batch is empty,
  the job is terminal, or `completed >= limit`; `await step.sleep(\`pace ${n}\`, "1 second")`
  between batches (be polite to targets).
- Finish: `setJobStatus(completed)` (or `failed` if every page failed and none succeeded), set
  `completedAt`. If the job has a `webhook` URL in its stored options, POST the terminal payload
  once (`{type:"crawl.completed", id, status, total, completed, data: [...]}` for the first page of
  results), with `AbortSignal.timeout(10000)`; webhook failure must not fail the job (log-free —
  no console spam beyond a single error).
- Read the stored `options` JSON from the job row (011 persists the resolved request).
- Keep the class free of business logic — everything testable lives in `engine.ts`.

### 4. `wrangler.toml` + `src/index.ts`
- `wrangler.toml`: add
  `[[workflows]] name = "workers-firecrawl-crawl", binding = "CRAWL_WORKFLOW", class_name = "CrawlWorkflow"`.
  Do NOT remove the D1 block. No DO migrations entry (Workflows manage their own state).
- `src/index.ts`: `export { CrawlWorkflow } from "./crawler/workflow";` (required for the binding)
  and make `CRAWL_WORKFLOW` a required binding in `Env` (it now exists) — keep `crawl.ts`'s
  defensive 503 path for safety but it should no longer trigger in production.
- `tests/wrangler.toml`: mirror the workflow binding if `vitest-pool-workers` requires the class to
  exist for suites that import `src/index.ts`; if that breaks the pool, instead keep the binding
  out of the test config and document why (tests import route classes directly).

### 5. Tests
NEW `tests/unit/crawler-robots.test.ts`: group matching (our UA vs `*`), Allow-beats-Disallow
(longest match), wildcards/`$`, comments/blank lines, crawl-delay, fetch failure → null.
NEW `tests/unit/crawler-engine.test.ts` (mock `../../src/browser` and `../../src/ai/extract`;
real D1 binding for the store calls):
- `filterDiscoveredLinks`: relative resolution, asset extensions dropped, mailto/js dropped,
  external dropped vs kept with `allowExternalLinks`, subdomain handling both ways
  (`allowSubdomains` true/false), `includePaths`/`excludePaths` globs, depth cap, dedupe within +
  across calls, order preservation.
- `initializeCrawl`: seed enqueued before sitemap URLs; `sitemap:"only"` skips the seed;
  `ignoreRobotsTxt` respected (robots fetch not called when true); job `total` updated.
- `processCrawlBatch`: happy path inserts results + bumps counters + marks queue done; scrape
  failure → queue `failed` + counted, batch continues; robots-disallowed URL → failed with a
  robots reason, browser not used for it; AI json failure degrades to a result with a warning;
  `sitemap:"only"` → no discoveries enqueued; cancelled job mid-batch stops early; browser closed
  on the error path (assert the mocked close).
- `isTerminal` truth table.

## Acceptance
`npm run lint`, `npm test` (480 baseline + new), `npx tsc --noEmit` — FULLY clean.
No new dependencies. `/v1/*`, search, AI, and scrape modules untouched (except `src/index.ts`).

## Do NOT
- use a Durable Object, copy robots-parsing code from a library/AGPL source, put business logic in
  the Workflow class, or add crawling endpoints beyond what exists (task 013 owns extras)
