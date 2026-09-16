import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type WorkflowStepConfig,
} from "cloudflare:workers";
import type { Env } from "../index";
import {
	buildTerminalPayload,
	initializeCrawl,
	isTerminal,
	loadCrawlOptions,
	postWebhook,
	processCrawlBatch,
} from "./engine";
import { claimNextBatch, getJob, setJobStatus } from "./store";

const BATCH_SIZE = 5;
const STEP_RETRIES: NonNullable<WorkflowStepConfig["retries"]> = {
	limit: 2,
	delay: "5 seconds",
	backoff: "exponential",
};

// Thin orchestration only: every step delegates to the testable engine. The
// Workflow runtime persists each step result, so a retried run resumes after the
// last completed step instead of re-crawling.
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

		await step.do(
			"initialize",
			{ retries: STEP_RETRIES, timeout: "2 minutes" },
			async () => await initializeCrawl(this.env, jobId, job.url, opts),
		);

		let succeeded = 0;
		let attempted = 0;

		for (let n = 1; ; n++) {
			const result = await step.do(
				`batch ${n}`,
				{ retries: STEP_RETRIES, timeout: "10 minutes" },
				async () => {
					const batch = await claimNextBatch(db, jobId, BATCH_SIZE);
					if (batch.length === 0) {
						return {
							empty: true,
							terminal: false,
							completed: 0,
							failed: 0,
							discovered: 0,
						};
					}
					const counts = await processCrawlBatch(this.env, jobId, batch, opts);
					const current = await getJob(db, jobId);
					return {
						empty: false,
						terminal: current ? isTerminal(current.status) : true,
						...counts,
					};
				},
			);

			if (result.empty || result.terminal) break;

			succeeded += result.completed;
			attempted += result.completed + result.failed;

			// `limit` caps successfully crawled pages; the queue bounds the rest.
			if (succeeded >= opts.limit) break;

			await step.sleep(`pace ${n}`, "1 second");
		}

		const status =
			attempted > 0 && succeeded === 0
				? ("failed" as const)
				: ("completed" as const);

		await step.do(
			"finalize",
			{ retries: STEP_RETRIES, timeout: "1 minute" },
			async () => {
				await setJobStatus(db, jobId, status, { completedAt: Date.now() });
			},
		);

		const webhook = opts.webhook;
		if (webhook) {
			await step.do(
				"webhook",
				{ retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" },
				async () => {
					const payload = await buildTerminalPayload(this.env, jobId, status);
					await postWebhook(webhook, payload);
				},
			);
		}
	}
}
