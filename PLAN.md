# workers-firecrawl v2 — Master Plan

Base: `main` tracks upstream `G4brym/workers-firecrawl` exactly. All work lands on
`feat/v2-port` via PRs, merged to `main` only when the whole effort is stable.

## Context

- Upstream `main` (`f53a0dc`) implements **v1 only**: `/v1/search`, `/v1/map`, `/v1/scrape`.
- Real Firecrawl is **v2** (`https://api.firecrawl.dev/v2`). We implement v2 while keeping v1 intact.
- Legacy feature donor: fork branches `crawl`, `legacy-crawl-search`, `FLARE-1`
  (cloned at `~/wfc-tmp/fork`; also on origin). Port logic, do not merge.
- Deployed stale workers `fireflare` + `workers-firecrawl` (legacy builds) are decommissioned at the end.

## Target architecture

```
src/
  index.ts               # Env type; registers /v1/* AND /v2/*; exports CrawlWorkflow
  authorization.ts       # unchanged
  browser.ts             # shared browser lifecycle
  scrape.ts webSearch.ts webMap.ts        # /v1/* (upstream, kept)
  v2/
    scrape.ts            # format objects, JSON mode, summary
    search.ts            # {success,data:{web,news,images}}
    map.ts               # links:[{url,title?,description?}]
    crawl.ts crawlStatus.ts crawlExtras.ts
  search/
    types.ts provider.ts searxng.ts ddg.ts ddgBrowser.ts params.ts
  ai/
    types.ts config.ts provider.ts openaiProvider.ts workersAiProvider.ts
    extract.ts prompt.ts
  crawler/
    workflow.ts batch.ts robots.ts sitemap.ts
migrations/              # D1 SQL
spec/v2-openapi.json     # vendored official spec (drift-checked in CI)
docs/specs/              # per-task implementation specs (agents read these)
```

## Provider chains

- **Search** (self-contained by default; SearXNG optional, never required):
  `SEARCH_CHAIN` = ordered provider list, resolved PER SOURCE (first success wins).
  Providers: `ddg` (web, fetch), `ddg-media` (news/images, vqd JSON), `browser` (web,
  Browser Rendering — the proven current logic), `searxng` (optional; all sources,
  skipped unless SEARXNG_ENDPOINT is set). Default: `ddg,ddg-media,browser`.
- **LLM**: OpenAI-compatible endpoint (GLM-5.3 Flash via `LLM_BASE_URL`, e.g. Z.ai or OpenRouter)
  preferred when a key is set; Cloudflare Workers AI (`env.AI`) as zero-config fallback.
  `LLM_STRICT_JSON=auto|on|off` (default `auto`): try native `json_schema`, fall back to
  `json_object`, ALWAYS zod-validate + bounded repair loop.

## Locked decisions

1. Serve `/v1` and `/v2` side by side.
2. Crawl = Cloudflare **Workflows** + D1. No Durable Object.
3. `/v2/extract` is **dropped** (deprecated upstream; scrape JSON mode replaces it).
4. `/v2/map`: v2 object shape + upstream browser discovery + legacy sitemap parser for `sitemap:"only"`.
5. Reimplement Firecrawl logic/prompts fresh (AGPL upstream; private use, but clean-room is free).
6. No new runtime npm deps without explicit approval.

## Workstreams (agent task graph)

| # | Task | Files (scope) | Deps | Wave |
|---|---|---|---|---|
| 001 | ✅ Vendor v2 spec + drift CI (PR #1) | `spec/`, `scripts/`, `.github/workflows/spec-drift.yml` | — | 1 |
| 004a | ✅ Fix base tsc errors + CI typecheck (PR #4) | `src/browser.ts`, `src/webSearch.ts`, `ci.yml` | — | 2 |
| 002 | ✅ Search params (kl tables, tbs mappers) (PR #2) | `src/search/params.ts` + test | — | 1 |
| 003 | ✅ SearXNG provider (PR #3) — retained as OPTIONAL backend, not in default chain | `src/search/types.ts`, `src/search/searxng.ts`, `Env` + tests | 002 (contract) | 1 |
| 004 | ✅ DDG fetch provider (PR #5) | `src/search/ddg.ts` + fixtures/tests | 002 | 2 |
| 005 | Configurable chain (SEARCH_CHAIN, per-source) | `src/search/provider.ts`, `src/search/ddgBrowser.ts` | 004, 007 (contract) | 2 |
| 007 | DDG vqd media provider (news+images) | `src/search/ddgMedia.ts` + tests | 002 | 2 |
| 006 | `/v2/search` route | `src/v2/search.ts`, `src/index.ts` | 005 | 2 |
| 007 | `/v2/map` route | `src/v2/map.ts`, `src/crawler/sitemap.ts` | — | 3 |
| 008 | `/v2/scrape` format objects (no AI) | `src/v2/scrape.ts` | — | 3 |
| 009a | AI: types/config/provider iface + OpenAI-compat | `src/ai/*` partial | — | 3 |
| 009b | AI: Workers AI provider | `src/ai/workersAiProvider.ts` | 009a | 3 |
| 009c | AI: extract pipeline + prompts + scrape wiring | `src/ai/extract.ts`, `prompt.ts`, `src/v2/scrape.ts` | 009a, 008 | 4 |
| 010 | robots + sitemap utils | `src/crawler/robots.ts`, `src/crawler/sitemap.ts` | — | 3 |
| 011 | D1 schema + crawl endpoints | `migrations/`, `src/v2/crawl*.ts` | — | 4 |
| 012 | Crawl Workflow + batch engine | `src/crawler/workflow.ts`, `batch.ts`, wrangler wiring | 010, 011, 009c | 4 |
| 013 | Crawl extras (errors/active/params-preview) | `src/v2/crawlExtras.ts` | 011 | 5 |
| 014 | README, changeset, deploy, decommission old workers | docs/deploy | all | 5 |

## Orchestration (team rules)

- **I (main agent)** plan, spec, review every PR, and merge. Implementation subagents do the code.
- Every task has a spec in `docs/specs/NNN-slug.md` — the agent's contract.
- Agents work in their own git worktree under `../workers-firecrawl-wt/task-NNN`,
  on branch `feat/v2-port-NNN-<slug>` forked from `feat/v2-port`, and open a PR
  **against `feat/v2-port`** (never `main`, never direct-push).
- Gates before any merge: `npm run lint`, `npm test`, `npx tsc --noEmit` — output pasted in PR body.
- Review is defect-first; fixes requested via PR review comments; agent amends and re-pushes.
