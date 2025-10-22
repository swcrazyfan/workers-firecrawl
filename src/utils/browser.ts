import puppeteer, { type Browser } from "@cloudflare/puppeteer";
import type { Env } from "../index";

/**
 * Launches a browser instance using Cloudflare's Browser Rendering API
 * @param env - Cloudflare Worker environment containing the BROWSER binding
 * @returns Promise<Browser> - A Puppeteer Browser instance
 */
export async function getBrowser(env: Env): Promise<Browser> {
  return await puppeteer.launch(env.BROWSER);
}

/**
 * Closes a browser instance and cleans up resources
 * @param browser - The Puppeteer Browser instance to close
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close();
}

/**
 * Creates a new page with common settings
 * @param browser - The Puppeteer Browser instance
 * @returns Promise<Page> - A new Puppeteer Page instance
 */
export async function createPage(browser: Browser) {
  const page = await browser.newPage();
  
  // Set default viewport
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Set default user agent that identifies as a bot
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  );
  
  return page;
}

/**
 * Sets custom headers for a page
 * @param page - The Puppeteer Page instance
 * @param headers - Record of header key-value pairs
 */
export async function setCustomHeaders(page: any, headers: Record<string, string>): Promise<void> {
  if (headers && Object.keys(headers).length > 0) {
    await page.setExtraHTTPHeaders(headers);
  }
}

/**
 * Navigates to a URL with error handling
 * @param page - The Puppeteer Page instance
 * @param url - The URL to navigate to
 * @param options - Navigation options
 * @returns Promise<HTTPResponse | null> - The response object or null if failed
 */
export async function navigateToPage(page: any, url: string, options: { timeout?: number; waitUntil?: string } = {}) {
  try {
    const response = await page.goto(url, {
      waitUntil: options.waitUntil || "domcontentloaded",
      timeout: options.timeout || 60000,
    });
    return response;
  } catch (error) {
    console.error(`Navigation failed for ${url}:`, error);
    throw new Error(`Navigation failed: ${(error as Error).message}`);
  }
}

/**
 * Waits for a specific selector to appear on the page
 * @param page - The Puppeteer Page instance
 * @param selector - CSS selector to wait for
 * @param timeout - Maximum time to wait in milliseconds
 */
export async function waitForSelector(page: any, selector: string, timeout: number = 60000): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (error) {
    console.warn(`Selector ${selector} not found within ${timeout}ms:`, error);
    // Don't throw error, just log warning as selector might be optional
  }
}

/**
 * Takes a screenshot of the current page
 * @param page - The Puppeteer Page instance
 * @param options - Screenshot options
 * @returns Promise<string> - Base64 encoded screenshot
 */
export async function takeScreenshot(page: any, options: { fullPage?: boolean; quality?: number } = {}): Promise<string> {
  const screenshot = await page.screenshot({
    encoding: "base64",
    fullPage: options.fullPage ?? true,
    quality: options.quality ?? 80,
    type: "png",
  });
  return screenshot as string;
}