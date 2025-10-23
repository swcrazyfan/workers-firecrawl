/**
 * OpenAI-Compatible LLM Provider
 * Implements the LLMProvider interface using OpenAI-compatible API
 * Defaults to OpenRouter but works with any OpenAI-compatible endpoint
 */

import { LLMProvider, LLMConfig, LLMError, SummarizeOptions, ExtractOptions } from './llmProvider';

export class OpenAIProvider implements LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Extract structured data from content using a JSON schema
   */
  async extractStructured(content: string, schema: any, prompt?: string): Promise<any> {
    const systemPrompt = this.buildStructuredExtractionPrompt(schema, prompt);
    
    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: content }
      ], {
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      return this.parseJSONResponse(response);
    } catch (error) {
      throw this.handleError(error, 'extractStructured');
    }
  }

  /**
   * Extract data from content using a natural language prompt
   */
  async extractWithPrompt(content: string, prompt: string): Promise<any> {
    const systemPrompt = `You are a data extraction assistant. Extract the requested information from the provided content and respond with structured data in JSON format.`;

    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${prompt}\n\nContent to analyze:\n${content}` }
      ], {
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      return this.parseJSONResponse(response);
    } catch (error) {
      throw this.handleError(error, 'extractWithPrompt');
    }
  }

  /**
   * Summarize content
   */
  async summarize(content: string, options: SummarizeOptions = {}): Promise<string> {
    const { maxLength = 500, tone = 'neutral', focus } = options;
    
    let systemPrompt = `You are a content summarization assistant. Create a concise summary of the provided content.`;
    
    if (tone === 'formal') {
      systemPrompt += ' Use a formal, professional tone.';
    } else if (tone === 'casual') {
      systemPrompt += ' Use a casual, conversational tone.';
    }
    
    if (focus) {
      systemPrompt += ` Focus particularly on: ${focus}.`;
    }
    
    systemPrompt += ` Keep the summary under ${maxLength} words.`;

    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: content }
      ], {
        temperature: 0.3,
        max_tokens: Math.min(maxLength * 2, 2000)
      });

      return response.trim();
    } catch (error) {
      throw this.handleError(error, 'summarize');
    }
  }

  /**
   * Check if the provider is properly configured and available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.makeRequest([
        { role: 'user', content: 'Hello' }
      ], {
        temperature: 0,
        max_tokens: 10
      });
      
      return response.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Make a request to the OpenAI-compatible API
   */
  private async makeRequest(messages: any[], options: any = {}): Promise<string> {
    const requestBody = {
      model: this.config.model,
      messages,
      temperature: options.temperature || 0.1,
      max_tokens: options.max_tokens || 1000,
      ...options
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://workers-firecrawl.dev',
        'X-Title': 'Workers Firecrawl',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json() as any;
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from API');
    }

    return data.choices[0].message.content || '';
  }

  /**
   * Parse JSON response with error handling
   */
  private parseJSONResponse(response: string): any {
    try {
      // Try to parse the response as JSON directly
      return JSON.parse(response);
    } catch {
      // If that fails, try to extract JSON from the response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // Continue to next attempt
        }
      }
      
      // Try to find JSON object in the response
      const objectMatch = response.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          // Continue to error
        }
      }
      
      throw new Error('Could not parse JSON from response');
    }
  }

  /**
   * Build prompt for structured extraction
   */
  private buildStructuredExtractionPrompt(schema: any, customPrompt?: string): string {
    let prompt = `You are a data extraction assistant. Extract information from the provided content and format it as JSON according to the following schema:\n\n${JSON.stringify(schema, null, 2)}\n\n`;
    
    if (customPrompt) {
      prompt += `Additional instructions: ${customPrompt}\n\n`;
    }
    
    prompt += `Please analyze the content and extract the requested information. Respond only with valid JSON that matches the schema exactly.`;
    
    return prompt;
  }

  /**
   * Handle and transform errors
   */
  private handleError(error: any, operation: string): LLMError {
    if (error.name === 'AbortError') {
      const llmError: LLMError = new Error(`Request timeout during ${operation}`) as LLMError;
      llmError.code = 'TIMEOUT';
      llmError.provider = 'openai-compatible';
      return llmError;
    }

    if (error.message?.includes('rate limit')) {
      const llmError: LLMError = new Error(`Rate limit exceeded during ${operation}`) as LLMError;
      llmError.code = 'RATE_LIMIT';
      llmError.provider = 'openai-compatible';
      return llmError;
    }

    if (error.message?.includes('API key')) {
      const llmError: LLMError = new Error(`Invalid API key during ${operation}`) as LLMError;
      llmError.code = 'CONFIG_ERROR';
      llmError.provider = 'openai-compatible';
      return llmError;
    }

    const llmError: LLMError = new Error(`API error during ${operation}: ${error.message}`) as LLMError;
    llmError.code = 'API_ERROR';
    llmError.provider = 'openai-compatible';
    llmError.details = error;
    return llmError;
  }
}