import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import {
  ExtractRequestSchema,
  ExtractResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";
import { Flare1Agent } from "../agents/flare1";
import { ResultAggregator } from "../agents/resultAggregator";

export class WebExtract extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          "application/json": {
            schema: ExtractRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful extract response",
        ...contentJson(ExtractResponseSchema),
      },
      400: {
        description: "Bad request - Invalid parameters",
        ...contentJson(ErrorResponseSchema),
      },
      401: {
        description: "Unauthorized - Invalid or missing API key",
        ...contentJson(ErrorResponseSchema),
      },
      500: {
        description: "Internal server error",
        ...contentJson(ErrorResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const { urls, prompt, schema, enableWebSearch, scrapeOptions, agent } = data.body;

      // FLARE-1 agent mode uses async Durable Object pattern (no timeout)
      // Regular extraction also uses Durable Objects
      // Generate unique job ID
      const jobId = `extract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Expand wildcard URLs
      const expandedUrls = await this.expandWildcardUrls(urls, c.env);

      // Create extraction job using Durable Object
      const doId = c.env.CRAWL_JOBS.idFromName(jobId);
      const extractJobDO = c.env.CRAWL_JOBS.get(doId);

      // Start the extraction job
      await extractJobDO.fetch(
        new Request("https://do/start-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            urls: expandedUrls,
            prompt,
            schema,
            enableWebSearch,
            scrapeOptions,
            agent
          }),
        })
      );

      return {
        success: true,
        id: jobId,
        url: `${new URL(c.req.url).origin}/v2/extract/${jobId}`,
      };

    } catch (error) {
      console.error("Extract operation failed:", error);
      
      // Handle validation errors
      if (error instanceof Error && error.message.includes("Validation")) {
        return Response.json(
          {
            success: false,
            error: `Validation error: ${error.message}`,
          },
          { status: 400 }
        );
      }

      // Handle other errors
      return Response.json(
        {
          success: false,
          error: `Extract failed: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }

  /**
   * Expand wildcard URLs (e.g., example.com/* -> all pages)
   */
  private async expandWildcardUrls(urls: string[], env: any): Promise<string[]> {
    const expandedUrls: string[] = [];

    for (const url of urls) {
      if (url.endsWith('/*')) {
        // This is a wildcard URL - we'll need to crawl it
        // For now, just add the base URL and let the crawl job handle expansion
        const baseUrl = url.slice(0, -2);
        expandedUrls.push(baseUrl);
      } else {
        expandedUrls.push(url);
      }
    }

    return expandedUrls;
  }
}