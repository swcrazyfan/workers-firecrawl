# Vendored Firecrawl v2 OpenAPI spec

- Source: <https://docs.firecrawl.dev/api-reference/v2-openapi.json>
- Vendored: 2026-09-15
- `v2-openapi.json` is the contract of record for the v2 port; endpoints are built against this file, not the live docs.
- Normalized with `jq -S .` (sorted keys) so diffs are stable.
- Refresh with `scripts/check-spec-drift.sh --update`; a weekly CI check (`.github/workflows/spec-drift.yml`) opens an issue when the live spec drifts from this copy.
