# workers-firecrawl

A self-hosted, Firecrawl-compatible API implemented as a Cloudflare Worker. It
serves the legacy `/v1/*` surface plus a `/v2/*` surface with grouped search,
format-object scrape, and an asynchronous crawl engine backed by D1 and
Cloudflare Workflows.

This repository is a fork of
[G4brym/workers-firecrawl](https://github.com/G4brym/workers-firecrawl); the
`/v2` surface, self-contained search providers, AI extraction, and the crawl
engine were added here.

## Endpoints

All routes accept `POST` with a JSON body unless noted. The auth header is:

```
Authorization: Bearer <AUTHORIZATION_KEY>
```

When `AUTHORIZATION_KEY` is unset, auth is disabled and the API is open.

### Legacy (`/v1`)

| Method | Path | Description |
|---|---|---|
| POST | `/v1/search` | Browser-backed DuckDuckGo search; scrapes each result and returns `data` as a flat array of pages. `scrapeOptions.formats` filters the returned formats. |
| POST | `/v1/map` | Browser discovery + `/sitemap.xml`; returns `links` as a flat array of URL strings. |
| POST | `/v1/scrape` | Scrapes one URL and returns `data` with `markdown`, `html`, `rawHtml`, `links`, `screenshot`, and `metadata`. Formats are strings (`screenshot@fullPage` is the full-page marker). |

### v2

| Method | Path | Description |
|---|---|---|
| POST | `/v2/search` | Grouped search. `data` is an object keyed by source (`web`, `news`, `images`) and never a flat array; a top-level `warning` reports degraded sources. |
| POST | `/v2/scrape` | Scrape one URL using the v2 format vocabulary, including object forms such as `{type:"json"}`, `{type:"summary"}`, and `{type:"screenshot",fullPage:true}`. Warnings live in `data.warning`. |
| POST | `/v2/map` | Map a site. `links` is an array of objects (`{url,title?,description?}`); supports `sitemap: "skip" \| "include" \| "only"`. |
| POST | `/v2/crawl` | Start an asynchronous crawl job. Returns a top-level `{success, id, url}` (`url` is the status URL). |
| GET | `/v2/crawl/:id` | Job status: `status`, `total`, `completed`, `data[]`, and a `next` cursor. Uses the `skip` query param as the pagination cursor. |
| DELETE | `/v2/crawl/:id` | Cancel a job (terminates the Workflow best-effort, marks the job `cancelled`). |
| GET | `/v2/crawl/:id/errors` | Per-job failure log (`errors[]`) plus `robotsBlocked[]`. |
| GET | `/v2/crawl/active` | A bounded list of still-running jobs. |
| POST | `/v2/crawl/params-preview` | Generates crawl parameters from `{url, prompt}` via AI. It does not fetch or crawl the URL; it falls back to engine defaults with a `warning` when AI is unavailable. |

Serving `GET /` renders the generated OpenAPI/Swagger UI.

## Configuration

Every value below is either a `[vars]` entry in `wrangler.toml` (safe defaults,
shown here) or a secret set with `npx wrangler secret put`. Secrets are never
stored in the repository.

| Name | Kind | Default | Purpose |
|---|---|---|---|
| `SEARCH_CHAIN` | var | `ddg,ddg-media,browser` | Ordered, comma-separated provider ids (see [Search](#search)). |
| `LLM_PROVIDER` | var | `openai` | Forces the AI provider (`openai` or `workers-ai`). An unknown value is a config error. |
| `LLM_BASE_URL` | var | `https://openrouter.ai/api/v1` | OpenAI-compatible base URL. z.ai alternative: `https://api.z.ai/api/paas/v4`. |
| `LLM_MODEL` | var | `z-ai/glm-5.3-flash` | Model id. For `workers-ai` the default is `@cf/meta/llama-3.1-8b-instruct`. |
| `LLM_STRICT_JSON` | var | `auto` | Strict-JSON mode: `auto` \| `on` \| `off` (see [AI extraction](#ai-extraction)). |
| `LLM_TIMEOUT_MS` | var | `20000` | Per-request AI timeout, clamped to `1000`–`300000`. |
| `LLM_MAX_REPAIRS` | var | `2` | Extra repair attempts after a failed schema validation, clamped to `0`–`5`. |
| `LLM_MAX_INPUT_CHARS` | var | `48000` | Content budget before truncation (minimum `1000`). |
| `LLM_API_KEY` | secret | unset | LLM provider key. |
| `OPENAI_API_KEY` | secret | unset | Accepted as an alias for `LLM_API_KEY`. |
| `AUTHORIZATION_KEY` | secret | unset | Bearer token. **When unset the API is open.** |
| `SEARXNG_ENDPOINT` | secret | unset | SearXNG base URL. Required to enable the `searxng` provider. |
| `SEARXNG_HEADERS` | secret | unset | JSON object of extra headers for SearXNG (e.g. Cloudflare Access). |
| `SEARXNG_ENGINES` | secret | unset | Comma-separated SearXNG engine list. |

## Search

`SEARCH_CHAIN` is a comma-separated, ordered list of provider ids. Each provider
declares which sources it can serve; `searxng` is dropped at parse time unless
`SEARXNG_ENDPOINT` is configured. Unknown ids and duplicate entries are skipped
with a warning. If the chain resolves to nothing, `/v2/search` returns HTTP 503.

| Provider id | Backend | Sources |
|---|---|---|
| `ddg` | DuckDuckGo HTML endpoint (no browser) | `web` |
| `ddg-media` | DuckDuckGo `vqd` media API (no browser) | `news`, `images` |
| `searxng` | Self-hosted SearXNG instance | `web`, `news`, `images` |
| `browser` | Browser Rendering fallback | `web` |

Resolution is **per source, first success wins**: the chain is walked in order,
and each provider is asked once for the still-missing sources it can serve. The
first provider to return at least one result for a source claims it; other
sources continue to later providers. This means `sources:["news"]` can be served
by `ddg-media` while `web` is still tried on `ddg`.

- If no requested source can be filled, the response is HTTP 503
  `{success:false, error, details}`.
- If some sources are filled, the response is HTTP 200 with a `warning` naming
  each unserved source.
- Empty source keys are never emitted (`"news": []` is omitted).

## AI extraction

AI is used for `{type:"json"}` and `{type:"summary"}` scrape formats and for
`/v2/crawl/params-preview`.

**Provider auto-detection order:**

1. `LLM_PROVIDER`, if set to `openai` or `workers-ai`.
2. Otherwise, a non-empty `LLM_API_KEY` or `OPENAI_API_KEY` selects `openai`.
3. Otherwise, the Workers AI `AI` binding selects `workers-ai`.
4. Otherwise AI is unconfigured. Extraction does **not** throw: the scrape still
   returns HTTP 200 and reports `data.warning`.

**Strict-JSON modes** (`LLM_STRICT_JSON`), applied when a JSON schema is supplied:

- `auto` (default) — send a strict `json_schema` request; on a provider rejection,
  retry once without the strict shape.
- `on` — require the strict shape and surface failures.
- `off` — never send a strict schema.

**Repair loop:** schema-backed extraction gets up to `LLM_MAX_REPAIRS + 1`
attempts. On a validation failure the previous output and the validation errors
are fed back as a repair message. Content longer than `LLM_MAX_INPUT_CHARS` is
truncated with a marker. A final failure returns a `warning` on an otherwise-HTTP-200
response rather than a 500.

## Crawl

A crawl is an asynchronous job persisted in D1 and driven by a Cloudflare
Workflow. `POST /v2/crawl` writes the job row, enqueues the seed URL, and starts a
`CrawlWorkflow` instance (the job id doubles as the Workflow instance id). The
Workflow initializes the front queue, processes URLs in batches of 5, records
results, and finalizes the job. If the `CRAWL_WORKFLOW` binding is absent, the job
is marked `failed` and the request returns HTTP 503 (`crawl engine not configured`).

Job status is one of `scraping`, `completed`, `failed`, `cancelled`. Poll
`GET /v2/crawl/:id`; the response carries `total`/`completed` counters, `data[]`,
and a `next` cursor. `skip` is a cursor (the id of the last result already seen),
not an offset, so pagination stays stable while results are inserted mid-crawl.
`DELETE /v2/crawl/:id` terminates the Workflow best-effort and marks the job
`cancelled`.

Storage uses three D1 tables (`crawl_jobs`, `crawl_queue`, `crawl_results`) defined
in `migrations/0001_crawl.sql`. The bound database is:

```
database_id = "637dfc08-e6e8-490f-ba9c-8c452168709f"
```

Apply the migration to the remote database with:

```bash
npx wrangler d1 execute workers-firecrawl --remote --file=./migrations/0001_crawl.sql
```

**Workflow step limits:** the engine uses one `initialize`, one `finalize`, and
one `webhook` step plus one step per batch of 5 URLs, so roughly `limit / 5 + 3`
steps. Free accounts allow 1024 steps (a `limit` around 5000); Workers Paid
defaults to 10,000 and can be raised to 25,000 via a `[workflows.limits]` block
(Workers Paid only) — see the comment in `wrangler.toml`.

## Local development

```bash
npm ci          # install dependencies
npm run lint    # biome (auto-rewrites on failure)
npm test        # vitest under the Workers runtime
npx tsc --noEmit
npx wrangler dev
```

## Deployment

```bash
# Optional secrets (only the ones you need):
npx wrangler secret put AUTHORIZATION_KEY
npx wrangler secret put LLM_API_KEY          # or OPENAI_API_KEY
npx wrangler secret put SEARXNG_ENDPOINT     # enables the searxng provider
npx wrangler secret put SEARXNG_HEADERS
npx wrangler secret put SEARXNG_ENGINES

# Create the crawl tables in the remote D1 database:
npx wrangler d1 execute workers-firecrawl --remote --file=./migrations/0001_crawl.sql

npx wrangler deploy
```

Deployment requires Workers Paid for Browser Rendering. Review `name` in
`wrangler.toml` before deploying: replacing the existing `workers-firecrawl`
worker vs. deploying under a new name is a pending owner decision.

## Smoke tests

`scripts/smoke.sh` exercises a deployed (or locally running) instance and prints
PASS/FAIL per check, exiting non-zero on any failure.

```bash
scripts/smoke.sh                                  # http://localhost:8787
scripts/smoke.sh https://your-worker.workers.dev
SMOKE_BASE_URL=https://your-worker.workers.dev AUTHORIZATION_KEY=... scripts/smoke.sh
```

It checks `/v2/scrape` (markdown + summary), `/v2/search` (grouped web results and
news), `/v2/map`, and a small `/v2/crawl` job (including polling to a terminal
status). When `AUTHORIZATION_KEY` is set it also asserts unauthenticated requests
are rejected. The DuckDuckGo news source can be blocked from Workers egress; that
check tolerates either a `news` result set or a `warning` and reports which one
occurred.

## SDK usage

Point the Firecrawl SDK at your Worker:

```javascript
const { FirecrawlApp } = require("@mendable/firecrawl-js");

const firecrawl = new FirecrawlApp({
    apiKey: "your-api-key", // only if AUTHORIZATION_KEY is set on the worker
    apiUrl: "https://your-worker.workers.dev",
});

const results = await firecrawl.search("test query");

const mapResult = await firecrawl.map("https://example.com");

const scrape = await firecrawl.scrapeUrl("https://example.com", {
    formats: ["markdown", "links"],
});
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.