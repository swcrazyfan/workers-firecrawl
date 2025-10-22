/**
 * Simple robots.txt parser for checking if URLs are allowed to be crawled
 */

export class RobotsParser {
  private allowedPaths: string[] = [];
  private disallowedPaths: string[] = [];
  private userAgent: string;
  private crawlDelay: number = 0;

  constructor(userAgent: string = '*', content?: string) {
    this.userAgent = userAgent;
    if (content) {
      this.parse(content);
    }
  }

  /**
   * Parse robots.txt content
   */
  private parse(content: string): void {
    const lines = content.split('\n');
    let currentUserAgent = '*';
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Check for User-agent directive
      if (trimmedLine.toLowerCase().startsWith('user-agent:')) {
        currentUserAgent = trimmedLine.substring(11).trim();
        continue;
      }
      
      // Only process directives for our user agent or wildcard
      if (currentUserAgent !== '*' && 
          currentUserAgent !== this.userAgent && 
          !this.userAgent.includes(currentUserAgent)) {
        continue;
      }
      
      // Process Allow directives
      if (trimmedLine.toLowerCase().startsWith('allow:')) {
        const path = trimmedLine.substring(6).trim();
        if (path) {
          this.allowedPaths.push(path);
        }
        continue;
      }
      
      // Process Disallow directives
      if (trimmedLine.toLowerCase().startsWith('disallow:')) {
        const path = trimmedLine.substring(9).trim();
        if (path) {
          this.disallowedPaths.push(path);
        }
        continue;
      }
      
      // Process Crawl-delay directive
      if (trimmedLine.toLowerCase().startsWith('crawl-delay:')) {
        const delay = parseFloat(trimmedLine.substring(12).trim());
        if (!isNaN(delay)) {
          this.crawlDelay = delay * 1000; // Convert to milliseconds
        }
        continue;
      }
    }
  }

  /**
   * Check if a URL is allowed to be crawled
   */
  isAllowed(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      // First check explicit allows
      for (const allowedPath of this.allowedPaths) {
        if (pathname.startsWith(allowedPath)) {
          return true;
        }
      }
      
      // Then check disallows
      for (const disallowedPath of this.disallowedPaths) {
        if (pathname.startsWith(disallowedPath)) {
          return false;
        }
      }
      
      // If no rules match, allow by default
      return true;
    } catch {
      // Invalid URL, disallow by default
      return false;
    }
  }

  /**
   * Get the crawl delay in milliseconds
   */
  getCrawlDelay(): number {
    return this.crawlDelay;
  }

  /**
   * Fetch and parse robots.txt for a domain
   */
  static async fetch(url: string, userAgent: string = '*'): Promise<RobotsParser> {
    try {
      const urlObj = new URL(url);
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
      
      const response = await fetch(robotsUrl);
      if (response.ok) {
        const content = await response.text();
        return new RobotsParser(userAgent, content);
      }
    } catch (error) {
      console.warn(`Failed to fetch robots.txt for ${url}:`, error);
    }
    
    // Return empty parser if robots.txt couldn't be fetched
    return new RobotsParser(userAgent);
  }
}