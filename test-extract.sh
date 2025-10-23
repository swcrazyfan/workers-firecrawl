#!/bin/bash

# Test script for Phase 5: Extract Endpoint
# Tests extraction from single and multiple URLs

# Configuration
WORKER_URL="${WORKER_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-76b8950bba6df685bf1b288ad1d2848b8e634a64d785801cd1d2892648f851a6}"

echo "================================"
echo "Phase 5: Extract Endpoint Tests"
echo "================================"
echo ""

# Test 1: Single URL extraction with schema
echo "Test 1: Single URL with Schema"
echo "-------------------------------"
RESPONSE=$(curl -s -X POST "${WORKER_URL}/v2/extract" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://blog.cloudflare.com"],
    "prompt": "Extract the site information",
    "schema": {
      "type": "object",
      "properties": {
        "siteName": {"type": "string"},
        "description": {"type": "string"},
        "mainTopics": {"type": "array", "items": {"type": "string"}}
      },
      "required": ["siteName"]
    }
  }')

echo "$RESPONSE" | jq '.'
JOB_ID=$(echo "$RESPONSE" | jq -r '.id')
echo "Job ID: $JOB_ID"

# Wait for job to complete
echo "Waiting for extraction to complete..."
sleep 5

# Check status
echo -e "\nChecking extraction status..."
curl -s -X GET "${WORKER_URL}/v2/extract/${JOB_ID}" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.'

echo -e "\n\n"

# Test 2: Multiple URLs extraction
echo "Test 2: Multiple URLs Extraction"
echo "---------------------------------"
RESPONSE=$(curl -s -X POST "${WORKER_URL}/v2/extract" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://blog.cloudflare.com",
      "https://www.cloudflare.com"
    ],
    "prompt": "Extract the company name and main purpose",
    "schema": {
      "type": "object",
      "properties": {
        "companyName": {"type": "string"},
        "purpose": {"type": "string"}
      }
    }
  }')

echo "$RESPONSE" | jq '.'
JOB_ID=$(echo "$RESPONSE" | jq -r '.id')

sleep 8

echo -e "\nChecking status..."
curl -s -X GET "${WORKER_URL}/v2/extract/${JOB_ID}" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.'

echo -e "\n\n"

# Test 3: Prompt-only extraction (no schema)
echo "Test 3: Prompt-Only Extraction"
echo "-------------------------------"
RESPONSE=$(curl -s -X POST "${WORKER_URL}/v2/extract" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://blog.cloudflare.com"],
    "prompt": "Extract the main topics covered in recent blog posts"
  }')

echo "$RESPONSE" | jq '.'
JOB_ID=$(echo "$RESPONSE" | jq -r '.id')

sleep 5

echo -e "\nChecking status..."
curl -s -X GET "${WORKER_URL}/v2/extract/${JOB_ID}" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.'

echo -e "\n\n"

# Test 4: Extract with web search enabled
echo "Test 4: Extract with Web Search"
echo "--------------------------------"
RESPONSE=$(curl -s -X POST "${WORKER_URL}/v2/extract" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://www.cloudflare.com"],
    "prompt": "Extract information about Cloudflare products and services",
    "enableWebSearch": true,
    "schema": {
      "type": "object",
      "properties": {
        "products": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "category": {"type": "string"}
            }
          }
        }
      }
    }
  }')

echo "$RESPONSE" | jq '.'
JOB_ID=$(echo "$RESPONSE" | jq -r '.id')

sleep 10

echo -e "\nChecking status..."
curl -s -X GET "${WORKER_URL}/v2/extract/${JOB_ID}" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.data.products[0:3]'

echo -e "\n\n"

echo "================================"
echo "All extract tests completed!"
echo "================================"