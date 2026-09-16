import { fileURLToPath } from "node:url";
import {
	defineWorkersConfig,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Resolve relative to this config file so the path is stable regardless of the
// working directory vitest is invoked from (`vitest run --root tests`).
const migrationsDirectory = fileURLToPath(
	new URL("../migrations", import.meta.url),
);

export default defineWorkersConfig(async () => {
	const migrations = await readD1Migrations(migrationsDirectory);

	return {
		test: {
			setupFiles: ["./setup.ts"],
			poolOptions: {
				workers: {
					wrangler: {
						configPath: "./wrangler.toml",
					},
					miniflare: {
						bindings: { TEST_MIGRATIONS: migrations },
						compatibilityFlags: ["nodejs_compat"],
						compatibilityDate: "2025-01-28",
					},
				},
			},
		},
	};
});
