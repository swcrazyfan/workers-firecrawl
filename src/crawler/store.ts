/**
 * Pure D1 access layer for crawl jobs.
 *
 * Every function takes the `D1Database` first so the layer is testable against
 * the real local D1 binding (`@cloudflare/vitest-pool-workers`), and so the
 * Workflow engine (task 012) can reuse it without any HTTP coupling.
 *
 * Conventions:
 * - timestamps are epoch milliseconds.
 * - values are always passed through `.bind()`, never interpolated into SQL.
 * - JSON columns are encoded on write and parsed defensively on read: invalid
 *   JSON resolves to `null` instead of throwing.
 */

export type CrawlStatus = "scraping" | "completed" | "failed" | "cancelled";

export interface CrawlJobRow {
	id: string;
	url: string;
	status: CrawlStatus;
	total: number;
	completed: number;
	error: string | null;
	created_at: number;
	updated_at: number;
	expires_at: number;
	completed_at: number | null;
}

export interface CrawlQueueItem {
	id: number;
	url: string;
	depth: number;
}

export interface CrawlResultRow {
	id: number;
	url: string;
	status: string;
	status_code: number | null;
	markdown: string | null;
	html: string | null;
	raw_html: string | null;
	links: string[] | null;
	metadata: unknown;
	json: unknown;
	error: string | null;
}

export interface CrawlJobError {
	id: number;
	timestamp: number;
	url: string;
	error: string;
}

export interface CrawlJobErrors {
	errors: CrawlJobError[];
	robotsBlocked: string[];
}

export interface ActiveCrawlJob {
	id: string;
	url: string;
	status: string;
	total: number;
	completed: number;
	created_at: number;
}

// Read caps for the auxiliary crawl endpoints. The crawl surface is
// intentionally pagination-free, so these are hard caps rather than cursors.
const DEFAULT_AUX_LIMIT = 100;

// Mirrors `ROBOTS_DISALLOWED` in `src/crawler/engine.ts`. Declared here rather
// than imported because the engine already imports this module; importing back
// would create a cycle. Both spellings must stay identical.
const ROBOTS_DISALLOWED = "robots.txt disallowed";

// Defensive cap resolution: a missing, non-finite or non-positive limit falls
// back to the default instead of erroring or returning nothing.
function resolveAuxLimit(limit?: number): number {
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
		return DEFAULT_AUX_LIMIT;
	}
	return Math.trunc(limit);
}

const JOB_COLUMNS =
	"id, url, status, total, completed, error, created_at, updated_at, expires_at, completed_at";

const RESULT_COLUMNS =
	"id, url, status, status_code, markdown, html, raw_html, links, metadata, json, error";

// `undefined`/`null` map to SQL NULL; anything else is JSON encoded. Encoding
// failures degrade to NULL instead of failing the whole insert.
function toJson(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	try {
		const encoded = JSON.stringify(value);
		return encoded === undefined ? null : encoded;
	} catch {
		return null;
	}
}

function parseJson(value: unknown): unknown {
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function parseJsonArray(value: unknown): string[] | null {
	const parsed = parseJson(value);
	if (!Array.isArray(parsed)) return null;
	return parsed.filter((item): item is string => typeof item === "string");
}

export async function createJob(
	db: D1Database,
	row: {
		id: string;
		url: string;
		options: unknown;
		now: number;
		expiresAt: number;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO crawl_jobs (id, url, status, options, total, completed, created_at, updated_at, expires_at)
			 VALUES (?, ?, 'scraping', ?, 0, 0, ?, ?, ?)`,
		)
		.bind(row.id, row.url, toJson(row.options), row.now, row.now, row.expiresAt)
		.run();
}

export async function getJob(
	db: D1Database,
	id: string,
): Promise<CrawlJobRow | null> {
	const row = await db
		.prepare(`SELECT ${JOB_COLUMNS} FROM crawl_jobs WHERE id = ?`)
		.bind(id)
		.first<CrawlJobRow>();
	return row ?? null;
}

export async function setJobStatus(
	db: D1Database,
	id: string,
	status: CrawlStatus,
	patch?: { error?: string | null; completedAt?: number | null },
): Promise<void> {
	// Only the column names are interpolated; every value is bound.
	const assignments = ["status = ?", "updated_at = ?"];
	const values: unknown[] = [status, Date.now()];

	if (patch && "error" in patch) {
		assignments.push("error = ?");
		values.push(patch.error ?? null);
	}
	if (patch && "completedAt" in patch) {
		assignments.push("completed_at = ?");
		values.push(patch.completedAt ?? null);
	}

	values.push(id);
	await db
		.prepare(`UPDATE crawl_jobs SET ${assignments.join(", ")} WHERE id = ?`)
		.bind(...values)
		.run();
}

// Additive counter update in a single statement so concurrent bumps cannot
// clobber each other via a read-modify-write.
export async function bumpJobCounters(
	db: D1Database,
	id: string,
	patch: { total?: number; completed?: number; now: number },
): Promise<void> {
	const assignments = ["updated_at = ?"];
	const values: unknown[] = [patch.now];

	if (patch.total !== undefined) {
		assignments.push("total = total + ?");
		values.push(patch.total);
	}
	if (patch.completed !== undefined) {
		assignments.push("completed = completed + ?");
		values.push(patch.completed);
	}

	values.push(id);
	await db
		.prepare(`UPDATE crawl_jobs SET ${assignments.join(", ")} WHERE id = ?`)
		.bind(...values)
		.run();
}

// `INSERT OR IGNORE` against `UNIQUE(job_id, url)` makes enqueueing idempotent;
// the returned count is the number of rows actually inserted (ignored seeds
// contribute 0).
export async function enqueueUrls(
	db: D1Database,
	jobId: string,
	urls: { url: string; depth: number }[],
	now: number,
): Promise<number> {
	if (urls.length === 0) return 0;
	const statement = db.prepare(
		"INSERT OR IGNORE INTO crawl_queue (job_id, url, depth, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
	);
	const results = await db.batch(
		urls.map((item) => statement.bind(jobId, item.url, item.depth, now)),
	);
	let inserted = 0;
	for (const result of results) {
		inserted += result.meta?.changes ?? 0;
	}
	return inserted;
}

// Atomically flips up to `limit` pending items to `processing` and returns them
// in one statement. Two concurrent callers can never receive the same row.
export async function claimNextBatch(
	db: D1Database,
	jobId: string,
	limit: number,
): Promise<CrawlQueueItem[]> {
	const { results } = await db
		.prepare(
			`UPDATE crawl_queue SET status = 'processing'
			 WHERE id IN (
			   SELECT id FROM crawl_queue
			   WHERE job_id = ? AND status = 'pending'
			   ORDER BY id
			   LIMIT ?
			 )
			 RETURNING id, url, depth`,
		)
		.bind(jobId, limit)
		.all<CrawlQueueItem>();
	return results ?? [];
}

export async function markQueueItem(
	db: D1Database,
	id: number,
	status: "done" | "failed",
): Promise<void> {
	await db
		.prepare("UPDATE crawl_queue SET status = ? WHERE id = ?")
		.bind(status, id)
		.run();
}

// Releases claimed-but-unfinished rows back to `pending`. Only rows still in
// `processing` are touched, so items already marked done/failed are preserved.
// Used to make a retried Workflow batch idempotent: a step that throws after
// `claimNextBatch` must not orphan its rows, and a batch stopped by `limit`
// must return its remainder to the queue.
export async function resetQueueItems(
	db: D1Database,
	ids: number[],
): Promise<void> {
	if (ids.length === 0) return;
	const placeholders = ids.map(() => "?").join(", ");
	await db
		.prepare(
			`UPDATE crawl_queue SET status = 'pending'
			 WHERE status = 'processing' AND id IN (${placeholders})`,
		)
		.bind(...ids)
		.run();
}

export async function pendingQueueCount(
	db: D1Database,
	jobId: string,
): Promise<number> {
	const row = await db
		.prepare(
			"SELECT COUNT(*) AS count FROM crawl_queue WHERE job_id = ? AND status = 'pending'",
		)
		.bind(jobId)
		.first<{ count: number }>();
	return row?.count ?? 0;
}

export async function insertResult(
	db: D1Database,
	row: {
		jobId: string;
		url: string;
		status: string;
		statusCode?: number | null;
		markdown?: string | null;
		html?: string | null;
		rawHtml?: string | null;
		links?: unknown;
		metadata?: unknown;
		json?: unknown;
		error?: string | null;
		now: number;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO crawl_results
			 (job_id, url, status, status_code, markdown, html, raw_html, links, metadata, json, error, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			row.jobId,
			row.url,
			row.status,
			row.statusCode ?? null,
			row.markdown ?? null,
			row.html ?? null,
			row.rawHtml ?? null,
			toJson(row.links),
			toJson(row.metadata),
			toJson(row.json),
			row.error ?? null,
			row.now,
		)
		.run();
}

export async function listResults(
	db: D1Database,
	jobId: string,
	opts: { afterId?: number; limit: number },
): Promise<CrawlResultRow[]> {
	const hasAfterId =
		typeof opts.afterId === "number" && Number.isFinite(opts.afterId);
	const statement = db.prepare(
		hasAfterId
			? `SELECT ${RESULT_COLUMNS} FROM crawl_results WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT ?`
			: `SELECT ${RESULT_COLUMNS} FROM crawl_results WHERE job_id = ? ORDER BY id ASC LIMIT ?`,
	);
	const bound = hasAfterId
		? statement.bind(jobId, opts.afterId, opts.limit)
		: statement.bind(jobId, opts.limit);

	const { results } = await bound.all<{
		id: number;
		url: string;
		status: string;
		status_code: number | null;
		markdown: string | null;
		html: string | null;
		raw_html: string | null;
		links: string | null;
		metadata: string | null;
		json: string | null;
		error: string | null;
	}>();

	return (results ?? []).map((row) => ({
		id: row.id,
		url: row.url,
		status: row.status,
		status_code: row.status_code ?? null,
		markdown: row.markdown ?? null,
		html: row.html ?? null,
		raw_html: row.raw_html ?? null,
		links: parseJsonArray(row.links),
		metadata: parseJson(row.metadata),
		json: parseJson(row.json),
		error: row.error ?? null,
	}));
}

// Retention purge: a job is dropped once its `expires_at` is older than the
// grace window (`keepSeconds`). Queue and result rows are removed first so the
// orphaned children are gone even though the schema declares no foreign keys.
export async function purgeExpired(
	db: D1Database,
	now: number,
	keepSeconds: number,
): Promise<void> {
	const cutoff = now - keepSeconds * 1000;
	await db.batch([
		db
			.prepare(
				"DELETE FROM crawl_results WHERE job_id IN (SELECT id FROM crawl_jobs WHERE expires_at < ?)",
			)
			.bind(cutoff),
		db
			.prepare(
				"DELETE FROM crawl_queue WHERE job_id IN (SELECT id FROM crawl_jobs WHERE expires_at < ?)",
			)
			.bind(cutoff),
		db.prepare("DELETE FROM crawl_jobs WHERE expires_at < ?").bind(cutoff),
	]);
}

// Per-job failure log for `GET /crawl/{id}/errors`. `error IS NOT NULL` is
// explicit because a `failed` row may still carry a NULL error (e.g. a network
// failure recorded without a message); those are not reportable. Newest first
// is ordered by the autoincrement id, matching `listResults`' id-based order.
export async function listJobErrors(
	db: D1Database,
	jobId: string,
	limit?: number,
): Promise<CrawlJobErrors> {
	const cap = resolveAuxLimit(limit);

	const errorRows = await db
		.prepare(
			`SELECT id, created_at, url, error FROM crawl_results
			 WHERE job_id = ? AND status = 'failed' AND error IS NOT NULL
			 ORDER BY id DESC LIMIT ?`,
		)
		.bind(jobId, cap)
		.all<{ id: number; created_at: number; url: string; error: string }>();

	// Distinct, so a URL the engine retried stays a single entry. Deliberately
	// overlaps the `errors` list above: a robots-disallowed page is both a
	// reported error and a robots block.
	const robotsRows = await db
		.prepare(
			`SELECT DISTINCT url FROM crawl_results
			 WHERE job_id = ? AND error = ?
			 ORDER BY url ASC LIMIT ?`,
		)
		.bind(jobId, ROBOTS_DISALLOWED, cap)
		.all<{ url: string }>();

	return {
		errors: (errorRows.results ?? []).map((row) => ({
			id: row.id,
			timestamp: row.created_at,
			url: row.url,
			error: row.error,
		})),
		robotsBlocked: (robotsRows.results ?? []).map((row) => row.url),
	};
}

// Active jobs for `GET /crawl/active`: still-scraping rows whose retention
// window has not elapsed, oldest first (id breaks `created_at` ties so the
// order is deterministic when rows share a millisecond).
export async function listActiveJobs(
	db: D1Database,
	now: number,
	limit?: number,
): Promise<ActiveCrawlJob[]> {
	const cap = resolveAuxLimit(limit);
	const { results } = await db
		.prepare(
			`SELECT id, url, status, total, completed, created_at FROM crawl_jobs
			 WHERE status = 'scraping' AND expires_at > ?
			 ORDER BY created_at ASC, id ASC LIMIT ?`,
		)
		.bind(now, cap)
		.all<ActiveCrawlJob>();

	return (results ?? []).map((row) => ({
		id: row.id,
		url: row.url,
		status: row.status,
		total: row.total,
		completed: row.completed,
		created_at: row.created_at,
	}));
}
