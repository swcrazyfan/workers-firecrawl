#!/usr/bin/env bash
# smoke.sh — post-deploy smoke test for workers-firecrawl.
#
# Exercises the deployed (or locally running) API and prints PASS/FAIL per
# check. Exits non-zero if any check fails.
#
# Usage:
#   scripts/smoke.sh [BASE_URL]
#
# Environment:
#   SMOKE_BASE_URL      overrides the positional BASE_URL
#   AUTHORIZATION_KEY   optional bearer token; when set, requests carry it and a
#                       request without it must be rejected (HTTP 401)
#
# Defaults to http://localhost:8787. The DDG news source can be blocked from
# Workers egress, so that check tolerates either news results or a warning.
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-${1:-http://localhost:8787}}"
BASE_URL="${BASE_URL%/}"
AUTHORIZATION_KEY="${AUTHORIZATION_KEY:-}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf -- "$TMPDIR"' EXIT

BODY_FILE="$TMPDIR/response.json"
HTTP_STATUS=""
CHECKS=0
FAILURES=0

pass() { CHECKS=$((CHECKS + 1)); echo "PASS: $1"; }
fail() {
	CHECKS=$((CHECKS + 1))
	FAILURES=$((FAILURES + 1))
	echo "FAIL: $1" >&2
	if [[ -s "$BODY_FILE" ]]; then
		echo "      body: $(cut -c1-300 <"$BODY_FILE")" >&2
	fi
}

# send <method> <path> <json-body-or-empty> <use-auth:0|1>
# Sets the globals HTTP_STATUS and BODY_FILE.
send() {
	local method="$1" path="$2" body="$3" auth="$4"
	local -a args=(-sS --max-time 90 -o "$BODY_FILE" -w '%{http_code}' -X "$method")
	if [[ "$method" == "POST" ]]; then
		args+=(-H "Content-Type: application/json")
	fi
	if [[ "$auth" == "1" && -n "$AUTHORIZATION_KEY" ]]; then
		args+=(-H "Authorization: Bearer ${AUTHORIZATION_KEY}")
	fi
	if [[ -n "$body" ]]; then
		args+=(--data "$body")
	fi
	: >"$BODY_FILE"
	HTTP_STATUS="$(curl "${args[@]}" "${BASE_URL}${path}" 2>/dev/null || true)"
}

# expect_status <label> <expected-code>
expect_status() {
	local label="$1" expected="$2"
	if [[ "$HTTP_STATUS" == "$expected" ]]; then
		pass "$label (HTTP $HTTP_STATUS)"
		return 0
	fi
	fail "$label: expected HTTP $expected, got $HTTP_STATUS"
	return 1
}

# expect_json <label> <python-code>
# The code receives the response body path as sys.argv[1] and must assert; any
# stdout it prints is appended to the PASS line.
expect_json() {
	local label="$1" code="$2" out msg
	if out="$(python3 -c "$code" "$BODY_FILE" 2>&1)"; then
		pass "$label${out:+ [$out]}"
	else
		msg="$(printf '%s\n' "$out" | tail -n1)"
		fail "$label: ${msg//$'\n'/ }"
	fi
}

echo "smoke: target ${BASE_URL}$([[ -n "$AUTHORIZATION_KEY" ]] && echo " (auth enabled)")"

# 1. Scrape markdown.
send POST /v2/scrape '{"url":"https://example.com","formats":["markdown"]}' 1
if expect_status "scrape markdown: HTTP 200" 200; then
	expect_json "scrape markdown: success, non-empty data.markdown, metadata.sourceURL" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
data = d.get("data") or {}
md = data.get("markdown")
assert isinstance(md, str) and md.strip(), "data.markdown is empty"
meta = data.get("metadata") or {}
assert meta.get("sourceURL"), "data.metadata.sourceURL missing"
print("markdown %d chars" % len(md))
'
fi

# 2. Scrape summary (AI may be unconfigured).
send POST /v2/scrape '{"url":"https://example.com","formats":[{"type":"summary"}]}' 1
if expect_status "scrape summary: HTTP 200" 200; then
	expect_json "scrape summary: data.summary or data.warning present" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
data = d.get("data") or {}
summary = data.get("summary")
warning = data.get("warning")
has_summary = isinstance(summary, str) and summary.strip()
has_warning = isinstance(warning, str) and warning.strip()
assert has_summary or has_warning, "neither data.summary nor data.warning present"
print("summary present" if has_summary else "warning: %s" % warning[:100])
'
fi

# 3. Search web (grouped envelope; never a flat array).
send POST /v2/search '{"query":"cloudflare workers","limit":3}' 1
if expect_status "search web: HTTP 200" 200; then
	expect_json "search web: data is an object with a web array" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
data = d.get("data")
assert isinstance(data, dict), "data is not an object (v2 is grouped)"
web = data.get("web")
assert isinstance(web, list), "data.web is missing or not an array"
print("%d web results" % len(web))
'
fi

# 4. Search news (DDG news may be blocked from Workers egress).
send POST /v2/search '{"query":"cloudflare workers","limit":3,"sources":["news"]}' 1
if expect_status "search news: HTTP 200" 200; then
	expect_json "search news: news results or a warning" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
data = d.get("data") or {}
news = data.get("news")
warning = d.get("warning")
if isinstance(news, list) and news:
    print("%d news results" % len(news))
elif isinstance(warning, str) and warning.strip():
    print("no news results; warning: %s" % warning[:120])
else:
    raise SystemExit("neither news results nor warning")
'
fi

# 5. Map (links must be an array of objects, not strings).
send POST /v2/map '{"url":"https://example.com"}' 1
if expect_status "map: HTTP 200" 200; then
	expect_json "map: links is a non-empty array of objects" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
links = d.get("links")
assert isinstance(links, list) and links, "links is not a non-empty array"
assert all(isinstance(x, dict) for x in links), "links is not an array of objects"
print("%d links" % len(links))
'
fi

# 6. Crawl: start a small job and poll to a terminal status.
CRAWL_ID=""
send POST /v2/crawl '{"url":"https://example.com","limit":2}' 1
if expect_status "crawl create: HTTP 200" 200; then
	expect_json "crawl create: top-level success, id, url" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
assert isinstance(d.get("id"), str) and d["id"], "top-level id missing"
assert isinstance(d.get("url"), str) and d["url"], "top-level url missing"
print("id=%s" % d["id"])
'
	CRAWL_ID="$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("id", ""))
except Exception:
    print("")
' "$BODY_FILE" 2>/dev/null || true)"
fi

if [[ -n "$CRAWL_ID" ]]; then
	deadline=$((SECONDS + 60))
	crawl_status=""
	while :; do
		send GET "/v2/crawl/${CRAWL_ID}" "" 1
		crawl_status="$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("status", ""))
except Exception:
    print("")
' "$BODY_FILE" 2>/dev/null || true)"
		case "$crawl_status" in
		completed | failed | cancelled) break ;;
		esac
		if ((SECONDS >= deadline)); then break; fi
		sleep 3
	done

	if expect_status "crawl status: HTTP 200" 200; then
		expect_json "crawl status: terminal status enum + counters" '
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("success") is True, "success is not true"
s = d.get("status")
assert s in ("scraping", "completed", "failed", "cancelled"), "unexpected status %r" % s
assert s != "scraping", "job did not reach a terminal status within 60s"
print("status=%s total=%s completed=%s" % (s, d.get("total"), d.get("completed")))
'
	fi
else
	fail "crawl: no job id returned, skipping poll"
fi

# 7. Auth: with the key set, a request without it must be rejected.
if [[ -n "$AUTHORIZATION_KEY" ]]; then
	send POST /v2/search '{"query":"auth probe","limit":1}' 0
	if [[ "$HTTP_STATUS" == "401" ]]; then
		pass "auth: unauthenticated request rejected (HTTP 401)"
	else
		fail "auth: expected HTTP 401 without the bearer token, got $HTTP_STATUS"
	fi
else
	echo "SKIP: auth check (AUTHORIZATION_KEY not set; the API is open)"
fi

echo
if ((FAILURES > 0)); then
	echo "smoke: ${FAILURES} of ${CHECKS} checks failed against ${BASE_URL}" >&2
	exit 1
fi
echo "smoke: all ${CHECKS} checks passed against ${BASE_URL}"
