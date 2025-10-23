// AI utilities aggregator for a single OpenAI-compatible provider

import { getLLMConfig, validateLLMConfig } from "../llm/llmConfig";
import { OpenAIProvider } from "../llm/openaiProvider";
import type { SummarizeOptions } from "../llm/llmProvider";

// Re-export structured extraction utilities
export {
  extractStructuredData,
  extractStructuredDataWithRetry,
  validateExtractedData,
  CommonSchemas,
} from "./structuredExtractor";

// Re-export prompt extraction utilities
export {
  extractWithPrompt,
  extractWithPromptRetry,
  CommonPrompts,
  createFallbackResponse,
} from "./promptExtractor";

// Get a configured LLM instance (OpenAI-compatible; defaults to OpenRouter in config)
export function getLLM(env: any) {
  const config = getLLMConfig(env);
  return new OpenAIProvider(config);
}

// Summarize content using configured LLM
export async function summarizeContent(
  env: any,
  content: string,
  options: SummarizeOptions = {}
): Promise<string> {
  const llm = getLLM(env);
  return llm.summarize(content, options);
}

// Provide a simple availability check for diagnostics/endpoints
export async function checkAIAvailability(
  env: any
): Promise<{
  available: boolean;
  provider: string;
  model: string;
  errors: string[];
}> {
  const errors: string[] = [];

  let available = false;
  let config;
  
  try {
    config = getLLMConfig(env);
  } catch (e) {
    errors.push(`Config error: ${e instanceof Error ? e.message : String(e)}`);
    return {
      available: false,
      provider: "openai-compatible",
      model: "unknown",
      errors,
    };
  }
  
  const llm = new OpenAIProvider(config);
  
  try {
    available = await llm.isAvailable();
    if (!available) {
      errors.push('Provider availability check returned false - likely API key issue or network error');
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return {
    available,
    provider: "openai-compatible",
    model: config.model,
    errors,
  };
}

// Return configuration validation status (for admin/testing)
export function getAIConfigStatus(
  env: any
): {
  isValid: boolean;
  errors: string[];
  model: string;
  baseUrl: string;
} {
  const config = getLLMConfig(env);
  const validation = validateLLMConfig(config);
  return {
    isValid: validation.isValid,
    errors: validation.errors,
    model: config.model,
    baseUrl: config.baseUrl,
  };
}