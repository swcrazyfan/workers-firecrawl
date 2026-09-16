---
"workers-firecrawl": minor
---

Add the v2 API surface: grouped `/v2/search`, format-object `/v2/scrape`, `/v2/map` with object links, and an asynchronous D1 + Cloudflare Workflows crawl engine (`/v2/crawl`, status, errors, active, params-preview).

- Self-contained search chain (`SEARCH_CHAIN`) with per-source, first-success provider resolution (`ddg`, `ddg-media`, optional `searxng`, `browser` fallback)
- AI extraction pipeline (OpenAI-compatible or Workers AI) for scrape `json`/`summary` and crawl parameter preview, with strict-JSON modes and a repair loop
- Legacy `/v1` endpoints remain available