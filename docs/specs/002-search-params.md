# Spec 002 — Search parameter mapping module

Task slug: `search-params`. Branch: `feat/v2-port-002-search-params`.

## Why
Both search backends need correct mappings from Firecrawl v2 search params
(`tbs`, `country`, `lang`, `location`, domain filters) to backend-native params.
The legacy fork has ~976 lines of region tables with known bugs — compress and fix,
don't copy.

## Reference source (read-only)
`git show origin/crawl:src/utils/searchParams.ts` — legacy tables and logic.

## Scope — create EXACTLY these files

### 1. `src/search/params.ts`

Exports (exact names/signatures — other modules depend on them):

```ts
export interface TbsMapping { df?: string; timeRange?: "day" | "week" | "month" | "year"; warnings: string[] }
export function mapTbs(tbs: string | undefined): TbsMapping

export function klFrom(input: { country?: string; lang?: string; location?: string }): string

export function buildDomainQuery(query: string, opts: { includeDomains?: string[]; excludeDomains?: string[] }): string
```

Behavior:

- **`mapTbs`** — input is Firecrawl-style `tbs`:
  - `qdr:d`→`df:"d", timeRange:"day"`; `qdr:w`→`"w"/"week"`; `qdr:m`→`"m"/"month"`; `qdr:y`→`"y"/"year"`
  - `qdr:h`→ map to `"d"/"day"` + warning `"qdr:h unsupported, using day"`
  - `cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY` → `df:"YYYY-MM-DD..YYYY-MM-DD"` (ISO reorder —
    legacy had a bug emitting `MM-DD-YYYY`; do it right) AND approximate `timeRange` from span:
    `<2 days → day`, `<14 → week`, `<60 → month`, else `year`, + warning `"custom date range approximated for time_range"`
  - bare `d|w|m|y` or `day|week|month|year` pass through
  - `sbd:1` (sort by date) → drop + warning `"sbd:1 sort-by-date unsupported"`
  - anything else → drop + warning `tbs "<value>" not recognized`
  - undefined/empty input → `{}` (no warnings)
- **`klFrom`** — DDG `kl` region code (`"us-en"`, `"uk-en"`, `"de-de"`, `"mx-es"`…):
  - Compress legacy's if-chains into plain data objects: `LOCATION_MAP` (city/region names → code),
    `COUNTRY_LANG_MAP` (`"us:en"`-keyed), `COUNTRY_MAP` (country-only), `LANG_MAP` (lang-only).
  - Resolution order: exact location name → country+lang → country-only → lang-only → `"us-en"`.
  - Lowercase + trim all inputs. Only accept location strings ≥ 3 chars that match
    `/^[a-z ,.'-]+$/` (legacy's substring matching was buggy: `"Russia"` contains `"us"`).
  - **Fixes vs legacy** (encode as tests): `Mexico → mx-es` (legacy wrongly said `es-mx`),
    `United Kingdom → uk-en`, `Germany → de-de`, `Japan → jp-jp`, `Brazil → br-pt`.
  - Port at least the ~40 most common countries fully; for the long tail, port legacy's
    fallback chains (country-only → lang-only). You may keep the full tables if you
    restructure them as compact `Record<string,string>` literals — no if/else chains.
- **`buildDomainQuery`** — append ` site:a.com OR site:b.com` for includeDomains and
  ` -site:x.com` for excludeDomains, space-joined, NOT parenthesized (some engines drop
  parenthesized groups). Return original query unchanged when both empty.

### 2. `tests/unit/search-params.test.ts`

Vitest, pure unit tests (no worker pool fixtures needed). Cover:
- every `tbs` case above incl. warnings text
- cdr ISO reorder regression: `cdr:1,cd_min:09/01/2026,cd_max:09/15/2026` → `df:"2026-09-01..2026-09-15"`, `timeRange:"week"`
- `klFrom` fixes: Mexico/UK/Germany/Japan/Brazil; case-insensitivity; `location:"Russia"` must NOT resolve via substring `us`; unknown country falls back correctly
- `buildDomainQuery` include/exclude/unchanged cases

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` all green. File count: exactly 2 new files.

## Do NOT
- modify `src/index.ts` or any other file
- add dependencies
- copy legacy `buildDuckDuckGoUrl`/`ia`/`iax` logic (that targets the DDG JS site; not used)
