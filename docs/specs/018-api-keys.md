# Spec 018 — API key management

Task slug: `api-keys`. Branch: `feat/v2-port-018-api-keys`.

## Why

Today auth is a single static bearer token (`AUTHORIZATION_KEY`, checked in
`src/authorization.ts`). Operators need to mint per-client keys (one per agent
/ integration), list them, and revoke them without rotating the master secret
or redeploying. D1 is already bound and holds crawl state, so the key store
needs no new infrastructure.

## Security model (locked)

- **Plaintext is never stored.** The full key is returned exactly once, at
  creation; the table keeps only `sha256(token)` plus a display prefix.
- Master/admin secrets stay Cloudflare secrets (`AUTHORIZATION_KEY`,
  new `ADMIN_KEY`).
- Comparison is constant-time over fixed-length SHA-256 digests (no
  length-based early exit).
- Keys are revocable (`revoked_at`) and optionally expiring (`expires_at`).
- A normal API key is rejected on the admin endpoints; the master/admin key
  works everywhere.

## Scope

### 1. Migration `migrations/0002_api_keys.sql`

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
```

### 2. New `src/apiKeys.ts` — helpers + D1 store

No route concerns here; pure/testable, D1 access in the repo's
`db.prepare(...).bind(...)` style.

- `generateApiKey(): { token, id, prefix }` — `wfc-` + base64url of 32 random
  bytes (`crypto.getRandomValues`); `id` = `key_` + 12 hex chars; `prefix` =
  first 12 chars of the token (display only).
- `hashToken(token): Promise<string>` — SHA-256 hex via `crypto.subtle`.
- `timingSafeEqual(a, b): Promise<boolean>` — hash both, XOR-accumulate the
  digests, no early exit.
- `createApiKey(db, { name?, expiresInDays? })` → `{ id, key, name, prefix,
  createdAt, expiresAt? }` (the ONLY time `key` is returned).
- `listApiKeys(db)` → array without hashes/tokens.
- `revokeApiKey(db, id)` → boolean (false when the id is unknown; a second
  revoke is idempotent and returns true).
- `findActiveApiKey(db, token)` → `{ id } | null`; hash lookup, rejects
  revoked/expired rows. Guarded by `token.startsWith("wfc-")` and wrapped so a
  missing table (pre-migration) or D1 error returns `null` instead of 500.

### 3. `src/authorization.ts` — accept master OR stored key

Order of checks:
1. Neither `AUTHORIZATION_KEY` nor `ADMIN_KEY` configured (empty/whitespace
   counts as unset) → allow (preserves today's open-mode behavior and the
   existing tests).
2. Bearer equals **either** configured secret — `ADMIN_KEY` **and**
   `AUTHORIZATION_KEY` are both accepted as API masters, constant-time. This
   is deliberate: setting `ADMIN_KEY` must not lock out existing
   `AUTHORIZATION_KEY` clients (Hermes keeps working).
3. Bearer starts with `wfc-` and `env.DB` exists → `findActiveApiKey`; on a
   hit, allow and best-effort touch `last_used_at` (`waitUntil` when an
   execution context exists, awaited otherwise so the write is never a
   floating promise).
4. Otherwise 401 `{ success: false, error: "Unauthorized: Invalid token" }`.

`AUTHORIZATION_KEY` keeps working unchanged, so Hermes and the current
deployment config are unaffected.

### 4. New `src/v2/keys.ts` — admin routes

Admin gate: bearer must equal `ADMIN_KEY` when configured, otherwise
`AUTHORIZATION_KEY` (constant-time); when neither is configured the routes
stay open (consistent with open mode). A D1-backed key that passed the global
middleware gets **403** `Forbidden: admin key required` here.

- `POST /v2/keys` — body `{ name?: string(≤100), expiresInDays?: int 1..3650 }`
  → `201 { success: true, data: { id, key, name?, prefix, createdAt,
  expiresAt? } }`.
- `GET /v2/keys` — → `200 { success: true, data: [...] }` (no secrets).
- `DELETE /v2/keys/:id` — → `200 { success: true, data: { id, revoked: true } }`;
  unknown id → `404 { success: false, error: "API key not found" }`.

Timestamps are ISO-8601 strings at the response boundary (D1 stores epoch
millis), matching `/v2/crawl`'s convention.

### 5. `src/index.ts`

- `Env` gains `ADMIN_KEY?: string`.
- Register the three routes. Literal paths before parameterised ones.

### 6. Tests

- New `tests/unit/api-keys.test.ts`: generator shape/entropy (prefix, length,
  uniqueness across calls), hash determinism, `timingSafeEqual` (equal,
  different, different lengths), store CRUD against a fake D1 (create →
  list → revoke → find returns null), expiry/revocation rejection, missing
  table → null.
- Extend `tests/unit/authorization.test.ts`: a valid stored key is accepted;
  revoked/expired rejected; non-`wfc-` junk never hits D1 (assert the fake DB
  was not queried); master still works; `ADMIN_KEY` accepted; neither set →
  open.
- New route tests in `tests/unit/api-keys.test.ts` (chanfana/Hono, fake D1):
  create returns the token once and not in list; list omits hashes; revoke;
  a stored key on an admin route → 403; master on admin route → 200; unknown
  id → 404.

## Acceptance

`npm run lint`, `npm test`, `npx tsc --noEmit` — fully clean (616 baseline).

## Deploy note

Apply `0002_api_keys.sql` to D1 **before** uploading the new bundle (the
middleware tolerates the missing table, but keys cannot be created until it
exists). No new bindings; `ADMIN_KEY` is an optional secret.

## Do NOT

- store plaintext or reversible material, add a rotate endpoint, per-key rate
  limits/scopes, or usage counters (all noted as follow-ons), touch `/v1`
  routes, or change the response shape of existing endpoints.
