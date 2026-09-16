import type { D1Migration } from "cloudflare:test";

export type Env = {
	BROWSER: Fetcher;
	AUTHORIZATION_KEY?: string;
	DB: D1Database;
};

declare module "cloudflare:test" {
	interface ProvidedEnv extends Env {
		TEST_MIGRATIONS: D1Migration[];
	}
}
