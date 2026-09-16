# Spec 001 — Vendor the Firecrawl v2 OpenAPI spec + drift-detection CI

Task slug: `spec-vendor`. Branch: `feat/v2-port-001-spec-vendor`.

## Why
We build against Firecrawl's real v2 API. The vendored spec is our contract of record;
a weekly CI check fetches the live spec and opens an issue if it changed.

## Scope — create EXACTLY these files, nothing else

1. `spec/v2-openapi.json` — fetch `https://docs.firecrawl.dev/api-reference/v2-openapi.json`,
   normalize with `jq -S .` (sorted keys, stable formatting) and save.
2. `spec/README.md` — 5-8 lines: source URL, vendored date (today), how to refresh
   (`scripts/check-spec-drift.sh --update`), and that this file is the contract of record.
3. `scripts/check-spec-drift.sh` — bash:
   - fetches the live spec to a temp file, normalizes both with `jq -S .`
   - `diff` → exit 1 with a short summary (line count of diff) if different, exit 0 if same
   - `--update` flag: overwrite `spec/v2-openapi.json` instead of diffing
   - must `set -euo pipefail`, work from repo root regardless of CWD (`cd "$(dirname "$0")/.."`)
4. `.github/workflows/spec-drift.yml`:
   - `on: schedule: [cron: "17 8 * * 1"]` (Mondays) + `workflow_dispatch`
   - permissions: `contents: read`, `issues: write`
   - steps: checkout → fetch+normalize live spec → diff vs vendored → on difference,
     open (or update an existing open) issue titled `Firecrawl v2 spec drift detected`
     listing a 40-line diff excerpt, using `gh issue` CLI with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
   - Note in a comment: scheduled runs only fire from the default branch; until this merges
     to `main` it runs on demand via `workflow_dispatch`.

## Acceptance
- `bash scripts/check-spec-drift.sh` exits 0 right after vendoring (fetch twice, compare).
- `bash scripts/check-spec-drift.sh --update` is idempotent (second run = no git diff).
- Workflow file parses (`npx --yes actionlint .github/workflows/spec-drift.yml` if
  network allows; otherwise careful YAML review).
- No `src/` or test changes. `npm run lint`, `npm test`, `npx tsc --noEmit` unchanged green.

## Notes
- A cached copy of the spec may exist at `/tmp/fcresearch/v2-openapi.json` — still fetch
  fresh; use the cache only if the fetch fails.
- jq is available. If not, `python3 -m json.tool --sort-keys` is an acceptable fallback
  (but prefer jq for speed on a 400KB file).
