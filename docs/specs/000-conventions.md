# Spec 000 — Working conventions (read first, every task)

You are an implementation agent for `workers-firecrawl`. Follow these rules exactly.

## Repo layout
- Main checkout: `/DATA/Documents/workers-firecrawl` (branch `main`, DO NOT touch).
- Integration branch: `feat/v2-port`, checked out at `/DATA/Documents/workers-firecrawl-wt/integ`.
- Your worktree: create it before writing anything:
  ```bash
  cd /DATA/Documents/workers-firecrawl
  git fetch origin
  git worktree add ../workers-firecrawl-wt/task-NNN -b feat/v2-port-NNN-<slug> feat/v2-port
  cd ../workers-firecrawl-wt/task-NNN
  npm ci
  ```

## Gates (must ALL pass before opening the PR)
```bash
npm run lint          # biome; auto-rewrites on failure — re-run after fixing
npm test              # vitest run --root tests
npx tsc --noEmit      # typecheck (there is no npm script)
```
Paste the actual output of all three into your PR body under `## Verification`.

## Hard rules
1. Touch ONLY the files your spec lists. No drive-by edits.
2. No new runtime dependencies. Dev-tooling deps only if the spec explicitly allows.
3. TypeScript strict; no `any` unless the repo's biome config tolerates it (it disables
   `noExplicitAny` — still prefer real types). Match the repo's existing style:
   tabs, double quotes, `chanfana` OpenAPIRoute classes, zod schemas inline in routes.
4. Tests live in `tests/unit/`. They must NOT import puppeteer/browser code directly
   (existing tests use stubs — see `tests/unit/routing.test.ts`). Pure functions get pure tests.
5. Never commit `node_modules`, `.dev.vars`, secrets, or `wrangler.toml` credentials.
6. Commits: short imperative messages, e.g. `add searxng search provider`.
7. Legacy reference code lives on branch `origin/crawl` (read with
   `git show origin/crawl:<path>`). Port logic — do NOT copy files wholesale; the legacy
   code has known defects your spec will call out.

## PR rules
```bash
git push -u origin feat/v2-port-NNN-<slug>
gh pr create --repo swcrazyfan/workers-firecrawl --base feat/v2-port \
  --title "feat(v2): <slug>" --body-file PR_BODY.md
```
PR body template:
```markdown
## What
<one paragraph>
## Spec
docs/specs/NNN-<slug>.md
## Verification
<pasted gate outputs>
## Notes / deviations
<anything you changed vs the spec, and why — unexplained deviations will be rejected>
```

## When blocked
Stop and write the blocker into the PR body as a draft PR comment — do NOT improvise
architecture. A partial, clearly-flagged result beats a wrong one.
