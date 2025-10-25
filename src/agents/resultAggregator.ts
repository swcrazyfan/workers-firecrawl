import { OpenAIProvider } from '../utils/llm/openaiProvider';
import { getLLMConfig } from '../utils/llm/llmConfig';
import type { Env } from '../index';

/**
 * Result Aggregator
 * 
 * Intelligently merges results from multiple pages using LLM.
 * Used when FLARE-1 processes multiple URLs and needs to combine the extracted data.
 */
export class ResultAggregator {
  private llm: OpenAIProvider;
  
  constructor(env: Env) {
    const config = getLLMConfig(env);
    this.llm = new OpenAIProvider(config);
  }
  
  /**
   * Merge results from multiple pages
   * 
   * @param results - Array of results with URL and extracted data
   * @param schema - Optional schema for the merged result
   * @returns Promise<any> - Merged result
   */
  async merge(
    results: Array<{ url: string; data: any }>,
    schema?: any
  ): Promise<any> {
    // Single result - no merging needed
    if (results.length === 0) {
      console.log('[ResultAggregator] No results to merge');
      return null;
    }
    
    if (results.length === 1) {
      console.log('[ResultAggregator] Single result, no merging needed');
      return results[0].data;
    }
    
    // Multiple results - intelligent merge using LLM
    console.log(`[ResultAggregator] Merging ${results.length} results`);
    
    const prompt = `You are a data aggregation expert. Merge these extracted results into a single coherent output.

Results from ${results.length} pages:
${JSON.stringify(results, null, 2)}

${schema ? `Target Schema:\n${JSON.stringify(schema, null, 2)}\n` : ''}

Rules for merging:
1. Resolve conflicts by choosing the most complete or recent data
2. Merge arrays by combining unique items
3. Deduplicate identical information
4. Maintain data relationships
5. Follow the schema structure exactly if provided
6. Preserve important context from each source

Return the merged result as JSON.`;
    
    try {
      const merged = await this.llm.extractWithPrompt(
        JSON.stringify(results),
        prompt
      );
      
      console.log('[ResultAggregator] Successfully merged results');
      return merged;
    } catch (error) {
      console.error('[ResultAggregator] Aggregation failed:', error);
      
      // Fallback: return all results as array
      console.log('[ResultAggregator] Falling back to array of results');
      return results.map(r => r.data);
    }
  }
  
  /**
   * Simple merge without LLM (for basic cases)
   * 
   * @param results - Array of results
   * @returns Merged result
   */
  simpleMerge(results: Array<{ url: string; data: any }>): any {
    if (results.length === 0) return null;
    if (results.length === 1) return results[0].data;
    
    // If all results are arrays, concatenate them
    if (results.every(r => Array.isArray(r.data))) {
      return results.flatMap(r => r.data);
    }
    
    // If all results are objects, merge them
    if (results.every(r => typeof r.data === 'object' && !Array.isArray(r.data))) {
      return Object.assign({}, ...results.map(r => r.data));
    }
    
    // Otherwise, return as array
    return results.map(r => r.data);
  }
}