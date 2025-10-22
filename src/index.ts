import { fromHono } from "chanfana";
import { type Context, Hono } from "hono";
import { authorizationMiddleware } from "./authorization";
import { WebSearch } from "./endpoints/webSearch";
import { WebScrape } from "./endpoints/webScrape";
import { WebCrawl } from "./endpoints/webCrawl";
import { WebCrawlStatus } from "./endpoints/webCrawlStatus";
import { getBrowser, closeBrowser } from "./utils/browser";
import { analyzeImageSearchPage, analyzeNewsSearchPage } from "./utils/contentExtractor";
import { CrawlJob } from "./durableObjects/crawlJob";

export type Env = {
	BROWSER: Fetcher;
	AUTHORIZATION_KEY?: string;
	CRAWL_JOBS: DurableObjectNamespace;
	DB: D1Database;
};
export type AppContext = Context<{ Bindings: Env }>;

// Start a Hono app
const app = new Hono();
app.use("*", authorizationMiddleware);

// Setup OpenAPI registry
const openapi = fromHono(app, { docs_url: "/" });

// Register OpenAPI endpoints (this will also register the routes in Hono)
// V2 API endpoints (matching official Firecrawl API)
openapi.post("/v2/search", WebSearch);
openapi.post("/v2/scrape", WebScrape);
openapi.post("/v2/crawl", WebCrawl);
openapi.get("/v2/crawl/:id", WebCrawlStatus);

// V1 API endpoint (backward compatibility)
openapi.post("/v1/search", WebSearch);

// Debug endpoint for analyzing search page structures
app.get("/debug/search", async (c) => {
  const query = c.req.query("q") || "test query";
  const type = c.req.query("type") || "news"; // 'news' or 'images'
  
  const browser = await getBrowser(c.env as Env);
  
  try {
    let analysis;
    if (type === "images") {
      analysis = await analyzeImageSearchPage(browser, query);
    } else {
      analysis = await analyzeNewsSearchPage(browser, query);
    }
    
    return c.json({ success: true, data: analysis });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: `Analysis failed: ${(error as Error).message}`
      },
      { status: 500 }
    );
  } finally {
    await closeBrowser(browser);
  }
});

// Export the Hono app and Durable Object
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    // Run cleanup every hour
    if (event.cron === "0 * * * *") {
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      // Delete expired jobs and related data
      await env.DB.prepare(`
        DELETE FROM results
        WHERE job_id IN (
          SELECT id FROM jobs WHERE expires_at < ?
        )
      `).bind(oneWeekAgo).run();
      
      await env.DB.prepare(`
        DELETE FROM url_queue
        WHERE job_id IN (
          SELECT id FROM jobs WHERE expires_at < ?
        )
      `).bind(oneWeekAgo).run();
      
      await env.DB.prepare(`
        DELETE FROM jobs WHERE expires_at < ?
      `).bind(oneWeekAgo).run();
    }
  },
};

// Export Durable Object
export { CrawlJob };
