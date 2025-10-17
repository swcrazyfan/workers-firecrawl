import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import { getBrowser, closeBrowser } from "../utils/browser";
import { performSearch, extractContent, performImageSearch, performNewsSearch } from "../utils/contentExtractor";
import {
  SearchRequestSchema,
  SearchResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";

export class WebSearch extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          "application/json": {
            schema: SearchRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful search response",
        ...contentJson(SearchResponseSchema),
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
        query,
        limit,
        sources = ["web"],
        tbs,
        lang,
        country,
        location,
        timeout,
        ignoreInvalidURLs,
        scrapeOptions
      } = data.body;

      const browser = await getBrowser(c.env);

      try {
        const results: any = { web: [], images: [], news: [] };
        
        // Perform web search if requested
        if (sources.includes("web")) {
          // Perform search to get URLs
          const searchResults = await performSearch(
            browser,
            query,
            limit || 5,
            { tbs, lang, country, location, sources },
          );

          // Filter invalid URLs if requested
          const validUrls = ignoreInvalidURLs
            ? searchResults.filter(url => isValidUrl(url))
            : searchResults;

          // Extract format types from scrapeOptions
          const formatTypes: string[] = [];
          let screenshotOptions: any = undefined;

          if (scrapeOptions?.formats) {
            for (const format of scrapeOptions.formats) {
              if (typeof format === 'string') {
                formatTypes.push(format);
              } else if (typeof format === 'object' && 'type' in format) {
                const formatObj = format as any;
                if (formatObj.type === 'screenshot') {
                  formatTypes.push('screenshot');
                  screenshotOptions = {
                    fullPage: formatObj.fullPage,
                    quality: formatObj.quality,
                  };
                } else if (formatObj.type === 'json') {
                  // JSON extraction would require LLM integration - not implemented yet
                  formatTypes.push('markdown'); // Fallback to markdown
                } else if (formatObj.type === 'changeTracking') {
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

          // Extract content from each result using shared utility
          const promises = validUrls.map((url, index) =>
            extractContent(browser, url, {
              formats: formatTypes,
              screenshot: screenshotOptions,
              headers: scrapeOptions?.headers,
              timeout: scrapeOptions?.timeout || timeout,
              waitFor: scrapeOptions?.waitFor,
              removeTags: scrapeOptions?.excludeTags,
              onlyMainContent: scrapeOptions?.onlyMainContent,
              includeTags: scrapeOptions?.includeTags,
              removeBase64Images: scrapeOptions?.removeBase64Images,
              blockAds: scrapeOptions?.blockAds,
              actions: scrapeOptions?.actions,
            }).then(content => ({
              ...content,
              position: index + 1
            }))
          );

          const webResults = await Promise.all(promises);
          
          // Filter out null results
          results.web = webResults.filter((obj) => obj !== null);
        }

        // Perform image search if requested
        if (sources.includes("images")) {
          results.images = await performImageSearch(
            browser,
            query,
            limit || 5,
            { tbs, lang, country, location, sources: ["images"] },
          );
        }

        // Perform news search if requested
        if (sources.includes("news")) {
          const newsResults = await performNewsSearch(
            browser,
            query,
            limit || 5,
            { tbs, lang, country, location, sources: ["news"] },
          );
          
          // If scrapeOptions is provided, scrape the content of news articles
          if (scrapeOptions && newsResults.length > 0) {
            // Extract format types from scrapeOptions
            const formatTypes: string[] = [];
            let screenshotOptions: any = undefined;

            if (scrapeOptions?.formats) {
              for (const format of scrapeOptions.formats) {
                if (typeof format === 'string') {
                  formatTypes.push(format);
                } else if (typeof format === 'object' && 'type' in format) {
                  const formatObj = format as any;
                  if (formatObj.type === 'screenshot') {
                    formatTypes.push('screenshot');
                    screenshotOptions = {
                      fullPage: formatObj.fullPage,
                      quality: formatObj.quality,
                    };
                  } else if (formatObj.type === 'json') {
                    // JSON extraction would require LLM integration - not implemented yet
                    formatTypes.push('markdown'); // Fallback to markdown
                  } else if (formatObj.type === 'changeTracking') {
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

            // Extract content from each news article
            const newsPromises = newsResults.map(async (newsItem, index) => {
              try {
                const content = await extractContent(browser, newsItem.url, {
                  formats: formatTypes,
                  screenshot: screenshotOptions,
                  headers: scrapeOptions?.headers,
                  timeout: scrapeOptions?.timeout || timeout,
                  waitFor: scrapeOptions?.waitFor,
                  removeTags: scrapeOptions?.excludeTags,
                  onlyMainContent: scrapeOptions?.onlyMainContent,
                  includeTags: scrapeOptions?.includeTags,
                  removeBase64Images: scrapeOptions?.removeBase64Images,
                  blockAds: scrapeOptions?.blockAds,
                  actions: scrapeOptions?.actions,
                });
                
                return {
                  title: newsItem.title,
                  snippet: newsItem.snippet,
                  url: newsItem.url,
                  date: newsItem.date,
                  imageUrl: newsItem.imageUrl,
                  position: newsItem.position,
                  ...content
                };
              } catch (error) {
                // If scraping fails, return the original news item
                console.warn(`Failed to scrape news article ${newsItem.url}:`, error);
                return newsItem;
              }
            });
            
            results.news = await Promise.all(newsPromises);
          } else {
            results.news = newsResults;
          }
        }
        
        // Filter out empty arrays based on requested sources
        const filteredResults: any = {};
        sources.forEach(source => {
          if (results[source] && results[source].length > 0) {
            filteredResults[source] = results[source];
          }
        });
        
        await closeBrowser(browser);

        // Add warning if some results failed
        let warning;
        if (sources.includes("web") && results.web.length < (limit || 5)) {
          const failedCount = (limit || 5) - results.web.length;
          warning = `${failedCount} out of ${limit || 5} web results failed to load`;
        } else if (sources.includes("images") && results.images.length === 0) {
          warning = "No image results found";
        } else if (sources.includes("news") && results.news.length === 0) {
          warning = "No news results found";
        }

        return {
          success: true,
          data: filteredResults,
          warning
        };

      } catch (error) {
        await closeBrowser(browser);
        throw error;
      }

    } catch (error) {
      console.error("Search operation failed:", error);
      
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
          error: `Search failed: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }
}

// Helper function to validate URLs
function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}