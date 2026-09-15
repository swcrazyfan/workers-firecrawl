# Spec 003 — SearXNG search provider

Task slug: `searxng-provider`. Branch: `feat/v2-port-003-searxng-provider`.
Depends on spec 002 contract (`mapTbs`, `buildDomainQuery` from `src/search/params.ts`) —
002 is being built in parallel; program against these exact exports (do not modify 002's files;
if 002 hasn't merged yet, create a minimal `src/search/params.ts` stub ONLY if missing,
matching 002's spec signatures, and note it in the PR).

## Why
SearXNG is our primary search backend (user runs their own instance behind Cloudflare Tunnel).
Reference: upstream Firecrawl `apps/api/src/search/v2/searxng.ts` — use its logic, write fresh code.

## Scope — create/modify EXACTLY these files

### 1. `src/search/types.ts`
```ts
import { z } from "zod";
export const webResultSchema = z.object({
  url: z.string().url(), title: z.string(), description: z.string(), position: z.number().int(),
});
export const newsResultSchema = z.object({
  url: z.string().url(), title: z.string(), snippet: z.string(),
  date: z.string().optional(), imageUrl: z.string().optional(), position: z.number().int(),
});
export const imageResultSchema = z.object({
  url: z.string().optional(), title: z.string().optional(), imageUrl: z.string().url(),
  imageWidth: z.number().int().optional(), imageHeight: z.number().int().optional(), position: z.number().int(),
});
export type WebResult = z.infer<typeof webResultSchema>;
export type NewsResult = z.infer<typeof newsResultSchema>;
export type ImageResult = z.infer<typeof imageResultSchema>;
export interface SearchResults { web?: WebResult[]; news?: NewsResult[]; images?: ImageResult[] }
export interface SearchOutcome { results: SearchResults; warnings: string[] }
export interface SearchInput {
  query: string; limit: number; sources: ("web" | "news" | "images")[];
  tbs?: string; lang?: string; country?: string; location?: string; safe?: boolean;
  includeDomains?: string[]; excludeDomains?: string[];
}
```

### 2. `src/search/searxng.ts`
```ts
export async function searxngSearch(input: SearchInput, env: Env): Promise<SearchOutcome>
```

Behavior:
- Endpoint: `${SEARXNG_ENDPOINT (trailing "/" stripped)}/search`, GET.
- Params: `q` (from `buildDomainQuery`), `format=json`, `categories` per source
  (`web→general`, `news→news`, `images→images`), `language=input.lang`,
  `pageno` 1..3 loop (stop early on empty page or when `limit` reached; slice to `limit`),
  `safesearch=2` only when `input.safe === true` (omit otherwise),
  `time_range` from `mapTbs(input.tbs)` (bubble its warnings),
  `engines=env.SEARXNG_ENGINES` only when set (omit the param entirely when unset).
- Auth: if `env.SEARXNG_HEADERS` set, JSON.parse it and merge into request headers
  (this carries Cloudflare Access service-token headers through the tunnel).
- One SearXNG call chain **per requested source**, run with `Promise.allSettled`
  (per-source fail-soft: a failed source contributes a warning, not an exception).
- Timeout: `AbortSignal.timeout(10000)` per page fetch. Retry once after 250ms on
  network error or 5xx; never retry 4xx.
- Errors: `403` → warning `"SearXNG returned 403 — enable 'json' in settings.yml search.formats"`.
  `400` → warning with SearXNG's error body text. All sources failed → throw
  `Error("searxng: all sources failed")` (the provider chain catches this and falls back).
- Normalize (validate each item with the zod schemas; drop invalid items silently):
  - web: `{url, title, description: content ?? "", position: i+1}` — filter non-http(s) URLs
  - news: `{url, title, snippet: content ?? "", date: publishedDate ?? undefined, imageUrl: thumbnail_src ?? img_src ?? undefined, position}`
  - images: `{imageUrl: img_src, url: url !== img_src ? url : undefined, title, position}`,
    parse `imageWidth`/`imageHeight` from `resolution` strings like `"1920 x 1080"` (regex `/(\d+)\D+(\d+)/`);
    omit dims when absent; drop items without `img_src`
  - Dedupe per source by normalized URL (lowercase host, strip trailing slash + hash), first wins
  - If a source's page-1 has zero results AND `unresponsive_engines` is non-empty → warning
    listing those engine errors
- Return `{results, warnings}`. Omit empty sources (don't emit empty arrays).

### 3. `src/index.ts` — Env type ONLY
Add to the existing `Env` type (minimal diff, do not touch routes):
```ts
SEARCH_PROVIDER?: string;       // "searxng" | "ddg" | "browser"
SEARCH_FALLBACK?: string;       // "ddg" | "browser" | "none"
SEARXNG_ENDPOINT?: string;
SEARXNG_ENGINES?: string;
SEARXNG_HEADERS?: string;       // JSON object of extra headers (CF Access etc.)
```

### 4. `tests/unit/search-searxng.test.ts`
Mock `globalThis.fetch`. Cover: web normalization + position; news publishedDate→date;
images resolution parse + img_src fallback; dedupe; pagination stop-on-empty;
`limit` slicing; domain filter query building; `safe:true` → `safesearch=2`;
403 warning text; all-sources-fail throws; fail-soft (news fails, web still returned).
Use a minimal `env` stub `{ SEARXNG_ENDPOINT: "https://sx.example", ... } as unknown as Env`.

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` green. No new deps.

## Do NOT
- touch route registration beyond the Env fields listed
- implement the DDG or browser providers (separate specs)
- send `country`/`location` to SearXNG (unsupported — ignore them here; DDG handles geo)
