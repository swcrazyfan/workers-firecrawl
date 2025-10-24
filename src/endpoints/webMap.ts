import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../index";
import { SitemapParser } from "../utils/sitemapParser";
import {
  MapRequestSchema,
  MapResponseSchema,
  ErrorResponseSchema,
} from "../types/schemas";

export class WebMap extends OpenAPIRoute {
  schema = {
    request: {
      body: {
        content: {
          "application/json": {
            schema: MapRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful map response",
        ...contentJson(MapResponseSchema),
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
        search,
        sitemap,
        includeSubdomains,
        ignoreQueryParameters,
        limit,
        timeout
      } = data.body;

      // Validate URL
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Invalid URL provided",
          },
          { status: 400 }
        );
      }

      // Discover URLs based on sitemap mode
      let discoveredUrls: string[] = [];

      switch (sitemap) {
        case "only":
          // Only use sitemap
          discoveredUrls = await SitemapParser.fetch(url);
          break;

        case "skip":
          // Only use crawling (skip sitemap)
          discoveredUrls = await this.crawlForUrls(url, limit);
          break;

        case "include":
        default:
          // Use sitemap + crawling
          const sitemapUrls = await SitemapParser.fetch(url);
          const crawledUrls = await this.crawlForUrls(url, limit);
          // Combine and deduplicate
          const urlSet = new Set([...sitemapUrls, ...crawledUrls]);
          discoveredUrls = Array.from(urlSet);
          break;
      }

      // Apply filters
      let filteredUrls = this.applyFilters(
        discoveredUrls,
        urlObj,
        includeSubdomains,
        ignoreQueryParameters
      );

      // Apply search filtering if provided
      if (search) {
        filteredUrls = this.applySearchFilter(filteredUrls, search);
      }

      // Apply limit
      filteredUrls = filteredUrls.slice(0, limit);

      // Extract metadata for each URL
      const links = await this.extractMetadata(filteredUrls);

      return {
        success: true,
        links,
      };

    } catch (error) {
      console.error("Map operation failed:", error);
      
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
          error: `Mapping failed: ${(error as Error).message}`,
        },
        { status: 500 }
      );
    }
  }

  /**
   * Crawl for URLs using lightweight approach (no full browser rendering)
   */
  private async crawlForUrls(baseUrl: string, limit: number): Promise<string[]> {
    const urls: string[] = [];
    
    try {
      // Fetch the base URL content
      const response = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Fireflare-Map/1.0)',
        },
      });

      if (!response.ok) {
        console.warn(`Failed to fetch ${baseUrl}: ${response.status}`);
        return urls;
      }

      const html = await response.text();
      
      // Extract links using regex (lightweight approach)
      const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>/gi;
      const matches = html.matchAll(linkRegex);
      
      const baseHost = new URL(baseUrl).hostname;
      
      for (const match of matches) {
        if (urls.length >= limit) break;
        
        const href = match[1];
        
        // Skip empty links, anchors, and special protocols
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
          continue;
        }
        
        // Convert relative URLs to absolute
        let absoluteUrl: string;
        try {
          absoluteUrl = new URL(href, baseUrl).href;
        } catch {
          continue;
        }
        
        // Only include URLs from the same domain (for now - subdomain filtering comes later)
        try {
          const urlHost = new URL(absoluteUrl).hostname;
          if (urlHost === baseHost || urlHost.endsWith(`.${baseHost}`)) {
            urls.push(absoluteUrl);
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.warn(`Error crawling ${baseUrl}:`, error);
    }
    
    return urls;
  }

  /**
   * Apply filters to URLs
   */
  private applyFilters(
    urls: string[],
    baseUrl: URL,
    includeSubdomains: boolean,
    ignoreQueryParameters: boolean
  ): string[] {
    const baseHost = baseUrl.hostname;
    
    return urls.filter(url => {
      try {
        const urlObj = new URL(url);
        
        // Subdomain filtering
        if (!includeSubdomains) {
          // Only allow exact domain match
          if (urlObj.hostname !== baseHost) {
            return false;
          }
        }
        
        // Query parameter filtering
        if (ignoreQueryParameters && urlObj.search) {
          return false;
        }
        
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Apply search filter (keyword matching in URL path)
   */
  private applySearchFilter(urls: string[], searchTerm: string): string[] {
    const lowerSearch = searchTerm.toLowerCase();
    
    // Calculate relevance scores and sort
    const scoredUrls = urls.map(url => {
      const urlObj = new URL(url);
      let score = 0;
      
      // Exact path segment match (highest score)
      const pathSegments = urlObj.pathname.split('/').filter(s => s);
      if (pathSegments.some(seg => seg.toLowerCase() === lowerSearch)) {
        score += 100;
      }
      
      // Partial path match
      if (urlObj.pathname.toLowerCase().includes(lowerSearch)) {
        score += 50;
      }
      
      // Domain match
      if (urlObj.hostname.toLowerCase().includes(lowerSearch)) {
        score += 25;
      }
      
      return { url, score };
    });
    
    // Filter URLs that match (score > 0) and sort by relevance
    return scoredUrls
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.url);
  }

  /**
   * Extract lightweight metadata for URLs
   */
  private async extractMetadata(urls: string[]): Promise<Array<{url: string, title?: string, description?: string}>> {
    const results = [];
    
    for (const url of urls) {
      try {
        const metadata = await this.extractUrlMetadata(url);
        results.push({
          url,
          title: metadata.title,
          description: metadata.description,
        });
      } catch (error) {
        // If metadata extraction fails, still include the URL
        results.push({ url });
      }
    }
    
    return results;
  }

  /**
   * Extract metadata from a single URL using lightweight approach
   */
  private async extractUrlMetadata(url: string): Promise<{title?: string, description?: string}> {
    try {
      // Try HEAD request first (fastest)
      const headResponse = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Fireflare-Map/1.0)',
        },
      });

      // If HEAD fails, try GET with minimal content
      if (!headResponse.ok) {
        const getResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Fireflare-Map/1.0)',
          },
        });

        if (!getResponse.ok) {
          return {};
        }

        const html = await getResponse.text();
        return this.parseMetadataFromHtml(html);
      }

      // HEAD succeeded - we have basic info but need content for title/description
      // For now, return empty metadata from HEAD only
      return {};

    } catch (error) {
      // If all attempts fail, return empty metadata
      return {};
    }
  }

  /**
   * Parse title and description from HTML
   */
  private parseMetadataFromHtml(html: string): {title?: string, description?: string} {
    const result: {title?: string, description?: string} = {};
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
    }
    
    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
    
    // Also try Open Graph description
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (ogDescMatch && !result.description) {
      result.description = ogDescMatch[1].trim();
    }
    
    return result;
  }
}