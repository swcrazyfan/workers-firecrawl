import { getLLM } from "./index";
import type { Env } from "../../index";

export interface SummaryOptions {
  maxLength?: number;
  type?: 'concise' | 'detailed' | 'bullets' | 'custom';
  tone?: 'neutral' | 'formal' | 'casual' | 'technical';
  focus?: string; // Custom focus area for the summary
  language?: string; // Target language for summary
}

export interface SummaryResult {
  success: boolean;
  data?: {
    summary: string;
    keyPoints?: string[];
    wordCount?: number;
  };
  error?: string;
}

/**
 * Generate AI-powered content summary with enhanced options
 */
export async function summarizeContent(
  env: Env,
  content: string,
  options: SummaryOptions = {}
): Promise<SummaryResult> {
  try {
    // Validate content
    if (!content || content.trim().length < 50) {
      return {
        success: false,
        error: "Content too short for meaningful summarization (minimum 50 characters)"
      };
    }

    // Validate options
    const validation = validateSummaryOptions(options);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid options: ${validation.errors.join(', ')}`
      };
    }

    // Get LLM instance
    const llm = getLLM(env);
    
    // Build enhanced summary prompt
    const prompt = buildEnhancedSummaryPrompt(content, options);
    
    try {
      // Use the existing LLM summarize method with enhanced prompt
      // Map 'technical' tone to 'formal' since the base LLM only supports neutral/formal/casual
      const mappedTone = options.tone === 'technical' ? 'formal' : (options.tone || 'neutral');
      
      const summary = await llm.summarize(prompt, {
        maxLength: options.maxLength || 300,
        tone: mappedTone as 'neutral' | 'formal' | 'casual',
        focus: options.focus
      });

      // Parse and format the response
      const summaryData = parseSummaryResponse(summary, options);

      return {
        success: true,
        data: summaryData
      };

    } catch (llmError) {
      console.error("LLM summarization failed:", llmError);
      return {
        success: false,
        error: `LLM summarization failed: ${(llmError as Error).message}`
      };
    }

  } catch (error) {
    console.error("Content summarization failed:", error);
    return {
      success: false,
      error: `Summarization failed: ${(error as Error).message}`
    };
  }
}

/**
 * Build enhanced summary prompt based on options
 */
function buildEnhancedSummaryPrompt(content: string, options: SummaryOptions): string {
  const {
    maxLength = 300,
    type = 'concise',
    tone = 'neutral',
    focus,
    language = 'English'
  } = options;

  let prompt = `Please summarize the following content in ${language}.`;

  // Add summary type instructions
  switch (type) {
    case 'concise':
      prompt += ` Create a concise summary of approximately ${maxLength} words (1-2 sentences) that captures the main points.`;
      break;
    case 'detailed':
      prompt += ` Create a detailed summary of approximately ${maxLength * 2} words that covers all important aspects and key insights.`;
      break;
    case 'bullets':
      prompt += ` Create a bulleted summary with the most important points. Each bullet should be concise but informative. Limit to 5-7 bullets.`;
      break;
    case 'custom':
      prompt += ` Create a summary according to the custom requirements specified below.`;
      break;
  }

  // Add tone instructions
  if (tone !== 'neutral') {
    switch (tone) {
      case 'formal':
        prompt += " Use a formal, professional tone.";
        break;
      case 'casual':
        prompt += " Use a casual, conversational tone.";
        break;
      case 'technical':
        prompt += " Use technical language appropriate for subject matter experts.";
        break;
    }
  }

  // Add focus instructions
  if (focus) {
    prompt += ` Focus particularly on: ${focus}`;
  }

  // Add length constraint
  if (type !== 'bullets') {
    prompt += ` Maximum length: ${maxLength} words.`;
  }

  prompt += `\n\nContent to summarize:\n${content}`;

  return prompt;
}

/**
 * Parse and format the summary response
 */
function parseSummaryResponse(response: string, options: SummaryOptions): {
  summary: string;
  keyPoints?: string[];
  wordCount?: number;
} {
  const { type = 'concise' } = options;
  
  // Clean up the response
  let cleanedResponse = response.trim();
  
  // Remove any markdown formatting
  cleanedResponse = cleanedResponse.replace(/^#+\s*/gm, '');
  cleanedResponse = cleanedResponse.replace(/^\*\s*/gm, '• ');
  cleanedResponse = cleanedResponse.replace(/^\-\s*/gm, '• ');
  
  // Extract key points for bullet point summaries
  let keyPoints: string[] | undefined;
  if (type === 'bullets') {
    const bulletRegex = /[•\-\*]\s+(.+?)(?=\n[•\-\*]|\n\n|$)/gs;
    const matches = Array.from(cleanedResponse.matchAll(bulletRegex));
    
    if (matches.length > 0) {
      keyPoints = matches.map(match => match[1].trim()).filter(point => point.length > 0);
      cleanedResponse = keyPoints.join('\n• ');
    }
  }
  
  // Calculate word count
  const wordCount = cleanedResponse.split(/\s+/).filter(word => word.length > 0).length;
  
  return {
    summary: cleanedResponse,
    keyPoints,
    wordCount
  };
}

/**
 * Validate summary options
 */
export function validateSummaryOptions(options: SummaryOptions): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (options.maxLength !== undefined) {
    if (typeof options.maxLength !== 'number' || options.maxLength < 10 || options.maxLength > 1000) {
      errors.push("maxLength must be a number between 10 and 1000");
    }
  }
  
  if (options.type !== undefined) {
    const validTypes = ['concise', 'detailed', 'bullets', 'custom'];
    if (!validTypes.includes(options.type)) {
      errors.push(`type must be one of: ${validTypes.join(', ')}`);
    }
  }
  
  if (options.tone !== undefined) {
    const validTones = ['neutral', 'formal', 'casual', 'technical'];
    if (!validTones.includes(options.tone)) {
      errors.push(`tone must be one of: ${validTones.join(', ')}`);
    }
  }
  
  if (options.language !== undefined && typeof options.language !== 'string') {
    errors.push("language must be a string");
  }
  
  if (options.focus !== undefined && typeof options.focus !== 'string') {
    errors.push("focus must be a string");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}