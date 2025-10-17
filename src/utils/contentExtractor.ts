import { NodeHtmlMarkdown } from "node-html-markdown";
import type { Browser } from "@cloudflare/puppeteer";
import type { BrowserAction, ScreenshotOptions } from "../types/schemas";
import { createPage, setCustomHeaders, navigateToPage, waitForSelector, takeScreenshot } from "./browser";
import { buildDuckDuckGoUrl, type DuckDuckGoSearchOptions } from "./searchParams";

interface ExtractOptions {
  formats?: string[];
  screenshot?: ScreenshotOptions;
  actions?: BrowserAction[];
  headers?: Record<string, string>;
  timeout?: number;
  waitFor?: number | string;
  removeTags?: string[];
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  mobile?: boolean;
  removeBase64Images?: boolean;
  blockAds?: boolean;
}

/**
 * Extracts content from a web page using the provided browser instance
 * @param browser - The Puppeteer Browser instance
 * @param url - The URL to extract content from
 * @param options - Extraction options
 * @returns Promise<Object> - The extracted content in various formats
 */
export async function extractContent(
  browser: Browser,
  url: string,
  options: ExtractOptions = {}
) {
  const page = await createPage(browser);
  
  try {
    // Set custom headers if provided
    if (options.headers) {
      await setCustomHeaders(page, options.headers);
    }

    // Set mobile viewport if requested
    if (options.mobile) {
      await page.setViewport({ width: 375, height: 667, isMobile: true });
    }

    // Navigate to page
    const response = await navigateToPage(page, url, {
      timeout: options.timeout || 60000
    });
    const statusCode = response ? response.status() : 0;

    // Wait for specific time or selector if provided
    if (typeof options.waitFor === "number" && options.waitFor > 0) {
      await page.waitForTimeout(options.waitFor);
    } else if (typeof options.waitFor === "string") {
      await waitForSelector(page, options.waitFor, options.timeout || 60000);
    }

    // Execute browser actions (click, type, etc.)
    if (options.actions && options.actions.length > 0) {
      await executeBrowserActions(page, options.actions);
    }

    // Close popups (existing logic)
    await closePopups(page);

    // Remove unwanted tags if specified
    if (options.excludeTags && options.excludeTags.length > 0) {
      await page.evaluate((tags) => {
        tags.forEach(tag => {
          document.querySelectorAll(tag).forEach(el => el.remove());
        });
      }, options.excludeTags);
    }

    // Only keep main content if specified
    if (options.onlyMainContent) {
      await page.evaluate(() => {
        // Remove common non-content elements
        const selectorsToRemove = [
          "script", "style", "nav", "header", "footer", 
          ".sidebar", ".menu", ".navigation", ".ads", ".advertisement",
          ".cookie-banner", ".popup", ".modal", ".overlay"
        ];
        
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });
      });
    }

    // Extract based on requested formats
    const result: any = {
      metadata: {
        title: "",
        description: "",
        sourceURL: url,
        statusCode: statusCode,
        error: null,
      }
    };

    // Get title and description
    const { title, description, content, language, keywords } = await page.evaluate(() => {
      const pageTitle = document.title || "No title available";
      const metaDescription = document.querySelector('meta[name="description"]');
      const descriptionText = metaDescription?.getAttribute("content") || "No description available";
      const htmlLang = document.documentElement.lang || "en";
      const metaKeywords = document.querySelector('meta[name="keywords"]');
      const keywordsText = metaKeywords?.getAttribute("content") || "";
      
      const body = document.body.cloneNode(true) as HTMLElement;
      body.querySelectorAll("script, style").forEach(el => el.remove());
      
      return {
        title: pageTitle,
        description: descriptionText,
        content: body.outerHTML || "No content extracted",
        language: htmlLang,
        keywords: keywordsText,
      };
    });

    result.metadata.title = title;
    result.metadata.description = description;
    result.metadata.language = language;
    result.metadata.keywords = keywords;

    // Add requested formats
    const formats = options.formats || ["markdown"];

    if (formats.includes("markdown")) {
      result.markdown = NodeHtmlMarkdown.translate(content);
    }

    if (formats.includes("html")) {
      result.html = content;
    }

    if (formats.includes("rawHtml")) {
      result.rawHtml = await page.content();
    }

    if (formats.includes("links")) {
      result.links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a"))
          .map(a => a.href)
          .filter(href => href && href.startsWith("http"));
      });
    }

    if (formats.includes("screenshot")) {
      const screenshotOptions = options.screenshot || {};
      result.screenshot = await takeScreenshot(page, screenshotOptions);
    }

    if (formats.includes("metadata")) {
      // Additional metadata extraction
      const additionalMetadata = await page.evaluate(() => {
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
        const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content");
        const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
        
        return {
          ogImage,
          ogTitle,
          ogDescription,
          canonical,
        };
      });
      
      result.metadata = {
        ...result.metadata,
        ...additionalMetadata,
      };
    }

    return result;

  } catch (error) {
    console.error(`Content extraction failed for ${url}:`, error);
    return {
      metadata: {
        title: "",
        description: "",
        sourceURL: url,
        statusCode: 0,
        error: (error as Error).message,
      },
      error: (error as Error).message
    };
  } finally {
    await page.close();
  }
}

/**
 * Executes browser actions on a page
 * @param page - The Puppeteer Page instance
 * @param actions - Array of browser actions to execute
 */
async function executeBrowserActions(page: any, actions: BrowserAction[]): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.type) {
        case "wait":
          const waitTime = action.milliseconds || action.timeout || 1000;
          await page.waitForTimeout(waitTime);
          break;
          
        case "click":
          if (action.selector) {
            await page.click(action.selector);
            await page.waitForTimeout(500); // Brief wait after click
          }
          break;
          
        case "type":
          if (action.selector && action.text) {
            await page.type(action.selector, action.text);
          }
          break;
          
        case "scroll":
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await page.waitForTimeout(1000); // Wait for content to load
          break;
          
        case "executeJavaScript":
          if (action.javascript) {
            await page.evaluate(action.javascript);
          }
          break;
      }
    } catch (error) {
      console.warn(`Action ${action.type} failed:`, error);
      // Continue with other actions even if one fails
    }
  }
}

/**
 * Attempts to close popups and modals on the page
 * @param page - The Puppeteer Page instance
 */
async function closePopups(page: any): Promise<void> {
  try {
    await page.evaluate(() => {
      // Find common close button selectors
      const closeSelectors = [
        "button[aria-label*='close']",
        "button[aria-label*='Close']",
        "button[title*='close']",
        "button[title*='Close']",
        ".close",
        ".modal-close",
        ".popup-close",
        "[class*='close']",
        "[class*='dismiss']",
        "button:contains('Close')",
        "button:contains('Accept')",
        "button:contains(' Agree ')",
        "button:contains('I Agree')",
        "button:contains('Accept All')",
      ];
      
      const closeButtons = [];
      
      // Try each selector
      closeSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const text = el.textContent?.toLowerCase() || "";
            if (text.includes('close') || text.includes('accept') || text.includes('agree') || text.includes('×')) {
              closeButtons.push(el);
            }
          });
        } catch (e) {
          // Ignore selector errors
        }
      });
      
      // Click all found close buttons
      closeButtons.forEach((btn: any) => {
        try {
          btn.click();
        } catch (e) {
          // Ignore click errors
        }
      });
    });
    
    await page.waitForTimeout(1000); // Allow popups to close
  } catch (error) {
    // Don't fail the entire scrape if popup closing fails
    console.warn("Failed to close popups:", error);
  }
}

/**
 * Performs a web search using DuckDuckGo and returns result URLs
 * @param browser - The Puppeteer Browser instance
 * @param query - Search query string
 * @param limit - Maximum number of results to return
 * @returns Promise<string[]> - Array of result URLs
 */
export async function performSearch(
  browser: Browser,
  query: string,
  limit: number,
  options: DuckDuckGoSearchOptions = {},
): Promise<string[]> {
  const page = await createPage(browser);
  
  try {
    const searchUrl = buildDuckDuckGoUrl(query, {
      ...options,
      sources: options.sources ?? ["web"],
    });
    await navigateToPage(page, searchUrl);
    
    await waitForSelector(page, '[data-testid="result-title-a"]', 10000); // Wait for result title links
    
    const urls = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll(
          'li[data-layout="organic"] [data-testid="result-title-a"]',
        ),
      );
      return links
        .map((link) => (link as HTMLAnchorElement).href)
        .filter((url) => url && url.startsWith("http")); // Ensure valid URLs
    });
    
    return urls.slice(0, limit); // Take top x organic results
  } catch (error) {
    throw new Error(`Search failed: ${(error as Error).message}`);
  } finally {
    await page.close();
  }
}

/**
 * Performs an image search using DuckDuckGo and returns image results
 * @param browser - The Puppeteer Browser instance
 * @param query - Search query string
 * @param limit - Maximum number of results to return
 * @returns Promise<Array> - Array of image results
 */
export async function performImageSearch(
  browser: Browser,
  query: string,
  limit: number,
  options: DuckDuckGoSearchOptions = {},
) {
  const page = await createPage(browser);
  
  try {
    const searchUrl = buildDuckDuckGoUrl(query, {
      ...options,
      sources: ["images"],
    });
    await navigateToPage(page, searchUrl);
    
    await page.waitForTimeout(2000); // Wait for images to load
    
    const images = await page.evaluate((maxResults) => {
      const imgElements = document.querySelectorAll('img[src*="duckduckgo.com/iu"]');
      const results = [];
      
      for (let i = 0; i < Math.min(imgElements.length, maxResults); i++) {
        const img = imgElements[i] as HTMLImageElement;
        
        // Try to find the link to the source page
        let sourceUrl = "";
        let parent = img.parentElement;
        while (parent && parent !== document.body) {
          if (parent.tagName === 'A' && (parent as HTMLAnchorElement).href) {
            sourceUrl = (parent as HTMLAnchorElement).href;
            break;
          }
          parent = parent.parentElement;
        }
        
        results.push({
          title: img.alt || `Image ${i + 1}`,
          imageUrl: img.src,
          imageWidth: img.width,
          imageHeight: img.height,
          url: sourceUrl,
          position: i + 1
        });
      }
      
      return results;
    }, limit);
    
    return images;
  } catch (error) {
    throw new Error(`Image search failed: ${(error as Error).message}`);
  } finally {
    await page.close();
  }
}

/**
 * Analyzes DuckDuckGo image search page structure to identify proper selectors
 * @param browser - The Puppeteer Browser instance
 * @param query - Search query string
 * @returns Promise<Object> - Analysis of page structure and potential selectors
 */
export async function analyzeImageSearchPage(browser: Browser, query: string) {
  const page = await createPage(browser);
  try {
    // Try different image search URLs
    const searchUrls = [
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}`,
    ];
    
    for (const url of searchUrls) {
      await navigateToPage(page, url);
      await page.waitForTimeout(2000); // Wait for content to load
      
      const html = await page.content();
      const title = await page.title();
      
      // Get all potential image result selectors
      const selectors = await page.evaluate(() => {
        const potentialSelectors = [
          'img.tile--img', // DuckDuckGo image tiles
          '.result__img', // Alternative image selector
          '.image-result', // Generic image result
          '.c-img', // Another possible selector
          'img[src*="duckduckgo.com/iu"]', // DDG image URLs
        ];
        
        const results = {};
        potentialSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            results[selector] = {
              count: elements.length,
              elements: Array.from(elements).slice(0, 3).map(el => ({
                src: (el as HTMLImageElement).src,
                alt: (el as HTMLImageElement).alt,
                width: (el as HTMLImageElement).width,
                height: (el as HTMLImageElement).height,
                parentHTML: el.parentElement?.innerHTML.substring(0, 200)
              }))
            };
          }
        });
        
        return {
          title: document.title,
          url: window.location.href,
          selectors: results,
          potentialImageContainers: Array.from(document.querySelectorAll('*')).filter(el => {
            const bgStyle = window.getComputedStyle(el).backgroundImage;
            return bgStyle && bgStyle !== 'none';
          }).slice(0, 3).map(el => ({
            tagName: el.tagName,
            className: el.className,
            backgroundImage: window.getComputedStyle(el).backgroundImage,
            innerHTML: el.innerHTML.substring(0, 100)
          }))
        };
      });
      
      return { url: url, title, html: html.substring(0, 5000), selectors };
    }
  } finally {
    await page.close();
  }
}

/**
 * Performs a news search using DuckDuckGo and returns news results
 * @param browser - The Puppeteer Browser instance
 * @param query - Search query string
 * @param limit - Maximum number of results to return
 * @returns Promise<Array> - Array of news results
 */
export async function performNewsSearch(
  browser: Browser,
  query: string,
  limit: number,
  options: DuckDuckGoSearchOptions = {},
) {
  const page = await createPage(browser);
  
  try {
    // Try different news search URLs
    const searchUrls = [
      buildDuckDuckGoUrl(query, {
        ...options,
        sources: ["news"],
      }),
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=news&iar=news`,
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=news`,
      `https://duckduckgo.com/news?q=${encodeURIComponent(query)}`,
    ];
    
    for (const searchUrl of searchUrls) {
      await navigateToPage(page, searchUrl);
      await page.waitForTimeout(2000); // Wait for news to load
      
      // Check if we're actually on a news page or if it redirected to web search
      const isNewsPage = await page.evaluate(() => {
        return window.location.href.includes('ia=news');
      });
      
      // Even if it's not a dedicated news page, we can still extract relevant results
      // by prioritizing news sources in the regular search results
      const news = await page.evaluate((maxResults, queryContainsNews) => {
        // News domains to prioritize
        const newsDomains = [
          'reuters.com', 'bbc.com', 'cnn.com', 'nytimes.com', 'washingtonpost.com',
          'wsj.com', 'theguardian.com', 'apnews.com', 'bloomberg.com', 'npr.org',
          'news.com.au', 'news.google.com', 'theguardian.com', 'cnbc.com',
          'techcrunch.com', 'theverge.com', 'arstechnica.com', 'wired.com'
        ];
        
        // Get all organic results
        const resultElements = document.querySelectorAll('[data-layout="organic"]');
        const results = [];
        
        // Process results
        for (let i = 0; i < Math.min(resultElements.length, maxResults * 2); i++) {
          const result = resultElements[i];
          
          // Extract title and URL
          const titleElement = result.querySelector('h2 a, .result__title a, [data-testid="result-title-a"]');
          const title = titleElement?.textContent || "";
          const url = titleElement ? (titleElement as HTMLAnchorElement).href : "";
          
          // Extract snippet
          const snippetElement = result.querySelector('.result__snippet, .snippet, [data-testid="result-snippet"]');
          const snippet = snippetElement?.textContent || "";
          
          // Extract date
          const dateElement = result.querySelector('.result__timestamp, .timestamp, .date, .result-date');
          const date = dateElement?.textContent || "";
          
          // Extract image
          const imageElement = result.querySelector('img');
          const imageUrl = imageElement ? (imageElement as HTMLImageElement).src : "";
          
          // Check if this is from a news domain
          const isNewsDomain = newsDomains.some(domain => url.includes(domain));
          
          // Add to results with priority for news domains
          if (isNewsDomain || queryContainsNews) {
            results.push({
              title,
              snippet,
              url,
              date,
              imageUrl,
              position: i + 1,
              isNewsDomain
            });
          }
        }
        
        // Sort results: prioritize news domains first
        results.sort((a, b) => {
          if (a.isNewsDomain && !b.isNewsDomain) return -1;
          if (!a.isNewsDomain && b.isNewsDomain) return 1;
          return a.position - b.position;
        });
        
        // Return top results
        return results.slice(0, maxResults);
      }, limit, query.toLowerCase().includes("news"));
      
      if (news.length > 0) {
        return news;
      }
    }
    
    // If no news found, return empty array
    return [];
  } catch (error) {
    throw new Error(`News search failed: ${(error as Error).message}`);
  } finally {
    await page.close();
  }
}

/**
 * Analyzes DuckDuckGo news search page structure to identify proper selectors
 * @param browser - The Puppeteer Browser instance
 * @param query - Search query string
 * @returns Promise<Object> - Analysis of page structure and potential selectors
 */
export async function analyzeNewsSearchPage(browser: Browser, query: string) {
  const page = await createPage(browser);
  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=news&iar=news`;
    await navigateToPage(page, searchUrl);
    await page.waitForTimeout(2000);
    
    const html = await page.content();
    const title = await page.title();
    
    const selectors = await page.evaluate(() => {
      const potentialSelectors = [
        '[data-layout="organic"]', // Organic results
        '.result', // General result class
        '.result__body', // Result body
        '.news-result', // News-specific results
        '.result__title', // Result title
        '.result__snippet', // Result snippet
        '.result__timestamp', // Result timestamp
      ];
      
      const results = {};
      potentialSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          results[selector] = {
            count: elements.length,
            elements: Array.from(elements).slice(0, 3).map(el => ({
              tagName: el.tagName,
              className: el.className,
              textContent: el.textContent?.substring(0, 100),
              innerHTML: el.innerHTML.substring(0, 200)
            }))
          };
        }
      });
      
      return {
        title: document.title,
        url: window.location.href,
        selectors: results
      };
    });
    
    return { url: searchUrl, title, html: html.substring(0, 5000), selectors };
  } finally {
    await page.close();
  }
}