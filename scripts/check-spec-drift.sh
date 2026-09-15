#!/usr/bin/env bash
# check-spec-drift.sh — compare the vendored Firecrawl v2 OpenAPI spec against the live one.
# Default: exit 0 if identical, exit 1 with a short summary if drifted.
# --update: overwrite spec/v2-openapi.json with the normalized live spec instead of diffing.
set -euo pipefail
cd "$(dirname "$0")/.."

SPEC_URL="https://docs.firecrawl.dev/api-reference/v2-openapi.json"
FALLBACK_CACHE="/tmp/fcresearch/v2-openapi.json"
VENDORED="spec/v2-openapi.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! curl -fsSL --max-time 90 "$SPEC_URL" -o "$TMP"; then
	if [[ -f "$FALLBACK_CACHE" ]]; then
		echo "warning: live fetch failed, using cached copy at $FALLBACK_CACHE" >&2
		cp "$FALLBACK_CACHE" "$TMP"
	else
		echo "error: live fetch failed and no cache at $FALLBACK_CACHE" >&2
		exit 2
	fi
fi

case "${1:-}" in
--update)
	jq -S . "$TMP" >"$VENDORED"
	echo "updated $VENDORED from $SPEC_URL"
	;;
"")
	DIFF="$(diff "$VENDORED" <(jq -S . "$TMP") || true)"
	if [[ -n "$DIFF" ]]; then
		LINES="$(printf '%s\n' "$DIFF" | wc -l)"
		echo "spec drift detected: $VENDORED differs from live spec ($LINES diff lines)"
		echo "run scripts/check-spec-drift.sh --update to re-vendor"
		exit 1
	fi
	echo "no drift: $VENDORED matches live spec"
	;;
*)
	echo "usage: $0 [--update]" >&2
	exit 2
	;;
esac
