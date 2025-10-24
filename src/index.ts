import { fromHono } from "chanfana";
import { type Context, Hono } from "hono";
import { authorizationMiddleware } from "./authorization";
import { WebSearch } from "./endpoints/webSearch";
import { WebScrape } from "./endpoints/webScrape";
import { WebCrawl } from "./endpoints/webCrawl";
import { WebCrawlStatus } from "./endpoints/webCrawlStatus";
import { WebExtract } from "./endpoints/webExtract";
import { WebExtractStatus } from "./endpoints/webExtractStatus";
import { WebMap } from "./endpoints/webMap";
import { getBrowser, closeBrowser } from "./utils/browser";
import { analyzeImageSearchPage, analyzeNewsSearchPage } from "./utils/contentExtractor";
import { CrawlJob } from "./durableObjects/crawlJob";
// Add AI utilities
import { checkAIAvailability, getAIConfigStatus } from "./utils/ai";

export type Env = {
	BROWSER: Fetcher;
	AUTHORIZATION_KEY?: string;
	CRAWL_JOBS: DurableObjectNamespace;
	DB: D1Database;
  // LLM config (OpenAI-compatible; defaults set in config)
  OPENAI_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT?: string;
  LLM_MAX_RETRIES?: string;
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
openapi.post("/v2/extract", WebExtract);
openapi.get("/v2/extract/:id", WebExtractStatus);
openapi.post("/v2/map", WebMap);

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

// Add AI debug endpoint for config + availability diagnostics
app.get("/debug/ai", async (c) => {
  try {
    // Validate configuration from environment
    const configStatus = getAIConfigStatus(c.env as Env);

    // Probe provider availability with a tiny request
    const availability = await checkAIAvailability(c.env as Env);

    return c.json({
      success: true,
      data: {
        config: {
          isValid: configStatus.isValid,
          errors: configStatus.errors,
          model: configStatus.model,
          baseUrl: configStatus.baseUrl
        },
        availability
      }
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: `AI debug failed: ${(error as Error).message}`
      },
      { status: 500 }
    );
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
