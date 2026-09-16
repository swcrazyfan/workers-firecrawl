import type { AiProvider } from "./provider";
import {
	type AiConfig,
	AiConfigError,
	type AiEnv,
	type ChatRequest,
	type ChatResponse,
} from "./types";

// Placeholder seam for task 010b: `src/ai/workersAiProvider.ts` is being built
// in parallel and replaces this minimal stub at merge. The module exists so
// `provider.ts` compiles and dispatches cleanly before 010b lands.
export class WorkersAiProvider implements AiProvider {
	readonly id = "workers-ai";
	readonly model: string;

	constructor(config: AiConfig, _env: AiEnv) {
		this.model = config.model;
	}

	async chat(_req: ChatRequest): Promise<ChatResponse> {
		throw new AiConfigError("workers-ai provider not available");
	}
}
