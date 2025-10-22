# Firecrawl Crawl Endpoint Setup Guide

This guide will help you set up the crawl functionality for the workers-firecrawl project, which requires a D1 database and Durable Objects configuration.

## Prerequisites

- Node.js and npm installed
- Cloudflare account with Workers enabled
- Wrangler CLI installed (`npm install -g wrangler`)

## Step 1: Create D1 Database

First, create a D1 database for storing crawl jobs and results:

```bash
# Create the D1 database
npx wrangler d1 create workers-firecrawl

# Note the database_id from the output - you'll need it for the next step
```

## Step 2: Run Database Migrations

Execute the database schema to create the necessary tables:

```bash
# Run the migrations file to create tables
npx wrangler d1 execute workers-firecrawl --file=./migrations.sql --remote
```

## Step 3: Deploy the Worker

Deploy the updated worker with crawl functionality:

```bash
# Deploy the worker
npx wrangler deploy
```

## Alternative: Automated Deployment

For a streamlined deployment process, you can use the provided deploy script:

```bash
# Make the script executable
chmod +x deploy.sh

# Run the deployment script
./deploy.sh
```

This script will:
1. Run database migrations
2. Deploy the worker
3. Test the crawl endpoint

## Step 5: Test the Crawl Endpoint

### Start a Crawl Job

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/v2/crawl" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "url": "https://docs.firecrawl.dev",
    "limit": 5,
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }'
```

Expected response:
```json
{
  "success": true,
  "id": "crawl_1234567890_abcdef123",
  "url": "https://your-worker.your-subdomain.workers.dev/v2/crawl/crawl_1234567890_abcdef123"
}
```

### Check Crawl Status

Replace `JOB_ID` with the actual ID from the previous response:

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/v2/crawl/JOB_ID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Expected response:
```json
{
  "success": true,
  "status": "scraping",
  "total": 5,
  "completed": 2,
  "data": [
    {
      "markdown": "Page content...",
      "html": "<html>...</html>",
      "metadata": {
        "title": "Page Title",
        "description": "Page description",
        "language": "en",
        "sourceURL": "https://example.com/page",
        "statusCode": 200
      }
    },
    ...
  ]
}
```

## Crawl Parameters

The crawl endpoint supports the following parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | Starting URL for crawl |
| `limit` | integer | 10000 | Maximum pages to crawl |
| `scrapeOptions` | object | {} | Options applied to each page |
| `maxDiscoveryDepth` | integer | 10 | Maximum depth for URL discovery |
| `crawlEntireDomain` | boolean | false | Crawl entire domain, not just child paths |
| `allowSubdomains` | boolean | false | Follow links to subdomains |
| `allowExternalLinks` | boolean | false | Follow links to external sites |
| `includePaths` | string[] | [] | Regex patterns for URLs to include |
| `excludePaths` | string[] | [] | Regex patterns for URLs to exclude |
| `ignoreQueryParameters` | boolean | false | Treat same path with different query as same |
| `sitemap` | string | "include" | Use sitemap: "include" or "skip" |
| `delay` | number | 0 | Delay between page scrapes (seconds) |
| `maxConcurrency` | integer | 3 | Maximum concurrent scrapes |

## Architecture Overview

The crawl implementation uses a hybrid architecture:

- **Durable Objects**: Handle individual crawl jobs asynchronously
- **D1 Database**: Store job status, results, and URL queues
- **Browser Rendering**: Extract content from web pages
- **Scheduled Cleanup**: Automatically remove expired jobs

## Troubleshooting

### Database Issues

If you encounter database errors, verify the schema was created correctly:

```bash
# Check table structure
wrangler d1 execute workers-firecrawl --command="SELECT name FROM sqlite_master WHERE type='table'" --remote
```

### Durable Object Issues

Check the logs for any Durable Object errors:

```bash
# View real-time logs
wrangler tail
```

### Crawl Not Starting

1. Verify the D1 database is properly configured
2. Check that the worker deployed successfully
3. Ensure the API key is valid (if using authorization)

## Advanced Configuration

### Custom Retention Period

To change how long crawl results are retained (default: 7 days), modify the expiration time in both:
- `src/durableObjects/crawlJob.ts` (line 95 and 373)
- `src/index.ts` (line 77)

### Rate Limiting

To add custom rate limiting, modify the `delay` parameter or implement additional logic in the CrawlJob class.

## Production Considerations

1. **Monitor Costs**: D1 queries and Durable Object operations have costs
2. **Set Limits**: Use reasonable `limit` values to prevent excessive crawling
3. **Authorization**: Consider implementing API key validation
4. **Error Handling**: Monitor failed crawls and implement retry logic if needed