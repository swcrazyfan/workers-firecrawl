/**
 * Prompt-based Data Extraction Utility
 * Handles extraction of data using natural language prompts
 */

import { OpenAIProvider } from '../llm/openaiProvider';
import { getLLMConfig, LLMEnvironment } from '../llm/llmConfig';
import { LLMProvider, LLMError } from '../llm/llmProvider';

export interface PromptExtractionOptions {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'json' | 'text';
}

export interface PromptExtractionResult {
  success: boolean;
  data?: any;
  text?: string;
  error?: string;
  metadata?: {
    model: string;
    tokensUsed?: number;
    processingTime: number;
    outputFormat: string;
  };
}

/**
 * Extract data from content using natural language prompt
 */
export async function extractWithPrompt(
  content: string,
  options: PromptExtractionOptions,
  env: LLMEnvironment
): Promise<PromptExtractionResult> {
  const startTime = Date.now();
  const outputFormat = options.outputFormat || 'json';
  
  try {
    const config = getLLMConfig(env);
    const provider = new OpenAIProvider(config);
    
    // Check if provider is available
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      return {
        success: false,
        error: 'LLM provider is not available',
        metadata: {
          model: config.model,
          processingTime: Date.now() - startTime,
          outputFormat
        }
      };
    }

    // Extract data using prompt
    const result = await provider.extractWithPrompt(content, options.prompt);

    if (outputFormat === 'json') {
      return {
        success: true,
        data: result,
        metadata: {
          model: config.model,
          processingTime: Date.now() - startTime,
          outputFormat
        }
      };
    } else {
      return {
        success: true,
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        metadata: {
          model: config.model,
          processingTime: Date.now() - startTime,
          outputFormat
        }
      };
    }

  } catch (error) {
    console.error('Prompt extraction failed:', error);
    
    let errorMessage = 'Unknown error occurred';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    // Handle specific LLM errors
    if (isLLMError(error)) {
      switch (error.code) {
        case 'RATE_LIMIT':
          errorMessage = 'Rate limit exceeded. Please try again later.';
          break;
        case 'TIMEOUT':
          errorMessage = 'Request timed out. Please try again.';
          break;
        case 'CONFIG_ERROR':
          errorMessage = 'LLM provider configuration error.';
          break;
        case 'API_ERROR':
          errorMessage = 'LLM API error. Please try again.';
          break;
      }
    }

    return {
      success: false,
      error: errorMessage,
      metadata: {
        model: 'unknown',
        processingTime: Date.now() - startTime,
        outputFormat
      }
    };
  }
}

/**
 * Extract data with retry logic
 */
export async function extractWithPromptRetry(
  content: string,
  options: PromptExtractionOptions,
  env: LLMEnvironment,
  maxRetries: number = 2
): Promise<PromptExtractionResult> {
  let lastResult: PromptExtractionResult | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await extractWithPrompt(content, options, env);
    
    if (result.success) {
      return result;
    }
    
    lastResult = result;
    
    // Don't retry on configuration errors
    if (result.error?.includes('configuration') || result.error?.includes('API key')) {
      break;
    }
    
    // Exponential backoff
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return lastResult || {
    success: false,
    error: 'All extraction attempts failed',
    metadata: {
      model: 'unknown',
      processingTime: 0,
      outputFormat: options.outputFormat || 'json'
    }
  };
}

/**
 * Common extraction prompts for different use cases
 */
export const CommonPrompts = {
  // Business information
  extractBusinessInfo: `Extract the following business information: company name, address, phone number, email, website, and business category. Return as JSON.`,

  // Product information
  extractProductInfo: `Extract product information including: product name, price, description, availability status, and key features. Return as JSON.`,

  // Contact information
  extractContactInfo: `Extract contact information including: name, email, phone number, company, and job title. Return as JSON.`,

  // Article information
  extractArticleInfo: `Extract article information including: title, author, publication date, summary, and main topics. Return as JSON.`,

  // Event information
  extractEventInfo: `Extract event information including: event name, date, time, location, description, and registration details. Return as JSON.`,

  // Job posting information
  extractJobInfo: `Extract job posting information including: job title, company, location, salary range, requirements, and application deadline. Return as JSON.`,

  // Recipe information
  extractRecipeInfo: `Extract recipe information including: recipe name, ingredients list, instructions, cooking time, and serving size. Return as JSON.`,

  // Review information
  extractReviewInfo: `Extract review information including: rating, review title, review text, reviewer name, and review date. Return as JSON.`,

  // Price information
  extractPriceInfo: `Extract all price information found in the content, including: product names, prices, currencies, and any discount information. Return as JSON.`,

  // Technical specifications
  extractTechSpecs: `Extract technical specifications including: product name, model numbers, dimensions, weight, and all technical specifications listed. Return as JSON.`,

  // Custom prompt builder
  buildCustomPrompt: (requirements: string[]) => {
    return `Extract the following information from the content: ${requirements.join(', ')}. Return the results as structured JSON data.`;
  }
};

/**
 * Extract multiple types of information in one call
 */
export async function extractMultipleTypes(
  content: string,
  extractions: Array<{ name: string; prompt: string; outputFormat?: 'json' | 'text' }>,
  env: LLMEnvironment
): Promise<{ success: boolean; results: Record<string, any>; errors: string[] }> {
  const results: Record<string, any> = {};
  const errors: string[] = [];
  
  for (const extraction of extractions) {
    try {
      const result = await extractWithPrompt(content, {
        prompt: extraction.prompt,
        outputFormat: extraction.outputFormat || 'json'
      }, env);
      
      if (result.success) {
        results[extraction.name] = result.data || result.text;
      } else {
        errors.push(`${extraction.name}: ${result.error}`);
      }
    } catch (error) {
      errors.push(`${extraction.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  return {
    success: errors.length === 0,
    results,
    errors
  };
}

/**
 * Type guard for LLM errors
 */
function isLLMError(error: any): error is LLMError {
  return error && typeof error === 'object' && 'code' in error;
}

/**
 * Create a fallback response when extraction fails
 */
export function createFallbackResponse(
  content: string,
  prompt: string,
  outputFormat: 'json' | 'text' = 'json'
): PromptExtractionResult {
  const fallbackData = {
    error: 'Extraction failed',
    originalPrompt: prompt,
    contentLength: content.length,
    timestamp: new Date().toISOString()
  };

  if (outputFormat === 'json') {
    return {
      success: false,
      data: fallbackData,
      error: 'Using fallback response due to extraction failure',
      metadata: {
        model: 'fallback',
        processingTime: 0,
        outputFormat
      }
    };
  } else {
    return {
      success: false,
      text: JSON.stringify(fallbackData, null, 2),
      error: 'Using fallback response due to extraction failure',
      metadata: {
        model: 'fallback',
        processingTime: 0,
        outputFormat
      }
    };
  }
}