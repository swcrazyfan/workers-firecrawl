/**
 * Structured Data Extraction Utility
 * Handles extraction of structured data using LLM providers
 */

import { OpenAIProvider } from '../llm/openaiProvider';
import { getLLMConfig, LLMEnvironment } from '../llm/llmConfig';
import { LLMProvider, LLMError } from '../llm/llmProvider';

export interface StructuredExtractionOptions {
  schema: any;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ExtractionResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    model: string;
    tokensUsed?: number;
    processingTime: number;
  };
}

/**
 * Extract structured data from content using JSON schema
 */
export async function extractStructuredData(
  content: string,
  options: StructuredExtractionOptions,
  env: LLMEnvironment
): Promise<ExtractionResult> {
  const startTime = Date.now();
  
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
        }
      };
    }

    // Extract structured data
    const data = await provider.extractStructured(
      content,
      options.schema,
      options.prompt
    );

    return {
      success: true,
      data,
      metadata: {
        model: config.model,
        processingTime: Date.now() - startTime,
      }
    };

  } catch (error) {
    console.error('Structured extraction failed:', error);
    
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
      }
    };
  }
}

/**
 * Extract structured data with retry logic
 */
export async function extractStructuredDataWithRetry(
  content: string,
  options: StructuredExtractionOptions,
  env: LLMEnvironment,
  maxRetries: number = 2
): Promise<ExtractionResult> {
  let lastResult: ExtractionResult | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await extractStructuredData(content, options, env);
    
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
    error: 'All extraction attempts failed'
  };
}

/**
 * Validate extracted data against schema
 */
export function validateExtractedData(data: any, schema: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Basic validation - in a real implementation, you might use a JSON schema validator
  if (schema.type === 'object' && schema.properties) {
    if (typeof data !== 'object' || data === null) {
      errors.push('Expected object but got ' + typeof data);
      return { isValid: false, errors };
    }
    
    // Check required properties
    if (schema.required) {
      for (const requiredProp of schema.required) {
        if (!(requiredProp in data)) {
          errors.push(`Missing required property: ${requiredProp}`);
        }
      }
    }
    
    // Check property types
    for (const [propName, propSchema] of Object.entries(schema.properties as any)) {
      if (propName in data) {
        const expectedType = (propSchema as any).type;
        const actualValue = data[propName];
        const actualType = Array.isArray(actualValue) ? 'array' : typeof actualValue;
        
        if (expectedType !== actualType) {
          errors.push(`Property ${propName} should be ${expectedType} but got ${actualType}`);
        }
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
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
 * Create a simple JSON schema for common extraction patterns
 */
export const CommonSchemas = {
  article: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      author: { type: 'string' },
      publishDate: { type: 'string' },
      summary: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'content']
  },
  
  product: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      price: { type: 'string' },
      description: { type: 'string' },
      availability: { type: 'string' },
      specifications: { type: 'object' },
      images: { type: 'array', items: { type: 'string' } }
    },
    required: ['name', 'price']
  },
  
  contact: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      company: { type: 'string' },
      address: { type: 'string' }
    },
    required: ['name']
  }
};