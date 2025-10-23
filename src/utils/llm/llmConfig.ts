/**
 * LLM Configuration Management
 * Handles configuration for the LLM provider with OpenRouter as default
 */

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
}

// Accept any environment-like object to avoid structural typing issues with Cloudflare Env
export type LLMEnvironment = any;

const DEFAULT_CONFIG: Partial<LLMConfig> = {
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'x-ai/grok-4-fast',
  timeout: 30000,
  maxRetries: 3,
};

/**
 * Get LLM configuration from environment variables
 */
export function getLLMConfig(env: any): LLMConfig {
  const apiKey = env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const baseUrl = env.LLM_BASE_URL || DEFAULT_CONFIG.baseUrl!;
  const model = env.LLM_MODEL || DEFAULT_CONFIG.model!;
  const timeout = env.LLM_TIMEOUT ? parseInt(env.LLM_TIMEOUT, 10) : DEFAULT_CONFIG.timeout;
  const maxRetries = env.LLM_MAX_RETRIES ? parseInt(env.LLM_MAX_RETRIES, 10) : DEFAULT_CONFIG.maxRetries;

  return {
    apiKey,
    baseUrl,
    model,
    timeout,
    maxRetries,
  };
}

/**
 * Validate LLM configuration
 */
export function validateLLMConfig(config: LLMConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push('API key is required');
  }

  if (!config.baseUrl) {
    errors.push('Base URL is required');
  } else {
    try {
      new URL(config.baseUrl);
    } catch {
      errors.push('Base URL is invalid');
    }
  }

  if (!config.model) {
    errors.push('Model is required');
  }

  if (config.timeout && (config.timeout < 1000 || config.timeout > 300000)) {
    errors.push('Timeout must be between 1000ms and 300000ms');
  }

  if (config.maxRetries && (config.maxRetries < 0 || config.maxRetries > 10)) {
    errors.push('Max retries must be between 0 and 10');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get default configuration for development/testing
 */
export function getDefaultLLMConfig(): LLMConfig {
  return {
    apiKey: 'sk-test-key',
    baseUrl: DEFAULT_CONFIG.baseUrl!,
    model: DEFAULT_CONFIG.model!,
    timeout: DEFAULT_CONFIG.timeout,
    maxRetries: DEFAULT_CONFIG.maxRetries,
  };
}