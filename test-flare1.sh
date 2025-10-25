#!/bin/bash

# FLARE-1 Test Script
# Tests the FLARE-1 agent mode for Fireflare

BASE_URL="http://localhost:8787"

echo "=========================================="
echo "FLARE-1 Agent Mode Tests"
echo "=========================================="
echo ""

# Test 1: Simple scrape with FLARE-1
echo "Test 1: Simple scrape with FLARE-1 agent"
echo "------------------------------------------"
curl -X POST "$BASE_URL/v2/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract the main heading and first paragraph from this page"
    }
  }' | jq '.'

echo -e "\n\n"

# Test 2: Extract with schema using FLARE-1
echo "Test 2: Extract with schema using FLARE-1"
echo "------------------------------------------"
curl -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract website information"
    },
    "schema": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "mainContent": {"type": "string"}
      },
      "required": ["title"]
    }
  }' | jq '.'

echo -e "\n\n"

# Test 3: Multi-URL extraction with FLARE-1
echo "Test 3: Multi-URL extraction with aggregation"
echo "------------------------------------------"
curl -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com",
      "https://example.org"
    ],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract and compare the main content from these pages",
      "maxSteps": 30
    }
  }' | jq '.'

echo -e "\n\n"

# Test 4: FLARE-1 with custom max steps and timeout
echo "Test 4: FLARE-1 with custom limits"
echo "------------------------------------------"
curl -X POST "$BASE_URL/v2/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://news.ycombinator.com",
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract the top 5 story titles",
      "maxSteps": 10,
      "maxSeconds": 60
    }
  }' | jq '.'

echo -e "\n\n"

# Test 5: FLARE-1 with complex schema
echo "Test 5: FLARE-1 with complex schema"
echo "------------------------------------------"
curl -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://github.com/cloudflare/workers-sdk"],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract repository information"
    },
    "schema": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "stars": {"type": "number"},
        "language": {"type": "string"},
        "topics": {
          "type": "array",
          "items": {"type": "string"}
        }
      }
    }
  }' | jq '.'

echo -e "\n\n"
echo "=========================================="
echo "All FLARE-1 tests completed!"
echo "=========================================="