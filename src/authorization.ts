import { findActiveApiKey, timingSafeEqual, touchApiKey } from "./apiKeys";
import type { AppContext } from "./index";

// Auth (spec 018): the master/admin secret keeps working exactly as before;
// additionally, `wfc-`-prefixed tokens are looked up in D1 (hash-only store).
// The D1 lookup is skipped unless the bearer has our marker, so unrelated
// junk never costs a query.

function bearer(c: AppContext): string {
	const header = c.req.header("authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function authorizationMiddleware(
	c: AppContext,
	next: CallableFunction,
) {
	const master = c.env.ADMIN_KEY ?? c.env.AUTHORIZATION_KEY;
	if (!master) {
		// Open mode (no secret configured) — unchanged legacy behavior.
		return next();
	}

	const token = bearer(c);
	if (token !== "" && (await timingSafeEqual(token, master))) {
		return next();
	}

	const active = await findActiveApiKey(c.env.DB, token);
	if (active !== null) {
		// Best-effort usage stamp; never block or fail the request on it.
		const touch = touchApiKey(c.env.DB, active.id).catch(() => {});
		try {
			c.executionCtx.waitUntil(touch);
		} catch {
			void touch;
		}
		return next();
	}

	return Response.json(
		{ success: false, error: "Unauthorized: Invalid token" },
		{ status: 401 },
	);
}
