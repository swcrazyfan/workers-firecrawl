import { OpenAiProvider } from "./openaiProvider";
import type { AiConfig, AiEnv, ChatRequest, ChatResponse } from "./types";
import { WorkersAiProvider } from "./workersAiProvider";

export interface AiProvider {
	readonly id: string;
	readonly model: string;
	chat(req: ChatRequest): Promise<ChatResponse>;
}

export function getAiProvider(config: AiConfig, env: AiEnv): AiProvider {
	if (config.provider === "workers-ai") {
		return new WorkersAiProvider(config, env);
	}
	return new OpenAiProvider(config);
}
