import { type AiConfig, AiConfigError, type AiEnv } from "./types";

const DEFAULT_OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENAI_MODEL = "z-ai/glm-5.3-flash";
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_REPAIRS = 2;
const DEFAULT_MAX_INPUT_CHARS = 48000;

function stripTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}

function resolveStrictJson(value: string | undefined): "auto" | "on" | "off" {
	if (value === "on" || value === "off") return value;
	return "auto";
}

// Parse a string env var as an integer, falling back to `fallback` on
// missing/garbage input and clamping into [min, max] — never NaN.
function resolveBoundedInt(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function selectProvider(
	env: AiEnv,
	key: string | undefined,
): "openai" | "workers-ai" {
	const requested = env.LLM_PROVIDER;
	if (requested !== undefined && requested.trim() !== "") {
		if (requested === "openai" || requested === "workers-ai") return requested;
		throw new AiConfigError(`unknown AI provider: ${requested}`);
	}
	if (key !== undefined && key.trim() !== "") return "openai";
	if (env.AI) return "workers-ai";
	throw new AiConfigError(
		"no AI provider configured: set LLM_API_KEY/OPENAI_API_KEY or bind Workers AI",
	);
}

export function resolveAiConfig(env: AiEnv): AiConfig {
	const key = env.LLM_API_KEY ?? env.OPENAI_API_KEY;
	const provider = selectProvider(env, key);
	const strictJson = resolveStrictJson(env.LLM_STRICT_JSON);
	const timeoutMs = resolveBoundedInt(
		env.LLM_TIMEOUT_MS,
		DEFAULT_TIMEOUT_MS,
		1000,
		Number.MAX_SAFE_INTEGER,
	);
	const maxRepairs = resolveBoundedInt(
		env.LLM_MAX_REPAIRS,
		DEFAULT_MAX_REPAIRS,
		0,
		5,
	);
	const maxInputChars = resolveBoundedInt(
		env.LLM_MAX_INPUT_CHARS,
		DEFAULT_MAX_INPUT_CHARS,
		1000,
		Number.MAX_SAFE_INTEGER,
	);

	if (provider === "workers-ai") {
		return {
			provider,
			model: env.LLM_MODEL ?? DEFAULT_WORKERS_AI_MODEL,
			timeoutMs,
			maxRepairs,
			maxInputChars,
			strictJson,
		};
	}

	return {
		provider,
		model: env.LLM_MODEL ?? DEFAULT_OPENAI_MODEL,
		baseUrl: stripTrailingSlashes(env.LLM_BASE_URL ?? DEFAULT_OPENAI_BASE_URL),
		apiKey: key,
		timeoutMs,
		maxRepairs,
		maxInputChars,
		strictJson,
	};
}
