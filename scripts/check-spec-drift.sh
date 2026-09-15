#!/usr/bin/env bash
# check-spec-drift.sh — compare the vendored Firecrawl v2 OpenAPI spec against the live one.
# Default: exit 0 if identical, exit 1 with a short summary if drifted.
# --update: re-vendor spec/v2-openapi.json from the live spec (normalized with `jq -S .`) and
#   refresh the vendored date in spec/README.md. Atomic: jq normalizes into a NEW temp file
#   that is mv'd into place only after jq succeeds with non-empty output, so a malformed or
#   truncated live response can never zero out the contract of record.
# --self-test: verify --update is idempotent (byte-identical across two runs, compared via
#   sha256) and failure-safe (a non-JSON response leaves the vendored file untouched and the
#   script exits non-zero).
# SPEC_URL, VENDORED and SPEC_README are env-overridable so failure paths are testable.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."

SPEC_URL="${SPEC_URL:-https://docs.firecrawl.dev/api-reference/v2-openapi.json}"
FALLBACK_CACHE="/tmp/fcresearch/v2-openapi.json"
VENDORED="${VENDORED:-spec/v2-openapi.json}"
README="${SPEC_README:-spec/README.md}"

TMP="$(mktemp)"
OUT="$(mktemp)"
trap 'rm -f "$TMP" "$OUT"' EXIT

# fetch <url>: download the raw body into $TMP (file:// URLs work too, for testing).
fetch() {
	if ! curl -fsSL --max-time 90 "$1" -o "$TMP"; then
		if [[ -f "$FALLBACK_CACHE" ]]; then
			echo "warning: live fetch failed, using cached copy at $FALLBACK_CACHE" >&2
			cp -- "$FALLBACK_CACHE" "$TMP"
		else
			echo "error: live fetch failed and no cache at $FALLBACK_CACHE" >&2
			exit 2
		fi
	fi
}

update_spec() {
	fetch "$SPEC_URL"
	if ! jq -S . "$TMP" >"$OUT" || ! test -s "$OUT"; then
		echo "error: jq failed or produced empty output; $VENDORED left unchanged" >&2
		return 1
	fi
	mv -- "$OUT" "$VENDORED"
	if [[ -f "$README" ]]; then
		sed -i -E "s/^(- Vendored: ).*/\1$(date +%F)/" "$README"
	fi
	echo "updated $VENDORED from $SPEC_URL"
}

check_drift() {
	fetch "$SPEC_URL"
	if ! jq -S . "$TMP" >"$OUT" || ! test -s "$OUT"; then
		echo "error: live response did not normalize to non-empty JSON; aborting" >&2
		exit 2
	fi
	if ! DIFF="$(diff "$VENDORED" "$OUT")"; then
		LINES="$(printf '%s\n' "$DIFF" | wc -l)"
		echo "spec drift detected: $VENDORED differs from live spec ($LINES diff lines)"
		echo "run scripts/check-spec-drift.sh --update to re-vendor"
		exit 1
	fi
	echo "no drift: $VENDORED matches live spec"
}

self_test() {
	local dir vend readme src sha_before sha_after sha_fixed rc failures=0
	dir="$(mktemp -d)"
	vend="$dir/v2-openapi.json"
	readme="$dir/README.md"
	printf -- '- Vendored: 2000-01-01\n' >"$readme"

	# Update source: the live spec when reachable, otherwise the vendored copy itself,
	# so the self-test also runs offline.
	if curl -fsSL --max-time 15 "$SPEC_URL" -o /dev/null 2>/dev/null; then
		src="$SPEC_URL"
	else
		echo "note: live spec unreachable; using vendored copy as the update source" >&2
		src="file://$PWD/spec/v2-openapi.json"
	fi

	# (a) --update twice must produce byte-identical output.
	env SPEC_URL="$src" VENDORED="$vend" SPEC_README="$readme" "$SCRIPT" --update
	sha_before="$(sha256sum "$vend" | cut -d' ' -f1)"
	env SPEC_URL="$src" VENDORED="$vend" SPEC_README="$readme" "$SCRIPT" --update
	sha_after="$(sha256sum "$vend" | cut -d' ' -f1)"
	if [[ -n "$sha_after" && "$sha_before" == "$sha_after" ]]; then
		echo "self-test a PASS: --update twice is byte-identical (sha256 $sha_after)"
	else
		echo "self-test a FAIL: --update is not idempotent ($sha_before -> $sha_after)" >&2
		failures=$((failures + 1))
	fi

	# (b) a non-JSON response must leave the vendored file untouched and exit non-zero.
	printf '<!DOCTYPE html><html><body><h1>not json</h1></body></html>\n' >"$dir/not-json.html"
	rc=0
	env SPEC_URL="file://$dir/not-json.html" VENDORED="$vend" SPEC_README="$readme" \
		"$SCRIPT" --update >/dev/null || rc=$?
	sha_fixed="$(sha256sum "$vend" | cut -d' ' -f1)"
	if [[ "$rc" -ne 0 && "$sha_fixed" == "$sha_after" && -s "$vend" ]]; then
		echo "self-test b PASS: jq failure exits non-zero ($rc) and leaves the vendored file untouched"
	else
		echo "self-test b FAIL: rc=$rc, vendored sha256 $sha_after -> $sha_fixed" >&2
		failures=$((failures + 1))
	fi

	# (c) --update refreshes the vendored date in the README.
	if grep -qF -- "- Vendored: $(date +%F)" "$readme"; then
		echo "self-test c PASS: vendored date refreshed to $(date +%F)"
	else
		echo "self-test c FAIL: README vendored date not refreshed" >&2
		failures=$((failures + 1))
	fi

	rm -rf -- "$dir"
	if [[ "$failures" -ne 0 ]]; then
		echo "self-test: $failures check(s) failed" >&2
		exit 1
	fi
	echo "self-test: all checks passed"
}

case "${1:-}" in
--update)
	update_spec
	;;
--self-test)
	self_test
	;;
"")
	check_drift
	;;
*)
	echo "usage: $0 [--update|--self-test]" >&2
	exit 2
	;;
esac
