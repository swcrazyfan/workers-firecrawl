#!/bin/bash

# Test FLARE-1 with YouTube channel navigation
# Goal: Navigate to Videos tab and extract 5 n8n video titles

BASE_URL="http://localhost:8787"

echo "=========================================="
echo "FLARE-1 YouTube Test: Extract n8n Videos"
echo "=========================================="
echo ""

curl -v -X POST "$BASE_URL/v2/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/@nicksaraev/featured",
    "agent": {
      "model": "FLARE-1",
      "prompt": "Click on the Videos tab. Then extract the first 25 videos you see. For each video, get the complete YouTube URL (https://www.youtube.com/watch?v=VIDEO_ID), title, views, and upload date. Only include videos that have 'n8n' in the title. If you find fewer than 5 n8n videos in the first 25, return what you found.",
      "maxSteps": 15,
      "maxSeconds": 90
    },
    "formats": [
      {
        "type": "json",
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
      }
    ]
  }' | jq '.'

echo ""
echo "=========================================="
echo "Test completed!"
echo "=========================================="