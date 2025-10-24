# Fire-1 Features: What We Need to Recreate

Based on research from Firecrawl's documentation and examples, here's a comprehensive breakdown of Fire-1's features and our implementation status.

## Core Fire-1 Features

### ✅ 1. Schema-Based Extraction
**What Fire-1 Does:**
- Accepts JSON Schema to define expected output structure
- Extracts data matching the schema from web pages
- Validates output against schema
- Handles nested objects and arrays

**Example from Firecrawl:**
```python
from pydantic import BaseModel, Field

class Article(BaseModel):
    title: str
    points: int
    by: str
    commentsURL: str

class TopArticles(BaseModel):
    top: List[Article] = Field(..., max_length=5)

# Fire-1 extracts data matching this schema
data = app.scrape_url(
    "https://news.ycombinator.com",
    formats=[{"type": "json", "schema": TopArticles}]
)
```

**Our Status:** ✅ **HAVE IT**
- Location: `src/utils/ai/structuredExtractor.ts`
- Uses: OpenAI/OpenRouter with JSON schema
- Quality: Good, needs optimization

**What We Need to Add:**
- [ ] Pydantic-style model support (convert to JSON schema)
- [ ] Better schema validation
- [ ] Nested schema handling improvements
- [ ] Array extraction optimization

---

### ✅ 2. Prompt-Based Extraction
**What Fire-1 Does:**
- Accepts natural language prompts
- Extracts data based on prompt instructions
- Returns structured JSON without explicit schema

**Example from Firecrawl:**
```python
data = app.scrape_url(
    url,
    params={
        'formats': ['markdown', 'extract'],
        'extract': {
            'prompt': "Find any mentions of specific dollar amounts or financial figures and return them with their context and article link."
        }
    }
)
```

**Our Status:** ✅ **HAVE IT**
- Location: `src/utils/ai/promptExtractor.ts`
- Uses: LLM with natural language prompts
- Quality: Good

**What We Need to Add:**
- [ ] Pre-built prompt templates (like CommonPrompts)
- [ ] Prompt optimization for accuracy
- [ ] Few-shot examples for complex extractions

---

### ❌ 3. System Prompts for Context
**What Fire-1 Does:**
- Allows custom system prompts to guide extraction
- Provides context about the extraction task
- Improves accuracy for domain-specific extractions

**Example from Firecrawl:**
```python
data = app.scrape_url(
    url,
    params={
        'formats': ['markdown', 'extract'],
        'extract': {
            'prompt': "Find financial figures",
            'systemPrompt': "You are a helpful assistant that extracts numerical financial data."
        }
    }
)
```

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] System prompt parameter in extraction options
- [ ] Pre-built system prompts for common domains
- [ ] System prompt + user prompt combination logic

---

### ✅ 4. Multi-URL Extraction
**What Fire-1 Does:**
- Extracts from multiple URLs in one request
- Supports wildcard patterns (e.g., `example.com/*`)
- Aggregates results intelligently

**Example from Firecrawl:**
```python
data = app.extract(
    urls=[
        "https://firecrawl.dev/*",
        "https://docs.firecrawl.dev/",
        "https://www.ycombinator.com/companies/firecrawl"
    ],
    prompt="Extract company mission, is_open_source, is_in_yc",
    schema={...}
)
```

**Our Status:** ✅ **HAVE IT**
- Location: `src/endpoints/webExtract.ts` + `src/durableObjects/crawlJob.ts`
- Uses: Durable Objects for job management
- Quality: Good, needs aggregation improvements

**What We Need to Add:**
- [ ] Better wildcard URL expansion
- [ ] Intelligent result aggregation (merge conflicts)
- [ ] Parallel processing optimization
- [ ] Progress tracking for large batches

---

### ❌ 5. Intelligent Result Aggregation
**What Fire-1 Does:**
- Merges data from multiple pages intelligently
- Resolves conflicts (e.g., different prices on different pages)
- Maintains relationships between entities
- Deduplicates information

**Example Scenario:**
```
Page 1: { "price": "$99", "inStock": true }
Page 2: { "price": "$89", "inStock": true, "discount": "10%" }

Fire-1 Output: { 
  "price": "$89",  // Takes most recent/complete
  "inStock": true,
  "discount": "10%"
}
```

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Conflict resolution strategies
- [ ] Entity relationship tracking
- [ ] Deduplication logic
- [ ] Confidence scoring for merged data
- [ ] LLM-powered intelligent merging

---

### ❌ 6. Few-Shot Learning
**What Fire-1 Does:**
- Provides examples to guide extraction
- Improves accuracy for complex schemas
- Handles edge cases better

**Example from Firecrawl:**
```python
# Fire-1 internally uses few-shot examples like:
"""
Example extraction:
Input: "Product: iPhone 15, Price: $999"
Output: {"name": "iPhone 15", "price": 999}

Now extract from: [actual content]
"""
```

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Few-shot example generation
- [ ] Example selection based on schema complexity
- [ ] Example storage and reuse
- [ ] Dynamic example injection in prompts

---

### ✅ 7. Content Preprocessing
**What Fire-1 Does:**
- Cleans HTML before extraction
- Removes ads, navigation, footers
- Focuses on main content
- Handles dynamic content

**Our Status:** ✅ **HAVE IT**
- Location: `src/utils/contentExtractor.ts`
- Features: `onlyMainContent`, `excludeTags`, `includeTags`
- Quality: Good

**What We Need to Add:**
- [ ] Better ad detection
- [ ] Smarter main content identification
- [ ] Dynamic content handling improvements

---

### ❌ 8. Extraction Confidence Scoring
**What Fire-1 Does:**
- Provides confidence score for each extraction
- Indicates data quality
- Helps identify unreliable extractions

**Example Output:**
```json
{
  "data": {...},
  "confidence": 0.95,
  "warnings": ["Some fields had low confidence"]
}
```

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Confidence calculation algorithm
- [ ] Per-field confidence scores
- [ ] Warning generation for low confidence
- [ ] Automatic retry on low confidence

---

### ❌ 9. Extraction Validation & Refinement
**What Fire-1 Does:**
- Validates extracted data against schema
- Attempts to fix invalid data
- Re-extracts if validation fails
- Provides detailed error messages

**Our Status:** ⚠️ **PARTIAL**
- Have: Basic schema validation in `structuredExtractor.ts`
- Missing: Automatic refinement, retry logic

**What We Need to Add:**
- [ ] Automatic data type correction
- [ ] Missing field detection and re-extraction
- [ ] Multi-pass extraction for accuracy
- [ ] Detailed validation error messages

---

### ❌ 10. Context-Aware Extraction
**What Fire-1 Does:**
- Understands relationships between data points
- Maintains context across multiple pages
- Links related information
- Handles references and cross-references

**Example:**
```
Page 1: "CEO: John Doe"
Page 2: "John leads the company with 20 years experience"

Fire-1 understands "John" refers to "John Doe" from Page 1
```

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Entity resolution across pages
- [ ] Reference tracking
- [ ] Context window management
- [ ] Cross-page relationship mapping

---

### ❌ 11. Incremental Extraction
**What Fire-1 Does:**
- Extracts data in chunks for large pages
- Maintains context between chunks
- Reassembles final result
- Handles token limits gracefully

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Content chunking strategy
- [ ] Chunk overlap for context
- [ ] Result reassembly logic
- [ ] Token limit detection and handling

---

### ✅ 12. Multiple Output Formats
**What Fire-1 Does:**
- Returns data in multiple formats simultaneously
- Supports: JSON, markdown, HTML, text
- Allows format-specific options

**Our Status:** ✅ **HAVE IT**
- Location: `src/utils/contentExtractor.ts`
- Formats: markdown, html, rawHtml, links, screenshot, metadata
- Quality: Good

**What We Need to Add:**
- [ ] JSON format with schema validation
- [ ] Format-specific optimization

---

### ❌ 13. Caching & Deduplication
**What Fire-1 Does:**
- Caches extraction results
- Deduplicates identical requests
- Reuses previous extractions
- Reduces API costs

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Extraction result caching (KV)
- [ ] Cache key generation (URL + schema hash)
- [ ] TTL-based expiration
- [ ] Cache invalidation strategies
- [ ] Request deduplication

---

### ❌ 14. Error Recovery & Retry
**What Fire-1 Does:**
- Automatically retries failed extractions
- Uses exponential backoff
- Provides partial results on timeout
- Graceful degradation

**Our Status:** ⚠️ **PARTIAL**
- Have: Basic retry in `structuredExtractor.ts`
- Missing: Exponential backoff, partial results

**What We Need to Add:**
- [ ] Exponential backoff strategy
- [ ] Partial result returns
- [ ] Fallback extraction methods
- [ ] Detailed error reporting

---

### ❌ 15. Extraction Monitoring & Metrics
**What Fire-1 Does:**
- Tracks extraction success rates
- Monitors token usage
- Measures processing time
- Provides analytics

**Our Status:** ❌ **DON'T HAVE IT**

**What We Need to Add:**
- [ ] Metrics collection
- [ ] Success/failure tracking
- [ ] Token usage monitoring
- [ ] Performance analytics
- [ ] Cost tracking

---

## Feature Comparison Matrix

| Feature | Fire-1 | Fireflare | Priority | Effort |
|---------|--------|-----------|----------|--------|
| Schema-Based Extraction | ✅ | ✅ | High | Low |
| Prompt-Based Extraction | ✅ | ✅ | High | Low |
| System Prompts | ✅ | ❌ | High | Low |
| Multi-URL Extraction | ✅ | ✅ | High | Medium |
| Intelligent Aggregation | ✅ | ❌ | High | High |
| Few-Shot Learning | ✅ | ❌ | Medium | Medium |
| Content Preprocessing | ✅ | ✅ | High | Low |
| Confidence Scoring | ✅ | ❌ | Medium | Medium |
| Validation & Refinement | ✅ | ⚠️ | High | Medium |
| Context-Aware Extraction | ✅ | ❌ | Medium | High |
| Incremental Extraction | ✅ | ❌ | Medium | High |
| Multiple Output Formats | ✅ | ✅ | High | Low |
| Caching & Deduplication | ✅ | ❌ | High | Medium |
| Error Recovery | ✅ | ⚠️ | High | Low |
| Monitoring & Metrics | ✅ | ❌ | Low | Low |

## Implementation Priority

### Phase 1: Critical Features (Week 1-2)
**Must-have for Fire-1 parity**

1. **System Prompts** ⭐⭐⭐
   - Easy to implement
   - High impact on accuracy
   - Effort: 2-3 hours

2. **Intelligent Aggregation** ⭐⭐⭐
   - Core Fire-1 feature
   - Differentiator from basic extraction
   - Effort: 1-2 days

3. **Validation & Refinement** ⭐⭐⭐
   - Improves reliability
   - Reduces errors
   - Effort: 1 day

4. **Caching Layer** ⭐⭐⭐
   - Reduces costs
   - Improves performance
   - Effort: 1 day

### Phase 2: Important Features (Week 3)
**Significantly improve quality**

5. **Confidence Scoring** ⭐⭐
   - Quality indicator
   - Helps users trust results
   - Effort: 1 day

6. **Few-Shot Learning** ⭐⭐
   - Better accuracy
   - Handles complex schemas
   - Effort: 2 days

7. **Error Recovery** ⭐⭐
   - Better reliability
   - Graceful degradation
   - Effort: 1 day

### Phase 3: Advanced Features (Week 4)
**Nice-to-have enhancements**

8. **Context-Aware Extraction** ⭐
   - Advanced feature
   - Complex implementation
   - Effort: 2-3 days

9. **Incremental Extraction** ⭐
   - Handles large pages
   - Token limit management
   - Effort: 2 days

10. **Monitoring & Metrics** ⭐
    - Operational visibility
    - Cost tracking
    - Effort: 1 day

## Quick Wins (Implement First)

### 1. System Prompts (2-3 hours)
```typescript
// Add to extraction options
interface ExtractionOptions {
  schema?: any;
  prompt?: string;
  systemPrompt?: string;  // NEW
}

// Use in LLM call
const messages = [
  { role: 'system', content: systemPrompt || defaultSystemPrompt },
  { role: 'user', content: userPrompt }
];
```

### 2. Basic Caching (4-6 hours)
```typescript
// Use Cloudflare KV
const cacheKey = `extract:${url}:${hashSchema(schema)}`;
const cached = await env.CACHE.get(cacheKey, 'json');
if (cached) return cached;

const result = await extract(url, schema);
await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
```

### 3. Confidence Scoring (6-8 hours)
```typescript
function calculateConfidence(data: any, schema: any): number {
  let score = 1.0;
  
  // Reduce score for missing required fields
  if (schema.required) {
    const missing = schema.required.filter(f => !data[f]);
    score -= (missing.length / schema.required.length) * 0.3;
  }
  
  // Reduce score for type mismatches
  // Reduce score for empty values
  
  return Math.max(0, score);
}
```

## What Makes Fire-1 Special

Based on the research, Fire-1's key differentiators are:

1. **Intelligent Aggregation** - Merges multi-page data smartly
2. **Context Awareness** - Understands relationships across pages
3. **High Accuracy** - Uses few-shot learning and validation
4. **Reliability** - Automatic retry and error recovery
5. **Efficiency** - Caching and deduplication

## Our Competitive Advantages

What we can do better than Fire-1:

1. **Edge Computing** - Cloudflare Workers global network
2. **Cost** - Pay-as-you-go vs fixed pricing
3. **Customization** - Full control over extraction logic
4. **Integration** - Direct access to browser, LLM, storage
5. **Transparency** - Open source, no black box

## Minimum Viable Fire-1 (MVP)

To match Fire-1's core value, we need:

✅ Schema-based extraction (HAVE)
✅ Prompt-based extraction (HAVE)
✅ Multi-URL support (HAVE)
❌ System prompts (NEED - Easy)
❌ Intelligent aggregation (NEED - Medium)
❌ Validation & refinement (NEED - Medium)
❌ Caching (NEED - Easy)

**Estimated effort for MVP: 1-2 weeks**

## Conclusion

Fire-1 has **15 major features**, and we currently have **5 fully implemented** and **2 partially implemented**.

**Priority order for implementation:**
1. System Prompts (Quick win)
2. Caching (Quick win)
3. Intelligent Aggregation (Core feature)
4. Validation & Refinement (Quality)
5. Confidence Scoring (Trust)
6. Few-Shot Learning (Accuracy)
7. Error Recovery (Reliability)
8. Context-Aware Extraction (Advanced)
9. Incremental Extraction (Scale)
10. Monitoring (Operations)

With focused effort on the top 4 features, we can achieve **Fire-1 parity** in 1-2 weeks! 🚀