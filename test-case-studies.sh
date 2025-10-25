#!/bin/bash

BASE_URL="http://localhost:8787"

echo "=========================================="
echo "FLARE-1 Case Studies Extraction Test"
echo "=========================================="
echo ""

# Create JSON payload
cat > /tmp/flare1-case-studies.json << 'EOF'
{
  "urls": ["https://joshuakaufman.ai"],
  "agent": {
    "model": "FLARE-1",
    "prompt": "Navigate to the case studies page on this website. Then extract all case studies found. For each case study, extract: title, description, client name, and any key results or metrics mentioned.",
    "maxSteps": 20,
    "maxSeconds": 120
  },
  "schema": {
    "type": "object",
    "properties": {
      "caseStudies": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "client": {"type": "string"},
            "results": {"type": "string"}
          },
          "required": ["title"]
        }
      }
    },
    "required": ["caseStudies"]
  }
}
EOF

# Start job
echo "Starting extraction job..."
RESPONSE=$(curl -s -X POST "$BASE_URL/v2/extract" \
  -H "Content-Type: application/json" \
  -d @/tmp/flare1-case-studies.json)

echo "Response: $RESPONSE"
echo ""

JOB_ID=$(echo $RESPONSE | jq -r '.id')

if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
  echo "❌ Failed to start job"
  echo "Error: $RESPONSE"
  rm /tmp/flare1-case-studies.json
  exit 1
fi

echo "✅ Job ID: $JOB_ID"
echo "Polling for results..."
echo ""

# Poll for completion
for i in {1..40}; do
  sleep 3
  
  STATUS_RESPONSE=$(curl -s "$BASE_URL/v2/extract/$JOB_ID")
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
  
  echo "[$i] Status: $STATUS"
  
  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "✅ COMPLETED!"
    echo ""
    echo "Full Response:"
    echo $STATUS_RESPONSE | jq '.'
    echo ""
    echo "Extracted Case Studies:"
    echo $STATUS_RESPONSE | jq '.data.caseStudies'
    rm /tmp/flare1-case-studies.json
    exit 0
  elif [ "$STATUS" = "failed" ]; then
    echo ""
    echo "❌ FAILED"
    echo ""
    echo $STATUS_RESPONSE | jq '.'
    rm /tmp/flare1-case-studies.json
    exit 1
  fi
done

echo ""
echo "⏰ Timeout waiting for completion"
echo "Last status: $STATUS"
rm /tmp/flare1-case-studies.json