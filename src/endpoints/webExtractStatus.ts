import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import {
  ExtractStatusResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";

export class WebExtractStatus extends OpenAPIRoute {
  schema = {
    responses: {
      200: {
        description: "Successful extract status response",
        ...contentJson(ExtractStatusResponseSchema),
      },
      404: {
        description: "Extract job not found",
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
            error: "Extract job not found",
          },
          { status: 404 }
        );
      }
      
      if (job.expires_at as number < Date.now()) {
        return Response.json(
          {
            success: false,
            error: "Extract job expired",
          },
          { status: 404 }
        );
      }
      
      // Get all results for extract job (no pagination for extract)
      const results = await c.env.DB.prepare(`
        SELECT * FROM results 
        WHERE job_id = ? 
        ORDER BY created_at
      `).bind(jobId).all();
      
      // For extract, we aggregate all JSON results into a single data object
      let extractedData: any = null;
      
      if (job.status === 'completed' && results.results.length > 0) {
        // If there's a schema/prompt, aggregate the JSON results
        const jsonResults = results.results
          .map(result => result.json ? JSON.parse(result.json as string) : null)
          .filter(json => json !== null);
        
        if (jsonResults.length === 1) {
          extractedData = jsonResults[0];
        } else if (jsonResults.length > 1) {
          // Multiple results - return as array
          extractedData = jsonResults;
        }
      }
      
      return {
        success: true,
        status: job.status as "processing" | "completed" | "failed" | "cancelled",
        data: extractedData,
        expiresAt: new Date(job.expires_at as number).toISOString(),
        tokensUsed: job.status === 'completed' ? (job.completed as number) : undefined,
        error: job.error as string | undefined,
      };

    } catch (error) {
      console.error("Extract status check failed:", error);
      return Response.json(
        {
          success: false,
          error: `Failed to get extract status: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }
}