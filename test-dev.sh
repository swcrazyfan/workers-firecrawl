#!/bin/bash

echo "🧪 Testing Firecrawl Crawl Endpoint (Development Mode)"

# Configuration from curl-cheatsheet.md
WORKER_URL="http://localhost:8787"
AUTH_TOKEN="76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6"

echo "Worker URL: $WORKER_URL"
echo ""
echo "Make sure to run 'npx wrangler dev --remote' in another terminal before running this script."
echo ""

# Test 1: Start a crawl job
echo "📋 Test 1: Starting a crawl job..."
CRAWL_RESPONSE=$(curl -s -X POST "$WORKER_URL/v2/crawl" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://joshuakaufmann.ai",
    "limit": 10,
    "maxDiscoveryDepth": 2,
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }')

echo "Crawl response: $CRAWL_RESPONSE"

# Extract job ID from response
JOB_ID=$(echo $CRAWL_RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
    echo "❌ Failed to start crawl job!"
    exit 1
fi

echo "✅ Crawl job started with ID: $JOB_ID"

# Test 2: Check crawl status
echo ""
echo "📋 Test 2: Checking crawl status..."
STATUS_RESPONSE=$(curl -s -X GET "$WORKER_URL/v2/crawl/$JOB_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN")

echo "Status response: $STATUS_RESPONSE"

# Test 3: Continuously check status until completion
echo ""
echo "📋 Test 3: Continuously checking crawl status until completion..."

MAX_ATTEMPTS=30
ATTEMPT=1
STATUS="scraping"

while [ "$STATUS" = "scraping" ] && [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  echo "Attempt $ATTEMPT: Checking status..."
  STATUS_RESPONSE=$(curl -s -X GET "$WORKER_URL/v2/crawl/$JOB_ID" \
    -H "Authorization: Bearer $AUTH_TOKEN")
  
  # Extract status from response
  STATUS=$(echo $STATUS_RESPONSE | grep -o '"status":"[^"]*' | cut -d'"' -f4)
  TOTAL=$(echo $STATUS_RESPONSE | grep -o '"total":[0-9]*' | cut -d':' -f2)
  COMPLETED=$(echo $STATUS_RESPONSE | grep -o '"completed":[0-9]*' | cut -d':' -f2)
  
  echo "Current status: $STATUS (Total: $TOTAL, Completed: $COMPLETED)"
  
  if [ "$STATUS" = "scraping" ]; then
    echo "Waiting 5 seconds before next check..."
    sleep 5
    ATTEMPT=$((ATTEMPT + 1))
  fi
done

echo "Final status response: $STATUS_RESPONSE"

echo ""
echo "🎉 Test completed!"
echo ""
echo "Check the wrangler dev terminal for logs and any error messages."