
# FLARE-1: Complete Implementation Plan for Fireflare

## Executive Summary

FLARE-1 is our Fire-1 alternative - an AI-powered agent that enables intelligent navigation and interaction with web pages for comprehensive data extraction. This document provides the complete implementation plan.

## What is FLARE-1?

**FLARE-1 = Fire-1 Alternative for Fireflare**

An AI agent that:
- ✅ Plans and takes browser actions autonomously
- ✅ Interacts with buttons, links, inputs, and dynamic elements
- ✅ Handles pagination and multi-step workflows
- ✅ Extracts structured data using schemas or prompts
- ✅ Intelligently aggregates results from multiple pages
- ✅ Runs entirely on Cloudflare Workers edge network

## Fire-1 vs FLARE-1

| Feature | Firecrawl Fire-1 | Fireflare FLARE-1 |
|---------|------------------|-------------------|
| AI Agent | ✅ Proprietary | ✅ OpenRouter/OpenAI |
| Browser Control | ✅ | ✅ Cloudflare Puppeteer |
| Action Planning | ✅ | ✅ LLM-driven |
| Pagination | ✅ | ✅ |
| Form Interaction | ✅ | ✅ |
| Multi-page Aggregation | ✅ | ✅ |
| Edge Computing | ❌ | ✅ |
| Cost | $$$ | $ |
| Customizable | ❌ | ✅ |

## Architecture Overview

```mermaid
graph TB
    A[User Request] --> B[/v2/extract or /v2/scrape]
    B --> C{Agent Mode?}
    
    C -->|No agent| D[Simple Extraction]
    D --> E[Scrape URLs]
    E --> F[Extract with LLM]
    F --> G[Return Results]
    
    C -->|With agent| H[FLARE-1 Agent]
    H --> I[Agent Loop]
    
    subgraph Agent Loop
        I --> J[LLM Plans Action]
        J --> K[Execute Action]
        K --> L[Observe Result]
        L --> M{Goal Achieved?}
        M -->|No| J
        M -->|Yes| N[Aggregate Results]
    end
    
    N --> O[Return Unified Data]
    
    subgraph Actions
        K --> P[goto URL]
        K --> Q[click button]
        K --> R[type text]
        K --> S[wait for element]
        K --> T[extract data]
        K --> U[finish]
    end
```

## Core Components

### 1. Agent Planner (LLM-Driven Decision Making)

**File**: `src/agents/flare1Planner.ts`

**Responsibilities:**
- Analyze current page state
- Decide next action based on goal
- Generate action parameters
- Determine when goal is achieved

**Key Functions:**
```typescript
interface PlannerInput {
  goal: string;              // User's extraction goal
  observation: PageState;    // Current page state
  schema?: any;              // Target data schema
  budget: {                  // Remaining resources
    steps: number;
    seconds: number;
  };
}

interface PlannedAction {
  type: 'goto' | 'click' | 'type' | 'wait' | 'extract' | 'finish';
  params: any;
  reasoning: string;
}

async function planNextAction(input: PlannerInput): Promise<PlannedAction>
```

### 2. Action Executor (Puppeteer Integration)

**File**: `src/agents/actionExecutor.ts`

**Responsibilities:**
- Execute planned actions using Puppeteer
- Handle action failures gracefully
- Capture page state after actions
- Extract data when requested

**Action Types:**
```typescript
type Action =
  | { type: 'goto'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'wait'; selector: string; state?: 'visible' | 'hidden' }
  | { type: 'extract'; schema: any; prompt?: string }
  | { type: 'finish'; reason: string }
```

### 3. Page Observer (State Capture)

**File**: `src/agents/pageObserver.ts`

**Responsibilities:**
- Capture current page state
- Identify interactive elements
- Detect pagination controls
- Provide context to planner

**Observation Data:**
```typescript
interface PageState {
  url: string;
  title: string;
  hasNextButton: boolean;
  hasPrevButton: boolean;
  hasLoadMore: boolean;
  hasSearchBox: boolean;
  mainContent: string;      // Simplified content for LLM
  interactiveElements: Array<{
    type: 'button' | 'link' | 'input';
    selector: string;
    text: string;
  }>;
}
```

### 4. Result Aggregator (Data Merging)

**File**: `src/agents/resultAggregator.ts`

**Responsibilities:**
- Collect extracted data from multiple pages
- Merge results intelligently using LLM
- Resolve conflicts
- Deduplicate information

**Aggregation Strategies:**
```typescript
type AggregationStrategy = 
  | 'merge'        // Combine all data into one object
  | 'array'        // Keep as array of page results
  | 'intelligent'  // LLM decides how to merge
```

### 5. Agent Controller (Orchestration)

**File**: `src/agents/flare1Controller.ts`

**Responsibilities:**
- Manage agent loop
- Track budget (steps, time)
- Handle errors and retries
- Coordinate all components

**Main Loop:**
```typescript
async function runAgent(config: AgentConfig): Promise<AgentResult> {
  let steps = 0;
  const maxSteps = config.maxSteps || 50;
  const startTime = Date.now();
  const maxTime = config.maxSeconds || 300;
  const extractedData: any[] = [];
  
  while (steps < maxSteps && (Date.now() - startTime) < maxTime * 1000) {
    // 1. Observe current state
    const observation = await observer.capture(page);
    
    // 2. Plan next action
    const action = await planner.plan({
      goal: config.goal,
      observation,
      schema: config.schema,
      budget: {
        steps: maxSteps - steps,
        seconds: Math.floor((maxTime * 1000 - (Date.now() - startTime)) / 1000)
      }
    });
    
    // 3. Execute action
    const result = await executor.execute(page, action);
    
    // 4. Collect extracted data
    if (action.type === 'extract' && result.data) {
      extractedData.push(result.data);
    }
    
    // 5. Check if done
    if (action.type === 'finish') {
      break;
    }
    
    steps++;
  }
  
  // 6. Aggregate all extracted data
  const aggregated = await aggregator.merge(extractedData, config.schema);
  
  return {
    success: true,
    data: aggregated,
    metadata: {
      steps,
      duration: Date.now() - startTime,
      pagesProcessed: extractedData.length
    }
  };
}
```

## Implementation Phases

### Phase 1: Core Agent Infrastructure (Week 1)

#### 1.1 Create Agent Types and Interfaces
**File**: `src/agents/types.ts`

```typescript
export interface AgentConfig {
  goal: string;
  startUrl: string;
  schema?: any;
  prompt?: string;
  maxSteps?: number;
  maxSeconds?: number;
  allowlist?: string[];
}

export interface AgentResult {
  success: boolean;
  data: any;
  metadata: {
    steps: number;
    duration: number;
    pagesProcessed: number;
    tokensUsed?: number;
  };
  warnings?: string[];
  error?: string;
}

export interface PageState {
  url: string;
  title: string;
  content: string;
  interactiveElements: InteractiveElement[];
  hints: {
    hasNextButton: boolean;
    hasPrevButton: boolean;
    hasLoadMore: boolean;
    hasSearchBox: boolean;
  };
}

export interface InteractiveElement {
  type: 'button' | 'link' | 'input' | 'select';
  selector: string;
  text: string;
  role?: string;
}
```

#### 1.2 Create Page Observer
**File**: `src/agents/pageObserver.ts`

```typescript
import type { Page } from '@cloudflare/puppeteer';
import type { PageState } from './types';

export class PageObserver {
  async capture(page: Page): Promise<PageState> {
    const url = page.url();
    const title = await page.title();
    
    // Get simplified content for LLM
    const content = await page.evaluate(() => {
      const main = document.querySelector('main, article, [role="main"]');
      const target = main || document.body;
      
      // Remove scripts, styles, nav, footer
      const clone = target.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, nav, footer, aside').forEach(el => el.remove());
      
      return clone.textContent?.trim().substring(0, 2000) || '';
    });
    
    // Detect interactive elements
    const interactiveElements = await page.evaluate(() => {
      const elements: any[] = [];
      
      // Find buttons
      document.querySelectorAll('button, [role="button"]').forEach((el, i) => {
        if (i < 10) { // Limit to first 10
          elements.push({
            type: 'button',
            selector: `button:nth-of-type(${i + 1})`,
            text: el.textContent?.trim() || '',
            role: el.getAttribute('role') || 'button'
          });
        }
      });
      
      // Find important links (Next, Previous, Load More, etc.)
      document.querySelectorAll('a').forEach((el) => {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (text.includes('next') || text.includes('more') || text.includes('previous')) {
          elements.push({
            type: 'link',
            selector: `a:has-text("${el.textContent?.trim()}")`,
            text: el.textContent?.trim() || '',
            role: 'link'
          });
        }
      });
      
      // Find inputs
      document.querySelectorAll('input[type="text"], input[type="search"]').forEach((el, i) => {
        if (i < 5) {
          elements.push({
            type: 'input',
            selector: `input:nth-of-type(${i + 1})`,
            text: el.getAttribute('placeholder') || el.getAttribute('name') || '',
            role: 'input'
          });
        }
      });
      
      return elements;
    });
    
    // Detect hints
    const hints = {
      hasNextButton: interactiveElements.some(el => 
        el.text.toLowerCase().includes('next')
      ),
      hasPrevButton: interactiveElements.some(el => 
        el.text.toLowerCase().includes('prev')
      ),
      hasLoadMore: interactiveElements.some(el => 
        el.text.toLowerCase().includes('load more') || el.text.toLowerCase().includes('show more')
      ),
      hasSearchBox: interactiveElements.some(el => el.type === 'input')
    };
    
    return {
      url,
      title,
      content,
      interactiveElements,
      hints
    };
  }
}
```

#### 1.3 Create Action Executor
**File**: `src/agents/actionExecutor.ts`

```typescript
import type { Page } from '@cloudflare/puppeteer';
import type { Action } from './types';
import { extractContent } from '../utils/contentExtractor';

export class ActionExecutor {
  async execute(page: Page, action: Action, env: any): Promise<any> {
    console.log(`Executing action: ${action.type}`, action);
    
    try {
      switch (action.type) {
        case 'goto':
          await page.goto(action.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
          });
          return { success: true };
          
        case 'click':
          await page.locator(action.selector).first().click({ timeout: 10000 });
          await page.waitForLoadState('domcontentloaded');
          return { success: true };
          
        case 'type':
          await page.locator(action.selector).first().fill(action.text, { timeout: 10000 });
          return { success: true };
          
        case 'wait':
          await page.locator(action.selector).waitFor({ 
            state: action.state || 'visible',
            timeout: 15000 
          });
          return { success: true };
          
        case 'extract':
          // Use existing extraction utilities
          const content = await extractContent(
            { newPage: async () => page } as any, // Mock browser
            page.url(),
            {
              formats: ['markdown'],
              onlyMainContent: true,
              timeout: 30000
            }
          );
          
          // Extract structured data using LLM
          let extracted;
          if (action.schema) {
            const { extractStructuredData } = await import('../utils/ai');
            const result = await extractStructuredData(
              content.markdown || '',
              { schema: action.schema, prompt: action.prompt },
              env
            );
            extracted = result.success ? result.data : null;
          } else if (action.prompt) {
            const { extractWithPrompt } = await import('../utils/ai');
            const result = await extractWithPrompt(
              content.markdown || '',
              { prompt: action.prompt, outputFormat: 'json' },
              env
            );
            extracted = result.success ? result.data : null;
          }
          
          return { 
            success: true, 
            data: extracted,
            url: page.url()
          };
          
        case 'finish':
          return { success: true, finished: true };
          
        default:
          throw new Error(`Unknown action type: ${(action as any).type}`);
      }
    } catch (error) {
      console.error(`Action execution failed:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
```

#### 1.4 Create Agent Planner
**File**: `src/agents/flare1Planner.ts`

```typescript
import { OpenAIProvider } from '../utils/llm/openaiProvider';
import { getLLMConfig } from '../utils/llm/llmConfig';
import type { PageState, PlannedAction, PlannerInput } from './types';

export class Flare1Planner {
  private llm: OpenAIProvider;
  
  constructor(env: any) {
    const config = getLLMConfig(env);
    this.llm = new OpenAIProvider(config);
  }
  
  async plan(input: PlannerInput): Promise<PlannedAction> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);
    
    const response = await this.llm.extractWithPrompt(
      userPrompt,
      'Plan the next action as JSON'
    );
    
    // Parse and validate action
    return this.parseAction(response);
  }
  
  private buildSystemPrompt(): string {
    return `You are FLARE-1, an AI agent that controls a web browser to extract data.

Your capabilities:
- Navigate to URLs (goto)
- Click buttons and links (click)
- Type into input fields (type)
- Wait for elements to appear (wait)
- Extract structured data (extract)
- Finish when goal is achieved (finish)

Rules:
1. Plan ONE action at a time
2. Be cautious and deliberate
3. Verify elements exist before clicking
4. Extract data only when you have all needed information
5. Finish as soon as the goal is satisfied
6. Stay within budget constraints

Return your action as JSON in this format:
{
  "type": "goto|click|type|wait|extract|finish",
  "selector": "CSS selector (for click/type/wait)",
  "url": "URL (for goto)",
  "text": "text to type (for type)",
  "state": "visible|hidden (for wait)",
  "schema": {...} (for extract),
  "prompt": "extraction prompt (for extract)",
  "reasoning": "why you chose this action"
}`;
  }
  
  private buildUserPrompt(input: PlannerInput): string {
    return `Goal: ${input.goal}

Current Page State:
- URL: ${input.observation.url}
- Title: ${input.observation.title}
- Content Preview: ${input.observation.content.substring(0, 500)}...

Interactive Elements Available:
${input.observation.interactiveElements.map(el => 
  `- ${el.type}: "${el.text}" (selector: ${el.selector})`
).join('\n')}

Page Hints:
- Has Next Button: ${input.observation.hints.hasNextButton}
- Has Load More: ${input.observation.hints.hasLoadMore}
- Has Search Box: ${input.observation.hints.hasSearchBox}

${input.schema ? `Target Schema:\n${JSON.stringify(input.schema, null, 2)}\n` : ''}

Budget Remaining:
- Steps: ${input.budget.steps}
- Seconds: ${input.budget.seconds}

What is the next action to achieve the goal? Return JSON only.`;
  }
  
  private parseAction(response: any): PlannedAction {
    // Validate and return action
    if (!response.type) {
      throw new Error('Invalid action: missing type');
    }
    
    return response as PlannedAction;
  }
}
```

#### 1.5 Create Result Aggregator
**File**: `src/agents/resultAggregator.ts`

```typescript
import { OpenAIProvider } from '../utils/llm/openaiProvider';
import { getLLMConfig } from '../utils/llm/llmConfig';

export class ResultAggregator {
  private llm: OpenAIProvider;
  
  constructor(env: any) {
    const config = getLLMConfig(env);
    this.llm = new OpenAIProvider(config);
  }
  
  async merge(
    results: Array<{ url: string; data: any }>,
    schema?: any
  ): Promise<any> {
    // Single result - no merging needed
    if (results.length === 0) {
      return null;
    }
    
    if (results.length === 1) {
      return results[0].data;
    }
    
    // Multiple results - intelligent merge
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
    
    const merged = await this.llm.extractWithPrompt(
      JSON.stringify(results),
      prompt
    );
    
    return merged;
  }
}
```

### Phase 2: Agent Controller (Week 2)

#### 2.1 Create Main Agent Controller
**File**: `src/agents/flare1Controller.ts`

```typescript
import type { Page, Browser } from '@cloudflare/puppeteer';
import { Flare1Planner } from './flare1Planner';
import { ActionExecutor } from './actionExecutor';
import { PageObserver } from './pageObserver';
import { ResultAggregator } from './resultAggregator';
import type { AgentConfig, AgentResult } from './types';

export class Flare1Controller {
  private planner: Flare1Planner;
  private executor: ActionExecutor;
  private observer: PageObserver;
  private aggregator: ResultAggregator;
  
  constructor(private env: any) {
    this.planner = new Flare1Planner(env);
    this.executor = new ActionExecutor();
    this.observer = new PageObserver();
    this.aggregator = new ResultAggregator(env);
  }
  
  async run(browser: Browser, config: AgentConfig): Promise<AgentResult> {
    const page = await browser.newPage();
    const startTime = Date.now();
    const maxSteps = config.maxSteps || 50;
    const maxSeconds = config.maxSeconds || 300;
    const extractedData: Array<{ url: string; data: any }> = [];
    
    let steps = 0;
    
    try {
      // Navigate to start URL
      await page.goto(config.startUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Agent loop
      while (steps < maxSteps) {
        // Check time budget
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= maxSeconds) {
          console.log('Time budget exceeded');
          break;
        }
        
        // 1. Observe current state
        const observation = await this.observer.capture(page);
        
        // 2. Plan next action
        const action = await this.planner.plan({
          goal: config.goal,
          observation,
          schema: config.schema,
          prompt: config.prompt,
          budget: {
            steps: maxSteps - steps,
            seconds: Math.floor(maxSeconds - elapsed)
          }
        });
        
        console.log(`Step ${steps + 1}: ${action.type}`, action.reasoning);
        
        // 3. Execute action
        const result = await this.executor.execute(page, action, this.env);
        
        if (!result.success) {
          console.warn(`Action failed: ${result.error}`);
          // Continue anyway - agent might recover
        }
        
        // 4. Collect extracted data
        if (action.type === 'extract' && result.data) {
          extractedData.push({
            url: result.url || page.url(),
            data: result.data
          });
        }
        
        // 5. Check if done
        if (action.type === 'finish') {
          console.log(`Agent finished: ${action.reasoning}`);
          break;
        }
        
        steps++;
        
        // Small delay between actions
        await page.waitForTimeout(500);
      }
      
      // 6. Aggregate results
      const aggregated = await this.aggregator.merge(extractedData, config.schema);
      
      return {
        success: true,
        data: aggregated,
        metadata: {
          steps,
          duration: Date.now() - startTime,
          pagesProcessed: extractedData.length
        }
      };
      
    } catch (error) {
      return {
        success: false,
        data: null,
        metadata: {
          steps,
          duration: Date.now() - startTime,
          pagesProcessed: extractedData.length
        },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      await page.close();
    }
  }
}
```

### Phase 3: Integration with Endpoints (Week 3)

#### 3.1 Update Type Definitions
**File**: `src/types/schemas.ts`

Add agent parameter to existing schemas:

```typescript
// Add to ScrapeRequestSchema
agent: z.object({
  model: z.string().optional(),
  prompt: z.string().optional()
}).optional()

// Add to ExtractRequestSchema  
agent: z.object({
  model: z.string().optional(),
  prompt: z.string().optional()
}).optional()
```

#### 3.2 Update webScrape Endpoint
**File**: `src/endpoints/webScrape.ts`

```typescript
import { Flare1Controller } from '../agents/flare1Controller';

export class WebScrape extends OpenAPIRoute {
  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { url, formats, agent, ...options } = data.body;
    
    const browser = await getBrowser(c.env);
    
    try {
      // Check if agent mode is requested
      if (agent && agent.model === 'FLARE-1') {
        // Use FLARE-1 agent
        const controller = new Flare1Controller(c.env);
        
        const result = await controller.run(browser, {
          goal: agent.prompt || 'Scrape the page content',
          startUrl: url,
          schema: formats.find(f => f.type === 'json')?.schema,
          maxSteps: 50,
          maxSeconds: 300
        });
        
        await closeBrowser(browser);
        
        if (!result.success) {
          return Response.json({
            success: false,
            error: result.error
          }, { status: 500 });
        }
        
        return {
          success: true,
          data: result.data,
          metadata: result.metadata
        };
      }
      
      // Regular scraping (existing code)
      const content = await extractContent(browser, url, options);
      await closeBrowser(browser);
      
      return {
        success: true,
        data: content
      };
      
    } catch (error) {
      await closeBrowser(browser);
      throw error;
    }
  }
}
```

#### 3.3 Update webExtract Endpoint
**File**: `src/endpoints/webExtract.ts`

```typescript
import { Flare1Controller } from '../agents/flare1Controller';

export class WebExtract extends OpenAPIRoute {
  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { urls, prompt, schema, agent, scrapeOptions } = data.body;
    
    // Check if agent mode is requested
    if (agent && agent.model === 'FLARE-1') {
      // Use FLARE-1 agent for each URL
      const browser = await getBrowser(c.env);
      const controller = new Flare1Controller(c.env);
      
      try {
        const results = [];
        
        for (const url of urls) {
          const result = await controller.run(browser, {
            goal: agent.prompt || prompt || 'Extract data from the page',
            startUrl: url,
            schema,
            prompt,
            maxSteps: 50,
            maxSeconds: 300
          });
          
          if (result.success) {
            results.push(result.data);
          }
        }
        
        await closeBrowser(browser);
        
        // Aggregate all results
        const aggregator = new ResultAggregator(c.env);
        const aggregated = await aggregator.merge(
          results.map((data, i) => ({ url: urls[i], data })),
          schema
        );
        
        return {
          success: true,
          data: aggregated
        };
        
      } catch (error) {
        await closeBrowser(browser);
        throw error;
      }
    }
    
    // Regular extraction (existing Durable Object code)
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
    
    return {
      success: true,
      id: jobId,
      url: `${new URL(c.req.url).origin}/v2/extract/${jobId}`,
    };
  }
}
```

### Phase 4: Optional Enhancements (Week 4)

#### 4.1 Add Queues for Parallel Processing

**Only if you want to process multiple agent runs in parallel**

```toml
# wrangler.toml
[[queues.producers]]
queue = "AGENT_JOBS"
binding = "AGENT_QUEUE"

[[queues.consumers]]
queue = "AGENT_JOBS"
max_batch_size = 5  # Run 5 agents in parallel
max_concurrency = 5
```

```typescript
// src/index.ts
export default {
  fetch: app.fetch,
  
  async queue(batch: MessageBatch, env: Env) {
    for (const msg of batch.messages) {
      const { url, goal, schema, jobId } = msg.body;
      
      const browser = await getBrowser(env);
      const controller = new Flare1Controller(env);
      
      const result = await controller.run(browser, {
        goal,
        startUrl: url,
        schema
      });
      
      await closeBrowser(browser);
      
      // Store result in D1
      await env.DB.prepare(
        `INSERT INTO results (job_id, url, json, created_at) VALUES (?, ?, ?, ?)`
      ).bind(jobId, url, JSON.stringify(result.data), Date.now()).run();
      
      msg.ack();
    }
  }
};
```

#### 4.2 Add Caching Layer

**File**: `src/utils/cache/agentCache.ts`

```typescript
export class AgentCache {
  constructor(private kv: KVNamespace) {}
  
  async get(url: string, goal: string, schema?: any): Promise<any | null> {
    const key = this.generateKey(url, goal, schema);
    return await this.kv.get(key, 'json');
  }
  
  async set(url: string, goal: string, data: any, schema?: any, ttl: number = 3600) {
    const key = this.generateKey(url, goal, schema);
    await this.kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  }
  
  private generateKey(url: string, goal: string, schema?: any): string {
    const schemaHash = schema ? this.hash(JSON.stringify(schema)) : '';
    const goalHash = this.hash(goal);
    return `flare1:${url}:${goalHash}:${schemaHash}`;
  }
  
  private hash(str: string): string {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
```

## Implementation Timeline

### Week 1: Core Agent Components
- [x] Research complete
- [ ] Create agent types (`src/agents/types.ts`)
- [ ] Implement PageObserver (`src/agents/pageObserver.ts`)
- [ ] Implement ActionExecutor (`src/agents/actionExecutor.ts`)
- [ ] Implement Flare1Planner (`src/agents/flare1Planner.ts`)
- [ ] Implement ResultAggregator (`src/agents/resultAggregator.ts`)
- [ ] Unit tests for each component

### Week 2: Agent Controller
- [ ] Implement Flare1Controller (`src/agents/flare1Controller.ts`)
- [ ] Add agent loop logic
- [ ] Add budget tracking
- [ ] Add error handling
- [ ] Integration tests

### Week 3: Endpoint Integration
- [ ] Update type schemas with agent parameter
- [ ] Integrate FLARE-1 into `/v2/scrape`
- [ ] Integrate FLARE-1 into `/v2/extract`
- [ ] Add agent mode detection
- [ ] End-to-end tests

### Week 4: Optimization & Polish
- [ ] Add caching layer (optional)
- [ ] Add Queues for parallel agents (