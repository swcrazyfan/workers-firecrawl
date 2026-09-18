// API key helpers + D1 store (spec 018).
//
// Security model: the plaintext token is returned exactly once at creation and
// is never persisted. The table keeps only the SHA-256 hash plus a display
// prefix. All comparisons are constant-time over fixed-length digests.

const KEY_PREFIX = "wfc-";
const TOKEN_BYTES = 32;
const ID_BYTES = 6; // 12 hex chars

export interface ApiKeyRecord {
	id: string;
	key_hash: string;
	prefix: string;
	name: string | null;
	created_at: number;
	last_used_at: number | null;
	expires_at: number | null;
	revoked_at: number | null;
}

export interface CreatedApiKey {
	id: string;
	key: string;
	prefix: string;
	name?: string;
	createdAt: string;
	expiresAt?: string;
}

export interface ListedApiKey {
	id: string;
	prefix: string;
	name?: string;
	createdAt: string;
	lastUsedAt?: string;
	expiresAt?: string;
	revokedAt?: string;
}

export interface CreateApiKeyOptions {
	name?: string;
	expiresInDays?: number;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// 32 random bytes → ~256 bits of entropy; `wfc-` marks the key so the auth
// middleware can skip the D1 lookup for unrelated bearers.
export function generateApiKey(): {
	token: string;
	id: string;
	prefix: string;
} {
	const token = `${KEY_PREFIX}${base64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))}`;
	const id = `key_${toHex(crypto.getRandomValues(new Uint8Array(ID_BYTES)))}`;
	return { token, id, prefix: token.slice(0, 12) };
}

export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return toHex(new Uint8Array(digest));
}

// Hashing both sides makes the comparison fixed-length, so no length-based
// early exit (or length leak) is possible; the XOR loop never short-circuits.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
	const [left, right] = await Promise.all([hashToken(a), hashToken(b)]);
	let diff = 0;
	for (let i = 0; i < left.length; i += 1) {
		diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
	}
	return diff === 0;
}

function iso(epochMs: number | null): string | undefined {
	return epochMs === null ? undefined : new Date(epochMs).toISOString();
}

export async function createApiKey(
	db: D1Database,
	options: CreateApiKeyOptions = {},
): Promise<CreatedApiKey> {
	const { token, id, prefix } = generateApiKey();
	const now = Date.now();
	const expiresAt =
		options.expiresInDays === undefined
			? null
			: now + options.expiresInDays * 24 * 60 * 60 * 1000;
	const keyHash = await hashToken(token);

	await db
		.prepare(
			"INSERT INTO api_keys (id, key_hash, prefix, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.bind(id, keyHash, prefix, options.name ?? null, now, expiresAt)
		.run();

	const created: CreatedApiKey = {
		id,
		key: token,
		prefix,
		createdAt: new Date(now).toISOString(),
	};
	if (options.name !== undefined) created.name = options.name;
	if (expiresAt !== null) created.expiresAt = new Date(expiresAt).toISOString();
	return created;
}

function toListed(record: ApiKeyRecord): ListedApiKey {
	const item: ListedApiKey = {
		id: record.id,
		prefix: record.prefix,
		createdAt: new Date(record.created_at).toISOString(),
	};
	if (record.name !== null) item.name = record.name;
	const lastUsedAt = iso(record.last_used_at);
	if (lastUsedAt !== undefined) item.lastUsedAt = lastUsedAt;
	const expiresAt = iso(record.expires_at);
	if (expiresAt !== undefined) item.expiresAt = expiresAt;
	const revokedAt = iso(record.revoked_at);
	if (revokedAt !== undefined) item.revokedAt = revokedAt;
	return item;
}

export async function listApiKeys(db: D1Database): Promise<ListedApiKey[]> {
	const result = await db
		.prepare(
			"SELECT id, key_hash, prefix, name, created_at, last_used_at, expires_at, revoked_at FROM api_keys ORDER BY created_at DESC",
		)
		.all<ApiKeyRecord>();
	return (result.results ?? []).map(toListed);
}

// Returns false when the id is unknown. A repeat revoke is idempotent and
// reports true (the key is already gone), which is what callers want.
export async function revokeApiKey(
	db: D1Database,
	id: string,
): Promise<boolean> {
	const existing = await db
		.prepare("SELECT id, revoked_at FROM api_keys WHERE id = ?")
		.bind(id)
		.first<{ id: string; revoked_at: number | null }>();
	if (existing === null) return false;
	if (existing.revoked_at === null) {
		await db
			.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?")
			.bind(Date.now(), id)
			.run();
	}
	return true;
}

// Auth hot path. Guarded by the `wfc-` marker so unrelated bearers never hit
// D1, and defensive about a missing table (pre-migration deploy) or D1 error —
// an auth lookup must fail closed (401), never 500.
export async function findActiveApiKey(
	db: D1Database | undefined,
	token: string,
): Promise<{ id: string } | null> {
	if (db === undefined || !token.startsWith(KEY_PREFIX)) return null;
	try {
		const keyHash = await hashToken(token);
		const record = await db
			.prepare(
				"SELECT id, revoked_at, expires_at FROM api_keys WHERE key_hash = ?",
			)
			.bind(keyHash)
			.first<{
				id: string;
				revoked_at: number | null;
				expires_at: number | null;
			}>();
		if (record === null) return null;
		if (record.revoked_at !== null) return null;
		if (record.expires_at !== null && record.expires_at <= Date.now()) {
			return null;
		}
		return { id: record.id };
	} catch {
		return null;
	}
}

export async function touchApiKey(db: D1Database, id: string): Promise<void> {
	await db
		.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
		.bind(Date.now(), id)
		.run();
}
