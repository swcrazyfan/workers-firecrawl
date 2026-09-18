import { findActiveApiKey, timingSafeEqual, touchApiKey } from "./apiKeys";
import type { AppContext, Env } from "./index";

// Auth (spec 018): the master secret(s) keep working exactly as before;
// additionally, `wfc-`-prefixed tokens are looked up in D1 (hash-only store).
// The D1 lookup is skipped unless the bearer has our marker, so unrelated
// junk never costs a query.

export function bearerToken(c: AppContext): string {
	const header = c.req.header("authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7) : "";
}

// Empty/whitespace secrets are treated as unset: `??` alone would let an empty
// ADMIN_KEY shadow a real AUTHORIZATION_KEY and open the API.
export function configuredSecret(
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

// Both secrets are accepted as API masters here. Setting ADMIN_KEY must not
// lock out existing AUTHORIZATION_KEY clients (Hermes); the admin routes
// themselves require ADMIN_KEY when it is configured.
export function masterSecrets(env: Env): string[] {
	return [
		configuredSecret(env.ADMIN_KEY),
		configuredSecret(env.AUTHORIZATION_KEY),
	].filter((secret): secret is string => secret !== undefined);
}

export async function authorizationMiddleware(
	c: AppContext,
	next: CallableFunction,
) {
	const masters = masterSecrets(c.env);
	if (masters.length === 0) {
		// Open mode (no secret configured) — unchanged legacy behavior.
		return next();
	}

	const token = bearerToken(c);
	if (token !== "") {
		// Fail closed on an unexpected crypto failure rather than 500.
		try {
			for (const master of masters) {
				if (await timingSafeEqual(token, master)) return next();
			}
		} catch {
			// fall through to the D1 check / 401
		}
	}

	const active = await findActiveApiKey(c.env.DB, token);
	if (active !== null) {
		// Best-effort usage stamp; never block or fail the request on it.
		const touch = touchApiKey(c.env.DB, active.id).catch(() => {});
		try {
			c.executionCtx.waitUntil(touch);
		} catch {
			// No execution context (unit tests, non-Worker hosts): await so the
			// write is never a floating promise.
			await touch;
		}
		return next();
	}

	return Response.json(
		{ success: false, error: "Unauthorized: Invalid token" },
		{ status: 401 },
	);
}
