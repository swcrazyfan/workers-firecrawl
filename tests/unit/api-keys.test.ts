import { env } from "cloudflare:test";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	createApiKey,
	findActiveApiKey,
	generateApiKey,
	hashToken,
	listApiKeys,
	revokeApiKey,
	timingSafeEqual,
} from "../../src/apiKeys";
import type { Env } from "../../src/index";
import { V2KeysCreate, V2KeysList, V2KeysRevoke } from "../../src/v2/keys";

const MASTER = "test-master-key";

function keyedEnv(overrides: Partial<Env> = {}): Env {
	return { ...(env as unknown as Env), AUTHORIZATION_KEY: MASTER, ...overrides };
}

function createApp() {
	const hono = new Hono<{ Bindings: Env }>();
	const openapi = fromHono(hono, { docs_url: "/" });
	openapi.post("/v2/keys", V2KeysCreate);
	openapi.get("/v2/keys", V2KeysList);
	openapi.delete("/v2/keys/:id", V2KeysRevoke);
	return hono;
}

async function call(
	method: string,
	path: string,
	options: { body?: unknown; token?: string; bindings?: Env } = {},
) {
	const headers: Record<string, string> = {};
	if (options.body !== undefined) headers["Content-Type"] = "application/json";
	if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
	return createApp().request(
		path,
		{
			method,
			headers,
			...(options.body !== undefined && { body: JSON.stringify(options.body) }),
		},
		options.bindings ?? keyedEnv(),
	);
}

describe("api key generation", () => {
	it("produces a marked, prefixed, unique token", () => {
		const first = generateApiKey();
		const second = generateApiKey();
		expect(first.token.startsWith("wfc-")).toBe(true);
		expect(first.token.length).toBeGreaterThan(40);
		expect(first.prefix).toBe(first.token.slice(0, 12));
		expect(first.id.startsWith("key_")).toBe(true);
		expect(first.token).not.toBe(second.token);
		expect(first.id).not.toBe(second.id);
	});

	it("hashes deterministically and compares in constant time", async () => {
		const token = "wfc-abc";
		expect(await hashToken(token)).toBe(await hashToken(token));
		expect(await hashToken(token)).not.toBe(await hashToken("wfc-abd"));
		expect(await timingSafeEqual("same", "same")).toBe(true);
		expect(await timingSafeEqual("same", "diff")).toBe(false);
		expect(await timingSafeEqual("short", "a-much-longer-value")).toBe(false);
	});
});

describe("api key store", () => {
	it("creates, lists, revokes and resolves a key", async () => {
		const created = await createApiKey(env.DB, { name: "hermes" });
		expect(created.key.startsWith("wfc-")).toBe(true);
		expect(created.expiresAt).toBeUndefined();

		const listed = await listApiKeys(env.DB);
		const mine = listed.find((item) => item.id === created.id);
		expect(mine?.name).toBe("hermes");
		expect(mine?.prefix).toBe(created.prefix);
		expect(mine?.revokedAt).toBeUndefined();
		// The list must never expose the secret or its hash.
		expect(JSON.stringify(listed)).not.toContain(created.key);

		expect(await findActiveApiKey(env.DB, created.key)).toEqual({
			id: created.id,
		});

		expect(await revokeApiKey(env.DB, created.id)).toBe(true);
		expect(await findActiveApiKey(env.DB, created.key)).toBeNull();
		// Revoking twice is idempotent.
		expect(await revokeApiKey(env.DB, created.id)).toBe(true);
		expect(await revokeApiKey(env.DB, "key_missing")).toBe(false);
	});

	it("stores expiry and rejects expired keys", async () => {
		const created = await createApiKey(env.DB, { expiresInDays: 1 });
		expect(created.expiresAt).toBeDefined();
		expect(await findActiveApiKey(env.DB, created.key)).not.toBeNull();

		await env.DB.prepare("UPDATE api_keys SET expires_at = ? WHERE id = ?")
			.bind(Date.now() - 1000, created.id)
			.run();
		expect(await findActiveApiKey(env.DB, created.key)).toBeNull();
	});

	it("never queries D1 for tokens without the marker, and fails closed on DB errors", async () => {
		let queried = false;
		const spyDb = {
			prepare() {
				queried = true;
				return { bind: () => ({ first: async () => null }) };
			},
		} as unknown as D1Database;
		expect(await findActiveApiKey(spyDb, "not-our-format")).toBeNull();
		expect(queried).toBe(false);

		const throwingDb = {
			prepare() {
				throw new Error("no such table: api_keys");
			},
		} as unknown as D1Database;
		expect(await findActiveApiKey(throwingDb, "wfc-something")).toBeNull();
	});
});

describe("api key routes", () => {
	it("creates a key with the master key and returns the secret once", async () => {
		const res = await call("POST", "/v2/keys", {
			body: { name: "agent-a", expiresInDays: 30 },
			token: MASTER,
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.key.startsWith("wfc-")).toBe(true);
		expect(body.data.name).toBe("agent-a");
		expect(body.data.expiresAt).toBeDefined();

		// Subsequent list must not include the secret.
		const list = await call("GET", "/v2/keys", { token: MASTER });
		const listBody = await list.json();
		expect(listBody.data.some((k: { id: string }) => k.id === body.data.id)).toBe(
			true,
		);
		expect(JSON.stringify(listBody)).not.toContain(body.data.key);
	});

	it("revokes a key and reports unknown ids", async () => {
		const created = await call("POST", "/v2/keys", {
			body: {},
			token: MASTER,
		});
		const { data } = await created.json();

		const res = await call("DELETE", `/v2/keys/${data.id}`, { token: MASTER });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual({ id: data.id, revoked: true });

		const missing = await call("DELETE", "/v2/keys/key_missing", {
			token: MASTER,
		});
		expect(missing.status).toBe(404);
	});

	it("rejects a stored API key on admin routes with 403", async () => {
		const created = await createApiKey(env.DB, { name: "not-admin" });
		const res = await call("POST", "/v2/keys", {
			body: {},
			token: created.key,
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toBe("Forbidden: admin key required");
	});

	it("keeps admin routes open when no secret is configured", async () => {
		const res = await call("POST", "/v2/keys", {
			body: { name: "open-mode" },
			bindings: { ...(env as unknown as Env), AUTHORIZATION_KEY: undefined },
		});
		expect(res.status).toBe(201);
	});

	it("prefers ADMIN_KEY over AUTHORIZATION_KEY for the admin gate", async () => {
		const bindings = keyedEnv({ ADMIN_KEY: "admin-secret" });
		expect(
			(await call("GET", "/v2/keys", { token: "admin-secret", bindings }))
				.status,
		).toBe(200);
		expect(
			(await call("GET", "/v2/keys", { token: MASTER, bindings })).status,
		).toBe(403);
	});
});
