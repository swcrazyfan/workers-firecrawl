#!/bin/bash

BASE_URL="http://localhost:8787"

echo "=========================================="
echo "FLARE-1 YouTube n8n Test (Async)"
echo "=========================================="
echo ""

# Create JSON payload in a file to avoid escaping issues
cat > /tmp/flare1-payload.json << 'EOF'
{
  "urls": ["https://www.youtube.com/@nicksaraev/videos"],
  "agent": {
    "model": "FLARE-1",
    "prompt": "Read the video list on this page and extract metadata for the first 20 videos. Do not click on any videos. Extract: title, URL, views, and upload date for each video visible on the current page.",
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
          }
        }
      }
    }
  }
}
EOF

# Start job
echo "Starting job..."
RESPONSE=$(curl -s -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d @/tmp/flare1-payload.json)

echo "Response: $RESPONSE"
echo ""

JOB_ID=$(echo $RESPONSE | jq -r '.id')

if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
  echo "❌ Failed to start job"
  exit 1
fi

echo "✅ Job ID: $JOB_ID"
echo "Polling for results..."
echo ""

# Poll
for i in {1..60}; do
  sleep 3
  
  STATUS_RESPONSE=$(curl -s "$BASE_URL/v2/extract/$JOB_ID")
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
  
  echo "[$i] Status: $STATUS"
  
  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "✅ COMPLETED!"
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    rm /tmp/flare1-payload.json
    exit 0
  elif [ "$STATUS" = "failed" ]; then
    echo ""
    echo "❌ FAILED"
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    rm /tmp/flare1-payload.json
    exit 1
  fi
done

echo "⏰ Timeout"
rm /tmp/flare1-payload.json