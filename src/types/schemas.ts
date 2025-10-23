import { z } from "zod";

// Shared format types
export const ScrapeFormatsEnum = z.enum([
  "markdown",
  "html", 
  "rawHtml",
  "links",
  "screenshot",
  "metadata"
]);

// Screenshot options
export const ScreenshotOptionsSchema = z.object({
  fullPage: z.boolean().default(true).optional(),
  quality: z.number().min(0).max(100).default(80).optional(),
});

// Browser actions for dynamic pages
export const BrowserActionSchema = z.object({
  type: z.enum(["wait", "click", "type", "scroll", "executeJavaScript"]),
  selector: z.string().optional(),
  text: z.string().optional(),
  timeout: z.number().default(5000).optional(),
  milliseconds: z.number().optional(),
  javascript: z.string().optional(),
});

// Location options
export const LocationSchema = z.object({
  country: z.string().default("US").optional(),
  languages: z.array(z.string()).default(["en-US"]).optional(),
});

// Main scrape request schema (v2 API compatible)
export const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  formats: z.array(z.union([
    z.literal("markdown"),
    z.literal("html"),
    z.literal("rawHtml"),
    z.literal("links"),
    z.literal("screenshot"),
    z.literal("metadata"),
    z.literal("summary"),
    z.object({
      type: z.literal("screenshot"),
      fullPage: z.boolean().default(true).optional(),
      quality: z.number().min(0).max(100).default(80).optional(),
    }),
    z.object({
      type: z.literal("json"),
      prompt: z.string().optional(),
      schema: z.any().optional(),
    }),
    z.object({
      type: z.literal("summary"),
      maxLength: z.number().min(10).max(1000).default(300).optional(),
      summaryType: z.enum(['concise', 'detailed', 'bullets', 'custom']).default('concise').optional(),
      tone: z.enum(['neutral', 'formal', 'casual', 'technical']).default('neutral').optional(),
      focus: z.string().optional(),
      language: z.string().default('English').optional(),
    }),
    z.object({
      type: z.literal("changeTracking"),
    }),
  ])).default(["markdown"]).optional(),
  onlyMainContent: z.boolean().default(true).optional(),
  includeTags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
  maxAge: z.number().default(172800000).optional(), // 2 days in ms
  headers: z.record(z.string()).optional(),
  waitFor: z.number().default(0).optional(),
  mobile: z.boolean().default(false).optional(),
  skipTlsVerification: z.boolean().default(true).optional(),
  timeout: z.number().default(60000).optional(),
  parsers: z.array(z.enum(["pdf"])).optional(),
  actions: z.array(BrowserActionSchema).optional(),
  location: LocationSchema.optional(),
  removeBase64Images: z.boolean().default(true).optional(),
  blockAds: z.boolean().default(true).optional(),
  proxy: z.enum(["basic", "stealth", "auto"]).default("auto").optional(),
  storeInCache: z.boolean().default(true).optional(),
  zeroDataRetention: z.boolean().default(false).optional(),
});

// Scrape options for crawl (doesn't require URL)
export const CrawlScrapeOptionsSchema = z.object({
  formats: z.array(z.union([
    z.literal("markdown"),
    z.literal("html"),
    z.literal("rawHtml"),
    z.literal("links"),
    z.literal("screenshot"),
    z.literal("metadata"),
    z.object({
      type: z.literal("screenshot"),
      fullPage: z.boolean().default(true).optional(),
      quality: z.number().min(0).max(100).default(80).optional(),
    }),
    z.object({
      type: z.literal("json"),
      prompt: z.string().optional(),
      schema: z.any().optional(),
    }),
    z.object({
      type: z.literal("changeTracking"),
    }),
  ])).default(["markdown"]).optional(),
  onlyMainContent: z.boolean().default(true).optional(),
  includeTags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
  maxAge: z.number().default(172800000).optional(), // 2 days in ms
  headers: z.record(z.string()).optional(),
  waitFor: z.number().default(0).optional(),
  mobile: z.boolean().default(false).optional(),
  skipTlsVerification: z.boolean().default(true).optional(),
  timeout: z.number().default(60000).optional(),
  parsers: z.array(z.enum(["pdf"])).optional(),
  actions: z.array(BrowserActionSchema).optional(),
  location: LocationSchema.optional(),
  removeBase64Images: z.boolean().default(true).optional(),
  blockAds: z.boolean().default(true).optional(),
  proxy: z.enum(["basic", "stealth", "auto"]).default("auto").optional(),
  storeInCache: z.boolean().default(true).optional(),
  zeroDataRetention: z.boolean().default(false).optional(),
});

// Search request schema (v2 API compatible)
export const SearchRequestSchema = z.object({
  query: z.string(),
  limit: z.number().min(1).max(100).default(5).optional(),
  sources: z.array(z.enum(["web", "images", "news"])).default(["web"]).optional(),
  tbs: z.string().optional(),
  lang: z.string().default("en").optional(),
  country: z.string().default("us").optional(),
  location: z.string().optional(),
  timeout: z.number().default(60000).optional(),
  ignoreInvalidURLs: z.boolean().default(false).optional(),
  scrapeOptions: z.object({
    formats: z.array(z.union([
      z.literal("markdown"),
      z.literal("html"),
      z.literal("rawHtml"),
      z.literal("links"),
      z.literal("screenshot"),
      z.literal("metadata"),
      z.literal("summary"),
      z.object({
        type: z.literal("screenshot"),
        fullPage: z.boolean().default(true).optional(),
        quality: z.number().min(0).max(100).default(80).optional(),
      }),
      z.object({
        type: z.literal("json"),
        prompt: z.string().optional(),
        schema: z.any().optional(),
      }),
      z.object({
        type: z.literal("summary"),
        maxLength: z.number().min(10).max(1000).default(300).optional(),
        summaryType: z.enum(['concise', 'detailed', 'bullets', 'custom']).default('concise').optional(),
        tone: z.enum(['neutral', 'formal', 'casual', 'technical']).default('neutral').optional(),
        focus: z.string().optional(),
        language: z.string().default('English').optional(),
      }),
      z.object({
        type: z.literal("changeTracking"),
      }),
    ])).default(["markdown"]).optional(),
    onlyMainContent: z.boolean().default(true).optional(),
    includeTags: z.array(z.string()).optional(),
    excludeTags: z.array(z.string()).optional(),
    headers: z.record(z.string()).optional(),
    waitFor: z.number().default(0).optional(),
    timeout: z.number().default(60000).optional(),
    actions: z.array(BrowserActionSchema).optional(),
    removeBase64Images: z.boolean().default(true).optional(),
    blockAds: z.boolean().default(true).optional(),
  }).optional(),
});

// Crawl request schema (v2 API compatible)
export const CrawlRequestSchema = z.object({
  url: z.string().url(),
  limit: z.number().min(1).max(10000).default(10000),
  scrapeOptions: CrawlScrapeOptionsSchema.default({}),
  maxDiscoveryDepth: z.number().min(1).max(10).default(10),
  crawlEntireDomain: z.boolean().default(false),
  allowSubdomains: z.boolean().default(false),
  allowExternalLinks: z.boolean().default(false),
  includePaths: z.array(z.string()).default([]),
  excludePaths: z.array(z.string()).default([]),
  ignoreQueryParameters: z.boolean().default(false),
  sitemap: z.enum(["include", "skip"]).default("include"),
  delay: z.number().min(0).max(60).default(0),
  maxConcurrency: z.number().min(1).max(10).default(3),
});

// Crawl response schema
export const CrawlResponseSchema = z.object({
  success: z.boolean(),
  id: z.string(),
  url: z.string().optional(),
});

// Metadata schema
export const MetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  language: z.string().optional(),
  sourceURL: z.string(),
  keywords: z.string().optional(),
  ogLocaleAlternate: z.array(z.string()).optional(),
  statusCode: z.number().int(),
  error: z.string().nullable(),
});

// Change tracking schema
export const ChangeTrackingSchema = z.object({
  previousScrapeAt: z.string().optional(),
  changeStatus: z.enum(["new", "updated", "unchanged"]).optional(),
  visibility: z.enum(["visible", "hidden"]).optional(),
  diff: z.string().optional(),
  json: z.any().optional(),
});

// Actions result schema
export const ActionsResultSchema = z.object({
  screenshots: z.array(z.string()).optional(),
  scrapes: z.array(z.object({
    url: z.string(),
    html: z.string(),
  })).optional(),
  javascriptReturns: z.array(z.object({
    type: z.string(),
    value: z.any(),
  })).optional(),
  pdfs: z.array(z.string()).optional(),
});

// Main scrape response schema (v2 API compatible)
export const ScrapeResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    markdown: z.string().optional(),
    summary: z.string().optional(),
    html: z.string().optional(),
    rawHtml: z.string().optional(),
    screenshot: z.string().optional(),
    links: z.array(z.string()).optional(),
    json: z.any().optional(),
    actions: ActionsResultSchema.optional(),
    metadata: MetadataSchema,
    warning: z.string().optional(),
    changeTracking: ChangeTrackingSchema.optional(),
  }),
});

// Crawl status response schema (moved after ScrapeResponseSchema)
export const CrawlStatusResponseSchema = z.object({
  success: z.boolean(),
  status: z.enum(["pending", "scraping", "completed", "failed"]),
  total: z.number(),
  completed: z.number(),
  data: z.array(ScrapeResponseSchema.shape.data).optional(),
  next: z.string().optional(),
  error: z.string().optional(),
});

// Search response schema (v2 API compatible)
export const SearchResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    web: z.array(ScrapeResponseSchema.shape.data).optional(),
    images: z.array(z.object({
      title: z.string(),
      imageUrl: z.string(),
      imageWidth: z.number().optional(),
      imageHeight: z.number().optional(),
      url: z.string(),
      position: z.number(),
    })).optional(),
    news: z.array(z.object({
      title: z.string(),
      snippet: z.string(),
      url: z.string(),
      date: z.string().optional(),
      imageUrl: z.string().optional(),
      position: z.number(),
      markdown: z.string().optional(),
      html: z.string().optional(),
      rawHtml: z.string().optional(),
      links: z.array(z.string()).optional(),
      screenshot: z.string().optional(),
      json: z.any().optional(),
      metadata: MetadataSchema.optional(),
    })).optional(),
  }),
  warning: z.string().optional(),
});

// Error response schema
export const ErrorResponseSchema = z.object({
  success: z.boolean().default(false),
  error: z.string(),
});

// Export types for TypeScript
export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type ScrapeResponse = z.infer<typeof ScrapeResponseSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;
export type CrawlResponse = z.infer<typeof CrawlResponseSchema>;
export type CrawlStatusResponse = z.infer<typeof CrawlStatusResponseSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type ScreenshotOptions = z.infer<typeof ScreenshotOptionsSchema>;