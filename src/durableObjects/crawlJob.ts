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
      case "/start-extract":
        return this.handleStartExtract(request);
      case "/status":
        return this.handleStatus();
      case "/status-extract":
        return this.handleExtractStatus();
      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  async handleStart(request: Request): Promise<Response> {
    const { jobId, url, options } = await request.json() as StartRequest;
    
    // Set instance variables (only for immediate use in this method)
    this.jobId = jobId;
    this.baseUrl = url;
    this.options = options;
    
    // Initialize job in D1 (single source of truth)
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
    
    // Pass jobId to all async methods so they can load state from D1
    this.state.waitUntil(this.initializeRobotsTxt(jobId));
    
    // Fetch sitemap if enabled
    if (options.sitemap === 'include') {
      this.state.waitUntil(this.initializeSitemap(jobId));
    }
    
    // Start crawling - pass jobId so it can load state from D1
    this.state.waitUntil(this.startCrawling(jobId));
    
    return Response.json({ success: true });
  }

  async handleStatus(): Promise<Response> {
    // Get jobId from the Durable Object ID (it was created with idFromName(jobId))
    const jobId = await this.state.storage.get('jobId') as string;
    
    if (!jobId) {
      // Fallback: try to get from any job in the database for this DO
      // This shouldn't happen but provides a safety net
      return Response.json(
        { success: false, error: "Job ID not found" },
        { status: 404 }
      );
    }
    
    const job = await this.env.DB.prepare(`
      SELECT * FROM jobs WHERE id = ?
    `).bind(jobId).first();
    
    if (!job) {
      return Response.json(
        { success: false, error: "Job not found" },
        { status: 404 }
      );
    }
    
    return Response.json(job);
  }

  async handleStartExtract(request: Request): Promise<Response> {
    const body = await request.json() as any;
    const { jobId, urls, prompt, schema, enableWebSearch, scrapeOptions, agent } = body;
    
    // Store jobId in DO storage for status checks and alarm cleanup
    await this.state.storage.put('jobId', jobId);
    
    // Store extract-specific options in DO storage (only if defined)
    if (prompt !== undefined) {
      await this.state.storage.put('extractPrompt', prompt);
    }
    if (schema !== undefined) {
      await this.state.storage.put('extractSchema', schema);
    }
    if (agent !== undefined) {
      await this.state.storage.put('extractAgent', agent);
    }
    
    // Initialize job in D1
    await this.env.DB.prepare(`
      INSERT INTO jobs (id, url, status, options, total, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      jobId,
      urls.join(','),
      'processing',
      JSON.stringify({ prompt, schema, enableWebSearch, agent, scrapeOptions }),
      urls.length,
      Date.now(),
      Date.now() + (24 * 60 * 60 * 1000)
    ).run();
    
    // Add all URLs to queue
    for (const url of urls) {
      await this.env.DB.prepare(`
        INSERT INTO url_queue (job_id, url, depth, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(jobId, url, 0, 'pending', Date.now()).run();
    }
    
    console.log(`Extract job ${jobId} initialized with ${urls.length} URLs`);
    
    // Start extraction - pass jobId
    this.state.waitUntil(this.startExtraction(jobId));
    
    return Response.json({ success: true });
  }

  async handleExtractStatus(): Promise<Response> {
    // Get jobId from DO storage
    const jobId = await this.state.storage.get('jobId') as string;
    
    if (!jobId) {
      return Response.json(
        { success: false, error: "Job ID not found" },
        { status: 404 }
      );
    }
    
    const job = await this.env.DB.prepare(`
      SELECT * FROM jobs WHERE id = ?
    `).bind(jobId).first();
    
    if (!job) {
      return Response.json(
        { success: false, error: "Job not found" },
        { status: 404 }
      );
    }
    
    // Get all results
    const results = await this.env.DB.prepare(`
      SELECT * FROM results WHERE job_id = ? ORDER BY created_at
    `).bind(jobId).all();
    
    // Aggregate JSON results
    let extractedData: any = null;
    
    if (job.status === 'completed' && results.results.length > 0) {
      const jsonResults = results.results
        .map(result => result.json ? JSON.parse(result.json as string) : null)
        .filter(json => json !== null);
      
      if (jsonResults.length === 1) {
        extractedData = jsonResults[0];
      } else if (jsonResults.length > 1) {
        extractedData = jsonResults;
      }
    }
    
    return Response.json({
      success: true,
      status: job.status,
      data: extractedData,
      expiresAt: new Date(job.expires_at as number).toISOString(),
      tokensUsed: job.status === 'completed' ? (job.completed as number) : undefined,
      error: job.error as string | undefined,
    });
  }

  async startExtraction(jobId: string): Promise<void> {
    // Load extract-specific options from DO storage
    const prompt = await this.state.storage.get('extractPrompt') as string;
    const schema = await this.state.storage.get('extractSchema');
    
    // Load job from D1
    const job = await this.env.DB.prepare(`
      SELECT * FROM jobs WHERE id = ?
    `).bind(jobId).first();
    
    if (!job) {
      console.error(`Extract job ${jobId} not found`);
      return;
    }
    
    // Set instance variables
    this.jobId = jobId;
    const options = JSON.parse(job.options as string);
    this.options = {
      url: '',
      limit: job.total as number,
      scrapeOptions: options.scrapeOptions || {},
      maxDiscoveryDepth: 1,
      crawlEntireDomain: false,
      allowSubdomains: false,
      allowExternalLinks: options.enableWebSearch || false,
      includePaths: [],
      excludePaths: [],
      ignoreQueryParameters: false,
      sitemap: 'skip',
      delay: 0,
      maxConcurrency: 3,
    };
    
    let active = true;
    while (active) {
      const urlRecord = await this.env.DB.prepare(`
        SELECT * FROM url_queue 
        WHERE job_id = ? AND status = 'pending'
        ORDER BY id
        LIMIT 1
      `).bind(jobId).first();
      
      if (!urlRecord) {
        await this.completeExtraction(jobId);
        break;
      }
      
      await this.env.DB.prepare(`
        UPDATE url_queue SET status = 'processing' WHERE id = ?
      `).bind(urlRecord.id).run();
      
      try {
        await this.processExtractUrl(urlRecord.url as string, prompt, schema);
        
        await this.env.DB.prepare(`
          UPDATE url_queue SET status = 'completed' WHERE id = ?
        `).bind(urlRecord.id).run();
        
      } catch (error) {
        await this.env.DB.prepare(`
          UPDATE url_queue SET status = 'failed' WHERE id = ?
        `).bind(urlRecord.id).run();
        
        console.error(`Failed to extract from ${urlRecord.url}:`, error);
      }
    }
  }

  async processExtractUrl(url: string, prompt: string, schema: any): Promise<void> {
    const browser = await getBrowser(this.env);
    
    try {
      // Extract content with markdown
      const result = await extractContent(browser, url, {
        formats: ['markdown'],
        onlyMainContent: this.options.scrapeOptions?.onlyMainContent,
        timeout: this.options.scrapeOptions?.timeout,
      });
      
      // Perform extraction using prompt and/or schema
      if (result.markdown) {
        try {
          let extractionResult;
          
          if (schema) {
            extractionResult = await extractStructuredData(
              result.markdown,
              { schema, prompt },
              this.env
            );
          } else if (prompt) {
            extractionResult = await extractWithPrompt(
              result.markdown,
              { prompt, outputFormat: 'json' },
              this.env
            );
          }
          
          if (extractionResult && extractionResult.success) {
            result.json = extractionResult.data;
          }
        } catch (error) {
          console.warn(`Extraction failed for ${url}:`, error);
        }
      }
      
      // Store result
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
      
      // Update job counters
      await this.env.DB.prepare(`
        UPDATE jobs SET completed = completed + 1 WHERE id = ?
      `).bind(this.jobId).run();
      
    } finally {
      await closeBrowser(browser);
    }
  }

  async completeExtraction(jobId: string): Promise<void> {
    console.log(`Completing extract job ${jobId}`);
    await this.env.DB.prepare(`
      UPDATE jobs SET 
        status = 'completed',
        completed_at = ?,
        expires_at = ?
      WHERE id = ?
    `).bind(
      Date.now(),
      Date.now() + (24 * 60 * 60 * 1000),
      jobId
    ).run();
    
    // Set cleanup alarm
    await this.state.storage.setAlarm(
      Date.now() + (24 * 60 * 60 * 1000)
    );
  }

  async initializeRobotsTxt(jobId: string): Promise<void> {
    try {
      // Load job from D1
      const job = await this.env.DB.prepare(`
        SELECT url, options FROM jobs WHERE id = ?
      `).bind(jobId).first();
      
      if (!job) {
        console.error(`Job ${jobId} not found for robots.txt initialization`);
        return;
      }
      
      const baseUrl = job.url as string;
      const options = JSON.parse(job.options as string) as CrawlRequest;
      
      console.log(`Fetching robots.txt for ${baseUrl}`);
      this.robotsParser = await RobotsParser.fetch(baseUrl, 'Firecrawl');
      const crawlDelay = this.robotsParser.getCrawlDelay();
      if (crawlDelay > 0) {
        console.log(`Robots.txt specifies crawl delay of ${crawlDelay}ms`);
        // Ensure our delay is at least as much as robots.txt requires
        if (options.delay < crawlDelay / 1000) {
          // Update crawl options in D1
          const updatedOptions = { ...options, delay: crawlDelay / 1000 };
          await this.env.DB.prepare(`
            UPDATE jobs SET options = ? WHERE id = ?
          `).bind(JSON.stringify(updatedOptions), jobId).run();
        }
      }
    } catch (error) {
      console.error(`Failed to initialize robots.txt parser:`, error);
      this.robotsParser = null;
    }
  }

  async initializeSitemap(jobId: string): Promise<void> {
    try {
      // Load job from D1
      const job = await this.env.DB.prepare(`
        SELECT url, options FROM jobs WHERE id = ?
      `).bind(jobId).first();
      
      if (!job) {
        console.error(`Job ${jobId} not found for sitemap initialization`);
        return;
      }
      
      const baseUrl = job.url as string;
      const options = JSON.parse(job.options as string) as CrawlRequest;
      
      console.log(`Fetching sitemap for ${baseUrl}`);
      const sitemapUrls = await SitemapParser.fetch(baseUrl);
      console.log(`Found ${sitemapUrls.length} URLs in sitemap`);
      
      // Temporarily set instance variables for shouldCrawl to work
      this.baseUrl = baseUrl;
      this.options = options;
      
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
            jobId,
            url,
            0, // Sitemap URLs start at depth 0
            'pending',
            Date.now()
          ).run();
          
          // Update total count in job
          await this.env.DB.prepare(`
            UPDATE jobs SET total = total + 1 WHERE id = ?
          `).bind(jobId).run();
        }
      }
      
      console.log(`Added ${maxSitemapUrls} sitemap URLs to crawl queue`);
    } catch (error) {
      console.error(`Failed to initialize sitemap:`, error);
    }
  }

  async startCrawling(jobId: string): Promise<void> {
    // Load complete job state from D1
    const job = await this.env.DB.prepare(`
      SELECT * FROM jobs WHERE id = ?
    `).bind(jobId).first();
    
    if (!job) {
      console.error(`Crawl job ${jobId} not found in database`);
      return;
    }
    
    // Set instance variables from D1 data
    this.jobId = job.id as string;
    this.baseUrl = job.url as string;
    this.options = JSON.parse(job.options as string) as CrawlRequest;
    
    console.log(`Starting crawl for job ${this.jobId}, baseUrl: ${this.baseUrl}`);
    
    // Update job status
    await this.env.DB.prepare(`
      UPDATE jobs SET status = 'scraping', started_at = ? WHERE id = ?
    `).bind(Date.now(), jobId).run();
    
    let active = true;
    while (active) {
      // Get next URL from queue
      const urlRecord = await this.env.DB.prepare(`
        SELECT * FROM url_queue 
        WHERE job_id = ? AND status = 'pending'
        ORDER BY depth, id
        LIMIT 1
      `).bind(jobId).first();
      
      if (!urlRecord) {
        // No more URLs to process
        await this.completeCrawl(jobId);
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
        
        // Increment completed counter
        await this.env.DB.prepare(`
          UPDATE jobs SET completed = completed + 1 WHERE id = ?
        `).bind(jobId).run();
        
      } catch (error) {
        // Mark as failed
        await this.env.DB.prepare(`
          UPDATE url_queue SET status = 'failed' WHERE id = ?
        `).bind(urlRecord.id).run();
        
        console.error(`Failed to process ${urlRecord.url}:`, error);
        console.error(`Error details:`, JSON.stringify(error, null, 2));
      }
      
      // Check if we've hit the limit
      const currentJob = await this.env.DB.prepare(`
        SELECT completed, options FROM jobs WHERE id = ?
      `).bind(jobId).first();
      
      const options = JSON.parse(currentJob.options as string);
      if (currentJob.completed >= options.limit) {
        await this.completeCrawl(jobId);
        break;
      }
      
      // Delay between requests if specified
      if (this.options.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.options.delay * 1000));
      }
    }
  }

  async processUrl(url: string): Promise<void> {
    // Defensive check: ensure state is loaded
    if (!this.jobId || !this.baseUrl || !this.options) {
      const errorMsg = `processUrl called without state: jobId=${this.jobId}, baseUrl=${this.baseUrl}, options=${!!this.options}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log(`Processing URL: ${url} for job ${this.jobId}`);
    
    const browser = await getBrowser(this.env);
    
    try {
      // Extract format types from scrapeOptions
      const formatTypes: string[] = [];
      let screenshotOptions: any = undefined;
      let jsonFormat: any = undefined;

      if (this.options.scrapeOptions?.formats) {
        for (const format of this.options.scrapeOptions.formats) {
          if (typeof (format as any).type === 'string') {
            if ((format as any).type === 'screenshot') {
              formatTypes.push('screenshot');
              screenshotOptions = { fullPage: (format as any).fullPage, quality: (format as any).quality };
            }
            if ((format as any).type === 'json') {
              jsonFormat = format as any;
              formatTypes.push('markdown');
            }
            if ((format as any).type === 'changeTracking') {
              formatTypes.push('markdown');
            }
          }
          if (typeof format === 'string') {
            formatTypes.push(format);
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
        // Check if URL already exists in queue to prevent duplicates
        const existingUrl = await this.env.DB.prepare(`
          SELECT id FROM url_queue WHERE job_id = ? AND url = ?
        `).bind(this.jobId, newUrl).first();
        
        if (existingUrl) {
          // URL already in queue, skip it
          continue;
        }
        
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
      
      console.log(`Finished processing URL: ${url}`);
      
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

  async completeCrawl(jobId: string): Promise<void> {
    console.log(`Completing crawl job ${jobId}`);
    await this.env.DB.prepare(`
      UPDATE jobs SET 
        status = 'completed',
        completed_at = ?,
        expires_at = ?
      WHERE id = ?
    `).bind(
      Date.now(),
      Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      jobId
    ).run();
    
    console.log(`Crawl job ${jobId} marked as completed`);
    
    // Set cleanup alarm
    await this.state.storage.setAlarm(
      Date.now() + (7 * 24 * 60 * 60 * 1000)
    );
  }

  async alarm(): Promise<void> {
    // Load jobId from storage (needed for cleanup)
    const jobId = await this.state.storage.get('jobId') as string;
    
    if (!jobId) {
      console.error('No jobId found in storage for cleanup');
      return;
    }
    
    // Delete all D1 data for this job
    await this.env.DB.prepare(`
      DELETE FROM results WHERE job_id = ?
    `).bind(jobId).run();
    
    await this.env.DB.prepare(`
      DELETE FROM url_queue WHERE job_id = ?
    `).bind(jobId).run();
    
    await this.env.DB.prepare(`
      DELETE FROM jobs WHERE id = ?
    `).bind(jobId).run();
    
    // Clean up DO storage (remove jobId, baseUrl, options, etc.)
    await this.state.storage.deleteAll();
  }
}