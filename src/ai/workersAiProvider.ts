import type { AiProvider } from "./provider";
import {
	type AiConfig,
	AiConfigError,
	type AiEnv,
	type ChatRequest,
	type ChatResponse,
	type ChatUsage,
} from "./types";

interface WorkersAiBinding {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface NormalizedResponse {
	content: string;
	parsed?: unknown;
	usage?: ChatUsage;
}

export function buildWorkersAiInput(
	req: ChatRequest,
	useStrictJson: boolean,
): Record<string, unknown> {
	const input: Record<string, unknown> = {
		messages: req.messages,
		temperature: req.temperature ?? 0,
		max_tokens: req.maxTokens ?? 2048,
	};

	if (req.jsonSchema) {
		input.response_format = useStrictJson
			? { type: "json_schema", json_schema: req.jsonSchema }
			: { type: "json_object" };
	}

	return input;
}

function toTokenCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function normalizeUsage(source: unknown): ChatUsage | undefined {
	if (!source || typeof source !== "object") {
		return undefined;
	}

	const record = source as Record<string, unknown>;
	const usage =
		record.usage && typeof record.usage === "object"
			? (record.usage as Record<string, unknown>)
			: record;
	const inputTokens = toTokenCount(usage.prompt_tokens ?? usage.input_tokens);
	const outputTokens = toTokenCount(
		usage.completion_tokens ?? usage.output_tokens,
	);

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined;
	}

	return { inputTokens, outputTokens };
}

function unexpectedShape(): Error {
	return new Error("ai: unexpected response shape from workers-ai");
}

function normalizeResponse(raw: unknown): NormalizedResponse {
	if (typeof raw === "string") {
		return { content: raw };
	}

	if (raw && typeof raw === "object") {
		const record = raw as Record<string, unknown>;
		if (!("response" in record)) {
			throw unexpectedShape();
		}

		const usage = normalizeUsage(record);
		const response = record.response;

		if (typeof response === "string") {
			return { content: response, usage };
		}

		if (response && typeof response === "object") {
			return { content: JSON.stringify(response), parsed: response, usage };
		}
	}

	throw unexpectedShape();
}

function prefixWorkersAiError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith("workers-ai: ")) {
		return error instanceof Error ? error : new Error(message);
	}
	return new Error(`workers-ai: ${message}`);
}

export class WorkersAiProvider implements AiProvider {
	readonly id = "workers-ai";
	readonly model: string;
	private readonly config: AiConfig;
	private readonly binding: WorkersAiBinding;

	constructor(config: AiConfig, env: AiEnv) {
		this.config = config;
		this.model = config.model;

		const binding = env.AI as WorkersAiBinding | undefined;
		if (!binding || typeof binding.run !== "function") {
			throw new AiConfigError("workers-ai binding missing");
		}
		this.binding = binding;
	}

	async chat(req: ChatRequest): Promise<ChatResponse> {
		const hasSchema = Boolean(req.jsonSchema);
		let strictJson = hasSchema && this.config.strictJson !== "off";
		let raw: unknown;

		try {
			raw = await this.runWithTimeout(buildWorkersAiInput(req, strictJson));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isJsonModeError = /json mode/i.test(message);

			if (hasSchema && isJsonModeError && this.config.strictJson === "auto") {
				strictJson = false;
				const retryInput = buildWorkersAiInput(
					{ ...req, jsonSchema: undefined },
					false,
				);
				try {
					raw = await this.runWithTimeout(retryInput);
				} catch (retryError) {
					throw prefixWorkersAiError(retryError);
				}
			} else if (
				hasSchema &&
				isJsonModeError &&
				this.config.strictJson === "on"
			) {
				throw error;
			} else {
				throw prefixWorkersAiError(error);
			}
		}

		const normalized = normalizeResponse(raw);
		const response: ChatResponse = {
			content: normalized.content,
			model: this.config.model,
			strictJson,
		};
		if (normalized.parsed !== undefined) {
			response.parsed = normalized.parsed;
		}
		if (normalized.usage !== undefined) {
			response.usage = normalized.usage;
		}
		return response;
	}

	private runWithTimeout(input: Record<string, unknown>): Promise<unknown> {
		const timeoutMs = this.config.timeoutMs;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`workers-ai: timeout after ${timeoutMs}ms`));
			}, timeoutMs);

			this.binding.run(this.config.model, input).then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}
}
