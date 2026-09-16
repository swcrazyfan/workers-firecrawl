export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
	role: ChatRole;
	content: string;
}

export interface ChatRequest {
	messages: ChatMessage[];
	temperature?: number;
	maxTokens?: number;
	jsonSchema?: Record<string, unknown>;
	signal?: AbortSignal;
}

export interface ChatUsage {
	inputTokens?: number;
	outputTokens?: number;
}

export interface ChatResponse {
	content: string;
	parsed?: unknown;
	usage?: ChatUsage;
	model: string;
	strictJson: boolean;
}

export interface AiConfig {
	provider: "openai" | "workers-ai";
	model: string;
	baseUrl?: string;
	apiKey?: string;
	timeoutMs: number;
	maxRepairs: number;
	maxInputChars: number;
	strictJson: "auto" | "on" | "off";
}

export class AiConfigError extends Error {}

export interface AiEnv {
	AI?: unknown;
	LLM_PROVIDER?: string;
	LLM_BASE_URL?: string;
	LLM_MODEL?: string;
	LLM_API_KEY?: string;
	OPENAI_API_KEY?: string;
	LLM_STRICT_JSON?: string;
	LLM_TIMEOUT_MS?: string;
	LLM_MAX_REPAIRS?: string;
	LLM_MAX_INPUT_CHARS?: string;
}
