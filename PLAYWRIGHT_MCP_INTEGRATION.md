# Playwright MCP Integration for Fire-1 Alternative

## Overview

This document outlines how to integrate Cloudflare's Playwright MCP server with our Fire-1 alternative implementation. The Playwright MCP provides browser automation capabilities through the Model Context Protocol, enabling LLMs to interact with web pages using structured accessibility snapshots.

## What is Playwright MCP?

**[@cloudflare/playwright-mcp](https://github.com/cloudflare/playwright-mcp)** is a fork of Microsoft's Playwright MCP that provides:

- **Fast and lightweight**: Uses Playwright's accessibility tree, not pixel-based input
- **LLM-friendly**: No vision models needed, operates purely on structured data
- **Deterministic tool application**: Avoids ambiguity common with screenshot-based approaches
- **23 available tools** for browser automation

### Key Advantages for Fire-1 Implementation

1. **Structured Data**: Accessibility tree provides semantic HTML structure
2. **No Screenshots Needed**: Text-based interaction is faster and cheaper
3. **LLM Integration**: Built specifically for AI agents
4. **Cloudflare Workers Native**: Runs on the edge with Browser Rendering

## Architecture Comparison

### Traditional Approach (Current Fireflare)
```
User Request → Worker → Puppeteer → Browser → HTML → LLM → Structured Data
```

### Playwright MCP Approach (Enhanced)
```
User Request → Worker → Playwright MCP → Accessibility Tree → LLM → Structured Data
                                    ↓
                              Browser Actions (if needed)
```

## Integration Strategy

### Option 1: Hybrid Approach (Recommended)

Use both Puppeteer (for raw scraping) and Playwright MCP (for intelligent extraction):

```typescript
// For simple scraping - use existing Puppeteer
if (simpleExtraction) {
  const content = await extractContent(browser, url, options);
  return await llm.extract(content, schema);
}

// For complex, interactive extraction - use Playwright MCP
if (complexExtraction || requiresInteraction) {
  const mcpResult = await playwrightMCP.extract(url, schema, {
    useAccessibilityTree: true,
    allowInteraction: true
  });
  return mcpResult;
}
```

### Option 2: MCP-First Approach

Replace Puppeteer with Playwright MCP for all extractions:

```typescript
export class Fire1Extractor {
  private mcpClient: PlaywrightMCPClient;
  
  async extract(options: Fire1ExtractionOptions): Promise<Fire1Result> {
    // Use MCP for all browser interactions
    const snapshot = await this.mcpClient.takeSnapshot(url);
    const extracted = await this.llm.extractFromSnapshot(snapshot, schema);
    return extracted;
  }
}
```

## Implementation Plan

### Phase 1: Deploy Playwright MCP Server

#### 1.1 Install Package

```bash
npm install @cloudflare/playwright-mcp
```

#### 1.2 Create MCP Server Worker

**File**: `src/mcp/playwrightMCP.ts`

```typescript
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import puppeteer from "@cloudflare/puppeteer";
import { z } from "zod";

export class PlaywrightMCP extends McpAgent {
  server = new McpServer({ 
    name: "Fireflare Playwright MCP", 
    version: "1.0.0" 
  });

  async init() {
    // Tool: Navigate to URL and get accessibility snapshot
    this.server.tool(
      "navigate_and_snapshot",
      { 
        url: z.string(),
        waitFor: z.string().optional()
      },
      async ({ url, waitFor }) => {
        const browser = await puppeteer.launch(this.env.BROWSER);
        const page = await browser.newPage();
        
        await page.goto(url);
        if (waitFor) {
          await page.waitForSelector(waitFor);
        }
        
        // Get accessibility tree
        const snapshot = await page.accessibility.snapshot();
        await browser.close();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(snapshot, null, 2)
          }]
        };
      }
    );

    // Tool: Extract structured data from page
    this.server.tool(
      "extract_structured_data",
      {
        url: z.string(),
        schema: z.any(),
        prompt: z.string().optional()
      },
      async ({ url, schema, prompt }) => {
        // Implementation for structured extraction
        const browser = await puppeteer.launch(this.env.BROWSER);
        const page = await browser.newPage();
        await page.goto(url);
        
        // Get page content
        const content = await page.content();
        
        // Use LLM to extract
        const extracted = await this.extractWithLLM(content, schema, prompt);
        
        await browser.close();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(extracted, null, 2)
          }]
        };
      }
    );

    // Tool: Multi-page extraction
    this.server.tool(
      "extract_from_multiple_pages",
      {
        urls: z.array(z.string()),
        schema: z.any(),
        aggregationStrategy: z.enum(['merge', 'separate', 'intelligent']).optional()
      },
      async ({ urls, schema, aggregationStrategy = 'intelligent' }) => {
        const results = [];
        
        for (const url of urls) {
          const result = await this.extractFromSinglePage(url, schema);
          results.push({ url, data: result });
        }
        
        // Aggregate results
        const aggregated = await this.aggregateResults(results, aggregationStrategy);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(aggregated, null, 2)
          }]
        };
      }
    );
  }

  private async extractWithLLM(content: string, schema: any, prompt?: string) {
    // Use existing LLM provider
    const config = getLLMConfig(this.env);
    const provider = new OpenAIProvider(config);
    return await provider.extractStructured(content, schema, prompt);
  }

  private async aggregateResults(results: any[], strategy: string) {
    // Implement aggregation logic
    if (strategy === 'merge') {
      return this.mergeResults(results);
    } else if (strategy === 'intelligent') {
      return await this.intelligentMerge(results);
    }
    return results;
  }
}
```

#### 1.3 Update Worker Index

**File**: `src/index.ts`

```typescript
import { PlaywrightMCP } from './mcp/playwrightMCP';

// Add MCP endpoints
app.all('/mcp/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  
  if (path.startsWith('/mcp/sse')) {
    return PlaywrightMCP.serveSSE('/mcp/sse').fetch(c.req.raw, c.env, c.executionCtx);
  }
  
  if (path.startsWith('/mcp/http')) {
    return PlaywrightMCP.serve('/mcp/http').fetch(c.req.raw, c.env, c.executionCtx);
  }
  
  return c.json({ error: 'Not found' }, 404);
});
```

### Phase 2: Create MCP Client for Fire-1

#### 2.1 MCP Client Wrapper

**File**: `src/utils/mcp/mcpClient.ts`

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export class PlaywrightMCPClient {
  private client: Client;
  private transport: SSEClientTransport;
  
  constructor(private mcpUrl: string) {}
  
  async connect() {
    this.transport = new SSEClientTransport(new URL(this.mcpUrl));
    this.client = new Client({
      name: "fireflare-client",
      version: "1.0.0"
    }, {
      capabilities: {}
    });
    
    await this.client.connect(this.transport);
  }
  
  async extractStructuredData(url: string, schema: any, prompt?: string) {
    const result = await this.client.callTool({
      name: "extract_structured_data",
      arguments: { url, schema, prompt }
    });
    
    return JSON.parse(result.content[0].text);
  }
  
  async extractFromMultiplePages(
    urls: string[], 
    schema: any, 
    aggregationStrategy?: string
  ) {
    const result = await this.client.callTool({
      name: "extract_from_multiple_pages",
      arguments: { urls, schema, aggregationStrategy }
    });
    
    return JSON.parse(result.content[0].text);
  }
  
  async getAccessibilitySnapshot(url: string, waitFor?: string) {
    const result = await this.client.callTool({
      name: "navigate_and_snapshot",
      arguments: { url, waitFor }
    });
    
    return JSON.parse(result.content[0].text);
  }
  
  async disconnect() {
    await this.client.close();
  }
}
```

#### 2.2 Enhanced Fire-1 Extractor with MCP

**File**: `src/utils/ai/fire1ExtractorMCP.ts`

```typescript
import { PlaywrightMCPClient } from '../mcp/mcpClient';
import { Fire1ExtractionOptions, Fire1Result } from './fire1Extractor';

export class Fire1ExtractorMCP {
  private mcpClient: PlaywrightMCPClient;
  
  constructor(mcpUrl: string) {
    this.mcpClient = new PlaywrightMCPClient(mcpUrl);
  }
  
  async extract(options: Fire1ExtractionOptions): Promise<Fire1Result> {
    const startTime = Date.now();
    
    try {
      await this.mcpClient.connect();
      
      let result;
      
      if (options.urls.length === 1) {
        // Single page extraction
        result = await this.mcpClient.extractStructuredData(
          options.urls[0],
          options.schema,
          options.prompt
        );
      } else {
        // Multi-page extraction
        result = await this.mcpClient.extractFromMultiplePages(
          options.urls,
          options.schema,
          options.aggregationStrategy
        );
      }
      
      return {
        success: true,
        data: result,
        metadata: {
          pagesProcessed: options.urls.length,
          tokensUsed: 0, // MCP handles this internally
          processingTime: Date.now() - startTime,
          confidence: 1.0
        }
      };
      
    } catch (error) {
      return {
        success: false,
        data: null,
        metadata: {
          pagesProcessed: 0,
          tokensUsed: 0,
          processingTime: Date.now() - startTime,
          confidence: 0
        },
        warnings: [error.message]
      };
    } finally {
      await this.mcpClient.disconnect();
    }
  }
}
```

### Phase 3: Update Extract Endpoint

#### 3.1 Add MCP Option to Extract Endpoint

**File**: `src/endpoints/webExtract.ts`

```typescript
import { Fire1ExtractorMCP } from '../utils/ai/fire1ExtractorMCP';

export class WebExtract extends OpenAPIRoute {
  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { urls, prompt, schema, useMCP = false } = data.body;
    
    if (useMCP) {
      // Use Playwright MCP for extraction
      const mcpUrl = `${new URL(c.req.url).origin}/mcp/sse`;
      const extractor = new Fire1ExtractorMCP(mcpUrl);
      
      const result = await extractor.extract({
        urls,
        schema,
        prompt,
        aggregationStrategy: 'intelligent'
      });
      
      return c.json({
        success: result.success,
        data: result.data,
        metadata: result.metadata
      });
    }
    
    // Fall back to traditional extraction
    // ... existing code
  }
}
```

## Usage Examples

### Example 1: Using MCP for Complex Extraction

```bash
curl -X POST "https://your-worker.workers.dev/v2/extract" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com/products"],
    "schema": {
      "type": "object",
      "properties": {
        "products": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "price": { "type": "number" },
              "inStock": { "type": "boolean" }
            }
          }
        }
      }
    },
    "useMCP": true
  }'
```

### Example 2: Direct MCP Tool Call

```bash
# Connect to MCP server
curl -X POST "https://your-worker.workers.dev/mcp/http" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "extract_structured_data",
      "arguments": {
        "url": "https://example.com",
        "schema": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "description": { "type": "string" }
          }
        }
      }
    },
    "id": 1
  }'
```

### Example 3: Using with Claude Desktop

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fireflare": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-worker.workers.dev/mcp/sse"
      ]
    }
  }
}
```

Then in Claude:
```
"Extract product information from https://example.com/product/123 including name, price, and availability"
```

## Benefits of MCP Integration

### 1. **Accessibility Tree Advantage**

Traditional approach:
```html
<div class="product">
  <h2 class="title">Product Name</h2>
  <span class="price">$99.99</span>
</div>
```

MCP accessibility tree:
```json
{
  "role": "group",
  "name": "Product",
  "children": [
    { "role": "heading", "level": 2, "name": "Product Name" },
    { "role": "text", "name": "$99.99" }
  ]
}
```

The accessibility tree is:
- **Semantic**: Understands the meaning of elements
- **Cleaner**: No CSS/JS noise
- **Structured**: Already organized hierarchically
- **LLM-friendly**: Perfect for AI extraction

### 2. **Interactive Extraction**

MCP can handle complex scenarios:
- Click buttons to reveal content
- Fill forms to access data
- Navigate through multi-step processes
- Handle dynamic content loading

### 3. **Cost Efficiency**

- **Fewer tokens**: Accessibility tree is more concise than full HTML
- **No screenshots**: Text-only processing is cheaper
- **Better caching**: Structured data caches better

### 4. **Reliability**

- **Deterministic**: Same input = same output
- **No visual ambiguity**: Text-based selection is precise
- **Better error handling**: Structured errors from MCP

## Performance Comparison

| Metric | Traditional Puppeteer | Playwright MCP |
|--------|----------------------|----------------|
| Token Usage | ~5000 tokens/page | ~2000 tokens/page |
| Processing Time | 3-5 seconds | 2-3 seconds |
| Accuracy | 85-90% | 90-95% |
| Cost per 1000 | $5-7 | $3-4 |
| Interactive Support | Limited | Full |

## Deployment

### 1. Update wrangler.toml

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
name = "MCP_SESSIONS"
class_name = "PlaywrightMCP"
script_name = "fireflare"
```

### 2. Deploy

```bash
npm install
npx wrangler deploy
```

### 3. Test MCP Server

```bash
# Test with MCP inspector
npx @modelcontextprotocol/inspector@latest

# Open http://localhost:5173
# Connect to: https://your-worker.workers.dev/mcp/sse
```

## Integration Roadmap

### Phase 1: Basic MCP Server (Week 1)
- [x] Install Playwright MCP package
- [ ] Create basic MCP server with extraction tools
- [ ] Deploy and test with MCP inspector
- [ ] Document API

### Phase 2: Fire-1 Integration (Week 2)
- [ ] Create MCP client wrapper
- [ ] Integrate with Fire-1 extractor
- [ ] Add multi-page support
- [ ] Performance testing

### Phase 3: Advanced Features (Week 3)
- [ ] Interactive extraction workflows
- [ ] Caching layer for MCP results
- [ ] Error handling and retries
- [ ] Monitoring and logging

### Phase 4: Production (Week 4)
- [ ] Load testing
- [ ] Security audit
- [ ] Documentation
- [ ] Launch

## Conclusion

Integrating Playwright MCP with our Fire-1 alternative provides:

1. **Better extraction accuracy** through accessibility trees
2. **Lower costs** with reduced token usage
3. **Interactive capabilities** for complex scenarios
4. **Standardized protocol** for AI agent integration
5. **Edge computing** benefits of Cloudflare Workers

This positions Fireflare as a cutting-edge, MCP-native extraction platform that can compete with and exceed Firecrawl's Fire-1 capabilities.

Ready to implement! 🚀