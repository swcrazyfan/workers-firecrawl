#!/bin/bash

# Simple FLARE-1 async test
BASE_URL="http://localhost:8787"

echo "Testing FLARE-1 async with /v2/extract..."
echo ""

# Start job
echo "1. Starting extraction job..."
RESPONSE=$(curl -s -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Extract the main heading and first paragraph"
    },
    "schema": {
      "type": "object",
      "properties": {
        "heading": {"type": "string"},
        "paragraph": {"type": "string"}
      }
    }
  }')

echo "Response: $RESPONSE"
echo ""

# Extract job ID
JOB_ID=$(echo $RESPONSE | jq -r '.id')

if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
  echo "❌ Failed to start job"
  exit 1
fi

echo "✅ Job started: $JOB_ID"
echo ""

# Poll for completion
echo "2. Polling for results..."
for i in {1..30}; do
  sleep 2
  
  STATUS_RESPONSE=$(curl -s "$BASE_URL/v2/extract/$JOB_ID")
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
  
  echo "[$i] Status: $STATUS"
  
  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "✅ Job completed!"
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    exit 0
  elif [ "$STATUS" = "failed" ]; then
    echo ""
    echo "❌ Job failed"
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    exit 1
  fi
done

echo ""
echo "⏰ Polling timeout"