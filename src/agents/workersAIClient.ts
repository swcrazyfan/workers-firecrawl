import type { Ai } from "@cloudflare/workers-types";

/**
 * Workers AI Client for Stagehand
 * Adapts Cloudflare Workers AI to work with Stagehand's LLM interface
 */
export class WorkersAIClient {
  constructor(
    private ai: Ai,
    private options?: {
      gateway?: { id: string };
    }
  ) {}

  /**
   * Create a chat completion using Workers AI
   * Compatible with OpenAI's chat completion interface
   */
  async createChatCompletion(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format?: { type: string; schema?: any };
    temperature?: number;
    max_tokens?: number;
  }) {
    try {
      // Use Workers AI to run the model
      const response = await this.ai.run(params.model as any, {
        messages: params.messages,
        ...(params.response_format && {
          response_format: params.response_format
        }),
        ...(params.temperature !== undefined && {
          temperature: params.temperature
        }),
        ...(params.max_tokens !== undefined && {
          max_tokens: params.max_tokens
        })
      });

      // Format response to match OpenAI's interface
      return {
        choices: [
          {
            message: {
              content: typeof response === 'string' 
                ? response 
                : JSON.stringify(response)
            }
          }
        ]
      };
    } catch (error) {
      console.error('Workers AI request failed:', error);
      throw new Error(`Workers AI error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Alternative method name for compatibility
   */
  async chat(params: Parameters<typeof this.createChatCompletion>[0]) {
    return this.createChatCompletion(params);
  }
}