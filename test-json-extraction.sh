#!/bin/bash

# Test script for Phase 2: JSON Extraction in /scrape endpoint
# This script tests schema-based, prompt-based, and mixed format extraction

# Colors for output
GREEN='\033[0.32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
WORKER_URL="${WORKER_URL:-https://workers-firecrawl.joshua-55c.workers.dev}"
API_KEY="${API_KEY:-76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6}"

echo "========================================="
echo "Phase 2: JSON Extraction Tests"
echo "========================================="
echo "Worker URL: $WORKER_URL"
echo ""

# Test 1: Schema-based extraction
echo -e "${YELLOW}Test 1: Schema-based JSON extraction${NC}"
echo "Extracting title and description from a webpage using JSON schema..."
curl -X POST "$WORKER_URL/v2/scrape" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "json",
      "schema": {
        "type": "object",
        "properties": {
          "title": {"type": "string"},
          "description": {"type": "string"},
          "mainHeading": {"type": "string"}
        },
        "required": ["title"]
      }
    }]
  }' | jq '.'

echo ""
echo "---"
echo ""

# Test 2: Prompt-based extraction
echo -e "${YELLOW}Test 2: Prompt-based JSON extraction${NC}"
echo "Extracting data using natural language prompt..."
curl -X POST "$WORKER_URL/v2/scrape" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "json",
      "prompt": "Extract the page title, main heading, and a brief summary of the content"
    }]
  }' | jq '.'

echo ""
echo "---"
echo ""

# Test 3: Mixed formats (markdown + JSON)
echo -e "${YELLOW}Test 3: Mixed formats (markdown + JSON)${NC}"
echo "Requesting both markdown and JSON extraction..."
curl -X POST "$WORKER_URL/v2/scrape" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [
      "markdown",
      {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "title": {"type": "string"},
            "hasExamples": {"type": "boolean"}
          }
        }
      }
    ]
  }' | jq '.'

echo ""
echo "---"
echo ""

# Test 4: Complex schema extraction
echo -e "${YELLOW}Test 4: Complex schema with nested objects${NC}"
echo "Testing extraction with complex nested schema..."
curl -X POST "$WORKER_URL/v2/scrape" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://news.ycombinator.com",
    "formats": [{
      "type": "json",
      "schema": {
        "type": "object",
        "properties": {
          "siteName": {"type": "string"},
          "topStories": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "title": {"type": "string"},
                "points": {"type": "number"}
              }
            }
          }
        },
        "required": ["siteName"]
      }
    }]
  }' | jq '.'

echo ""
echo "---"
echo ""

# Test 5: Schema with prompt guidance
echo -e "${YELLOW}Test 5: Schema with additional prompt guidance${NC}"
echo "Using both schema and prompt for better extraction..."
curl -X POST "$WORKER_URL/v2/scrape" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "json",
      "schema": {
        "type": "object",
        "properties": {
          "pageType": {"type": "string"},
          "keyPoints": {
            "type": "array",
            "items": {"type": "string"}
          }
        }
      },
      "prompt": "Identify the type of page (e.g., homepage, article, product) and extract 3-5 key points from the content"
    }]
  }' | jq '.'

echo ""
echo "---"
echo ""

# Test 6: Error handling - invalid schema
echo -e "${YELLOW}Test 6: Error handling with missing required fields${NC}"
echo "Testing graceful degradation when extraction fails..."
curl -X POST "$WORKER_URL/v2/scrape" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [
      "markdown",
      {
        "type": "json",
        "schema": {
          "type": "object",
          "properties": {
            "nonExistentField": {"type": "string"}
          },
          "required": ["nonExistentField"]
        }
      }
    ]
  }' | jq '.'

echo ""
echo "========================================="
echo -e "${GREEN}All tests completed!${NC}"
echo "========================================="
echo ""
echo "Expected results:"
echo "- Tests 1-5 should return JSON data in the 'data.json' field"
echo "- Test 6 should return markdown but may have a warning about JSON extraction"
echo "- All tests should return success: true"
echo ""