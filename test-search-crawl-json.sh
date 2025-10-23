#!/bin/bash

# Test script for JSON extraction in search and crawl endpoints
# Usage: ./test-search-crawl-json.sh

# Configuration
WORKER_URL="${WORKER_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-test-key}"

echo "Testing JSON Extraction in Search and Crawl Endpoints"
echo "======================================================"
echo "Worker URL: $WORKER_URL"
echo ""

# Test 1: Search with JSON extraction (prompt-based)
echo "Test 1: Search with JSON extraction (prompt-based)"
echo "---------------------------------------------------"
curl -X POST "$WORKER_URL/v2/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cloudflare workers",
    "limit": 2,
    "scrapeOptions": {
      "formats": ["markdown", {
        "type": "json",
        "prompt": "Extract the page title and main description"
      }]
    }
  }' | jq '.'

echo -e "\n\n"

# Test 2: Search with JSON extraction (schema-based)
echo "Test 2: Search with JSON extraction (schema-based)"
echo "---------------------------------------------------"
curl -X POST "$WORKER_URL/v2/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "web scraping",
    "limit": 2,
    "scrapeOptions": {
      "formats": [{
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "main_topic": {"type": "string"}
          },
          "required": ["title"]
        }
      }]
    }
  }' | jq '.'

echo -e "\n\n"

# Test 3: News search with JSON extraction
echo "Test 3: News search with JSON extraction"
echo "---------------------------------------------------"
curl -X POST "$WORKER_URL/v2/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "artificial intelligence",
    "limit": 2,
    "sources": ["news"],
    "scrapeOptions": {
      "formats": [{
        "type": "json",
        "prompt": "Extract the article headline, summary, and publication date"
      }]
    }
  }' | jq '.'

echo -e "\n\n"

# Test 4: Start crawl with JSON extraction
echo "Test 4: Start crawl with JSON extraction"
echo "---------------------------------------------------"
CRAWL_RESPONSE=$(curl -s -X POST "$WORKER_URL/v2/crawl" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "limit": 2,
    "scrapeOptions": {
      "formats": ["markdown", {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "page_title": {"type": "string"},
            "main_content": {"type": "string"}
          }
        }
      }]
    }
  }')

echo "$CRAWL_RESPONSE" | jq '.'
CRAWL_ID=$(echo "$CRAWL_RESPONSE" | jq -r '.id')

echo -e "\n\n"

# Test 5: Check crawl status (wait a bit for processing)
echo "Test 5: Check crawl status (waiting 5 seconds for processing)"
echo "---------------------------------------------------"
sleep 5

curl -X GET "$WORKER_URL/v2/crawl/$CRAWL_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.'

echo -e "\n\n"
echo "Tests completed!"