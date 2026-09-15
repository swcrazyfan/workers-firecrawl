import { fromHono } from "chanfana";
import { type Context, Hono } from "hono";
import { authorizationMiddleware } from "./authorization";
import { WebScrape } from "./scrape";
import { WebMap } from "./webMap";
import { WebSearch } from "./webSearch";

export type Env = {
	BROWSER: Fetcher;
	AUTHORIZATION_KEY?: string;
	SEARCH_PROVIDER?: string; // "searxng" | "ddg" | "browser"
	SEARCH_FALLBACK?: string; // "ddg" | "browser" | "none"
	SEARXNG_ENDPOINT?: string;
	SEARXNG_ENGINES?: string;
	SEARXNG_HEADERS?: string; // JSON object of extra headers (CF Access etc.)
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

// Export the Hono app
export default app;
