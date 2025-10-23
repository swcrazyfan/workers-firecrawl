/**
 * Sitemap parser for discovering URLs from sitemap.xml
 */

export class SitemapParser {
  private static readonly MAX_RECURSION_DEPTH = 3;

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
      
      const urlSet = new Set<string>();
      const visitedSitemaps = new Set<string>();
      
      for (const sitemapUrl of sitemapUrls) {
        try {
          const response = await fetch(sitemapUrl);
          if (response.ok) {
            const content = await response.text();
            visitedSitemaps.add(sitemapUrl);
            await this.parseSitemapRecursive(content, urlObj.origin, urlSet, visitedSitemaps, 0);
            break; // Stop after finding a valid sitemap
          }
        } catch (error) {
          // Try next sitemap URL
          continue;
        }
      }
      
      return Array.from(urlSet);
    } catch (error) {
      console.warn(`Failed to fetch sitemap for ${baseUrl}:`, error);
      return [];
    }
  }
  
  /**
   * Recursively parse sitemap XML content and fetch sub-sitemaps
   */
  private static async parseSitemapRecursive(
    content: string,
    baseUrl: string,
    urlSet: Set<string>,
    visitedSitemaps: Set<string>,
    depth: number
  ): Promise<void> {
    // Extract regular URLs from sitemap
    const urlRegex = /<url>\s*<loc>([^<]+)<\/loc>/g;
    let match;
    
    while ((match = urlRegex.exec(content)) !== null) {
      const url = match[1].trim();
      if (url && url.startsWith('http')) {
        urlSet.add(url);
      }
    }
    
    // Check for sitemap index files and fetch them recursively
    if (depth < this.MAX_RECURSION_DEPTH) {
      const sitemapIndexRegex = /<sitemap>\s*<loc>([^<]+)<\/loc>/g;
      const subSitemaps: string[] = [];
      
      while ((match = sitemapIndexRegex.exec(content)) !== null) {
        const sitemapUrl = match[1].trim();
        if (sitemapUrl && sitemapUrl.startsWith('http') && !visitedSitemaps.has(sitemapUrl)) {
          subSitemaps.push(sitemapUrl);
          visitedSitemaps.add(sitemapUrl);
        }
      }
      
      // Fetch sub-sitemaps recursively
      if (subSitemaps.length > 0) {
        console.log(`Found ${subSitemaps.length} sub-sitemaps at depth ${depth}, fetching...`);
        
        for (const subSitemapUrl of subSitemaps) {
          try {
            const response = await fetch(subSitemapUrl);
            if (response.ok) {
              const subContent = await response.text();
              await this.parseSitemapRecursive(subContent, baseUrl, urlSet, visitedSitemaps, depth + 1);
            }
          } catch (error) {
            console.warn(`Failed to fetch sub-sitemap ${subSitemapUrl}:`, error);
          }
        }
      }
    } else {
      console.log(`Max recursion depth (${this.MAX_RECURSION_DEPTH}) reached, stopping sitemap traversal`);
    }
  }
}