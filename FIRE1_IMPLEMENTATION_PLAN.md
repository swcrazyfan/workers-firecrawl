# Fire-1 Alternative Implementation Plan for Fireflare

## Executive Summary

This document outlines the implementation of a Fire-1 alternative for the Fireflare Cloudflare Worker. Fire-1 is Firecrawl's AI-powered extraction model that intelligently extracts structured data from web pages. Our implementation will leverage:

1. **Cloudflare Browser Rendering** - Using Puppeteer for real browser automation
2. **LLM Integration** - OpenRouter/OpenAI for AI-powered extraction
3. **Intelligent Content Processing** - Multi-page aggregation and context-aware extraction
4. **Edge Computing** - Cloudflare Workers for global performance

## Understanding Fire-1

### What Fire-1 Does

Fire-1 is Firecrawl's proprietary model that:
- Extracts structured data from web pages using AI
- Understands context across multiple pages
- Handles complex schemas with nested objects
- Provides high accuracy through prompt engineering
- Supports both schema-based and prompt-based extraction

### Key Features to Replicate

1. **Schema-Based Extraction**: Define JSON schemas for structured output
2. **Prompt-Based Extraction**: Use natural language to describe what to extract
3. **Multi-URL Support**: Extract from multiple pages and aggregate results
4. **Wildcard URL Patterns**: Support patterns like `example.com/*`
5. **Context Awareness**: Understand relationships between extracted data
6. **High Accuracy**: Use optimized prompts and validation

## Current Fireflare Architecture

### Existing Components

```
src/
├── endpoints/
│   ├── webExtract.ts          # Extract endpoint (basic)
│   ├── webExtractStatus.ts    # Status checking
│   ├── webScrape.ts           # Single page scraping
│   └── webSearch.ts           # Search functionality
├── utils/
│   ├── ai/
│   │   ├── structuredExtractor.ts  # Schema-based extraction
│   │   ├── promptExtractor.ts      # Prompt-based extraction
│   │   └── summarizer.ts           # Content summarization
│   ├── llm/
│   │   ├── llmProvider.ts          # LLM interface
│   │   ├── openaiProvider.ts       # OpenAI implementation
│   │   └── llmConfig.ts            # Configuration
│   ├── browser.ts              # Puppeteer wrapper
│   └── contentExtractor.ts     # Content extraction
└── durableObjects/
    └── crawlJob.ts             # Job management
```

### What We Have

✅ Browser rendering with Puppeteer
✅ LLM integration (OpenRouter/OpenAI)
✅ Schema-based extraction
✅ Prompt-based extraction
✅ Durable Objects for job management
✅ Multi-page crawling capability

### What We Need to Add

❌ Enhanced multi-page context aggregation
❌ Intelligent content chunking for large pages
❌ Advanced prompt engineering for Fire-1-like accuracy
❌ Result validation and refinement
❌ Caching layer for repeated extractions
❌ Performance optimizations

## Implementation Strategy

### Phase 1: Enhanced Extraction Engine

#### 1.1 Create Fire-1 Style Extractor

**File**: `src/utils/ai/fire1Extractor.ts`

Key features:
- Intelligent content preprocessing
- Context-aware prompt generation
- Multi-pass extraction for accuracy
- Result validation and refinement
- Support for complex nested schemas

```typescript
interface Fire1ExtractionOptions {
  schema?: any;
  prompt?: string;
  urls: string[];
  aggregationStrategy?: 'merge' | 'separate' | 'intelligent';
  maxTokensPerPage?: number;
  enableValidation?: boolean;
  retryOnFailure?: boolean;
}

interface Fire1Result {
  success: boolean;
  data: any;
  metadata: {
    pagesProcessed: number;
    tokensUsed: number;
    processingTime: number;
    confidence: number;
  };
  warnings?: string[];
}
```

#### 1.2 Intelligent Content Chunking

**File**: `src/utils/ai/contentChunker.ts`

For large pages that exceed token limits:
- Smart chunking based on semantic boundaries
- Overlap between chunks for context
- Chunk prioritization (main content first)
- Reassembly of extracted data

#### 1.3 Advanced Prompt Engineering

**File**: `src/utils/ai/promptTemplates.ts`

Fire-1-style prompts:
- System prompts optimized for extraction accuracy
- Few-shot examples for complex schemas
- Chain-of-thought reasoning for nested data
- Validation instructions

### Phase 2: Multi-Page Intelligence

#### 2.1 Context Aggregation

**File**: `src/utils/ai/contextAggregator.ts`

Features:
- Merge data from multiple pages intelligently
- Detect and resolve conflicts
- Maintain relationships between entities
- Handle partial data gracefully

#### 2.2 Smart URL Expansion

Enhance wildcard URL handling:
- Intelligent sitemap parsing
- Relevance scoring for pages
- Parallel processing with rate limiting
- Deduplication

### Phase 3: Performance & Reliability

#### 3.1 Caching Layer

**File**: `src/utils/cache/extractionCache.ts`

Using Cloudflare KV:
- Cache extracted data by URL + schema hash
- TTL-based expiration
- Cache warming for common patterns
- Invalidation strategies

#### 3.2 Result Validation

**File**: `src/utils/ai/resultValidator.ts`

Features:
- Schema compliance checking
- Data type validation
- Completeness scoring
- Automatic retry on low confidence

#### 3.3 Error Handling & Fallbacks

- Graceful degradation
- Partial result returns
- Detailed error reporting
- Automatic retry with backoff

### Phase 4: API Enhancement

#### 4.1 Enhanced Extract Endpoint

Update `/v2/extract` to support:
- Fire-1 style extraction options
- Streaming results for long jobs
- Webhook notifications
- Priority queuing

#### 4.2 New Endpoints

**`/v2/extract/fire1`** - Fire-1 optimized extraction
**`/v2/extract/batch`** - Batch processing
**`/v2/extract/validate`** - Schema validation

## Technical Implementation Details

### 1. Fire-1 Extractor Core

```typescript
export class Fire1Extractor {
  private llmProvider: LLMProvider;
  private browser: Browser;
  private cache: ExtractionCache;
  
  async extract(options: Fire1ExtractionOptions): Promise<Fire1Result> {
    // 1. Fetch and preprocess content from all URLs
    const contents = await this.fetchContents(options.urls);
    
    // 2. Chunk content if needed
    const chunks = await this.chunkContent(contents, options.maxTokensPerPage);
    
    // 3. Generate optimized prompts
    const prompts = this.generatePrompts(options.schema, options.prompt, chunks);
    
    // 4. Extract data with multi-pass approach
    const rawResults = await this.multiPassExtraction(prompts, chunks);
    
    // 5. Aggregate results intelligently
    const aggregated = await this.aggregateResults(rawResults, options.aggregationStrategy);
    
    // 6. Validate and refine
    const validated = await this.validateAndRefine(aggregated, options.schema);
    
    // 7. Return with metadata
    return this.formatResult(validated);
  }
}
```

### 2. Prompt Engineering Strategy

#### System Prompt Template

```typescript
const FIRE1_SYSTEM_PROMPT = `You are an expert data extraction AI specialized in extracting structured information from web content.

Your task is to:
1. Carefully analyze the provided web content
2. Extract information that matches the given schema
3. Ensure all extracted data is accurate and complete
4. Handle missing data gracefully by using null or appropriate defaults
5. Maintain relationships between related data points

Guidelines:
- Be precise and accurate
- Extract only information that is explicitly present
- Use the exact field names from the schema
- Validate data types match the schema
- For arrays, extract all relevant items
- For nested objects, maintain the structure

Return ONLY valid JSON that matches the schema exactly.`;
```

#### Schema-Specific Prompts

```typescript
function generateSchemaPrompt(schema: any, customPrompt?: string): string {
  let prompt = `Extract data according to this JSON schema:\n\n`;
  prompt += JSON.stringify(schema, null, 2);
  
  if (customPrompt) {
    prompt += `\n\nAdditional instructions: ${customPrompt}`;
  }
  
  // Add few-shot examples for complex schemas
  if (isComplexSchema(schema)) {
    prompt += `\n\nExample extraction:\n${generateExample(schema)}`;
  }
  
  return prompt;
}
```

### 3. Multi-Page Aggregation

```typescript
class ContextAggregator {
  async aggregate(
    results: Array<{ url: string; data: any }>,
    strategy: 'merge' | 'separate' | 'intelligent'
  ): Promise<any> {
    switch (strategy) {
      case 'merge':
        return this.mergeResults(results);
      
      case 'separate':
        return results.map(r => ({ url: r.url, data: r.data }));
      
      case 'intelligent':
        return this.intelligentMerge(results);
    }
  }
  
  private async intelligentMerge(results: Array<{ url: string; data: any }>): Promise<any> {
    // Use LLM to intelligently merge conflicting data
    const prompt = `Given these extracted data from multiple pages, 
    intelligently merge them into a single coherent result, 
    resolving conflicts and maintaining accuracy:
    
    ${JSON.stringify(results, null, 2)}`;
    
    return await this.llmProvider.extractWithPrompt(prompt, 'Merge the data');
  }
}
```

### 4. Caching Strategy

```typescript
class ExtractionCache {
  private kv: KVNamespace;
  
  async get(key: string): Promise<any | null> {
    const cached = await this.kv.get(key, 'json');
    if (cached && !this.isExpired(cached)) {
      return cached.data;
    }
    return null;
  }
  
  async set(key: string, data: any, ttl: number = 3600): Promise<void> {
    await this.kv.put(key, JSON.stringify({
      data,
      timestamp: Date.now(),
      ttl
    }), { expirationTtl: ttl });
  }
  
  generateKey(url: string, schema: any, prompt?: string): string {
    const schemaHash = this.hashObject(schema);
    const promptHash = prompt ? this.hashString(prompt) : '';
    return `extract:${url}:${schemaHash}:${promptHash}`;
  }
}
```

## API Usage Examples

### Example 1: Schema-Based Extraction (Fire-1 Style)

```bash
curl -X POST "https://your-worker.workers.dev/v2/extract" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com/product/123",
      "https://example.com/product/123/reviews"
    ],
    "schema": {
      "type": "object",
      "properties": {
        "product": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "price": { "type": "number" },
            "description": { "type": "string" },
            "inStock": { "type": "boolean" }
          }
        },
        "reviews": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "rating": { "type": "number" },
              "text": { "type": "string" },
              "author": { "type": "string" }
            }
          }
        }
      }
    },
    "prompt": "Extract product information and customer reviews",
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }'
```

### Example 2: Prompt-Based Extraction

```bash
curl -X POST "https://your-worker.workers.dev/v2/extract" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com/about"],
    "prompt": "Extract the company mission statement, founding year, number of employees, and list of key executives with their titles"
  }'
```

### Example 3: Wildcard URL Pattern

```bash
curl -X POST "https://your-worker.workers.dev/v2/extract" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://blog.example.com/*"],
    "schema": {
      "type": "object",
      "properties": {
        "articles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "author": { "type": "string" },
              "date": { "type": "string" },
              "summary": { "type": "string" }
            }
          }
        }
      }
    },
    "limit": 20
  }'
```

## Performance Considerations

### 1. Token Optimization

- Preprocess content to remove noise (ads, navigation, etc.)
- Use `onlyMainContent: true` for cleaner extraction
- Chunk large pages intelligently
- Cache frequently accessed pages

### 2. Parallel Processing

- Process multiple URLs concurrently (with rate limiting)
- Use Durable Objects for job coordination
- Implement worker-to-worker communication for large jobs

### 3. Cost Management

- Cache extraction results in KV
- Use cheaper models for simple extractions
- Implement request deduplication
- Set reasonable token limits

### 4. Reliability

- Implement exponential backoff for retries
- Validate results before returning
- Provide partial results on timeout
- Log failures for debugging

## Comparison: Fireflare vs Firecrawl Fire-1

| Feature | Firecrawl Fire-1 | Fireflare Implementation |
|---------|------------------|--------------------------|
| AI Model | Proprietary | OpenRouter/OpenAI (configurable) |
| Browser Rendering | ✅ | ✅ Cloudflare Puppeteer |
| Schema Extraction | ✅ | ✅ Enhanced with validation |
| Prompt Extraction | ✅ | ✅ With advanced templates |
| Multi-URL Support | ✅ | ✅ With intelligent aggregation |
| Wildcard Patterns | ✅ | ✅ With smart expansion |
| Caching | ✅ | ✅ Cloudflare KV |
| Edge Computing | ❌ | ✅ Cloudflare Workers |
| Cost | $$ | $ (pay-as-you-go) |
| Customization | Limited | Full control |

## Implementation Timeline

### Week 1: Core Fire-1 Extractor
- [ ] Create `fire1Extractor.ts`
- [ ] Implement content chunking
- [ ] Add prompt templates
- [ ] Basic validation

### Week 2: Multi-Page Intelligence
- [ ] Context aggregation
- [ ] Smart URL expansion
- [ ] Conflict resolution
- [ ] Testing

### Week 3: Performance & Caching
- [ ] KV caching layer
- [ ] Result validation
- [ ] Error handling
- [ ] Optimization

### Week 4: API & Documentation
- [ ] Enhanced endpoints
- [ ] API documentation
- [ ] Usage examples
- [ ] Performance tuning

## Testing Strategy

### Unit Tests
- Content chunking logic
- Prompt generation
- Result validation
- Cache operations

### Integration Tests
- End-to-end extraction flows
- Multi-page scenarios
- Error handling
- Performance benchmarks

### Real-World Tests
- E-commerce product extraction
- News article aggregation
- Business directory scraping
- Documentation extraction

## Monitoring & Observability

### Metrics to Track
- Extraction success rate
- Average processing time
- Token usage per request
- Cache hit rate
- Error rates by type

### Logging
- Request/response logging
- LLM API calls
- Cache operations
- Performance metrics

## Security Considerations

1. **API Key Protection**: Secure storage in Cloudflare secrets
2. **Rate Limiting**: Prevent abuse
3. **Input Validation**: Sanitize URLs and schemas
4. **Output Sanitization**: Clean extracted data
5. **Access Control**: Authorization middleware

## Cost Estimation

### Per 1000 Extractions (Estimated)

- **Browser Rendering**: $0.50 (Cloudflare pricing)
- **LLM API Calls**: $2-5 (depending on model)
- **KV Storage**: $0.10
- **Worker Compute**: $0.05
- **Total**: ~$2.65-5.65 per 1000 extractions

### Cost Optimization Tips
- Use caching aggressively
- Choose appropriate models (Grok 4 Fast is cost-effective)
- Batch similar requests
- Implement request deduplication

## Next Steps

1. Review and approve this implementation plan
2. Set up development environment
3. Begin Phase 1 implementation
4. Create test suite
5. Deploy to staging
6. Performance testing
7. Production deployment

## Conclusion

This Fire-1 alternative implementation will provide Fireflare with enterprise-grade AI-powered extraction capabilities while maintaining the flexibility and cost-effectiveness of running on Cloudflare Workers. The modular architecture allows for easy customization and future enhancements.

The key advantages over Firecrawl's Fire-1:
- **Full control** over the extraction pipeline
- **Edge computing** for global performance
- **Cost-effective** pay-as-you-go pricing
- **Customizable** LLM providers and models
- **Open source** and transparent

Ready to implement! 🚀