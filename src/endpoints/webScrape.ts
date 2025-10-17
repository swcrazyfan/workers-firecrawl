import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import { getBrowser, closeBrowser } from "../utils/browser";
import { extractContent } from "../utils/contentExtractor";
import {
  ScrapeRequestSchema,
  ScrapeResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";

export class WebScrape extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          "application/json": {
            schema: ScrapeRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful scrape response",
        ...contentJson(ScrapeResponseSchema),
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
      const {
        url,
        formats,
        onlyMainContent,
        includeTags,
        excludeTags,
        headers,
        waitFor,
        mobile,
        timeout,
        actions,
        removeBase64Images,
        blockAds
      } = data.body;

      // Extract format types from the formats array
      const formatTypes: string[] = [];
      let screenshotOptions: any = undefined;

      if (formats) {
        for (const format of formats) {
          if (typeof format === 'string') {
            formatTypes.push(format);
          } else if (typeof format === 'object' && format.type) {
            if (format.type === 'screenshot') {
              formatTypes.push('screenshot');
              screenshotOptions = {
                fullPage: format.fullPage,
                quality: format.quality,
              };
            } else if (format.type === 'json') {
              // JSON extraction would require LLM integration - not implemented yet
              formatTypes.push('markdown'); // Fallback to markdown
            } else if (format.type === 'changeTracking') {
              // Change tracking would require caching - not implemented yet
              formatTypes.push('markdown'); // Fallback to markdown
            }
          }
        }
      }

      // Default to markdown if no formats specified
      if (formatTypes.length === 0) {
        formatTypes.push('markdown');
      }

      const browser = await getBrowser(c.env);

      try {
        const result = await extractContent(browser, url, {
          formats: formatTypes,
          screenshot: screenshotOptions,
          actions,
          headers,
          timeout,
          waitFor,
          excludeTags,
          onlyMainContent,
          includeTags,
          mobile,
        });

        // Remove base64 images if requested
        if (removeBase64Images && result.markdown) {
          result.markdown = result.markdown.replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '');
        }

        // Block ads content if requested
        if (blockAds && result.markdown) {
          // Simple ad content removal - could be enhanced
          const adPatterns = [
            /\[Advertisement\]/gi,
            /\[Sponsored\]/gi,
            /\[Ad\]/gi,
          ];
          adPatterns.forEach(pattern => {
            result.markdown = result.markdown.replace(pattern, '[Ad removed]');
          });
        }

        await closeBrowser(browser);

        return {
          success: true,
          data: result,
        };

      } catch (error) {
        await closeBrowser(browser);
        throw error;
      }

    } catch (error) {
      console.error("Scrape operation failed:", error);
      
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
          error: `Scraping failed: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }
}