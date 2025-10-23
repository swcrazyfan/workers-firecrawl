import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import { getBrowser, closeBrowser } from "../utils/browser";
import { extractContent } from "../utils/contentExtractor";
import { extractStructuredData, extractWithPrompt, summarizeContentEnhanced } from "../utils/ai";
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
      let jsonOptions: { schema?: any; prompt?: string } | undefined;
      let summaryOptions: any = undefined;

      if (formats) {
        for (const format of formats) {
          if (typeof format === 'string') {
            formatTypes.push(format);
            // Set default summary options if format is "summary" string
            if (format === 'summary') {
              summaryOptions = summaryOptions || {
                maxLength: 300,
                type: 'concise',
                tone: 'neutral'
              };
            }
          } else if (typeof format === 'object' && format.type) {
            if (format.type === 'screenshot') {
              formatTypes.push('screenshot');
              screenshotOptions = {
                fullPage: (format as any).fullPage,
                quality: (format as any).quality,
              };
            } else if (format.type === 'json') {
              // Store JSON options for later processing
              formatTypes.push('json');
              jsonOptions = {
                schema: (format as any).schema,
                prompt: (format as any).prompt
              };
            } else if (format.type === 'summary') {
              // Store summary options for later processing
              formatTypes.push('summary');
              summaryOptions = {
                maxLength: (format as any).maxLength,
                type: (format as any).summaryType,
                tone: (format as any).tone,
                focus: (format as any).focus,
                language: (format as any).language
              };
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
      
      // Ensure markdown is included if summary is requested (summary needs markdown content)
      if (summaryOptions && !formatTypes.includes('markdown')) {
        formatTypes.push('markdown');
      }
      
      // Ensure markdown is included if JSON is requested (JSON extraction needs markdown content)
      if (jsonOptions && !formatTypes.includes('markdown')) {
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

        // Process JSON extraction if requested
        if (jsonOptions && result.markdown) {
          try {
            let extractionResult;
            
            // Use schema-based extraction if schema is provided
            if (jsonOptions.schema) {
              extractionResult = await extractStructuredData(
                result.markdown,
                {
                  schema: jsonOptions.schema,
                  prompt: jsonOptions.prompt
                },
                c.env
              );
            } 
            // Use prompt-based extraction if only prompt is provided
            else if (jsonOptions.prompt) {
              extractionResult = await extractWithPrompt(
                result.markdown,
                {
                  prompt: jsonOptions.prompt,
                  outputFormat: 'json'
                },
                c.env
              );
            }
            
            if (extractionResult && extractionResult.success) {
              result.json = extractionResult.data;
            } else if (extractionResult) {
              // Add warning but don't fail the request
              result.warning = result.warning 
                ? `${result.warning}; JSON extraction failed: ${extractionResult.error}`
                : `JSON extraction failed: ${extractionResult.error}`;
            }
          } catch (error) {
            // Log error but don't fail the entire request
            console.error('JSON extraction error:', error);
            result.warning = result.warning
              ? `${result.warning}; JSON extraction error: ${(error as Error).message}`
              : `JSON extraction error: ${(error as Error).message}`;
          }
        }

        // Process summary generation if requested
        if (summaryOptions && result.markdown) {
          try {
            const summaryResult = await summarizeContentEnhanced(
              c.env,
              result.markdown,
              summaryOptions
            );
            
            if (summaryResult.success && summaryResult.data) {
              result.summary = summaryResult.data.summary;
            } else {
              // Add warning but don't fail the request
              result.warning = result.warning 
                ? `${result.warning}; Summary generation failed: ${summaryResult.error}`
                : `Summary generation failed: ${summaryResult.error}`;
            }
          } catch (error) {
            // Log error but don't fail the entire request
            console.error('Summary generation error:', error);
            result.warning = result.warning
              ? `${result.warning}; Summary generation error: ${(error as Error).message}`
              : `Summary generation error: ${(error as Error).message}`;
          }
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