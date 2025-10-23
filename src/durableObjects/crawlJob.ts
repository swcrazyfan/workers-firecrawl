import { extractContent } from "../utils/contentExtractor";
import { getBrowser, closeBrowser } from "../utils/browser";
import { RobotsParser } from "../utils/robotsParser";
import { SitemapParser } from "../utils/sitemapParser";
import type { CrawlRequest } from "../types/schemas";
import type { Env } from "../index";
import { extractStructuredData, extractWithPrompt } from "../utils/ai";

interface StartRequest {
  jobId: string;
  url: string;
  options: CrawlRequest;
}

export class CrawlJob {
  private state: DurableObjectState;
  private env: Env;
  private jobId: string;
  private options: CrawlRequest;
  private baseUrl: string;
  private robotsParser: RobotsParser | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    switch (url.pathname) {
      case "/start":
        return this.handleStart(request);
      case "/status":
        return this.handleStatus();
      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  async handleStart(request: Request): Promise<Response> {
    const { jobId, url, options } = await request.json() as StartRequest;
    
    this.jobId = jobId;
    this.baseUrl = url;
    this.options = options;
    
    // Initialize job in D1
    await this.env.DB.prepare(`
      INSERT INTO jobs (id, url, status, options, total, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      jobId,
      url,
      'pending',
      JSON.stringify(options),
      1, // Start with 1 URL in the queue
      Date.now(),
      Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
    ).run();
    
    // Add initial URL to queue
    await this.env.DB.prepare(`
      INSERT INTO url_queue (job_id, url, depth, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(jobId, url, 0, 'pending', Date.now()).run();
    
    console.log(`Crawl job ${jobId} initialized with URL: ${url}`);
    
    // Fetch and parse robots.txt
    this.state.waitUntil(this.initializeRobotsTxt());
    
    // Fetch sitemap if enabled
    if (this.options.sitemap === 'include') {
      this.state.waitUntil(this.initializeSitemap());
    }
    
    // Start crawling
    this.state.waitUntil(this.startCrawling());
    
    return Response.json({ success: true });
  }

  async handleStatus(): Promise<Response> {
    const job = await this.env.DB.prepare(`
      SELECT * FROM jobs WHERE id = ?
    `).bind(this.jobId).first();
    
    return Response.json(job);
  }

  async initializeRobotsTxt(): Promise<void> {
    try {
      console.log(`Fetching robots.txt for ${this.baseUrl}`);
      this.robotsParser = await RobotsParser.fetch(this.baseUrl, 'Firecrawl');
      const crawlDelay = this.robotsParser.getCrawlDelay();
      if (crawlDelay > 0) {
        console.log(`Robots.txt specifies crawl delay of ${crawlDelay}ms`);
        // Ensure our delay is at least as much as robots.txt requires
        if (this.options.delay < crawlDelay / 1000) {
          this.options.delay = crawlDelay / 1000;
        }
      }
    } catch (error) {
      console.error(`Failed to initialize robots.txt parser:`, error);
      this.robotsParser = null;
    }
  }

  async initializeSitemap(): Promise<void> {
    try {
      console.log(`Fetching sitemap for ${this.baseUrl}`);
      const sitemapUrls = await SitemapParser.fetch(this.baseUrl);
      console.log(`Found ${sitemapUrls.length} URLs in sitemap`);
      
      // Add sitemap URLs to queue (limit to avoid adding too many at once)
      const maxSitemapUrls = Math.min(sitemapUrls.length, 100);
      for (let i = 0; i < maxSitemapUrls; i++) {
        const url = sitemapUrls[i];
        
        // Check if URL should be crawled (respects robots.txt and other filters)
        if (this.shouldCrawl(url)) {
          await this.env.DB.prepare(`
            INSERT INTO url_queue (job_id, url, depth, status, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            this.jobId,
            url,
            0, // Sitemap URLs start at depth 0
            'pending',
            Date.now()
          ).run();
          
          // Update total count
          await this.env.DB.prepare(`
            UPDATE jobs SET total = total + 1 WHERE id = ?
          `).bind(this.jobId).run();
        }
      }
      
      console.log(`Added ${maxSitemapUrls} sitemap URLs to crawl queue`);
    } catch (error) {
      console.error(`Failed to initialize sitemap:`, error);
    }
  }

  async startCrawling(): Promise<void> {
    // Update job status
    await this.env.DB.prepare(`
      UPDATE jobs SET status = 'scraping', started_at = ? WHERE id = ?
    `).bind(Date.now(), this.jobId).run();
    
    let active = true;
    while (active) {
      // Get next URL from queue
      const urlRecord = await this.env.DB.prepare(`
        SELECT * FROM url_queue 
        WHERE job_id = ? AND status = 'pending'
        ORDER BY depth, id
        LIMIT 1
      `).bind(this.jobId).first();
      
      if (!urlRecord) {
        // No more URLs to process
        await this.completeCrawl();
        break;
      }
      
      // Mark as processing
      await this.env.DB.prepare(`
        UPDATE url_queue SET status = 'processing' WHERE id = ?
      `).bind(urlRecord.id).run();
      
      try {
        // Process the URL
        await this.processUrl(urlRecord.url as string);
        
        // Mark as completed
        await this.env.DB.prepare(`
          UPDATE url_queue SET status = 'completed' WHERE id = ?
        `).bind(urlRecord.id).run();
        
      } catch (error) {
        // Mark as failed
        await this.env.DB.prepare(`
          UPDATE url_queue SET status = 'failed' WHERE id = ?
        `).bind(urlRecord.id).run();
        
        console.error(`Failed to process ${urlRecord.url}:`, error);
        console.error(`Error details:`, JSON.stringify(error, null, 2));
      }
      
      // Check if we've hit the limit
      const job = await this.env.DB.prepare(`
        SELECT completed, options FROM jobs WHERE id = ?
      `).bind(this.jobId).first();
      
      const options = JSON.parse(job.options as string);
      if (job.completed >= options.limit) {
        await this.completeCrawl();
        break;
      }
      
      // Delay between requests if specified
      if (this.options.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.options.delay * 1000));
      }
    }
  }

  async processUrl(url: string): Promise<void> {
    const browser = await getBrowser(this.env);
    
    try {
      // Extract format types from scrapeOptions
      const formatTypes: string[] = [];
      let screenshotOptions: any = undefined;
      let jsonFormat: any = undefined;

      if (this.options.scrapeOptions?.formats) {
        for (const format of this.options.scrapeOptions.formats) {
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
              // Store JSON format for later processing
              jsonFormat = formatObj;
              formatTypes.push('markdown'); // Need markdown for extraction
            } else if (formatObj.type === 'changeTracking') {
              formatTypes.push('markdown'); // Fallback to markdown
            }
          }
        }
      }

      // Default to markdown if no formats specified
      if (formatTypes.length === 0) {
        formatTypes.push('markdown');
      }

      // Always include HTML for link discovery (but don't add it if it's already there)
      if (!formatTypes.includes('html')) {
        formatTypes.push('html');
      }

      // Extract content using existing utility
      const result = await extractContent(browser, url, {
        formats: formatTypes,
        screenshot: screenshotOptions,
        actions: this.options.scrapeOptions?.actions,
        headers: this.options.scrapeOptions?.headers,
        timeout: this.options.scrapeOptions?.timeout,
        waitFor: this.options.scrapeOptions?.waitFor,
        excludeTags: this.options.scrapeOptions?.excludeTags,
        onlyMainContent: this.options.scrapeOptions?.onlyMainContent,
        includeTags: this.options.scrapeOptions?.includeTags,
        mobile: this.options.scrapeOptions?.mobile,
        removeBase64Images: this.options.scrapeOptions?.removeBase64Images,
        blockAds: this.options.scrapeOptions?.blockAds,
      });
      
      // Perform JSON extraction if requested
      if (jsonFormat && result.markdown) {
        try {
          let extractionResult;
          
          // Use schema-based extraction if schema is provided
          if (jsonFormat.schema) {
            extractionResult = await extractStructuredData(
              result.markdown,
              {
                schema: jsonFormat.schema,
                prompt: jsonFormat.prompt
              },
              this.env
            );
          } 
          // Use prompt-based extraction if only prompt is provided
          else if (jsonFormat.prompt) {
            extractionResult = await extractWithPrompt(
              result.markdown,
              {
                prompt: jsonFormat.prompt,
                outputFormat: 'json'
              },
              this.env
            );
          }
          
          if (extractionResult && extractionResult.success) {
            result.json = extractionResult.data;
          }
        } catch (error) {
          console.warn(`JSON extraction failed for ${url}:`, error);
          // Continue without JSON data
        }
      }
      
      // Store result in D1
      await this.env.DB.prepare(`
        INSERT INTO results (job_id, url, markdown, html, raw_html, links, metadata, json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        this.jobId,
        url,
        result.markdown || null,
        result.html || null,
        result.rawHtml || null,
        JSON.stringify(result.links || []),
        JSON.stringify(result.metadata || {}),
        result.json ? JSON.stringify(result.json) : null,
        Date.now()
      ).run();
      
      console.log(`Successfully processed and stored result for URL: ${url}`);
      console.log(`Result has rawHtml: ${!!result.rawHtml}, html: ${!!result.html}, json: ${!!result.json}`);
      
      // Discover new URLs
      const htmlContent = result.rawHtml || result.html || "";
      console.log(`HTML content length: ${htmlContent.length}`);
      
      const newUrls = await this.discoverLinks(htmlContent, url);
      
      console.log(`Discovered ${newUrls.length} new URLs from ${url}`);
      if (newUrls.length > 0) {
        console.log(`First few URLs: ${newUrls.slice(0, 3).join(', ')}`);
      }
      
      // Add new URLs to queue
      for (const newUrl of newUrls) {
        await this.env.DB.prepare(`
          INSERT INTO url_queue (job_id, url, depth, status, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          this.jobId,
          newUrl,
          this.getCurrentDepth(url) + 1,
          'pending',
          Date.now()
        ).run();
        
        // Update total count
        await this.env.DB.prepare(`
          UPDATE jobs SET total = total + 1 WHERE id = ?
        `).bind(this.jobId).run();
      }
      
      // Update job counters
      await this.env.DB.prepare(`
        UPDATE jobs SET completed = completed + 1 WHERE id = ?
      `).bind(this.jobId).run();
      
      console.log(`Updated completed count for job ${this.jobId}`);
      
    } finally {
      await closeBrowser(browser);
    }
  }

  async discoverLinks(html: string, sourceUrl: string): Promise<string[]> {
    // Extract links from HTML
    const links: string[] = [];
    const urlRegex = /href=["']([^"']+)["']/g;
    let match;
    
    while ((match = urlRegex.exec(html)) !== null) {
      let url = match[1];
      
      // Skip anchors, javascript, etc.
      if (url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) {
        continue;
      }
      
      // Convert relative URLs to absolute
      if (url.startsWith('/')) {
        const baseUrl = new URL(sourceUrl);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      } else if (!url.startsWith('http')) {
        url = new URL(url, sourceUrl).href;
      }
      
      links.push(url);
    }
    
    // Filter links based on options
    return links.filter(link => this.shouldCrawl(link));
  }

  shouldCrawl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const baseUrlObj = new URL(this.baseUrl);
      
      // Check robots.txt if available
      if (this.robotsParser && !this.robotsParser.isAllowed(url)) {
        console.log(`URL disallowed by robots.txt: ${url}`);
        return false;
      }
      
      // Check depth limit
      const depth = this.getCurrentDepth(url);
      if (depth > this.options.maxDiscoveryDepth) {
        return false;
      }
      
      // Check external links
      if (!this.options.allowExternalLinks && urlObj.hostname !== baseUrlObj.hostname) {
        return false;
      }
      
      // Check subdomains
      if (!this.options.allowSubdomains && urlObj.hostname !== baseUrlObj.hostname) {
        return false;
      }
      
      // Check if we should crawl entire domain
      if (!this.options.crawlEntireDomain && !url.startsWith(this.baseUrl)) {
        // Only crawl child paths of the original URL
        const baseUrlPath = new URL(this.baseUrl).pathname;
        const urlPath = new URL(url).pathname;
        if (!urlPath.startsWith(baseUrlPath)) {
          return false;
        }
      }
      
      // Check include/exclude patterns
      if (this.options.includePaths.length > 0) {
        const matchesInclude = this.options.includePaths.some(pattern => 
          new RegExp(pattern).test(urlObj.pathname)
        );
        if (!matchesInclude) return false;
      }
      
      if (this.options.excludePaths.length > 0) {
        const matchesExclude = this.options.excludePaths.some(pattern => 
          new RegExp(pattern).test(urlObj.pathname)
        );
        if (matchesExclude) return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  getCurrentDepth(url: string): number {
    // Calculate depth based on URL path
    const urlObj = new URL(url);
    const baseUrlObj = new URL(this.baseUrl);
    
    if (urlObj.hostname !== baseUrlObj.hostname) {
      return Infinity; // External link
    }
    
    // Simple depth calculation based on path
    const basePath = baseUrlObj.pathname;
    const currentPath = urlObj.pathname;
    
    if (!currentPath.startsWith(basePath)) {
      return Infinity; // Different path branch
    }
    
    const extraPath = currentPath.substring(basePath.length);
    return extraPath.split('/').length - 1;
  }

  async completeCrawl(): Promise<void> {
    console.log(`Completing crawl job ${this.jobId}`);
    await this.env.DB.prepare(`
      UPDATE jobs SET 
        status = 'completed',
        completed_at = ?,
        expires_at = ?
      WHERE id = ?
    `).bind(
      Date.now(),
      Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      this.jobId
    ).run();
    
    console.log(`Crawl job ${this.jobId} marked as completed`);
    
    // Set cleanup alarm
    await this.state.storage.setAlarm(
      Date.now() + (7 * 24 * 60 * 60 * 1000)
    );
  }

  async alarm(): Promise<void> {
    // Delete all data for this job
    await this.env.DB.prepare(`
      DELETE FROM results WHERE job_id = ?
    `).bind(this.jobId).run();
    
    await this.env.DB.prepare(`
      DELETE FROM url_queue WHERE job_id = ?
    `).bind(this.jobId).run();
    
    await this.env.DB.prepare(`
      DELETE FROM jobs WHERE id = ?
    `).bind(this.jobId).run();
    
    // Clean up DO storage
    await this.state.storage.deleteAll();
  }
}