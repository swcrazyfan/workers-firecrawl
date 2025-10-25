# FLARE-1 Implementation Guide Using Stagehand

## Executive Summary

FLARE-1 is Fireflare's Fire-1 alternative, built on top of [Stagehand](https://www.stagehand.dev/) - an AI-powered browser automation library. Instead of building an agent from scratch, we leverage Stagehand's proven capabilities and wrap it with Firecrawl-compatible APIs.

**Implementation Time: 5-6 hours** (vs 2-4 weeks building from scratch)

## What is Stagehand?

Stagehand is an open-source, AI-powered browser automation library that:
- ✅ Uses natural language for browser actions
- ✅ AI-powered observation and decision making
- ✅ Built-in structured data extraction
- ✅ Resilient to website changes
- ✅ Works with Cloudflare Browser Rendering
- ✅ Supports Workers AI, OpenAI, Anthropic

**Stagehand essentially IS Fire-1 for Cloudflare Workers.**

## Architecture

```mermaid
graph TB
    A[User Request] --> B[/v2/extract or /v2/scrape]
    B --> C{agent.model?}
    
    C -->|FLARE-1| D[Flare1Agent Wrapper]
    D --> E[Stagehand Instance]
    
    E --> F[page.observe]
    F --> G[AI Plans Actions]
    G --> H[page.act]
    H --> I[Execute Actions]
    I --> J{More Actions?}
    J -->|Yes| F
    J -->|No| K[page.extract]
    K --> L[Extract with Schema]
    L --> M[Return Data]
    
    C -->|No agent| N[Regular Extraction]
    N --> O[Existing Flow]
```

## Implementation Plan

### Phase 1: Setup & Dependencies (30 minutes)

#### 1.1 Install Dependencies

```bash
npm install @browserbasehq/stagehand@^2.5.0
npm install zod@^3.25.76
npm install zod-to-json-schema@^3.24.6
```

**Important:** Stagehand requires Zod v3, not v4.

#### 1.2 Update wrangler.toml

Add AI binding and module alias:

```toml
name = "fireflare"
main = "src/index.ts"
compatibility_date = "2025-01-15"
compatibility_flags = ["nodejs_compat"]

[browser]
binding = "BROWSER"

[ai]
binding = "AI"

# Module alias to use Cloudflare's Playwright
[alias]
playwright = "@cloudflare/playwright"

[[d1_databases]]
binding = "DB"
database_name = "fireflare-db"
database_id = "your-database-id"

[[durable_objects.bindings]]
name = "CRAWL_JOBS"
class_name = "CrawlJob"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CrawlJob"]
```

#### 1.3 Update Environment Types

Update `src/index.ts`:

```typescript
export type Env = {
  BROWSER: Fetcher;
  AI: Ai; // Add this
  AUTHORIZATION_KEY?: string;
  CRAWL_JOBS: DurableObjectNamespace;
  DB: D1Database;
  OPENAI_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT?: string;
  LLM_MAX_RETRIES?: string;
};
```

### Phase 2: Create FLARE-1 Agent (2 hours)

#### 2.1 Create WorkersAI Client

**File:** `src/agents/workersAIClient.ts`

```typescript
import type { Ai } from "@cloudflare/workers-types";

export class WorkersAIClient {
  constructor(
    private ai: Ai,
    private options?: {
      gateway?: { id: string };
    }
  ) {}

  async createChatCompletion(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format?: { type: string; schema?: any };
  }) {
    const response = await this.ai.run(params.model, {
      messages: params.messages,
      ...(params.response_format && {
        response_format: params.response_format
      })
    });

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
  }
}
```

#### 2.2 Create FLARE-1 Agent Wrapper

**File:** `src/agents/flare1.ts`

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { endpointURLString } from "@cloudflare/playwright";
import { WorkersAIClient } from "./workersAIClient";
import type { Env } from "../index";
import type { z } from "zod";

export interface Flare1Config {
  url: string;
  goal: string;
  schema?: z.ZodType<any>;
  maxSteps?: number;
  maxSeconds?: number;
  verbose?: boolean;
}

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

export class Flare1Agent {
  private stagehand: Stagehand | null = null;
  
  constructor(private env: Env) {}
  
  async run(config: Flare1Config): Promise<Flare1Result> {
    const startTime = Date.now();
    let steps = 0;
    
    try {
      // Initialize Stagehand
      this.stagehand = new Stagehand({
        env: "LOCAL",
        localBrowserLaunchOptions: { 
          cdpUrl: endpointURLString(this.env.BROWSER) 
        },
        // Use Workers AI or OpenRouter/OpenAI
        ...(this.env.AI ? {
          llmClient: new WorkersAIClient(this.env.AI)
        } : {
          modelName: this.env.LLM_MODEL || "openai/gpt-4",
          modelClientOptions: {
            apiKey: this.env.OPENAI_API_KEY,
            baseURL: this.env.LLM_BASE_URL
          }
        }),
        verbose: config.verbose ? 1 : 0
      });
      
      await this.stagehand.init();
      const page = this.stagehand.page;
      
      // Navigate to URL
      await page.goto(config.url);
      steps++;
      
      // AI observes and plans actions
      const actions = await page.observe(config.goal);
      
      // Execute each action
      for (const action of actions) {
        if (steps >= (config.maxSteps || 50)) {
          console.warn('Max steps reached');
          break;
        }
        
        if ((Date.now() - startTime) >= (config.maxSeconds || 300) * 1000) {
          console.warn('Max time reached');
          break;
        }
        
        await page.act(action);
        steps++;
      }
      
      // Extract structured data
      const data = await page.extract({
        instruction: config.goal,
        ...(config.schema && { schema: config.schema })
      });
      
      await this.close();
      
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
  
  async close() {
    if (this.stagehand) {
      await this.stagehand.close();
      this.stagehand = null;
    }
  }
}
```

#### 2.3 Create Result Aggregator

**File:** `src/agents/resultAggregator.ts`

```typescript
import { OpenAIProvider } from '../utils/llm/openaiProvider';
import { getLLMConfig } from '../utils/llm/llmConfig';
import type { Env } from '../index';

export class ResultAggregator {
  private llm: OpenAIProvider;
  
  constructor(env: Env) {
    const config = getLLMConfig(env);
    this.llm = new OpenAIProvider(config);
  }
  
  async merge(
    results: Array<{ url: string; data: any }>,
    schema?: any
  ): Promise<any> {
    // Single result - no merging needed
    if (results.length === 0) return null;
    if (results.length === 1) return results[0].data;
    
    // Multiple results - intelligent merge using LLM
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

Return the merged result as JSON.`;
    
    try {
      const merged = await this.llm.extractWithPrompt(
        JSON.stringify(results),
        prompt
      );
      
      return merged;
    } catch (error) {
      console.error('Aggregation failed:', error);
      // Fallback: return all results as array
      return results.map(r => r.data);
    }
  }
}
```

### Phase 3: Update Endpoints (2 hours)

#### 3.1 Update Type Schemas

**File:** `src/types/schemas.ts`

Add agent parameter to existing schemas:

```typescript
import { z } from "zod";

// Add agent schema
export const AgentSchema = z.object({
  model: z.enum(['FLARE-1']).optional(),
  prompt: z.string().optional(),
  maxSteps: z.number().optional(),
  maxSeconds: z.number().optional()
}).optional();

// Update ScrapeRequestSchema
export const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  formats: z.array(z.string()).optional(),
  agent: AgentSchema, // Add this
  // ... existing fields
});

// Update ExtractRequestSchema
export const ExtractRequestSchema = z.object({
  urls: z.array(z.string().url()),
  prompt: z.string().optional(),
  schema: z.any().optional(),
  agent: AgentSchema, // Add this
  scrapeOptions: z.any().optional()
});
```

#### 3.2 Update webScrape Endpoint

**File:** `src/endpoints/webScrape.ts`

```typescript
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { getBrowser, closeBrowser } from "../utils/browser";
import { extractContent } from "../utils/contentExtractor";
import { Flare1Agent } from "../agents/flare1";

export class WebScrape extends OpenAPIRoute {
  schema = {
    tags: ["Scraping"],
    summary: "Scrape a single URL",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              url: z.string().url(),
              formats: z.array(z.string()).optional(),
              agent: z.object({
                model: z.enum(['FLARE-1']).optional(),
                prompt: z.string().optional(),
                maxSteps: z.number().optional(),
                maxSeconds: z.number().optional()
              }).optional(),
              // ... other existing fields
            })
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Successful scrape",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
              metadata: z.any().optional()
            })
          }
        }
      }
    }
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { url, formats, agent, ...options } = data.body;
    
    // Check if FLARE-1 agent mode is requested
    if (agent?.model === 'FLARE-1') {
      const flare1 = new Flare1Agent(c.env);
      
      try {
        const result = await flare1.run({
          url,
          goal: agent.prompt || 'Scrape and extract all relevant content from this page',
          maxSteps: agent.maxSteps || 50,
          maxSeconds: agent.maxSeconds || 300,
          verbose: true
        });
        
        if (!result.success) {
          return Response.json({
            success: false,
            error: result.error
          }, { status: 500 });
        }
        
        return Response.json({
          success: true,
          data: result.data,
          metadata: result.metadata
        });
        
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    }
    
    // Regular scraping (existing code)
    const browser = await getBrowser(c.env);
    
    try {
      const content = await extractContent(browser, url, {
        formats: formats || ['markdown'],
        ...options
      });
      
      await closeBrowser(browser);
      
      return Response.json({
        success: true,
        data: content
      });
      
    } catch (error) {
      await closeBrowser(browser);
      throw error;
    }
  }
}
```

#### 3.3 Update webExtract Endpoint

**File:** `src/endpoints/webExtract.ts`

```typescript
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { Flare1Agent } from "../agents/flare1";
import { ResultAggregator } from "../agents/resultAggregator";

export class WebExtract extends OpenAPIRoute {
  schema = {
    tags: ["Extraction"],
    summary: "Extract structured data from URLs",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              urls: z.array(z.string().url()),
              prompt: z.string().optional(),
              schema: z.any().optional(),
              agent: z.object({
                model: z.enum(['FLARE-1']).optional(),
                prompt: z.string().optional(),
                maxSteps: z.number().optional(),
                maxSeconds: z.number().optional()
              }).optional(),
              scrapeOptions: z.any().optional()
            })
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Successful extraction",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
              metadata: z.any().optional()
            })
          }
        }
      }
    }
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { urls, prompt, schema, agent, scrapeOptions } = data.body;
    
    // Check if FLARE-1 agent mode is requested
    if (agent?.model === 'FLARE-1') {
      const flare1 = new Flare1Agent(c.env);
      const results: Array<{ url: string; data: any }> = [];
      
      try {
        // Process each URL with FLARE-1
        for (const url of urls) {
          const result = await flare1.run({
            url,
            goal: agent.prompt || prompt || 'Extract structured data from this page',
            schema,
            maxSteps: agent.maxSteps || 50,
            maxSeconds: agent.maxSeconds || 300,
            verbose: true
          });
          
          if (result.success) {
            results.push({
              url,
              data: result.data
            });
          }
        }
        
        // Aggregate results if multiple URLs
        let aggregated;
        if (results.length === 1) {
          aggregated = results[0].data;
        } else if (results.length > 1) {
          const aggregator = new ResultAggregator(c.env);
          aggregated = await aggregator.merge(results, schema);
        } else {
          aggregated = null;
        }
        
        return Response.json({
          success: true,
          data: aggregated,
          metadata: {
            urlsProcessed: results.length,
            totalUrls: urls.length
          }
        });
        
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    }
    
    // Regular extraction using Durable Objects (existing code)
    const jobId = `extract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const doId = c.env.CRAWL_JOBS.idFromName(jobId);
    const extractJobDO = c.env.CRAWL_JOBS.get(doId);
    
    await extractJobDO.fetch(
      new Request("https://do/start-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          urls,
          prompt,
          schema,
          scrapeOptions
        }),
      })
    );
    
    return Response.json({
      success: true,
      id: jobId,
      url: `${new URL(c.req.url).origin}/v2/extract/${jobId}`,
    });
  }
}
```

### Phase 4: Testing (1 hour)

#### 4.1 Create Test Script

**File:** `test-flare1.sh`

```bash
#!/bin/bash

# Test FLARE-1 with single URL
echo "Testing FLARE-1 with single URL..."
curl -X POST "http://localhost:8787/v2/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract the main heading and first paragraph"
    }
  }'

echo -e "\n\n"

# Test FLARE-1 with schema
echo "Testing FLARE-1 with schema..."
curl -X POST "http://localhost:8787/v2/extract" \
  -H "Content-Type: "application/json" \
  -d '{
    "urls": ["https://example.com"],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract website information"
    },
    "schema": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"}
      }
    }
  }'

echo -e "\n\n"

# Test FLARE-1 with multiple URLs
echo "Testing FLARE-1 with multiple URLs..."
curl -X POST "http://localhost:8787/v2/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com",
      "https://example.org"
    ],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract and compare the main content"
    }
  }'
```

Make it executable:
```bash
chmod +x test-flare1.sh
```

#### 4.2 Test Scenarios

1. **Single URL Extraction**
   ```bash
   ./test-flare1.sh
   ```

2. **Multi-step Workflow** (pagination)
   ```json
   {
     "url": "https://example.com/products",
     "agent": {
       "model": "FLARE-1",
       "prompt": "Click through all pages and extract product names",
       "maxSteps": 20
     }
   }
   ```

3. **Form Interaction**
   ```json
   {
     "url": "https://example.com/search",
     "agent": {
       "model": "FLARE-1",
       "prompt": "Search for 'laptops' and extract the first 5 results"
     }
   }
   ```

### Phase 5: Documentation

#### 5.1 Update README.md

Add FLARE-1 section:

```markdown
## FLARE-1 Agent Mode

FLARE-1 is Fireflare's AI-powered browser automation agent, built on Stagehand. It enables intelligent navigation and data extraction using natural language instructions.

### Features

- 🤖 **AI-Powered Actions** - Natural language browser control
- 🔍 **Intelligent Observation** - AI decides what actions to take
- 📊 **Structured Extraction** - Extract data with schemas
- 🔄 **Multi-Step Workflows** - Handle pagination, forms, and complex interactions
- 🛡️ **Resilient** - Adapts to website changes automatically

### Usage

#### Basic Scraping with FLARE-1

```javascript
const response = await fetch('https://your-worker.workers.dev/v2/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    url: 'https://example.com',
    agent: {
      model: 'FLARE-1',
      prompt: 'Extract the main article content'
    }
  })
});
```

#### Extraction with Schema

```javascript
const response = await fetch('https://your-worker.workers.dev/v2/extract', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    urls: ['https://example.com/product'],
    agent: {
      model: 'FLARE-1',
      prompt: 'Extract product information'
    },
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number' },
        inStock: { type: 'boolean' }
      }
    }
  })
});
```

#### Multi-Step Workflow

```javascript
const response = await fetch('https://your-worker.workers.dev/v2/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    url: 'https://example.com/products',
    agent: {
      model: 'FLARE-1',
      prompt: 'Click through all pages and extract all product names',
      maxSteps: 20,
      maxSeconds: 120
    }
  })
});
```

### Agent Parameters

- `model`: Must be `"FLARE-1"` to enable agent mode
- `prompt`: Natural language instruction for what to do
- `maxSteps`: Maximum number of actions (default: 50)
- `maxSeconds`: Maximum execution time in seconds (default: 300)
```

## Deployment

### 1. Build

```bash
npm run build
```

### 2. Deploy

```bash
npx wrangler deploy
```

### 3. Test Production

```bash
curl -X POST "https://your-worker.workers.dev/v2/scrape" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "url": "https://example.com",
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract the main content"
    }
  }'
```

## Comparison: FLARE-1 vs Fire-1

| Feature | Firecrawl Fire-1 | Fireflare FLARE-1 |
|---------|------------------|-------------------|
| AI Agent | ✅ Proprietary | ✅ Stagehand |
| Browser Control | ✅ | ✅ Cloudflare Browser Rendering |
| Natural Language | ✅ | ✅ |
| Structured Extraction | ✅ | ✅ |
| Multi-step Workflows | ✅ | ✅ |
| Pagination | ✅ | ✅ |
| Form Interaction | ✅ | ✅ |
| Edge Computing | ❌ | ✅ |
| Cost | $$$ | $ |
| Customizable | ❌ | ✅ |
| Open Source | ❌ | ✅ |

## Implementation Timeline

- ✅ **Phase 1**: Setup & Dependencies (30 min)
- ✅ **Phase 2**: Create FLARE-1 Agent (2 hours)
- ✅ **Phase 3**: Update Endpoints (2 hours)
- ✅ **Phase 4**: Testing (1 hour)
- ✅ **Phase 5**: Documentation (30 min)

**Total: ~6 hours**

## Next Steps

1. Install dependencies
2. Update configuration
3. Create agent files
4. Update endpoints
5. Test thoroughly
6. Deploy to production

## Resources

- [Stagehand Documentation](https://docs.stagehand.dev/)
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Firecrawl API Guide](./FIRECRAWL_API_GUIDE.md)