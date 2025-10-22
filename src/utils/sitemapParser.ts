/**
 * Sitemap parser for discovering URLs from sitemap.xml
 */

export class SitemapParser {
  /**
   * Fetch and parse sitemap URLs
   */
  static async fetch(baseUrl: string): Promise<string[]> {
    try {
      const urlObj = new URL(baseUrl);
      const sitemapUrls = [
        `${urlObj.protocol}//${urlObj.host}/sitemap.xml`,
        `${urlObj.protocol}//${urlObj.host}/sitemap_index.xml`,
        `${urlObj.protocol}//${urlObj.host}/sitemaps.xml`
      ];
      
      const urls: string[] = [];
      
      for (const sitemapUrl of sitemapUrls) {
        try {
          const response = await fetch(sitemapUrl);
          if (response.ok) {
            const content = await response.text();
            const parsedUrls = this.parseSitemap(content, urlObj.origin);
            urls.push(...parsedUrls);
            break; // Stop after finding a valid sitemap
          }
        } catch (error) {
          // Try next sitemap URL
          continue;
        }
      }
      
      return urls;
    } catch (error) {
      console.warn(`Failed to fetch sitemap for ${baseUrl}:`, error);
      return [];
    }
  }
  
  /**
   * Parse sitemap XML content
   */
  private static parseSitemap(content: string, baseUrl: string): string[] {
    const urls: string[] = [];
    
    // Simple regex to extract URLs from sitemap
    const urlRegex = /<url>\s*<loc>([^<]+)<\/loc>/g;
    let match;
    
    while ((match = urlRegex.exec(content)) !== null) {
      const url = match[1].trim();
      if (url && url.startsWith('http')) {
        urls.push(url);
      }
    }
    
    // Also check for sitemap index files
    const sitemapIndexRegex = /<sitemap>\s*<loc>([^<]+)<\/loc>/g;
    
    while ((match = sitemapIndexRegex.exec(content)) !== null) {
      const sitemapUrl = match[1].trim();
      if (sitemapUrl && sitemapUrl.startsWith('http')) {
        // This is a sub-sitemap, we could fetch it recursively
        // For now, we'll just log it
        console.log(`Found sub-sitemap: ${sitemapUrl}`);
      }
    }
    
    return urls;
  }
}