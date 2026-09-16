# Spec 004a — Fix pre-existing tsc errors on the base branch

Task slug: `base-tsc-fix`. Branch: `feat/v2-port-004a-base-tsc`.

## Why
`npx tsc --noEmit` on `feat/v2-port` fails with 5 pre-existing errors in
`src/browser.ts` (4) and `src/webSearch.ts` (1). Every agent PR currently has to
"ignore exactly those 5" — fragile. Fix them and enforce tsc in CI.

The errors are DOM-typing issues inside `page.evaluate()` callbacks:
- `src/browser.ts:49` — `Property 'click' does not exist on type 'Element'`
- `src/browser.ts:72,75` — `Property 'querySelectorAll' does not exist on type 'Node'`
- `src/browser.ts:77` — `Property 'outerHTML' does not exist on type 'Node'`
- `src/webSearch.ts:23` — `Property 'href' does not exist on type 'Element'`

## Scope
1. `src/browser.ts`, `src/webSearch.ts` — make tsc pass with ZERO behavior change:
   - Use typed `querySelectorAll<HTMLAnchorElement>(...)` generics, `instanceof`
     narrowing, or `as HTMLElement` / `as HTMLAnchorElement` casts inside the
     evaluate callbacks — whichever is smallest per site.
   - Do not restructure logic, do not rename anything, do not "improve" the code.
   - The callbacks are serialized and run in browser context; only the types change.
2. `.github/workflows/ci.yml` — add a `typecheck` step (or job) running
   `npx tsc --noEmit`, placed so it gates the workflow alongside lint/test.
   Match the existing style of the file.

## Acceptance
- `npx tsc --noEmit` exits 0 with NO output.
- `npm run lint` clean; `npm test` 99/99 unchanged.
- Diff shows type-level changes only — if a reviewer can't tell it's
  behavior-neutral by inspection, redo it smaller.
