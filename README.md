# fireflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fireflare/fireflare)

## Overview

`fireflare` is a Firecrawl API compatible tool that runs entirely on Cloudflare Workers. It provides both `/search`, `/scrape`, `/crawl`, `/map`, and `/extract` endpoints, enabling comprehensive web data extraction capabilities. Originally inspired by workers-firecrawl, it has been thoroughly enhanced and extended with additional features and improved performance.

**Key Features:**
- **Firecrawl API Compatible**: Drop-in replacement for existing Firecrawl integrations
- **Cloudflare Workers Native**: Leveraging Cloudflare's global edge network for speed and reliability
- **Flexible LLM Integration**: Choose your preferred LLM provider with easy configuration
- **OpenRouter Ready**: Pre-configured with Grok 4 Fast for optimal speed and accuracy
- **Multiple Output Formats**: Support for markdown, HTML, JSON, screenshots, and more

## Purpose

This project focuses on providing a high-performance, self-hosted alternative to Firecrawl's API endpoints with the added flexibility of customizable LLM integration. By running on Cloudflare Workers, it offers a simple API interface for web search, scraping, and data extraction with minimal setup and maximum performance.

## LLM Integration

Fireflare is designed to work seamlessly with multiple LLM providers:

**Default Configuration:**
- **Provider**: OpenRouter
- **Model**: Grok 4 Fast (selected for speed and accuracy)
- **Easy Customization**: Switch providers/models via environment variables

**Supported Providers:**
- OpenRouter (default)
- OpenAI
- Any OpenAI-compatible API

**Configuration Example:**
```bash
# Set your preferred LLM provider
npx wrangler secret put OPENAI_API_KEY

# Or customize the provider in wrangler.toml
LLM_BASE_URL = "https://api.openai.com/v1"
LLM_MODEL = "gpt-4-turbo"
```

## Features

- **`/v2/search` Endpoint**: Perform web searches and retrieve structured results, compatible with Firecrawl SDKs.
- **`/v2/scrape` Endpoint**: Scrape individual URLs and extract content in multiple formats.
- **`/v2/crawl` Endpoint**: Recursively crawl entire websites and extract content from multiple pages.
- **`/v2/map` Endpoint**: Get a complete list of URLs from any website quickly.
- **`/v2/extract` Endpoint**: Extract structured data from webpages using AI with natural language prompts.
- **Multiple Output Formats**: Support for markdown, HTML, raw HTML, links, screenshots, metadata, JSON, and AI-powered summaries.
- **Browser Actions**: Support for clicking, typing, waiting, and scrolling on pages.
- **Advanced Options**: Custom headers, mobile emulation, popup handling, and more.
- **Cloudflare Browser Rendering**: Powers real-time web scraping and content extraction.
- **Advanced Search Controls**: DuckDuckGo-backed time (TBS) and region (`lang`/`country`/`location`) parameters for finer-grained search targeting.
- **Firecrawl SDK Compatibility**: Seamlessly integrates with existing Firecrawl-based applications.
- **Backward Compatibility**: Maintains `/v1/search` endpoint for existing integrations.

Additional endpoints or features can be requested
via [GitHub Issues](https://github.com/fireflare/fireflare/issues).

## API Endpoints

### POST /v2/scrape
Scrape a single URL and get its content in various formats.

**Request Body:**
```json
{
  "url": "https://example.com",
  "formats": ["markdown", "html", "links", "screenshot"],
  "screenshot": {
    "fullPage": true,
    "quality": 80
  },
  "actions": [
    {
      "type": "wait",
      "milliseconds": 2000
    },
    {
      "type": "click",
      "selector": "#accept-cookies"
    }
  ],
  "onlyMainContent": true,
  "timeout": 60000,
  "waitFor": ".main-content",
  "headers": {
    "User-Agent": "Custom Bot"
  },
  "mobile": false
}
```

**Example Usage:**
```javascript
const response = await fetch('https://your-worker.workers.dev/v2/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY' // if configured
  },
  body: JSON.stringify({
    url: 'https://example.com',
    formats: ['markdown', 'screenshot']
  })
});

const data = await response.json();
console.log(data.data.markdown);
```

### POST /v2/search
Search the web and scrape results (enhanced with v2 features).

**Request Body:**
```json
{
  "query": "search term",
  "tbs": "qdr:w",
  "limit": 5,
  "lang": "en",
  "country": "us",
  "location": "United States",
  "scrapeOptions": {
    "formats": ["markdown", "html", "links"],
    "onlyMainContent": true,
    "timeout": 60000,
    "actions": [
      {
        "type": "wait",
        "milliseconds": 1000
      }
    ]
  }
}
```

`lang`, `country`, and `location` map to DuckDuckGo's regional biasing, while `tbs` supports presets such as `qdr:d` (past day), `qdr:w` (past week), `qdr:m` (past month), `qdr:y` (past year), or custom ranges (`cdr:1,...`) to mirror Firecrawl's V2 behaviour.

**Example Usage:**
```javascript
const response = await fetch('https://your-worker.workers.dev/v2/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY' // if configured
  },
  body: JSON.stringify({
    query: 'Cloudflare Workers',
    limit: 3,
    scrapeOptions: {
      formats: ['markdown', 'metadata']
    }
  })
});

const data = await response.json();
console.log(data.data); // Array of scraped results
});
```

#### Using `curl` with time and region filters

```bash
curl -X POST "https://your-worker.workers.dev/v2/search" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest technology news",
    "sources": ["news"],
    "limit": 5,
    "tbs": "qdr:w",
    "lang": "en",
    "country": "us",
    "location": "United States",
    "scrapeOptions": {
      "formats": ["markdown", "metadata"],
      "onlyMainContent": true
    }
  }'
```

This request filters news results to the past week and biases them toward United States English sources while still returning full scrape data.

### POST /v2/crawl
Recursively crawl entire websites and extract content from multiple pages.

**Request Body:**
```json
{
  "url": "https://example.com",
  "limit": 50,
  "scrapeOptions": {
    "formats": ["markdown"],
    "onlyMainContent": true
  },
  "crawlEntireDomain": false,
  "maxDepth": 3
}
```

**Example Usage:**
```javascript
const response = await fetch('https://your-worker.workers.dev/v2/crawl', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    url: 'https://example.com',
    limit: 20,
    scrapeOptions: {
      formats: ['markdown']
    }
  })
});

const data = await response.json();
console.log('Crawl job ID:', data.id);

// Check crawl status
const statusResponse = await fetch(`https://your-worker.workers.dev/v2/crawl/${data.id}`, {
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

const statusData = await statusResponse.json();
console.log('Crawl status:', statusData.status);
```

### POST /v2/map
Get a complete list of URLs from any website quickly.

**Request Body:**
```json
{
  "url": "https://example.com",
  "limit": 100,
  "sitemap": "include",
  "includeSubdomains": false,
  "ignoreQueryParameters": true
}
```

**Example Usage:**
```javascript
const response = await fetch('https://your-worker.workers.dev/v2/map', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    url: 'https://example.com',
    limit: 100,
    search: 'blog'
  })
});

const data = await response.json();
console.log('Found URLs:', data.links);
```

### POST /v2/extract
Extract structured data from webpages using AI with natural language prompts.

**Request Body:**
```json
{
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
}
```

### Legacy Endpoint

#### POST /v1/search
Legacy search endpoint maintained for backward compatibility. Uses the same request/response format as the original implementation.

## Supported Formats

- **`markdown`**: Clean markdown conversion of page content
- **`html`**: Processed HTML with scripts/styles removed
- **`rawHtml`**: Complete raw HTML from the page
- **`links`**: Array of all HTTP links found on the page
- **`screenshot`**: Base64 encoded PNG screenshot
- **`metadata`**: Page metadata (title, description, etc.)
- **`json`**: Structured data extraction using AI
- **`summary`**: AI-powered content summarization

## Browser Actions

- **`wait`**: Wait for specified milliseconds
- **`click`**: Click on an element matching a CSS selector
- **`type`**: Type text into an input field
- **`scroll`**: Scroll to the bottom of the page
- **`executeJavaScript`**: Execute custom JavaScript on the page

## Basic Usage

### Prerequisites

- A Cloudflare account with a [Workers Paid Plan](https://developers.cloudflare.com/workers/platform/pricing/) ($
  5/month) to use Browser Rendering.

### Setup for Local Development

1. **Clone the Repository**

   ```bash
   git clone git@github.com:fireflare/fireflare.git
   cd fireflare
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Log in to Cloudflare**

   Authenticate with your Cloudflare account:

   ```bash
   npx wrangler login
   ```

4. **Configure LLM Provider (Optional)**

   The default configuration uses OpenRouter with Grok 4 Fast. To customize:

   ```bash
   # Set your OpenAI API key (or other provider)
   npx wrangler secret put OPENAI_API_KEY
   ```

   Or modify `wrangler.toml`:
   ```toml
   [vars]
   LLM_BASE_URL = "https://openrouter.ai/api/v1"  # or your preferred provider
   LLM_MODEL = "x-ai/grok-4-fast"              # or your preferred model
   ```

5. **Deploy the Worker**

   Deploy to Cloudflare:

   ```bash
   npx wrangler deploy
   ```

   After deployment, you'll see a URL in your terminal, e.g., `https://fireflare.{your-user}.workers.dev`. This
   is your Worker's endpoint.

6. **Test the Worker**

   Open the URL in your browser to access a Swagger UI for testing all endpoints directly. Use this URL in your
   Firecrawl SDK configuration.

7. **Authorization (Optional)**

   By default, this worker will accept requests from everyone, so its recommended that you setup authorization,
   For this, just set the `AUTHORIZATION_KEY` secret in your worker, with the desired api key you want to use.

   ```bash
   npx wrangler secret put AUTHORIZATION_KEY
   ```

### Making Requests

#### Using the Firecrawl SDK

Integrate with the Firecrawl SDK by updating the `apiUrl` to your Worker's URL:

```javascript
const {FirecrawlApp} = require('@mendable/firecrawl-js');

const fireflare = new FirecrawlApp({
    apiKey: 'your-api-key', // Only if AUTHORIZATION_KEY is defined in the worker
    apiUrl: 'https://fireflare.{your-user}.workers.dev'
});

// Example search
const searchResults = await fireflare.search('test query');
console.log(searchResults);

// Example scrape
const scrapeResults = await fireflare.scrapeUrl('https://example.com');
console.log(scrapeResults);

// Example crawl
const crawlResults = await fireflare.crawlUrl('https://example.com');
console.log(crawlResults);

// Example map
const mapResults = await fireflare.map('https://example.com');
console.log(mapResults);
```

#### Using Direct HTTP Requests

```javascript
// Search endpoint
const searchResponse = await fetch('https://your-worker.workers.dev/v2/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY' // if configured
  },
  body: JSON.stringify({
    query: 'Cloudflare Workers tutorial',
    limit: 5,
    scrapeOptions: {
      formats: ['markdown', 'metadata']
    }
  })
});

const searchData = await searchResponse.json();
console.log('Search results:', searchData.data);

// Scrape endpoint
const scrapeResponse = await fetch('https://your-worker.workers.dev/v2/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY' // if configured
  },
  body: JSON.stringify({
    url: 'https://blog.cloudflare.com',
    formats: ['markdown', 'screenshot'],
    onlyMainContent: true,
    screenshot: {
      fullPage: false,
      quality: 90
    }
  })
});

const scrapeData = await scrapeResponse.json();
console.log('Scraped content:', scrapeData.data.markdown);
```

### Customization

- **Custom Domain**: Assign a custom domain via the Cloudflare dashboard under Workers > Your Worker > Triggers.
- **Cloudflare Access**: Add security by configuring Cloudflare Access for authenticated access under Access >
  Applications.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
