import type { AiProvider } from "./provider";
import {
	type AiConfig,
	AiConfigError,
	type ChatRequest,
	type ChatResponse,
	type ChatUsage,
} from "./types";

const RETRY_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 5000;
const DEFAULT_MAX_TOKENS = 2048;
const OPENROUTER_REFERER = "https://github.com/swcrazyfan/workers-firecrawl";
const OPENROUTER_TITLE = "workers-firecrawl";

const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransientStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function retryDelayMs(response: Response): number {
	const header = response.headers.get("Retry-After");
	if (header) {
		const seconds = Number(header);
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
		}
	}
	return RETRY_DELAY_MS;
}

function isOpenRouter(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).host.includes("openrouter.ai");
	} catch {
		return false;
	}
}

// AbortSignal.any ships in the Workers runtime and modern Node, but is absent
// from the configured TS lib — fall back to the timeout signal alone when it
// is unavailable (the external signal is then ignored).
function mergeSignals(
	timeout: AbortSignal,
	external: AbortSignal,
): AbortSignal {
	const any = (
		AbortSignal as unknown as {
			any?: (signals: AbortSignal[]) => AbortSignal;
		}
	).any;
	return typeof any === "function" ? any([timeout, external]) : timeout;
}

function normalizeUsage(raw: unknown): ChatUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const usage = raw as { prompt_tokens?: unknown; completion_tokens?: unknown };
	const normalized: ChatUsage = {};
	if (typeof usage.prompt_tokens === "number")
		normalized.inputTokens = usage.prompt_tokens;
	if (typeof usage.completion_tokens === "number")
		normalized.outputTokens = usage.completion_tokens;
	if (
		normalized.inputTokens === undefined &&
		normalized.outputTokens === undefined
	)
		return undefined;
	return normalized;
}

export function buildRequestBody(
	req: ChatRequest,
	config: AiConfig,
	useStrictJson: boolean,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: config.model,
		messages: req.messages,
		temperature: req.temperature ?? 0,
		max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
	};
	if (req.jsonSchema !== undefined) {
		body.response_format = useStrictJson
			? {
					type: "json_schema",
					json_schema: {
						name: "extraction",
						strict: true,
						schema: req.jsonSchema,
					},
				}
			: { type: "json_object" };
	}
	return body;
}

export class OpenAiProvider implements AiProvider {
	readonly id = "openai";
	readonly model: string;
	private readonly config: AiConfig;
	private readonly baseUrl: string;
	private readonly apiKey: string;

	constructor(config: AiConfig) {
		if (!config.baseUrl || !config.apiKey) {
			throw new AiConfigError(
				"openai: baseUrl and apiKey are required for the OpenAI-compatible provider",
			);
		}
		this.config = config;
		this.model = config.model;
		this.baseUrl = config.baseUrl;
		this.apiKey = config.apiKey;
	}

	async chat(req: ChatRequest): Promise<ChatResponse> {
		const setting = this.config.strictJson;
		const useStrictJson = setting !== "off";
		const response = await this.sendWithRetry(
			buildRequestBody(req, this.config, useStrictJson),
			req,
		);

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			if (this.canFallBackToJsonObject(response.status, setting, req, body)) {
				const fallback = await this.sendWithRetry(
					buildRequestBody(req, this.config, false),
					req,
				);
				if (!fallback.ok) {
					const fallbackBody = await fallback.text().catch(() => "");
					throw new Error(
						`ai: ${this.id} HTTP ${fallback.status}${fallbackBody ? `: ${fallbackBody}` : ""}`,
					);
				}
				return await this.parse(fallback, false);
			}
			throw new Error(
				`ai: ${this.id} HTTP ${response.status}${body ? `: ${body}` : ""}`,
			);
		}

		return await this.parse(response, useStrictJson);
	}

	private canFallBackToJsonObject(
		status: number,
		setting: AiConfig["strictJson"],
		req: ChatRequest,
		body: string,
	): boolean {
		return (
			status === 400 &&
			setting === "auto" &&
			req.jsonSchema !== undefined &&
			/response_format|json_schema/.test(body)
		);
	}

	private async sendWithRetry(
		body: Record<string, unknown>,
		req: ChatRequest,
	): Promise<Response> {
		const first = await this.trySend(body, req);
		if (first === null) {
			await delay(RETRY_DELAY_MS);
			return await this.send(body, req);
		}
		if (isTransientStatus(first.status)) {
			await delay(retryDelayMs(first));
			return await this.send(body, req);
		}
		return first;
	}

	private async trySend(
		body: Record<string, unknown>,
		req: ChatRequest,
	): Promise<Response | null> {
		try {
			return await this.send(body, req);
		} catch {
			return null;
		}
	}

	private async send(
		body: Record<string, unknown>,
		req: ChatRequest,
	): Promise<Response> {
		const timeout = AbortSignal.timeout(this.config.timeoutMs);
		const signal = req.signal ? mergeSignals(timeout, req.signal) : timeout;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
			"content-type": "application/json",
		};
		if (isOpenRouter(this.baseUrl)) {
			headers["HTTP-Referer"] = OPENROUTER_REFERER;
			headers["X-Title"] = OPENROUTER_TITLE;
		}
		return await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});
	}

	private async parse(
		response: Response,
		strictJson: boolean,
	): Promise<ChatResponse> {
		let json: unknown;
		try {
			json = await response.json();
		} catch {
			throw new Error(`ai: unexpected response shape from ${this.id}`);
		}
		const record = json as {
			choices?: unknown;
			usage?: unknown;
			model?: unknown;
		} | null;
		const choices = Array.isArray(record?.choices) ? record.choices : [];
		const message = (
			choices[0] as
				| { message?: { content?: unknown; parsed?: unknown } }
				| undefined
		)?.message;
		if (
			!message ||
			(typeof message.content !== "string" && message.parsed === undefined)
		) {
			throw new Error(`ai: unexpected response shape from ${this.id}`);
		}
		const parsed = message.parsed;
		const content =
			typeof message.content === "string"
				? message.content
				: parsed === undefined
					? ""
					: JSON.stringify(parsed);
		return {
			content,
			parsed,
			usage: normalizeUsage(record?.usage),
			model: typeof record?.model === "string" ? record.model : this.model,
			strictJson,
		};
	}
}
