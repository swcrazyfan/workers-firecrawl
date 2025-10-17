# workers-firecrawl

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G4brym/workers-firecrawl)

## Overview

`workers-firecrawl` is a Cloudflare Workers implementation of the Firecrawl API, providing both `/search` and `/scrape` endpoints. It uses Cloudflare's Browser Rendering API to perform web searches and extract content from web pages, all within the Cloudflare environment. This project enables developers to self-host a Firecrawl-compatible service with minimal setup.

## Purpose

This project focuses on providing a lightweight, self-hosted alternative to Firecrawl's API endpoints. By leveraging Cloudflare Workers, it offers a simple API interface for web search and scraping capabilities, making it an ideal drop-in replacement for existing Firecrawl SDK integrations. Update just one line in your codebase to point to your Worker, and you're ready to go!

## Features

- **`/v2/search` Endpoint**: Perform web searches and retrieve structured results, compatible with Firecrawl SDKs.
- **`/v2/scrape` Endpoint**: Scrape individual URLs and extract content in multiple formats.
- **Multiple Output Formats**: Support for markdown, HTML, raw HTML, links, screenshots, and metadata.
- **Browser Actions**: Support for clicking, typing, waiting, and scrolling on pages.
- **Advanced Options**: Custom headers, mobile emulation, popup handling, and more.
- **Cloudflare Browser Rendering**: Powers real-time web scraping and content extraction.
- **Advanced Search Controls**: DuckDuckGo-backed time (TBS) and region (`lang`/`country`/`location`) parameters for finer-grained search targeting.
- **Firecrawl SDK Compatibility**: Seamlessly integrates with existing Firecrawl-based applications.
- **Backward Compatibility**: Maintains `/v1/search` endpoint for existing integrations.

Additional endpoints or features can be requested
via [GitHub Issues](https://github.com/G4brym/workers-firecrawl/issues).

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

`lang`, `country`, and `location` map to DuckDuckGo's regional biasing, while `tbs` supports presets such as `qdr:d` (past day), `qdr:w` (past week), `qdr:m` (past month), `qdr:y` (past year), or custom ranges (`cdr:1,...`) to mirror Firecrawl’s V2 behaviour.

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
   git clone git@github.com:G4brym/workers-firecrawl.git
   cd workers-firecrawl
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

4. **Deploy the Worker**

   Deploy to Cloudflare:

   ```bash
   npx wrangler deploy
   ```

   After deployment, you’ll see a URL in your terminal, e.g., `https://workers-firecrawl.{your-user}.workers.dev`. This
   is your Worker’s endpoint.

5. **Test the Worker**

   Open the URL in your browser to access a Swagger UI for testing all endpoints directly. Use this URL in your
   Firecrawl SDK configuration.

6. **Authorization (Optional)**

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

const firecrawl = new FirecrawlApp({
    apiKey: 'your-api-key', // Only if AUTHORIZATION_KEY is defined in the worker
    apiUrl: 'https://workers-firecrawl.{your-user}.workers.dev'
});

// Example search
const searchResults = await firecrawl.search('test query');
console.log(searchResults);

// Example scrape
const scrapeResults = await firecrawl.scrapeUrl('https://example.com');
console.log(scrapeResults);
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
