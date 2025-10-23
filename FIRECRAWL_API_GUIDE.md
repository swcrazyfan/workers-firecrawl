# Firecrawl API Complete Guide

This guide provides comprehensive documentation for the official Firecrawl API endpoints, their parameters, and how they work together. This is the definitive reference for the real Firecrawl service.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Base URL](#base-url)
- [Response Codes](#response-codes)
- [Endpoints](#endpoints)
  - [Scrape (`/v2/scrape`)](#scrape-v2scrape)
  - [Crawl (`/v2/crawl`)](#crawl-v2crawl)
  - [Search (`/v2/search`)](#search-v2search)
  - [Extract (`/v2/extract`)](#extract-v2extract)
  - [Map (`/v2/map`)](#map-v2map)
- [Common Parameters](#common-parameters)
- [AI Features](#ai-features)
- [Cost Implications](#cost-implications)
- [Rate Limits](#rate-limits)
- [Examples](#examples)

## Overview

Firecrawl is a web data API that turns any website into clean, structured data for AI applications. It provides multiple endpoints for different use cases:

- **Scrape**: Extract content from single webpages
- **Crawl**: Recursively crawl entire websites
- **Search**: Search the web and optionally scrape results
- **Extract**: Extract structured data using AI
- **Map**: Get all URLs from a website

## Authentication

All requests require an Authorization header:

```http
Authorization: Bearer fc-YOUR-API-KEY
```

## Base URL

```
https://api.firecrawl.dev
```

## Response Codes

| Status | Description |
|--------|-------------|
| 200 | Request successful |
| 400 | Invalid parameters |
| 401 | Missing or invalid API key |
| 402 | Payment required |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 5xx | Server error |

## Endpoints

### Scrape (`/v2/scrape`)

Extract content from a single webpage in various formats.

#### Endpoint
```
POST /v2/scrape
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to scrape |
| `formats` | array | No | Output formats (markdown, html, json, etc.) |
| `onlyMainContent` | boolean | No | Extract only main content (default: false) |
| `timeout` | number | No | Request timeout in milliseconds |
| `waitFor` | number | No | Wait time in milliseconds for dynamic content |
| `screenshot` | boolean | No | Take screenshot |
| `actions` | array | No | Actions to perform before scraping |
| `location` | object | No | Location settings (country, languages) |
| `proxy` | string | No | Proxy setting ("basic", "stealth", "auto") |
| `maxAge` | number | No | Cache freshness window in milliseconds |
| `headers` | object | No | Custom headers to send |
| `includeTags` | array | No | HTML tags to include |
| `excludeTags` | array | No | HTML tags to exclude |
| `mobile` | boolean | No | Use mobile viewport (default: false) |
| `skipTlsVerification` | boolean | No | Skip TLS verification (default: true) |
| `parsers` | array | No | Enable specific parsers (e.g., ["pdf"]) |
| `removeBase64Images` | boolean | No | Remove base64 images (default: true) |
| `blockAds` | boolean | No | Block ads content (default: true) |
| `storeInCache` | boolean | No | Store in cache (default: true) |
| `zeroDataRetention` | boolean | No | Zero data retention (default: false) |

#### Formats Array

Each format object can have:
- `type`: "markdown", "html", "rawHtml", "json", "links", "images", "screenshot", "changeTracking"
- For JSON format:
  - `schema`: JSON schema for structured output
  - `prompt`: Optional prompt to guide extraction
- For screenshot format:
  - `fullPage`: boolean (default: true)
  - `quality`: number 0-100 (default: 80)

#### Example Request

```bash
curl -X POST "https://api.firecrawl.dev/v2/scrape" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "html"],
    "onlyMainContent": true,
    "timeout": 30000
  }'
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "markdown": "# Page Title\n\nContent here...",
    "html": "<html>...</html>",
    "metadata": {
      "title": "Page Title",
      "description": "Page description",
      "sourceURL": "https://example.com",
      "statusCode": 200
    }
  }
}
```

#### JSON Extraction Example

```bash
curl -X POST "https://api.firecrawl.dev/v2/scrape" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {"type": "string"},
          "price": {"type": "number"}
        }
      }
    }]
  }'
```

### Crawl (`/v2/crawl`)

Recursively crawl entire websites and extract content from multiple pages.

#### Endpoint
```
POST /v2/crawl
GET /v2/crawl/{id}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Starting URL to crawl |
| `limit` | number | No | Maximum pages to crawl (default: 10) |
| `scrapeOptions` | object | No | Options applied to each page (same as scrape) |
| `maxDiscoveryDepth` | number | No | Maximum discovery depth (default: 10) |
| `crawlEntireDomain` | boolean | No | Crawl entire domain, not just subpaths |
| `allowSubdomains` | boolean | No | Allow crawling subdomains |
| `allowExternalLinks` | boolean | No | Allow external links |
| `includePaths` | array | No | URL patterns to include |
| `excludePaths` | array | No | URL patterns to exclude |
| `ignoreQueryParameters` | boolean | No | Ignore query parameters |
| `sitemap` | string | No | Sitemap handling ("include", "skip") |
| `delay` | number | No | Delay between requests in seconds (default: 0) |
| `maxConcurrency` | number | No | Maximum concurrent requests (default: 3) |
| `webhook` | object | No | Webhook configuration for real-time updates |

#### Start Crawl Request

```bash
curl -X POST "https://api.firecrawl.dev/v2/crawl" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "limit": 50,
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    },
    "crawlEntireDomain": false,
    "maxDepth": 3
  }'
```

#### Start Crawl Response

```json
{
  "success": true,
  "id": "crawl-123-456-789",
  "url": "https://api.firecrawl.dev/v2/crawl/crawl-123-456-789"
}
```

#### Check Crawl Status

```bash
curl -X GET "https://api.firecrawl.dev/v2/crawl/crawl-123-456-789" \
  -H "Authorization: Bearer fc-YOUR-API-KEY"
```

#### Crawl Status Response

```json
{
  "success": true,
  "status": "scraping",
  "total": 50,
  "completed": 15,
  "creditsUsed": 15,
  "expiresAt": "2024-12-01T00:00:00.000Z",
  "next": "https://api.firecrawl.dev/v2/crawl/crawl-123-456-789?skip=15",
  "data": [
    {
      "markdown": "Page content...",
      "metadata": {
        "title": "Page Title",
        "sourceURL": "https://example.com/page1",
        "statusCode": 200
      }
    }
  ]
}
```

### Search (`/v2/search`)

Search the web and optionally scrape content from search results.

#### Endpoint
```
POST /v2/search
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `limit` | number | No | Number of results (default: 10) |
| `sources` | array | No | Result types: ["web", "news", "images"] |
| `categories` | array | No | Search categories: ["github", "research"] |
| `location` | string | No | Location for localized results |
| `tbs` | string | No | Time-based search (qdr:h, qdr:d, qdr:w, qdr:m, qdr:y) |
| `lang` | string | No | Language code (default: "en") |
| `country` | string | No | Country code (default: "us") |
| `scrapeOptions` | object | No | Options for scraping search results |
| `timeout` | number | No | Search timeout in milliseconds |
| `ignoreInvalidURLs` | boolean | No | Ignore invalid URLs (default: false) |

#### Search Request

```bash
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "web scraping tools",
    "limit": 5,
    "sources": ["web"],
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }'
```

#### Search Response

```json
{
  "success": true,
  "data": {
    "web": [
      {
        "url": "https://example.com/tool1",
        "title": "Tool 1",
        "description": "Description of tool 1",
        "position": 1,
        "markdown": "Content from the page...",
        "metadata": {
          "title": "Tool 1",
          "sourceURL": "https://example.com/tool1",
          "statusCode": 200
        }
      }
    ],
    "images": [],
    "news": []
  }
}
```

#### Search with JSON Extraction

```bash
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
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
            "price": {"type": "number"}
          }
        }
      }]
    }
  }'
```

#### Search Categories

**GitHub Category:**
```bash
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "web scraping python",
    "categories": ["github"],
    "limit": 10
  }'
```

**Research Category:**
```bash
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning transformers",
    "categories": ["research"],
    "limit": 10
  }'
```

### Extract (`/v2/extract`)

Extract structured data from webpages using AI with natural language prompts.

#### Endpoint
```
POST /v2/extract
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to extract data from |
| `prompt` | string | Yes | Natural language description of what to extract |
| `schema` | object | No | Optional JSON schema for structured output |

#### Extract Request

```bash
curl -X POST "https://api.firecrawl.dev/v2/extract" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product",
    "prompt": "Extract product information including name, price, and availability",
    "schema": {
      "type": "object",
      "properties": {
        "productName": {"type": "string"},
        "price": {"type": "number"},
        "inStock": {"type": "boolean"}
      }
    }
  }'
```

#### Extract Response

```json
{
  "success": true,
  "data": {
    "json": {
      "productName": "Example Product",
      "price": 29.99,
      "inStock": true
    },
    "metadata": {
      "title": "Product Page",
      "sourceURL": "https://example.com/product"
    }
  }
}
```

### Map (`/v2/map`)

Get a complete list of URLs from any website quickly. This endpoint prioritizes speed and may not capture all website links.

#### Endpoint
```
POST /v2/map
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Website URL to map |
| `search` | string | No | Keyword to filter URLs (simple string matching in URL path, ordered by relevance) |
| `sitemap` | string | No | Sitemap mode: "skip", "include", or "only" (default: "include") |
| `includeSubdomains` | boolean | No | Include subdomains (default: true) |
| `ignoreQueryParameters` | boolean | No | Exclude URLs with query parameters (default: true) |
| `limit` | number | No | Maximum URLs to return (default: 5000, max: 100000) |
| `timeout` | number | No | Timeout in milliseconds (no timeout by default) |
| `location` | object | No | Location settings (country, languages) |

#### Sitemap Modes

The `sitemap` parameter controls how sitemaps are used:

- **`"include"`** (default) - Use sitemap + find other pages through crawling
- **`"skip"`** - Ignore sitemap completely, only use crawling
- **`"only"`** - Only return URLs found in sitemap

#### Map Request

```bash
curl -X POST "https://api.firecrawl.dev/v2/map" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "limit": 100,
    "sitemap": "include",
    "includeSubdomains": false,
    "ignoreQueryParameters": true
  }'
```

#### Map Response

**Important**: The response returns an array of link objects with `url`, `title`, and `description` fields (not just URL strings).

```json
{
  "success": true,
  "links": [
    {
      "url": "https://example.com/",
      "title": "Home Page",
      "description": "Welcome to our website"
    },
    {
      "url": "https://example.com/about",
      "title": "About Us",
      "description": "Learn more about our company"
    },
    {
      "url": "https://example.com/contact",
      "title": "Contact",
      "description": "Get in touch with us"
    }
  ]
}
```

**Note**: `title` and `description` are not always present as it depends on the website.

#### Map with Search (Keyword Filtering)

The `search` parameter filters URLs using **simple keyword matching** in the URL path. Results are ordered by relevance (how prominently the keyword appears in the URL).

**Example**: Search for URLs containing "blog":

```bash
curl -X POST "https://api.firecrawl.dev/v2/map" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://firecrawl.dev",
    "search": "blog"
  }'
```

Response (ordered by relevance):
```json
{
  "success": true,
  "links": [
    {
      "url": "https://firecrawl.dev/blog",
      "title": "Blog",
      "description": "Latest updates"
    },
    {
      "url": "https://firecrawl.dev/blog/post-1",
      "title": "Blog Post 1",
      "description": "First blog post"
    }
  ]
}
```

**Note**: The search uses keyword matching in URLs, not semantic/embedding-based search.

#### Map with Sitemap Only

Return only URLs found in the sitemap:

```bash
curl -X POST "https://api.firecrawl.dev/v2/map" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "sitemap": "only",
    "limit": 1000
  }'
```

#### Map with Location

```bash
curl -X POST "https://api.firecrawl.dev/v2/map" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "location": {
      "country": "US",
      "languages": ["en"]
    }
  }'
```

## Common Parameters

### Location Object

```json
{
  "country": "US",
  "languages": ["en-US"]
}
```

### Webhook Object

```json
{
  "url": "https://your-domain.com/webhook",
  "metadata": {
    "custom": "value"
  },
  "events": ["started", "page", "completed"]
}
```

### Actions Array

```json
[
  {"type": "wait", "milliseconds": 2000},
  {"type": "click", "selector": "button"},
  {"type": "type", "text": "search query"},
  {"type": "scroll", "direction": "down"},
  {"type": "executeJavaScript", "javascript": "document.title"},
  {"type": "screenshot", "fullPage": true}
]
```

## AI Features

### JSON Extraction

All endpoints support AI-powered JSON extraction through the `formats` parameter:

1. **Schema-based**: Provide a JSON schema for structured output
2. **Prompt-based**: Use natural language to guide extraction

### Example: Schema-based Extraction

```json
{
  "formats": [{
    "type": "json",
    "schema": {
      "type": "object",
      "properties": {
        "company_mission": {"type": "string"},
        "supports_sso": {"type": "boolean"},
        "is_open_source": {"type": "boolean"},
        "is_in_yc": {"type": "boolean"}
      },
      "required": ["company_mission", "supports_sso", "is_open_source", "is_in_yc"]
    }
  }]
}
```

### Example: Prompt-based Extraction

```json
{
  "formats": [{
    "type": "json",
    "prompt": "Extract the company mission from the page."
  }]
}
```

## Cost Implications

| Feature | Cost per request |
|---------|------------------|
| Basic scrape/search | 1 credit |
| PDF parsing | 1 credit per page |
| JSON extraction | +4 credits |
| Stealth proxy | +4 credits |

## Rate Limits

- Default rate limits apply to all endpoints
- 429 status code indicates rate limit exceeded
- Implement exponential backoff for retries

## Examples

### Complete Workflow Example

```bash
# 1. Map a website to get all URLs
curl -X POST "https://api.firecrawl.dev/v2/map" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# 2. Crawl the website with JSON extraction
curl -X POST "https://api.firecrawl.dev/v2/crawl" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "limit": 20,
    "scrapeOptions": {
      "formats": [{
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"}
          }
        }
      }]
    }
  }'

# 3. Check crawl status
curl -X GET "https://api.firecrawl.dev/v2/crawl/{jobId}" \
  -H "Authorization: Bearer fc-YOUR-API-KEY"

# 4. Search for related content
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "related topics",
    "limit": 5,
    "scrapeOptions": {
      "formats": ["markdown"]
    }
  }'
```

### Batch Processing Example

```bash
# Scrape multiple URLs with different extraction needs
curl -X POST "https://api.firecrawl.dev/v2/scrape" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/products",
    "formats": [
      "markdown",
      {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "products": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {"type": "string"},
                  "price": {"type": "number"},
                  "description": {"type": "string"}
                }
              }
            }
          }
        }
      }
    ]
  }'
```

### Advanced Search with Time Filtering

```bash
# Search for recent news articles
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "artificial intelligence news",
    "sources": ["news"],
    "tbs": "qdr:w",
    "limit": 10,
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }'
```

### Custom Date Range Search

```bash
# Search within specific date range
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "firecrawl updates",
    "limit": 10,
    "tbs": "cdr:1,cd_min:12/1/2024,cd_max:12/31/2024"
  }'
```

### HD Image Search

```bash
# Search for high-resolution images
curl -X POST "https://api.firecrawl.dev/v2/search" \
  -H "Authorization: Bearer fc-YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "sunset imagesize:1920x1080",
    "sources": ["images"],
    "limit": 5
  }'
```

This guide serves as a comprehensive reference for the official Firecrawl API. For the most up-to-date information, visit the official Firecrawl documentation at https://docs.firecrawl.dev.