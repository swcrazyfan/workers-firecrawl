import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import {
	createApiKey,
	listApiKeys,
	revokeApiKey,
	timingSafeEqual,
} from "../apiKeys";
import type { AppContext } from "../index";

// Admin gate (spec 018): the master/admin secret opens these routes; a
// D1-backed key that satisfied the global middleware does NOT. When no secret
// is configured the deployment is in open mode, so the routes stay open too —
// consistent with `authorizationMiddleware`.
async function requireAdmin(c: AppContext): Promise<Response | null> {
	const master = c.env.ADMIN_KEY ?? c.env.AUTHORIZATION_KEY;
	if (!master) return null;
	const header = c.req.header("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7) : "";
	if (token !== "" && (await timingSafeEqual(token, master))) return null;
	return Response.json(
		{ success: false, error: "Forbidden: admin key required" },
		{ status: 403 },
	);
}

const keySummarySchema = z.object({
	id: z.string(),
	prefix: z.string(),
	name: z.string().optional(),
	createdAt: z.string(),
	lastUsedAt: z.string().optional(),
	expiresAt: z.string().optional(),
	revokedAt: z.string().optional(),
});

export class V2KeysCreate extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							name: z.string().max(100).optional(),
							expiresInDays: z.number().int().min(1).max(3650).optional(),
						}),
					},
				},
			},
		},
		responses: {
			201: {
				description: "API key created — `key` is returned only once",
				...contentJson(
					z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							key: z.string(),
							prefix: z.string(),
							name: z.string().optional(),
							createdAt: z.string(),
							expiresAt: z.string().optional(),
						}),
					}),
				),
			},
			403: {
				description: "Admin key required",
				...contentJson(
					z.object({ success: z.literal(false), error: z.string() }),
				),
			},
		},
	};

	async handle(c: AppContext) {
		const denied = await requireAdmin(c);
		if (denied !== null) return denied;
		const data = await this.getValidatedData<typeof this.schema>();
		const created = await createApiKey(c.env.DB, {
			name: data.body.name,
			expiresInDays: data.body.expiresInDays,
		});
		return Response.json({ success: true, data: created }, { status: 201 });
	}
}

export class V2KeysList extends OpenAPIRoute {
	schema = {
		responses: {
			200: {
				description: "API keys (secrets are never included)",
				...contentJson(
					z.object({
						success: z.literal(true),
						data: keySummarySchema.array(),
					}),
				),
			},
			403: {
				description: "Admin key required",
				...contentJson(
					z.object({ success: z.literal(false), error: z.string() }),
				),
			},
		},
	};

	async handle(c: AppContext) {
		const denied = await requireAdmin(c);
		if (denied !== null) return denied;
		const keys = await listApiKeys(c.env.DB);
		return { success: true, data: keys };
	}
}

export class V2KeysRevoke extends OpenAPIRoute {
	schema = {
		request: {
			params: z.object({ id: z.string().min(1) }),
		},
		responses: {
			200: {
				description: "API key revoked",
				...contentJson(
					z.object({
						success: z.literal(true),
						data: z.object({ id: z.string(), revoked: z.literal(true) }),
					}),
				),
			},
			403: {
				description: "Admin key required",
				...contentJson(
					z.object({ success: z.literal(false), error: z.string() }),
				),
			},
			404: {
				description: "Unknown API key id",
				...contentJson(
					z.object({ success: z.literal(false), error: z.string() }),
				),
			},
		},
	};

	async handle(c: AppContext) {
		const denied = await requireAdmin(c);
		if (denied !== null) return denied;
		const data = await this.getValidatedData<typeof this.schema>();
		const revoked = await revokeApiKey(c.env.DB, data.params.id);
		if (!revoked) {
			return Response.json(
				{ success: false, error: "API key not found" },
				{ status: 404 },
			);
		}
		return { success: true, data: { id: data.params.id, revoked: true } };
	}
}
