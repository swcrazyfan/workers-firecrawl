#!/bin/bash

echo "🚀 Starting Firecrawl Crawl Endpoint Deployment"

# Step 1: Run database migrations
echo "📊 Step 1: Creating database tables..."
npx wrangler d1 execute workers-firecrawl --file=./migrations.sql --remote

if [ $? -ne 0 ]; then
    echo "❌ Database migration failed!"
    exit 1
fi

echo "✅ Database tables created successfully!"

# Step 2: Deploy the worker
echo "🌐 Step 2: Deploying the worker..."
npx wrangler deploy

if [ $? -ne 0 ]; then
    echo "❌ Worker deployment failed!"
    exit 1
fi

echo "✅ Worker deployed successfully!"

# Step 3: Test the deployment
echo "🧪 Step 3: Testing the deployment..."

# Get the worker URL from wrangler.toml or use a default
WORKER_URL="https://workers-firecrawl.joshua-55c.workers.dev"

echo "Testing the crawl endpoint at $WORKER_URL/v2/crawl..."

# Test crawl endpoint
echo "Starting a test crawl..."
CRAWL_RESPONSE=$(curl -s -X POST "$WORKER_URL/v2/crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.firecrawl.dev",
    "limit": 2,
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

# Wait a moment for processing
echo "⏳ Waiting 5 seconds for processing..."
sleep 5

# Check crawl status
echo "Checking crawl status..."
STATUS_RESPONSE=$(curl -s -X GET "$WORKER_URL/v2/crawl/$JOB_ID")
echo "Status response: $STATUS_RESPONSE"

echo "🎉 Deployment completed successfully!"
echo ""
echo "Your crawl endpoint is now live at: $WORKER_URL/v2/crawl"
echo ""
echo "Example usage:"
echo "curl -X POST \"$WORKER_URL/v2/crawl\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"url\": \"https://example.com\", \"limit\": 10}'"
echo ""
echo "Check status with:"
echo "curl -X GET \"$WORKER_URL/v2/crawl/YOUR_JOB_ID\""