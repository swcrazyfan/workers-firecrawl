import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type WorkflowStepConfig,
} from "cloudflare:workers";
import type { Env } from "../index";
import {
	buildTerminalPayload,
	finalizeCrawl,
	initializeCrawl,
	loadCrawlOptions,
	postWebhook,
	runCrawlBatch,
} from "./engine";
import { getJob, setJobStatus } from "./store";

const BATCH_SIZE = 5;
// Politeness cap for a robots `Crawl-delay`; the between-batch sleep is never
// shorter than 1s or longer than this.
const MIN_PACE_SECONDS = 1;
const MAX_PACE_SECONDS = 10;

const STEP_RETRIES: NonNullable<WorkflowStepConfig["retries"]> = {
	limit: 2,
	delay: "5 seconds",
	backoff: "exponential",
};

// Thin orchestration only: every step delegates to the testable engine. The
// Workflow runtime persists each step result, so a retried run resumes after the
// last completed step instead of re-crawling (and `runCrawlBatch` releases any
// rows a failed attempt had claimed).
export class CrawlWorkflow extends WorkflowEntrypoint<Env, { jobId: string }> {
	async run(
		event: WorkflowEvent<{ jobId: string }>,
		step: WorkflowStep,
	): Promise<void> {
		const { jobId } = event.payload;
		const db = this.env.DB;

		const job = await getJob(db, jobId);
		if (!job || job.status === "cancelled") return;

		const opts = await loadCrawlOptions(this.env, jobId);
		if (!opts) {
			await setJobStatus(db, jobId, "failed", {
				error: "crawl options unavailable",
				completedAt: Date.now(),
			});
			return;
		}

		// 10 minutes covers the bounded sitemap fetch worst case
		// (20 files * 5s + robots), see `initializeCrawl`.
		await step.do(
			"initialize",
			{ retries: STEP_RETRIES, timeout: "10 minutes" },
			async () => await initializeCrawl(this.env, jobId, job.url, opts),
		);

		let succeeded = 0;
		let attempted = 0;
		let lastDelaySec = 0;

		for (let n = 1; ; n++) {
			const result = await step.do(
				`batch ${n}`,
				{ retries: STEP_RETRIES, timeout: "10 minutes" },
				async () => await runCrawlBatch(this.env, jobId, opts, BATCH_SIZE),
			);

			// Count the final batch before any break so nothing is discarded.
			if (!result.empty) {
				succeeded += result.completed;
				attempted += result.completed + result.failed;
				lastDelaySec = result.crawlDelaySec ?? 0;
			}

			if (result.empty || result.terminal) break;
			if (succeeded >= opts.limit) break;

			const pace = Math.min(
				Math.max(lastDelaySec, MIN_PACE_SECONDS),
				MAX_PACE_SECONDS,
			);
			await step.sleep(`pace ${n}`, pace * 1000);
		}

		const status = await step.do(
			"finalize",
			{ retries: STEP_RETRIES, timeout: "1 minute" },
			async () => await finalizeCrawl(this.env, jobId, attempted, succeeded),
		);

		const webhook = opts.webhook;
		if (webhook && (status === "completed" || status === "failed")) {
			await step.do(
				"webhook",
				{ retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" },
				async () => {
					const payload = await buildTerminalPayload(
						this.env,
						jobId,
						status === "failed" ? "crawl.failed" : "crawl.completed",
						webhook.metadata,
					);
					await postWebhook(webhook, payload);
				},
			);
		}
	}
}
