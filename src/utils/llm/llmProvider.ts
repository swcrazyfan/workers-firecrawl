/**
 * LLM Provider Interface
 * Defines the contract for LLM providers that can be used for AI-powered features
 */

export interface LLMProvider {
  /**
   * Extract structured data from content using a JSON schema
   */
  extractStructured(content: string, schema: any, prompt?: string): Promise<any>;

  /**
   * Extract data from content using a natural language prompt
   */
  extractWithPrompt(content: string, prompt: string): Promise<any>;

  /**
   * Summarize content
   */
  summarize(content: string, options?: SummarizeOptions): Promise<string>;

  /**
   * Check if the provider is properly configured and available
   */
  isAvailable(): Promise<boolean>;
}

export interface SummarizeOptions {
  maxLength?: number;
  tone?: 'neutral' | 'formal' | 'casual';
  focus?: string; // What to focus on in the summary
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
}

export interface ExtractOptions {
  schema?: any;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMError extends Error {
  code: 'API_ERROR' | 'TIMEOUT' | 'RATE_LIMIT' | 'INVALID_RESPONSE' | 'CONFIG_ERROR';
  provider?: string;
  details?: any;
}