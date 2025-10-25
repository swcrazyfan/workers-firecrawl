import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import { z } from "zod";
import {
  ErrorResponseSchema,
} from "../types/schemas";

// Response schema for scrape status
const ScrapeStatusResponseSchema = z.object({
  success: z.boolean(),
  status: z.enum(["processing", "completed", "failed"]),
  data: z.object({
    json: z.any().optional(),
    metadata: z.any()
  }).optional(),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
});

export class WebScrapeStatus extends OpenAPIRoute {
  schema = {
    responses: {
      200: {
        description: "Successful scrape status response",
        ...contentJson(ScrapeStatusResponseSchema),
      },
      404: {
        description: "Scrape job not found",
        ...contentJson(ErrorResponseSchema),
      },
      401: {
        description: "Unauthorized - Invalid or missing API key",
        ...contentJson(ErrorResponseSchema),
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const jobId = c.req.param('id');
      
      // Get job from Durable Object
      const doId = c.env.CRAWL_JOBS.idFromName(jobId);
      const jobDO = c.env.CRAWL_JOBS.get(doId);
      
      const response = await jobDO.fetch(
        new Request("https://do/status-flare1", {
          method: "GET",
        })
      );
      
      const statusData = await response.json();
      
      return Response.json(statusData);

    } catch (error) {
      console.error("Status check failed:", error);
      
      return Response.json(
        {
          success: false,
          error: `Status check failed: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }
}