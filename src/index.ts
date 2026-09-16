import { fromHono } from "chanfana";
import { type Context, Hono } from "hono";
import { authorizationMiddleware } from "./authorization";
import { WebScrape } from "./scrape";
import { V2Crawl } from "./v2/crawl";
import { V2CrawlStatus } from "./v2/crawlStatus";
import { V2Map } from "./v2/map";
import { V2Scrape } from "./v2/scrape";
import { V2Search } from "./v2/search";
import { WebMap } from "./webMap";
import { WebSearch } from "./webSearch";

export type Env = {
	BROWSER: Fetcher;
	AUTHORIZATION_KEY?: string;
	DB: D1Database; // crawl storage (D1)
	CRAWL_WORKFLOW: Workflow<{ jobId: string }>; // crawl engine (task 012)
	SEARCH_CHAIN?: string; // comma-separated provider ids tried in order: "ddg" | "ddg-media" | "searxng" | "browser"
	SEARXNG_ENDPOINT?: string;
	SEARXNG_ENGINES?: string;
	SEARXNG_HEADERS?: string; // JSON object of extra headers (CF Access etc.)
	AI?: unknown; // Workers AI binding (provider: "workers-ai")
	LLM_PROVIDER?: string; // "openai" | "workers-ai"
	LLM_BASE_URL?: string; // OpenAI-compatible base URL (default OpenRouter)
	LLM_MODEL?: string;
	LLM_API_KEY?: string;
	OPENAI_API_KEY?: string;
	LLM_STRICT_JSON?: string; // "auto" | "on" | "off"
	LLM_TIMEOUT_MS?: string;
	LLM_MAX_REPAIRS?: string;
	LLM_MAX_INPUT_CHARS?: string;
};
export type AppContext = Context<{ Bindings: Env }>;

// Start a Hono app
const app = new Hono();
app.use("*", authorizationMiddleware);

// Setup OpenAPI registry
const openapi = fromHono(app, { docs_url: "/" });

// Register OpenAPI endpoints (this will also register the routes in Hono)
openapi.post("/v1/search", WebSearch);
openapi.post("/v1/map", WebMap);
openapi.post("/v1/scrape", WebScrape);
openapi.post("/v2/map", V2Map);
openapi.post("/v2/search", V2Search);
openapi.post("/v2/scrape", V2Scrape);
openapi.post("/v2/crawl", V2Crawl);
openapi.get("/v2/crawl/:id", V2CrawlStatus);
openapi.delete("/v2/crawl/:id", V2CrawlStatus);

// Exported for the `CRAWL_WORKFLOW` binding; Cloudflare Workflows instantiate
// this class by name.
export { CrawlWorkflow } from "./crawler/workflow";

// Export the Hono app
export default app;
