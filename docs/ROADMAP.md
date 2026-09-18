# Roadmap — v2 feature gaps (Phase B research)

Last updated: 2026-09-16, after Phase A (scrape actions + v1 search fix).
Deployed state: `fireflare` @ https://crawl.joshhost.com, bundle from `main`
@ `e0d6f8f` (sha `f3c7bc02…`), 616 tests green. Deploy procedure:
docs/DEPLOY.md.

## Where we are

Live and working (verified by smoke + live checks):

- `/v1` scrape/map/search (search now behind the Chrome/140 UA + 1920x1080
  viewport — spec 017).
- `/v2/scrape`: formats `markdown` `html` `rawHtml` `links` `screenshot`
  (viewport + fullPage) `summary` `json` (schema/prompt, strict-JSON + repair
  loop via LLM_PROVIDER seam); `actions` array (spec 016): `wait` (ms or
  selector), `click` (with `all`), `write`, `press`, `scroll` (page or
  element), `screenshot` (fullPage/quality/viewport) → `data.actions.screenshots`;
  `pdf`/`executeJavascript`/`scrape` accepted-and-warn.
- `/v2/search`: web/news/images via chain `ddg,ddg-media,browser`.
- `/v2/map` (browser discovery + `sitemap:"only"`), `/v2/crawl` (+ status,
  errors, active, params-preview) on Workflows + D1.
- AI: OpenAI-compatible endpoint (GLM-5.3 Flash via OpenRouter) with Workers
  AI fallback; strict JSON + bounded repair.
- Ops: zone firewall rule skips Browser Integrity Check for
  `crawl.joshhost.com` only (rule `c53d85f9…`, zone `joshhost.com`) so
  programmatic clients (`Python-urllib` etc.) are not 403'd. Keep this if the
  zone is ever rebuilt. Bearer auth (`AUTHORIZATION_KEY` secret) is the real
  protection.

## Gap inventory vs spec/v2-openapi.json (current, drift CI clean)

Priority order is roughly: SDK-compat cheap wins → storage-backed → flagship
AI endpoints. Effort: S/M/L.

### A. Cheap wins on existing seams (Phase B1 candidates)

| Feature | What | Where it lands | Effort |
|---|---|---|---|
| `question` format | NL Q&A over the page → `data.answer` | same pattern as `summarize` in `src/v2/scrape.ts` + `src/ai/extract.ts` | S |
| `highlights` format | source-text selection query → `data.highlights` | same | S |
| `product` / `menu` / `branding` formats | preset-schema LLM extraction | json pipeline with built-in schemas | S each |
| `checkPromptInjection` (json option) | scan page for prompt injection before extraction, 403 on detect | one LLM call before extract in `src/ai/extract.ts` | S |
| `includeTags`/`excludeTags` | content filtering — most-requested ignored knob | DOM filter in `src/browser.ts` `extractContent` | S |
| `mobile` | mobile viewport + UA | `extractContent` page setup | S |
| `removeBase64Images` | strip `data:` images | regex post-pass | S |
| `images` format | extract image URLs | DOM query alongside `links` | S |
| `rawBase64` format | base64 of rawHtml | trivial | S |

### B. Storage/queue-backed (Phase B2)

| Feature | What | Notes | Effort |
|---|---|---|---|
| `/batch/scrape` (+ status/errors) | many-URL queue without discovery — SDKs call it directly | crawl engine "no-discovery" mode + D1 | S–M |
| `changeTracking` format | `git-diff` or `json` mode vs last scrape, per-tag history, delta statuses | D1 snapshot table; json mode reuses extract | M |
| crawl `webhook` | notify on crawl completion | small addition to workflow | S |

### C. Flagship AI endpoints (Phase B3+)

| Feature | What | Notes | Effort |
|---|---|---|---|
| `/v2/extract` (+ status) | async multi-URL extraction: `urls[]`, `prompt`, `schema`, `enableWebSearch`, `showSources` | locked decision #3 dropped it when it looked like deprecated single-page extract; the real shape is multi-page + search-augmented — decision worth revisiting in PLAN.md | M |
| `/monitor` (+ checks/run) | cron re-scrape + AI-judged change filtering + webhook/Slack alerts | changeTracking + cron triggers + D1 + notifications | M–L |
| `/agent` (+ trace/snapshots) | prompt + urls + schema, effort levels, autonomous multi-step navigation | all primitives exist now (browser actions, search, LLM); scope to read-only navigate+extract first | L |

### D. Deferred / skip

- `/interact` (persistent browser sessions) — Browser Rendering session
  lifetime + session registry; revisit after agent. M–L.
- `/parse` (PDF/DOCX upload) — pure-JS parsers heavy on Workers; browser PDF
  text limited. Low value for us.
- `audio`/`video` formats — YouTube download; egress/size make it a bad fit.
- `/team/*` usage/billing, `/support/*` (RAG over Firecrawl's own docs),
  `/feedback`, `/search/developer`, `/search/research/papers` — new surface,
  low self-host value; papers search only if a use case appears.
- `pdf` action — Browser Rendering has no PDF print in our puppeteer fork;
  keep accepted-and-warn.
- `executeJavascript` action — would be easy via `page.evaluate` (reconsider
  on demand; security tradeoff: it is arbitrary JS in the customer's own
  scrape call, which is the same trust model as real Firecrawl).

## Recommended cut

- **B1**: everything in section A (one or two PRs; spec 018).
- **B2**: batch/scrape + changeTracking + crawl webhook (spec 019/020).
- **B3**: `/v2/extract` multi-page + `enableWebSearch` (spec 021; amend
  PLAN.md locked decision #3).
- **B4**: monitors (spec 022).
- **B5**: scoped read-only `/agent` (spec 023).

## Continuation prompt (paste to start Phase B1)

```text
Continue the workers-firecrawl project (Firecrawl-compatible API on Cloudflare
Workers, live at https://crawl.joshhost.com as the `fireflare` worker). Repo:
/DATA/Documents/workers-firecrawl — main tracks the deployed state.

READ FIRST:
- PLAN.md and docs/specs/000-conventions.md — working conventions (spec →
  worktree → implement → gates: `npm run lint` / `npm test` / `npx tsc
  --noEmit` → PR against feat/v2-port → defect-first review → fix round →
  merge; commit identity via `git -c user.name="swcrazyfan" -c
  user.email="79735340+swcrazyfan@users.noreply.github.com"`)
- docs/ROADMAP.md — where we are + the Phase B gap inventory (this task = B1)
- docs/DEPLOY.md — deployment runbook (no wrangler token on this box; use the
  cloudflare-bridge MCP)
- Contract of record: spec/v2-openapi.json → `jq '.components.schemas'`
  (Formats / ScrapeOptions / ExtractRequest)

TASK — Phase B1 (SDK-compat sweep, 1–2 PRs), from docs/ROADMAP.md section A:
1. New AI formats on POST /v2/scrape, following the `summarize` pattern in
   src/v2/scrape.ts + src/ai/extract.ts:
   - `question`: {type:"question", question} → data.answer (max 10k chars)
   - `highlights`: {type:"highlights", query} → data.highlights
   - `product` / `menu` / `branding`: preset schemas → data.product/.menu/.branding
   - `checkPromptInjection` option on the json format: scan before extract, 403
     with code SCRAPE_PROMPT_INJECTION_DETECTED on hit
2. Stop ignoring the cheap scrapeOptions knobs (thread through
   src/browser.ts extractContent; /v1 must not change):
   - includeTags/excludeTags (DOM filter), mobile (viewport+UA),
     removeBase64Images, `images` format, `rawBase64` format
3. Tests with the mocked-browser patterns in tests/unit/v2-scrape.test.ts;
   pure prompt/preset-schema logic unit-tested in tests/unit/ai-*.test.ts style.

PROCESS: write docs/specs/018-b1-sdk-compat.md first (match existing spec
style), implement in a worktree per conventions, PR to feat/v2-port, defect
review + fix round, merge. Deploy per docs/DEPLOY.md, then
`bash scripts/smoke.sh https://crawl.joshhost.com` with AUTHORIZATION_KEY from
~/.config/opencode/opencode.json → mcp.firecrawl.environment.FIRECRAWL_API_KEY.
Report back with PR links and smoke output.

For later phases: B2 = /batch/scrape + changeTracking + crawl webhook,
B3 = /v2/extract multi-page (amend locked decision #3), B4 = /monitor,
B5 = read-only /agent. Same process; ROADMAP.md has the details.
```
