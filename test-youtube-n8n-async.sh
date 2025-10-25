#!/bin/bash

# Test FLARE-1 with YouTube channel navigation (ASYNC)
# Uses /v2/extract endpoint which supports async jobs
# Goal: Navigate to Videos tab and extract 5 n8n video titles

BASE_URL="http://localhost:8787"

echo "=========================================="
echo "FLARE-1 YouTube Test (Async): Extract n8n Videos"
echo "=========================================="
echo ""

# Start the extraction job
echo "Starting FLARE-1 extraction job..."
RESPONSE=$(curl -s -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://www.youtube.com/@nicksaraev/featured"],
    "agent": {
      "model": "FLARE-1",
      "prompt": "Click on the Videos tab. Then extract the first 25 videos you see. For each video, get the complete YouTube URL (https://www.youtube.com/watch?v=VIDEO_ID), title, views, and upload date. Only include videos that have n8n in the title. If you find fewer than 5 n8n videos in the first 25, return what you found.",
      "maxSteps": 15,
      "maxSeconds": 90
    },
    "schema": {
      "type": "object",
      "properties": {
        "videos": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": {"type": "string"},
              "url": {"type": "string"},
              "views": {"type": "string"},
              "uploadDate": {"type": "string"}
            },
            "required": ["title"]
          },
          "maxItems": 5
        }
      },
      "required": ["videos"]
    }
  }')

echo "Response: $RESPONSE"
echo ""

# Extract job ID
JOB_ID=$(echo $RESPONSE | jq -r '.id')

if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
  echo "❌ Failed to start job"
  echo $RESPONSE | jq '.'
  exit 1
fi

echo "✅ Job started: $JOB_ID"
echo "Polling for results..."
echo ""

# Poll for completion
MAX_ATTEMPTS=60  # 2 minutes max (2 second intervals)
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  
  # Check status
  STATUS_RESPONSE=$(curl -s "$BASE_URL/v2/extract/$JOB_ID")
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
  
  echo "[$ATTEMPT] Status: $STATUS"
  
  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "=========================================="
    echo "✅ Job completed successfully!"
    echo "=========================================="
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    break
  elif [ "$STATUS" = "failed" ]; then
    echo ""
    echo "=========================================="
    echo "❌ Job failed"
    echo "=========================================="
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    exit 1
  fi
  
  # Wait before next poll
  sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo ""
  echo "=========================================="
  echo "⏰ Polling timeout - job still processing"
  echo "=========================================="
  echo ""
  echo "Check status manually:"
  echo "curl $BASE_URL/v2/extract/$JOB_ID | jq '.'"
fi

echo ""
echo "=========================================="
echo "Test completed!"
echo "=========================================="