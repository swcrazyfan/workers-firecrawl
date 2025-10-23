#!/bin/bash

# Test script for Phase 4: Content Summarization
# Tests various summarization options

# Configuration
WORKER_URL="${WORKER_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6}"

echo "================================"
echo "Phase 4: Summarization Tests"
echo "================================"
echo ""

# Test 1: Basic summary (concise)
echo "Test 1: Basic Concise Summary"
echo "------------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": ["markdown", "summary"]
  }' | jq '{success, data: {summary: .data.summary, wordCount: (.data.summary // "" | split(" ") | length)}}'

echo -e "\n\n"

# Test 2: Detailed summary
echo "Test 2: Detailed Summary"
echo "------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": ["markdown", {
      "type": "summary",
      "maxLength": 500,
      "summaryType": "detailed",
      "tone": "formal"
    }]
  }' | jq '{success, data: {summary: .data.summary, wordCount: (.data.summary // "" | split(" ") | length)}}'

echo -e "\n\n"

# Test 3: Bullet point summary
echo "Test 3: Bullet Point Summary"
echo "----------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": [{
      "type": "summary",
      "summaryType": "bullets",
      "tone": "neutral"
    }]
  }' | jq '{success, data: {summary: .data.summary}}'

echo -e "\n\n"

# Test 4: Technical summary with focus
echo "Test 4: Technical Summary with Focus"
echo "------------------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": [{
      "type": "summary",
      "maxLength": 300,
      "summaryType": "concise",
      "tone": "technical",
      "focus": "technical innovations and performance improvements"
    }]
  }' | jq '{success, data: {summary: .data.summary}}'

echo -e "\n\n"

# Test 5: Summary with JSON extraction
echo "Test 5: Summary + JSON Extraction"
echo "----------------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": [
      "summary",
      {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "siteName": {"type": "string"},
            "mainTopic": {"type": "string"}
          }
        }
      }
    ]
  }' | jq '{success, data: {summary: .data.summary, json: .data.json}}'

echo -e "\n\n"

# Test 6: Custom language summary
echo "Test 6: Custom Language Summary (Spanish)"
echo "-----------------------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://blog.cloudflare.com",
    "formats": [{
      "type": "summary",
      "maxLength": 200,
      "summaryType": "concise",
      "language": "Spanish"
    }]
  }' | jq '{success, data: {summary: .data.summary}}'

echo -e "\n\n"

# Test 7: Error handling - content too short
echo "Test 7: Error Handling - Short Content"
echo "--------------------------------------"
curl -X POST "${WORKER_URL}/v2/scrape" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["summary"]
  }' | jq '{success, data: {summary: .data.summary, warning: .data.warning}}'

echo -e "\n\n"

echo "================================"
echo "All summarization tests completed!"
echo "================================"