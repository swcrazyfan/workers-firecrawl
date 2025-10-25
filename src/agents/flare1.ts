import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { WorkersAIClient } from "./workersAIClient";
import type { Env } from "../index";
import { z } from "zod";

/**
 * Configuration for FLARE-1 agent
 */
export interface Flare1Config {
  url: string;
  goal: string;
  schema?: z.ZodType<any>;
  maxSteps?: number;
  maxSeconds?: number;
  verbose?: boolean;
}

/**
 * Result from FLARE-1 agent execution
 */
export interface Flare1Result {
  success: boolean;
  data: any;
  metadata: {
    steps: number;
    duration: number;
    url: string;
  };
  error?: string;
}

/**
 * FLARE-1 Agent
 * 
 * AI-powered browser automation agent built on Stagehand.
 * Provides Fire-1 equivalent functionality for Cloudflare Workers.
 */
export class Flare1Agent {
  private stagehand: Stagehand | null = null;
  
  constructor(private env: Env) {}
  
  /**
   * Run the FLARE-1 agent
   * 
   * @param config - Agent configuration
   * @returns Promise<Flare1Result> - Execution result with extracted data
   */
  async run(config: Flare1Config): Promise<Flare1Result> {
    const startTime = Date.now();
    let steps = 0;
    
    try {
      // Initialize Stagehand with Cloudflare Browser Rendering
      const stagehandConfig: any = {
        env: "LOCAL",
        localBrowserLaunchOptions: {
          cdpUrl: endpointURLString(this.env.BROWSER)
        },
        verbose: config.verbose ? 1 : 0
      };

      // Use Workers AI or external LLM based on configuration
      console.log(`[FLARE-1 DEBUG] OPENAI_API_KEY present: ${!!this.env.OPENAI_API_KEY}`);
      console.log(`[FLARE-1 DEBUG] LLM_BASE_URL: ${this.env.LLM_BASE_URL}`);
      console.log(`[FLARE-1 DEBUG] LLM_MODEL: ${this.env.LLM_MODEL}`);
      console.log(`[FLARE-1 DEBUG] AI binding present: ${!!this.env.AI}`);
      
      if (this.env.OPENAI_API_KEY && this.env.LLM_BASE_URL) {
        // External LLM (OpenRouter, OpenAI, etc.)
        stagehandConfig.modelName = this.env.LLM_MODEL;
        stagehandConfig.modelClientOptions = {
          apiKey: this.env.OPENAI_API_KEY,
          baseURL: this.env.LLM_BASE_URL,
          defaultHeaders: {
            'HTTP-Referer': 'https://fireflare.dev',
            'X-Title': 'Fireflare FLARE-1'
          }
        };
        
        console.log(`[FLARE-1] Using external LLM: ${this.env.LLM_MODEL}`);
        console.log(`[FLARE-1] BaseURL: ${this.env.LLM_BASE_URL}`);
        console.log(`[FLARE-1 DEBUG] Stagehand config:`, JSON.stringify({
          env: stagehandConfig.env,
          modelName: stagehandConfig.modelName,
          hasModelClientOptions: !!stagehandConfig.modelClientOptions,
          hasApiKey: !!stagehandConfig.modelClientOptions?.apiKey
        }));
      } else if (this.env.AI) {
        // Workers AI
        stagehandConfig.llmClient = new WorkersAIClient(this.env.AI as any);
        console.log(`[FLARE-1] Using Workers AI`);
      } else {
        throw new Error('Either OPENAI_API_KEY + LLM_BASE_URL or AI binding is required for FLARE-1');
      }

      console.log(`[FLARE-1] Creating Stagehand instance...`);
      this.stagehand = new Stagehand(stagehandConfig);
      
      console.log(`[FLARE-1] Initializing Stagehand (connecting to browser)...`);
      const initStart = Date.now();
      await this.stagehand.init();
      console.log(`[FLARE-1] Stagehand initialized in ${Date.now() - initStart}ms`);
      const page = this.stagehand.page;
      
      // Navigate to URL
      console.log(`[FLARE-1] Navigating to ${config.url}`);
      await page.goto(config.url);
      steps++;
      
      // AI observes and plans actions
      console.log(`[FLARE-1] Observing page for goal: ${config.goal}`);
      const actions = await page.observe(config.goal);
      console.log(`[FLARE-1] Planned ${actions.length} actions`);
      
      // Execute each action
      for (const action of actions) {
        if (steps >= (config.maxSteps || 50)) {
          console.warn('[FLARE-1] Max steps reached');
          break;
        }
        
        if ((Date.now() - startTime) >= (config.maxSeconds || 300) * 1000) {
          console.warn('[FLARE-1] Max time reached');
          break;
        }
        
        console.log(`[FLARE-1] Executing action: ${action}`);
        await page.act(action);
        steps++;
      }
      
      // Extract structured data
      console.log('[FLARE-1] Extracting data');
      
      let data;
      if (config.schema) {
        // Convert JSON schema to Zod schema if needed
        const zodSchema = this.jsonSchemaToZod(config.schema);
        
        data = await page.extract({
          instruction: config.goal,
          schema: zodSchema
        });
      } else {
        // Extract without schema - just use the instruction
        data = await page.extract({
          instruction: config.goal
        });
      }
      
      await this.close();
      
      console.log(`[FLARE-1] Completed successfully in ${steps} steps`);
      
      return {
        success: true,
        data,
        metadata: {
          steps,
          duration: Date.now() - startTime,
          url: config.url
        }
      };
      
    } catch (error) {
      console.error('[FLARE-1] Error:', error);
      await this.close();
      
      return {
        success: false,
        data: null,
        metadata: {
          steps,
          duration: Date.now() - startTime,
          url: config.url
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Close the Stagehand instance and cleanup resources
   */
  async close() {
    if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch (error) {
        console.error('[FLARE-1] Error closing Stagehand:', error);
      }
      this.stagehand = null;
    }
  }
  
  /**
   * Convert JSON Schema to Zod schema
   * Stagehand requires Zod schemas, not JSON schemas
   */
  private jsonSchemaToZod(jsonSchema: any): z.ZodObject<any> {
    if (!jsonSchema || typeof jsonSchema !== 'object') {
      return z.object({ data: z.any() }) as any;
    }
    
    const type = jsonSchema.type;
    const properties = jsonSchema.properties;
    const items = jsonSchema.items;
    const required = jsonSchema.required || [];
    
    // Handle object type
    if (type === 'object' && properties) {
      const shape: Record<string, z.ZodType<any>> = {};
      
      for (const [key, prop] of Object.entries(properties)) {
        const propSchema = prop as any;
        shape[key] = this.jsonSchemaToZod(propSchema);
        
        // Make optional if not in required array
        if (!required.includes(key)) {
          shape[key] = shape[key].optional();
        }
      }
      
      return z.object(shape);
    }
    
    // For non-object types, wrap in an object
    // Stagehand requires ZodObject, not primitive types
    if (type === 'array' && items) {
      return z.object({
        items: z.array(this.jsonSchemaToZod(items))
      }) as any;
    }
    
    // Handle primitive types by wrapping in object
    let primitiveSchema: z.ZodType<any>;
    switch (type) {
      case 'string':
        primitiveSchema = z.string();
        break;
      case 'number':
        primitiveSchema = z.number();
        break;
      case 'integer':
        primitiveSchema = z.number().int();
        break;
      case 'boolean':
        primitiveSchema = z.boolean();
        break;
      case 'null':
        primitiveSchema = z.null();
        break;
      default:
        primitiveSchema = z.any();
    }
    
    return z.object({ value: primitiveSchema }) as any;
  }
}