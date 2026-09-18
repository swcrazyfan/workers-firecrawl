import { env as testEnv } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApiKey } from "../../src/apiKeys";
import { authorizationMiddleware } from "../../src/authorization";
import type { Env } from "../../src/index";

function createApp() {
	const app = new Hono<{ Bindings: Env }>();
	app.use("*", authorizationMiddleware);
	app.all("*", (c) => c.json({ success: true }));
	return app;
}

describe("Authorization Middleware", () => {
	describe("when AUTHORIZATION_KEY is configured", () => {
		const env = { AUTHORIZATION_KEY: "test-secret-key" };

		it("rejects requests without Authorization header", async () => {
			const app = createApp();
			const res = await app.request("/", { method: "GET" }, env);

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error).toContain("Unauthorized");
		});

		it("rejects requests with invalid Bearer token", async () => {
			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: "Bearer wrong-key" },
				},
				env,
			);

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.success).toBe(false);
		});

		it("rejects requests with malformed Authorization header", async () => {
			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: "test-secret-key" },
				},
				env,
			);

			expect(res.status).toBe(401);
		});

		it("allows requests with valid Bearer token", async () => {
			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: "Bearer test-secret-key" },
				},
				env,
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	describe("when AUTHORIZATION_KEY is not configured", () => {
		const env = {};

		it("allows all requests without any auth header", async () => {
			const app = createApp();
			const res = await app.request("/", { method: "GET" }, env);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});

		it("allows requests even with an arbitrary auth header", async () => {
			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: "Bearer anything" },
				},
				env,
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	describe("stored API keys (spec 018)", () => {
		it("accepts a valid D1-backed key and stamps last_used_at", async () => {
			const created = await createApiKey(testEnv.DB, { name: "auth-test" });
			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: `Bearer ${created.key}` },
				},
				{ AUTHORIZATION_KEY: "master", DB: testEnv.DB } as unknown as Env,
			);
			expect(res.status).toBe(200);

			const row = await testEnv.DB.prepare(
				"SELECT last_used_at FROM api_keys WHERE id = ?",
			)
				.bind(created.id)
				.first<{ last_used_at: number | null }>();
			expect(row.last_used_at).not.toBeNull();
		});

		it("rejects a revoked key", async () => {
			const created = await createApiKey(testEnv.DB, { name: "revoked-test" });
			await testEnv.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?")
				.bind(Date.now(), created.id)
				.run();
			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: `Bearer ${created.key}` },
				},
				{ AUTHORIZATION_KEY: "master", DB: testEnv.DB } as unknown as Env,
			);
			expect(res.status).toBe(401);
		});

		it("only queries D1 for bearers carrying the key marker", async () => {
			let queried = false;
			const spyDb = {
				prepare() {
					queried = true;
					return { bind: () => ({ first: async () => null }) };
				},
			} as unknown as D1Database;

			const app = createApp();
			const res = await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: "Bearer plain-wrong-token" },
				},
				{ AUTHORIZATION_KEY: "master", DB: spyDb } as unknown as Env,
			);
			expect(res.status).toBe(401);
			expect(queried).toBe(false);

			await app.request(
				"/",
				{
					method: "GET",
					headers: { Authorization: "Bearer wfc-not-a-real-key" },
				},
				{ AUTHORIZATION_KEY: "master", DB: spyDb } as unknown as Env,
			);
			expect(queried).toBe(true);
		});

		it("enforces auth when only ADMIN_KEY is configured", async () => {
			const app = createApp();
			const env = { ADMIN_KEY: "admin-only" } as unknown as Env;
			expect((await app.request("/", { method: "GET" }, env)).status).toBe(401);
			expect(
				(
					await app.request(
						"/",
						{
							method: "GET",
							headers: { Authorization: "Bearer admin-only" },
						},
						env,
					)
				).status,
			).toBe(200);
		});
	});
});
