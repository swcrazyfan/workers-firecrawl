## AI-Powered JSON Extraction in Search

### Search with JSON Extraction (Prompt-Based)
Extract structured data from search results using natural language prompts.

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cloudflare workers",
    "limit": 3,
    "scrapeOptions": {
      "formats": ["markdown", {
        "type": "json",
        "prompt": "Extract the page title, main description, and key features"
      }]
    }
  }'
```

### Search with JSON Extraction (Schema-Based)
Extract structured data from search results using a JSON schema.

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "web scraping tools",
    "limit": 3,
    "scrapeOptions": {
      "formats": [{
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "productName": {"type": "string"},
            "description": {"type": "string"},
            "pricing": {"type": "string"},
            "features": {"type": "array", "items": {"type": "string"}}
          },
          "required": ["productName"]
        }
      }]
    }
  }'
```

### News Search with JSON Extraction
Extract structured data from news articles.

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/search" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "artificial intelligence",
    "sources": ["news"],
    "limit": 3,
    "tbs": "qdr:w",
    "scrapeOptions": {
      "formats": [{
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "headline": {"type": "string"},
            "summary": {"type": "string"},
            "author": {"type": "string"},
            "publishDate": {"type": "string"}
          },
          "required": ["headline", "summary"]
        }
      }]
    }
  }'
```

## AI-Powered JSON Extraction in Crawl

### Start Crawl with JSON Extraction
Crawl a website and extract structured data from each page.

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/crawl" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "limit": 5,
    "scrapeOptions": {
      "formats": ["markdown", {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "pageTitle": {"type": "string"},
            "mainContent": {"type": "string"},
            "category": {"type": "string"}
          },
          "required": ["pageTitle"]
        }
      }]
    }
  }'
```

### Crawl with Prompt-Based Extraction
Use natural language prompts to extract data during crawling.

```bash
curl -X POST "https://workers-firecrawl.joshua-55c.workers.dev/v2/crawl" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.example.com",
    "limit": 10,
    "maxDiscoveryDepth": 2,
    "scrapeOptions": {
      "formats": [{
        "type": "json",
        "prompt": "Extract the article title, author, publication date, and main topics"
      }]
    }
  }'
```

### Check Crawl Status with JSON Results
Retrieve crawl results including extracted JSON data.

```bash
curl -X GET "https://workers-firecrawl.joshua-55c.workers.dev/v2/crawl/CRAWL_JOB_ID" \
  -H "Authorization: Bearer 76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6"
```

Response will include JSON data for each crawled page:
```json
{
  "success": true,
  "status": "completed",
  "total": 5,
  "completed": 5,
  "data": [
    {
      "markdown": "...",
      "json": {
        "pageTitle": "Example Page",
        "mainContent": "...",
        "category": "Technology"
      },
      "metadata": {...},
      "sourceURL": "https://example.com"
    }
  ]
}
```