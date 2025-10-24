# Using MCP Server as Your Fire-1 Agent Inside Fireflare Worker

## Yes, You Can! 🎉

You can absolutely use the Playwright MCP server **inside** your Fireflare worker and modify it to be your Fire-1 extraction agent. This is actually the **best approach** because:

1. **No External Dependencies** - Everything runs in your worker
2. **Direct Access** - No network calls between MCP client/server
3. **Shared State** - Access to your existing browser, LLM, and database
4. **Full Control** - Customize the MCP tools for your specific needs
5. **Cost Effective** - No additional worker deployments needed

## Architecture: MCP Agent Inside Worker

```
┌─────────────────────────────────────────────────────────────┐
│                    Fireflare Worker                          │
│                                                              │
│  ┌──────────────┐      ┌─────────────────────────────┐     │
│  │   HTTP API   │      │    MCP Agent (Fire-1)       │     │
│  │              │      │                             │     │
│  │ /v2/scrape   │──────│  • Browser Tools            │     │
│  │ /v2/extract  │      │  • Extraction Tools         │     │
│  │ /v2/crawl    │      │  • Aggregation Tools        │     │
│  │              │      │  • Validation Tools         │     │
│  └──────────────┘      └─────────────────────────────┘     │
│         │                         │                         │
│         │                         │                         │
│  ┌──────▼─────────────────────────▼──────────────────┐     │
│  │         Shared Resources                          │     │
│  │  • Puppeteer Browser (env.BROWSER)               │     │
│  │  • LLM Provider (OpenRouter/OpenAI)              │     │
│  │  • Durable Objects (CRAWL_JOBS)                  │     │
│  │  • D1 Database (DB)                              │     │
│  │  • KV Cache                                       │     │
│  └──────────────────────────────────────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Implementation: MCP Agent as Fire-1 Engine

### Step 1: Create Fire-1 MCP Agent

**File**: `src/agents/fire1Agent.ts`

```typescript
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import puppeteer from "@cloudflare/puppeteer";
import { OpenAIProvider } from "../utils/llm/openaiProvider";
import { getLLMConfig } from "../utils/llm/llmConfig";
import { extractContent } from "../utils/contentExtractor";
import type { Env } from "../index";

/**
 * Fire-1 Agent: AI-powered extraction agent using MCP
 * This agent provides tools for intelligent web data extraction
 */
export class Fire1Agent extends McpAgent<Env> {
  server = new McpServer({ 
    name: "Fire-1 Extraction Agent", 
    version: "1.0.0" 
  });

  private llmProvider: OpenAIProvider | null = null;

  async init() {
    // Initialize LLM provider
    const config = getLLMConfig(this.env);
    this.llmProvider = new OpenAIProvider(config);

    // ============================================
    // TOOL 1: Extract Structured Data from URL
    // ============================================
    this.server.tool(
      "extract_structured",
      {
        url: z.string().describe("URL to extract data from"),
        schema: z.any().describe("JSON schema for extraction"),
        prompt: z.string().optional().describe("Additional extraction instructions"),
        onlyMainContent: z.boolean().optional().describe("Extract only main content")
      },
      async ({ url, schema, prompt, onlyMainContent = true }) => {
        try {
          // Use existing browser and extraction utilities
          const browser = await puppeteer.launch(this.env.BROWSER);
          
          // Extract content using existing utilities
          const content = await extractContent(browser, url, {
            formats: ['markdown'],
            onlyMainContent,
            timeout: 30000
          });
          
          await browser.close();
          
          // Use LLM to extract structured data
          const extracted = await this.llmProvider!.extractStructured(
            content.markdown || '',
            schema,
            prompt
          );
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                url,
                data: extracted,
                metadata: content.metadata
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // ============================================
    // TOOL 2: Extract from Multiple URLs
    // ============================================
    this.server.tool(
      "extract_multi_page",
      {
        urls: z.array(z.string()).describe("URLs to extract from"),
        schema: z.any().describe("JSON schema for extraction"),
        aggregationStrategy: z.enum(['merge', 'separate', 'intelligent']).optional(),
        prompt: z.string().optional()
      },
      async ({ urls, schema, aggregationStrategy = 'intelligent', prompt }) => {
        try {
          const results = [];
          const browser = await puppeteer.launch(this.env.BROWSER);
          
          // Extract from each URL
          for (const url of urls) {
            try {
              const content = await extractContent(browser, url, {
                formats: ['markdown'],
                onlyMainContent: true,
                timeout: 30000
              });
              
              const extracted = await this.llmProvider!.extractStructured(
                content.markdown || '',
                schema,
                prompt
              );
              
              results.push({ url, data: extracted, success: true });
            } catch (error) {
              results.push({ url, error: error.message, success: false });
            }
          }
          
          await browser.close();
          
          // Aggregate results based on strategy
          let aggregated;
          if (aggregationStrategy === 'separate') {
            aggregated = results;
          } else if (aggregationStrategy === 'merge') {
            aggregated = this.mergeResults(results);
          } else {
            // Intelligent merge using LLM
            aggregated = await this.intelligentMerge(results, schema);
          }
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                pagesProcessed: urls.length,
                data: aggregated
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // ============================================
    // TOOL 3: Extract with Prompt (No Schema)
    // ============================================
    this.server.tool(
      "extract_with_prompt",
      {
        url: z.string().describe("URL to extract from"),
        prompt: z.string().describe("Natural language extraction instructions"),
        outputFormat: z.enum(['json', 'text']).optional()
      },
      async ({ url, prompt, outputFormat = 'json' }) => {
        try {
          const browser = await puppeteer.launch(this.env.BROWSER);
          
          const content = await extractContent(browser, url, {
            formats: ['markdown'],
            onlyMainContent: true,
            timeout: 30000
          });
          
          await browser.close();
          
          const extracted = await this.llmProvider!.extractWithPrompt(
            content.markdown || '',
            prompt
          );
          
          return {
            content: [{
              type: "text",
              text: outputFormat === 'json' 
                ? JSON.stringify(extracted, null, 2)
                : typeof extracted === 'string' ? extracted : JSON.stringify(extracted)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // ============================================
    // TOOL 4: Validate Extracted Data
    // ============================================
    this.server.tool(
      "validate_extraction",
      {
        data: z.any().describe("Data to validate"),
        schema: z.any().describe("JSON schema to validate against")
      },
      async ({ data, schema }) => {
        const validation = this.validateAgainstSchema(data, schema);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(validation, null, 2)
          }]
        };
      }
    );

    // ============================================
    // TOOL 5: Get Accessibility Snapshot
    // ============================================
    this.server.tool(
      "get_accessibility_tree",
      {
        url: z.string().describe("URL to get accessibility tree from"),
        waitFor: z.string().optional().describe("CSS selector to wait for")
      },
      async ({ url, waitFor }) => {
        try {
          const browser = await puppeteer.launch(this.env.BROWSER);
          const page = await browser.newPage();
          
          await page.goto(url, { waitUntil: 'networkidle0' });
          
          if (waitFor) {
            await page.waitForSelector(waitFor);
          }
          
          // Get accessibility snapshot
          const snapshot = await page.accessibility.snapshot();
          
          await browser.close();
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                url,
                accessibilityTree: snapshot
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Merge results from multiple pages
   */
  private mergeResults(results: any[]): any {
    const merged: any = {};
    
    for (const result of results) {
      if (result.success && result.data) {
        Object.assign(merged, result.data);
      }
    }
    
    return merged;
  }

  /**
   * Intelligently merge results using LLM
   */
  private async intelligentMerge(results: any[], schema: any): Promise<any> {
    const successfulResults = results.filter(r => r.success);
    
    if (successfulResults.length === 0) {
      return { error: "No successful extractions to merge" };
    }
    
    if (successfulResults.length === 1) {
      return successfulResults[0].data;
    }
    
    // Use LLM to intelligently merge
    const prompt = `Given these extracted data from multiple pages, intelligently merge them into a single coherent result that matches the schema. Resolve any conflicts by choosing the most complete or recent data.

Schema:
${JSON.stringify(schema, null, 2)}

Extracted Data:
${JSON.stringify(successfulResults.map(r => ({ url: r.url, data: r.data })), null, 2)}

Return the merged data as JSON matching the schema.`;
    
    return await this.llmProvider!.extractWithPrompt(
      JSON.stringify(successfulResults),
      prompt
    );
  }

  /**
   * Validate data against schema
   */
  private validateAgainstSchema(data: any, schema: any): any {
    const errors: string[] = [];
    
    if (schema.type === 'object' && schema.properties) {
      // Check required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in data)) {
            errors.push(`Missing required field: ${field}`);
          }
        }
      }
      
      // Check field types
      for (const [field, fieldSchema] of Object.entries(schema.properties as any)) {
        if (field in data) {
          const expectedType = fieldSchema.type;
          const actualType = Array.isArray(data[field]) ? 'array' : typeof data[field];
          
          if (expectedType !== actualType) {
            errors.push(`Field ${field}: expected ${expectedType}, got ${actualType}`);
          }
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      data
    };
  }
}
```

### Step 2: Integrate Agent into Worker

**File**: `src/index.ts`

```typescript
import { Fire1Agent } from './agents/fire1Agent';

// Export the agent as a Durable Object
export { Fire1Agent };

// Add to your worker
const app = new Hono();

// Mount MCP endpoints for external access (optional)
app.all('/mcp/sse/*', async (c) => {
  return Fire1Agent.serveSSE('/mcp/sse').fetch(c.req.raw, c.env, c.executionCtx);
});

app.all('/mcp/http/*', async (c) => {
  return Fire1Agent.serve('/mcp/http').fetch(c.req.raw, c.env, c.executionCtx);
});

// Use agent internally in your endpoints
app.post('/v2/extract/fire1', async (c) => {
  const { urls, schema, prompt, aggregationStrategy } = await c.req.json();
  
  // Get agent instance
  const agentId = c.env.FIRE1_AGENT.idFromName('fire1-singleton');
  const agent = c.env.FIRE1_AGENT.get(agentId);
  
  // Call agent tool directly
  const response = await agent.fetch(
    new Request('https://do/tool/extract_multi_page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'extract_multi_page',
          arguments: { urls, schema, prompt, aggregationStrategy }
        },
        id: 1
      })
    })
  );
  
  const result = await response.json();
  return c.json(result);
});
```

### Step 3: Update wrangler.toml

```toml
name = "fireflare"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[browser]
binding = "BROWSER"

[[durable_objects.bindings]]
name = "CRAWL_JOBS"
class_name = "CrawlJob"
script_name = "fireflare"

[[durable_objects.bindings]]
name = "FIRE1_AGENT"
class_name = "Fire1Agent"
script_name = "fireflare"

[[migrations]]
tag = "v1"
new_classes = ["CrawlJob", "Fire1Agent"]
```

## Usage Patterns

### Pattern 1: Direct Internal Use (Recommended)

```typescript
// In your endpoint
export class WebExtract extends OpenAPIRoute {
  async handle(c: AppContext) {
    const { urls, schema, prompt } = await this.getValidatedData();
    
    // Get Fire-1 agent instance
    const agentId = c.env.FIRE1_AGENT.idFromName('fire1-singleton');
    const agent = c.env.FIRE1_AGENT.get(agentId);
    
    // Call agent tool
    const response = await agent.fetch(
      new Request('https://do/tool/extract_multi_page', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'extract_multi_page',
            arguments: { urls, schema, prompt }
          },
          id: 1
        })
      })
    );
    
    const result = await response.json();
    return c.json(result.result);
  }
}
```

### Pattern 2: Helper Wrapper

```typescript
// src/utils/fire1Helper.ts
export class Fire1Helper {
  constructor(private env: Env) {}
  
  async extractStructured(url: string, schema: any, prompt?: string) {
    const agentId = this.env.FIRE1_AGENT.idFromName('fire1-singleton');
    const agent = this.env.FIRE1_AGENT.get(agentId);
    
    const response = await agent.fetch(
      new Request('https://do/tool/extract_structured', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'extract_structured',
            arguments: { url, schema, prompt }
          },
          id: 1
        })
      })
    );
    
    const result = await response.json();
    return JSON.parse(result.result.content[0].text);
  }
  
  async extractMultiPage(
    urls: string[], 
    schema: any, 
    options: { prompt?: string; aggregationStrategy?: string } = {}
  ) {
    const agentId = this.env.FIRE1_AGENT.idFromName('fire1-singleton');
    const agent = this.env.FIRE1_AGENT.get(agentId);
    
    const response = await agent.fetch(
      new Request('https://do/tool/extract_multi_page', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'extract_multi_page',
            arguments: { urls, schema, ...options }
          },
          id: 1
        })
      })
    );
    
    const result = await response.json();
    return JSON.parse(result.result.content[0].text);
  }
}

// Usage in endpoint
const fire1 = new Fire1Helper(c.env);
const result = await fire1.extractStructured(url, schema, prompt);
```

### Pattern 3: Simplified API

```typescript
// src/endpoints/webExtract.ts
export class WebExtract extends OpenAPIRoute {
  async handle(c: AppContext) {
    const data = await this.getValidatedData();
    const { urls, schema, prompt } = data.body;
    
    // Use helper
    const fire1 = new Fire1Helper(c.env);
    
    if (urls.length === 1) {
      const result = await fire1.extractStructured(urls[0], schema, prompt);
      return c.json({ success: true, data: result });
    } else {
      const result = await fire1.extractMultiPage(urls, schema, {
        prompt,
        aggregationStrategy: 'intelligent'
      });
      return c.json({ success: true, data: result });
    }
  }
}
```

## Benefits of This Approach

### 1. **No Network Overhead**
- Agent runs in same worker
- No HTTP calls between components
- Faster execution

### 2. **Shared Resources**
- Single browser instance
- Shared LLM provider
- Common database access
- Unified caching

### 3. **Simplified Architecture**
```
Before (Separate MCP Server):
Worker → HTTP → MCP Server → Browser → LLM
(3 network hops)

After (Integrated Agent):
Worker → Agent → Browser → LLM
(0 network hops)
```

### 4. **State Management**
- Agent can maintain state across calls
- Cache extraction results
- Remember previous extractions
- Learn from patterns

### 5. **Cost Efficiency**
- No additional worker costs
- Reduced latency
- Better resource utilization

## Advanced: Agent with Memory

```typescript
export class Fire1Agent extends McpAgent<Env> {
  // Agent state (persisted in Durable Object)
  private extractionCache: Map<string, any> = new Map();
  private stats = {
    totalExtractions: 0,
    successfulExtractions: 0,
    failedExtractions: 0
  };

  async init() {
    // Load state from storage
    const cached = await this.state.storage.get('extractionCache');
    if (cached) {
      this.extractionCache = new Map(Object.entries(cached));
    }
    
    const stats = await this.state.storage.get('stats');
    if (stats) {
      this.stats = stats;
    }
    
    // Add tool with caching
    this.server.tool(
      "extract_structured_cached",
      {
        url: z.string(),
        schema: z.any(),
        prompt: z.string().optional(),
        useCache: z.boolean().optional()
      },
      async ({ url, schema, prompt, useCache = true }) => {
        const cacheKey = `${url}:${JSON.stringify(schema)}`;
        
        // Check cache
        if (useCache && this.extractionCache.has(cacheKey)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                cached: true,
                data: this.extractionCache.get(cacheKey)
              }, null, 2)
            }]
          };
        }
        
        // Extract
        try {
          const result = await this.performExtraction(url, schema, prompt);
          
          // Cache result
          this.extractionCache.set(cacheKey, result);
          await this.state.storage.put('extractionCache', 
            Object.fromEntries(this.extractionCache)
          );
          
          // Update stats
          this.stats.totalExtractions++;
          this.stats.successfulExtractions++;
          await this.state.storage.put('stats', this.stats);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                cached: false,
                data: result
              }, null, 2)
            }]
          };
        } catch (error) {
          this.stats.totalExtractions++;
          this.stats.failedExtractions++;
          await this.state.storage.put('stats', this.stats);
          
          throw error;
        }
      }
    );
    
    // Add stats tool
    this.server.tool(
      "get_stats",
      {},
      async () => ({
        content: [{
          type: "text",
          text: JSON.stringify(this.stats, null, 2)
        }]
      })
    );
  }
}
```

## Deployment

```bash
# Install dependencies
npm install agents @modelcontextprotocol/sdk

# Deploy
npx wrangler deploy

# Test
curl -X POST "https://your-worker.workers.dev/v2/extract/fire1" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "description": { "type": "string" }
      }
    }
  }'
```

## Conclusion

**Yes, you can and should use the MCP server inside your worker as your Fire-1 agent!**

This approach gives you:
- ✅ Full control over the agent
- ✅ Direct access to all worker resources
- ✅ No network overhead
- ✅ Stateful agent with memory
- ✅ Cost-effective architecture
- ✅ Easy to customize and extend

The Fire-1 agent becomes a **first-class citizen** of your worker, not an external dependency. This is the most powerful and flexible way to implement your Fire-1 alternative! 🚀