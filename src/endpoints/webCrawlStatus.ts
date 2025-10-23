import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import {
  CrawlStatusResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";

export class WebCrawlStatus extends OpenAPIRoute {
  schema = {
    responses: {
      200: {
        description: "Successful crawl status response",
        ...contentJson(CrawlStatusResponseSchema),
      },
      404: {
        description: "Crawl job not found",
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
      
      // Check if job exists and is not expired
      const job = await c.env.DB.prepare(`
        SELECT * FROM jobs WHERE id = ?
      `).bind(jobId).first();
      
      if (!job) {
        return Response.json(
          {
            success: false,
            error: "Job not found",
          },
          { status: 404 }
        );
      }
      
      if (job.expires_at as number < Date.now()) {
        return Response.json(
          {
            success: false,
            error: "Job expired",
          },
          { status: 404 }
        );
      }
      
      // Get results with pagination
      const skip = parseInt(c.req.query('skip') || '0');
      const limit = Math.min(parseInt(c.req.query('limit') || '100'), 100);
      
      const results = await c.env.DB.prepare(`
        SELECT * FROM results 
        WHERE job_id = ? 
        ORDER BY created_at 
        LIMIT ? OFFSET ?
      `).bind(jobId, limit, skip).all();
      
      // Get total count for pagination
      const totalCount = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM results WHERE job_id = ?
      `).bind(jobId).first();
      
      // Format results
      const formattedResults = results.results.map(result => ({
        markdown: result.markdown,
        html: result.html,
        rawHtml: result.raw_html,
        links: result.links ? JSON.parse(result.links as string) : [],
        metadata: result.metadata ? JSON.parse(result.metadata as string) : {},
        json: result.json ? JSON.parse(result.json as string) : undefined,
        sourceURL: result.url,
      }));
      
      // Determine if there are more results
      const totalCountValue = totalCount.count as number;
      const hasMore = skip + limit < totalCountValue;
      const nextUrl = hasMore 
        ? `${new URL(c.req.url).origin}/v2/crawl/${jobId}?skip=${skip + limit}`
        : null;
      
      return {
        success: true,
        status: job.status,
        total: totalCount.count,
        completed: job.completed,
        data: formattedResults,
        next: nextUrl,
      };

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