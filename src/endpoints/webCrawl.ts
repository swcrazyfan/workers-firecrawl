import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import {
  CrawlRequestSchema,
  CrawlResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";

export class WebCrawl extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          "application/json": {
            schema: CrawlRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful crawl response",
        ...contentJson(CrawlResponseSchema),
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
      const { url, ...options } = data.body;

      // Generate unique job ID
      const jobId = `crawl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create Durable Object for this job
      // Create Durable Object for this job
      const doId = c.env.CRAWL_JOBS.idFromName(jobId);
      const crawlJobDO = c.env.CRAWL_JOBS.get(doId);

      // Start the crawl job
      await crawlJobDO.fetch(
        new Request("https://do/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, url, options }),
        })
      );

      return {
        success: true,
        id: jobId,
        url: `${new URL(c.req.url).origin}/v2/crawl/${jobId}`,
      };

    } catch (error) {
      console.error("Crawl operation failed:", error);
      
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
          error: `Crawl failed: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }
}