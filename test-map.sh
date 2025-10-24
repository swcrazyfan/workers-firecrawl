#!/bin/bash

# Test script for the /v2/map endpoint
# Make sure the development server is running on localhost:8787

BASE_URL="http://localhost:8787"
AUTH_HEADER="Authorization: Bearer test-key"

echo "🗺️  Testing Fireflare Map Endpoint"
echo "================================="

# Function to run a test and check response
run_test() {
    local test_name="$1"
    local request_body="$2"
    local expected_field="$3"
    
    echo ""
    echo "📋 Test: $test_name"
    echo "Request: $request_body"
    echo "---"
    
    response=$(curl -s -X POST "$BASE_URL/v2/map" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "$request_body")
    
    # Check if response contains success field
    if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
        success=$(echo "$response" | jq -r '.success')
        if [ "$success" = "true" ]; then
            echo "✅ Success: $test_name"
            
            # Count links
            link_count=$(echo "$response" | jq '.links | length')
            echo "📊 Found $link_count links"
            
            # Show first few links as examples
            if [ "$link_count" -gt 0 ]; then
                echo "🔗 Sample links:"
                echo "$response" | jq -r '.links[:3] | .[] | "  - \(.url) (\(.title // "No title"))"'
            fi
            
            # Check for expected field if provided
            if [ -n "$expected_field" ]; then
                has_field=$(echo "$response" | jq -r ".links[0].$expected_field // empty")
                if [ -n "$has_field" ]; then
                    echo "✅ Contains $expected_field field"
                else
                    echo "⚠️  Missing $expected_field field (optional)"
                fi
            fi
        else
            echo "❌ Failed: $test_name"
            error_msg=$(echo "$response" | jq -r '.error // "Unknown error"')
            echo "Error: $error_msg"
        fi
    else
        echo "❌ Invalid response format for: $test_name"
        echo "Response: $response"
    fi
}

# Function to test error cases
run_error_test() {
    local test_name="$1"
    local request_body="$2"
    local expected_status="$3"
    
    echo ""
    echo "📋 Error Test: $test_name"
    echo "Request: $request_body"
    echo "---"
    
    response=$(curl -s -w "%{http_code}" -X POST "$BASE_URL/v2/map" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "$request_body")
    
    # Extract status code (last 3 characters)
    status_code="${response: -3}"
    response_body="${response%???}"
    
    if [ "$status_code" = "$expected_status" ]; then
        echo "✅ Correctly returned $status_code error"
        if echo "$response_body" | jq -e '.error' > /dev/null 2>&1; then
            error_msg=$(echo "$response_body" | jq -r '.error')
            echo "Error message: $error_msg"
        fi
    else
        echo "❌ Expected $expected_status, got $status_code"
        echo "Response: $response_body"
    fi
}

echo "🔧 Basic functionality tests"

# Test 1: Basic map request
run_test "Basic map request" '{"url": "https://www.cloudflare.com", "limit": 10}' "title"

# Test 2: Sitemap only mode
run_test "Sitemap only mode" '{"url": "https://www.cloudflare.com", "sitemap": "only", "limit": 20}' "url"

# Test 3: Skip sitemap mode
run_test "Skip sitemap mode" '{"url": "https://joshuakaufmann.ai", "sitemap": "skip", "limit": 10}' "url"

# Test 4: Default sitemap mode (include)
run_test "Default sitemap mode" '{"url": "https://www.cloudflare.com", "limit": 15}' "url"

echo ""
echo "🔍 Search filtering tests"

# Test 5: Search filtering
run_test "Search filtering" '{"url": "https://firecrawl.dev", "search": "blog", "limit": 10}' "url"

# Test 6: Search with non-existent term
run_test "Search with no results" '{"url": "https://firecrawl.dev", "search": "nonexistentterm12345", "limit": 5}' "url"

echo ""
echo "⚙️  Advanced options tests"

# Test 7: Subdomain filtering
run_test "Exclude subdomains" '{"url": "https://cloudflare.com", "includeSubdomains": false, "limit": 20}' "url"

# Test 8: Query parameter filtering
run_test "Ignore query parameters" '{"url": "https://example.com", "ignoreQueryParameters": true, "limit": 10}' "url"

# Test 9: Custom limit
run_test "Custom limit" '{"url": "https://www.cloudflare.com", "limit": 5}' "url"

echo ""
echo "❌ Error handling tests"

# Test 10: Invalid URL
run_error_test "Invalid URL" '{"url": "not-a-valid-url", "limit": 10}' "400"

# Test 11: Missing URL
run_error_test "Missing URL" '{"limit": 10}' "400"

# Test 12: Invalid sitemap mode
run_error_test "Invalid sitemap mode" '{"url": "https://example.com", "sitemap": "invalid"}' "400"

# Test 13: Limit too high
run_error_test "Limit too high" '{"url": "https://example.com", "limit": 200000}' "400"

echo ""
echo "🏁 Testing complete!"
echo ""
echo "📝 Notes:"
echo "- Some tests may show 'Missing title/description field' warnings - this is normal"
echo "- Metadata extraction is lightweight and may not always find title/description"
echo "- Search filtering uses simple keyword matching in URL paths"
echo "- Sitemap availability varies by website"
echo ""
echo "🚀 If all tests pass, the Map endpoint is working correctly!"