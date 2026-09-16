# Spec 014 — Deploy configuration, docs, and smoke tests

Task slug: `deploy-config`. Branch: `feat/v2-port-014-deploy-config`.

## Why
The v2 implementation is complete and green. This task makes it deployable and verifiable:
production `wrangler.toml` config, an env/secrets table, a README rewrite, a post-deploy smoke
script, and a changeset. **It must NOT deploy anything** — deployment happens separately with the
owner's credentials.

## Scope

### 1. `wrangler.toml` — final production config
Keep what exists (name, main, compatibility_date, compatibility_flags, observability, browser
binding, D1 block with the real database id `637dfc08-e6e8-490f-ba9c-8c452168709f`, `[[workflows]]`).
Add:
- `[ai] binding = "AI"` (Workers AI fallback provider for extraction).
- `[vars]` with safe defaults and comments:
  - `SEARCH_CHAIN = "ddg,ddg-media,browser"` (note: `searxng` may be added if `SEARXNG_ENDPOINT` is set)
  - `LLM_STRICT_JSON = "auto"`
  - `LLM_TIMEOUT_MS = "20000"`, `LLM_MAX_REPAIRS = "2"`, `LLM_MAX_INPUT_CHARS = "48000"`
  - `LLM_PROVIDER = "openai"`, `LLM_BASE_URL = "https://openrouter.ai/api/v1"`,
    `LLM_MODEL = "z-ai/glm-5.3-flash"` — with a comment showing the z.ai alternative
    (`https://api.z.ai/api/paas/v4`, model `glm-5.3-flash`) and that Workers AI is used when no key is set.
- A comment block listing the SECRETS (never in the file): `LLM_API_KEY` (or `OPENAI_API_KEY`),
  `AUTHORIZATION_KEY` (optional; when unset the API is OPEN — say so explicitly), and optional
  `SEARXNG_ENDPOINT`/`SEARXNG_HEADERS`/`SEARXNG_ENGINES`.
- Do NOT include any secret values. Do NOT change `name` (the owner decides whether to replace the
  existing worker or deploy under a new name — leave a comment noting that decision is pending).

### 2. README rewrite (repo root)
Replace/expand the upstream README's endpoint section so it documents THIS worker:
- Endpoint table: `/v1/{search,map,scrape}` (legacy-compatible) and
  `/v2/{search,scrape,map,crawl,crawl/:id,crawl/:id/errors,crawl/active,crawl/params-preview}`
  with one-line descriptions and the auth header format (`Authorization: Bearer <AUTHORIZATION_KEY>`,
  and that auth is disabled when the key is unset).
- Config table: every env var/secret from above, its default, and what it does.
- Search section: the `SEARCH_CHAIN` design (per-source, first-success) and each provider's
  capability (`ddg` web, `ddg-media` news+images, `searxng` optional all-sources, `browser` web).
- AI section: provider auto-detection order, strict-JSON modes, repair loop, and that extraction
  degrades to a `warning` on a still-200 response when unconfigured.
- Crawl section: D1 + Workflows architecture, the D1 id, the migration command
  (`npx wrangler d1 execute workers-firecrawl --remote --file=./migrations/0001_crawl.sql`),
  and the `[limits] steps` note for large crawls.
- Local dev: `npm ci`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx wrangler dev`.
- Deployment: the `wrangler secret put` commands, the D1 migration command, and
  `npx wrangler deploy`.
- Keep it honest: no marketing language, no claims we cannot verify.

### 3. NEW `scripts/smoke.sh`
A bash script (`set -euo pipefail`) taking the base URL as `$1` (default
`http://localhost:8787`) and optional `AUTHORIZATION_KEY` from the env, exercising the deployed API
and printing PASS/FAIL per check with a non-zero exit on any failure:
- `POST /v2/scrape` on `https://example.com` with `["markdown"]` → expect `success:true`,
  non-empty `data.markdown`, and a `metadata.sourceURL`.
- `POST /v2/scrape` with `[{"type":"summary"}]` → expect 200 and either `data.summary` or a
  `data.warning` (AI may be unconfigured) — assert the response is well-formed either way.
- `POST /v2/search` `{query:"cloudflare workers", limit:3}` → expect `data` to be an OBJECT with a
  `web` array (never a flat array); print the result count.
- `POST /v2/search` with `sources:["news"]` → expect 200 and a `warning` or `news` results (DDG
  news may be blocked from Workers egress — the check tolerates either but prints what happened).
- `POST /v2/map` `{url:"https://example.com"}` → expect `links` to be an ARRAY OF OBJECTS.
- `POST /v2/crawl` `{url:"https://example.com", limit:2}` → expect `{success,id,url}` with a
  TOP-LEVEL `id`; then poll `GET /v2/crawl/<id>` up to ~60s until `status` is terminal; assert the
  status enum and print `total`/`completed`.
- Auth: when `AUTHORIZATION_KEY` is set, include the header and additionally assert that a request
  WITHOUT it is rejected.
Use `curl` + `python3 -c` for JSON assertions (python3 is available; no jq dependency beyond what
already exists — check `scripts/check-spec-drift.sh` for the established style).

### 4. Changeset
Add `.changeset/<name>.md` describing the v2 port (new endpoints + self-contained search + AI
extraction + crawl) as a `minor` bump, matching the existing changeset format in `.changeset/`.

## Acceptance
`npm run lint`, `npm test` (560 baseline), `npx tsc --noEmit` — FULLY clean.
`bash -n scripts/smoke.sh` parses; the script supports `SMOKE_BASE_URL` override and exits non-zero
on a failed assertion (verify by running it against a URL that will fail, e.g. `http://127.0.0.1:1`).
No secret values committed anywhere — grep your diff for anything that looks like a key.

## Do NOT
- deploy, run `wrangler secret put`, or commit credentials
- change application code (src/**) — if you find a bug, report it in the PR body instead of fixing it
