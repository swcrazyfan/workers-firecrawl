import { applyD1Migrations, env } from "cloudflare:test";

// Runs outside isolated storage, before each test file. `applyD1Migrations` is
// idempotent (it records applied migrations in `d1_migrations`), so the crawl
// schema is present for every test against the real local D1 binding.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
