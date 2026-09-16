import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { extractContent, getBrowser } from "../browser";
import type { AppContext } from "../index";

// Accepted-and-ignored request fields (validated for SDK compatibility but not
// wired to the extraction pipeline yet): actions, location, proxy, maxAge,
// minAge, storeInCache, parsers, profile, lockdown, redactPII,
// zeroDataRetention, threatProtection, auditMetadata, skipTlsVerification.
// `includeTags`/`excludeTags`, `mobile`, `removeBase64Images` and `blockAds`
// are also accepted but not applied by `extractContent` today.

export class FormatValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FormatValidationError";
	}
}

export interface NormalizedFormats {
	strings: string[];
	screenshotFullPage: boolean;
	wantsJson: { schema?: unknown; prompt?: string } | null;
	wantsSummary: boolean;
	warnings: string[];
}

const KNOWN_STRING_FORMATS = [
	"markdown",
	"html",
	"rawHtml",
	"links",
	"screenshot",
	"summary",
] as const;

const LEGACY_FULL_PAGE_WARNING =
	"screenshot@fullPage is v1; use {type:'screenshot',fullPage:true}";

export function normalizeFormats(input: unknown[]): NormalizedFormats {
	const strings: string[] = [];
	const warnings: string[] = [];
	let screenshotFullPage = false;
	let wantsJson: { schema?: unknown; prompt?: string } | null = null;
	let wantsSummary = false;

	const addString = (format: string) => {
		if (!strings.includes(format)) {
			strings.push(format);
		}
	};

	for (const format of input) {
		if (typeof format === "string") {
			if (format === "screenshot@fullPage") {
				screenshotFullPage = true;
				addString("screenshot");
				if (!warnings.includes(LEGACY_FULL_PAGE_WARNING)) {
					warnings.push(LEGACY_FULL_PAGE_WARNING);
				}
				continue;
			}
			if (!(KNOWN_STRING_FORMATS as readonly string[]).includes(format)) {
				throw new FormatValidationError(`Unsupported format: ${format}`);
			}
			addString(format);
			continue;
		}

		if (format !== null && typeof format === "object") {
			const typed = format as { type?: unknown; fullPage?: unknown };
			if (typed.type === "screenshot") {
				addString("screenshot");
				if (typed.fullPage === true) {
					screenshotFullPage = true;
				}
				continue;
			}
			if (typed.type === "json") {
				const { schema, prompt } = format as {
					schema?: unknown;
					prompt?: unknown;
				};
				wantsJson = wantsJson ?? {};
				if (schema !== undefined) {
					wantsJson.schema = schema;
				}
				if (typeof prompt === "string") {
					wantsJson.prompt = prompt;
				}
				continue;
			}
			if (typed.type === "summary") {
				wantsSummary = true;
				addString("summary");
				continue;
			}
		}

		throw new FormatValidationError(
			`Unsupported format: ${JSON.stringify(format)}`,
		);
	}

	return { strings, screenshotFullPage, wantsJson, wantsSummary, warnings };
}

function buildWarning(warnings: string[]): string | undefined {
	return warnings.length > 0 ? warnings.join("; ") : undefined;
}

export class V2Scrape extends OpenAPIRoute {
	schema = {
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							url: z.string(),
							formats: z
								.array(
									z.union([
										z.enum([
											"markdown",
											"html",
											"rawHtml",
											"links",
											"screenshot",
											"summary",
											// Legacy v1 alias: accepted and normalized to a
											// full-page screenshot with a warning.
											"screenshot@fullPage",
										]),
										z.object({
											type: z.literal("screenshot"),
											fullPage: z.boolean().optional(),
											quality: z.number().int().min(1).max(100).optional(),
										}),
										z.object({
											type: z.literal("json"),
											schema: z.unknown().optional(),
											prompt: z.string().optional(),
										}),
										z.object({ type: z.literal("summary") }),
									]),
								)
								.default(["markdown"])
								.optional(),
							onlyMainContent: z.boolean().default(true).optional(),
							waitFor: z.number().default(0).optional(),
							timeout: z.number().optional(),
							headers: z.record(z.string()).optional(),
							includeTags: z.string().array().optional(),
							excludeTags: z.string().array().optional(),
							mobile: z.boolean().optional(),
							removeBase64Images: z.boolean().optional(),
							blockAds: z.boolean().optional(),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Scraped content from the provided URL",
				...contentJson({
					success: z.literal(true),
					data: z.object({
						markdown: z.string().optional(),
						html: z.string().optional(),
						rawHtml: z.string().optional(),
						links: z.string().array().optional(),
						screenshot: z.string().nullable().optional(),
						summary: z.string().optional(),
						json: z.unknown().optional(),
						metadata: z.object({
							title: z.string(),
							description: z.string(),
							sourceURL: z.string(),
							statusCode: z.number().int(),
							error: z.string().nullable(),
							language: z.string().optional(),
							keywords: z.string().optional(),
						}),
					}),
					warning: z.string().optional(),
				}),
			},
			500: {
				description: "Failed to scrape the provided URL",
				...contentJson({
					success: z.literal(false),
					error: z.string(),
				}),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const body = data.body;

		let normalized: NormalizedFormats;
		try {
			normalized = normalizeFormats(body.formats ?? ["markdown"]);
		} catch (error) {
			if (error instanceof FormatValidationError) {
				return Response.json(
					{ success: false, error: error.message },
					{ status: 400 },
				);
			}
			throw error;
		}

		const warnings = [...normalized.warnings];
		if (normalized.wantsJson) {
			warnings.push(
				"json format requires AI configuration (not yet available)",
			);
		}
		if (normalized.wantsSummary) {
			warnings.push(
				"summary format requires AI configuration (not yet available)",
			);
		}

		// `extractContent` still speaks the v1 format vocabulary; translate the
		// v2 screenshot object into the legacy full-page marker it understands.
		const extractFormats = normalized.strings
			.filter((format) => format !== "summary")
			.map((format) =>
				format === "screenshot" && normalized.screenshotFullPage
					? "screenshot@fullPage"
					: format,
			);

		const browser = await getBrowser(c.env);
		try {
			let result: Awaited<ReturnType<typeof extractContent>> = null;
			try {
				result = await extractContent(browser, body.url, {
					formats: extractFormats,
					onlyMainContent: body.onlyMainContent ?? true,
					waitFor: body.waitFor,
					timeout: body.timeout,
					headers: body.headers,
				});
			} catch (error) {
				console.error(
					`Content extraction failed for ${body.url}: ${(error as Error).message}`,
				);
				result = null;
			}

			if (!result) {
				return Response.json(
					{ success: false, error: "Failed to scrape URL" },
					{ status: 500 },
				);
			}

			const responseData: Record<string, unknown> = {
				metadata: result.metadata,
			};
			if (normalized.strings.includes("markdown") && result.markdown != null) {
				responseData.markdown = result.markdown;
			}
			if (normalized.strings.includes("html") && result.html != null) {
				responseData.html = result.html;
			}
			if (normalized.strings.includes("rawHtml") && result.rawHtml != null) {
				responseData.rawHtml = result.rawHtml;
			}
			if (normalized.strings.includes("links")) {
				responseData.links = result.links ?? [];
			}
			if (normalized.strings.includes("screenshot")) {
				responseData.screenshot = result.screenshot;
			}

			const payload: {
				success: true;
				data: Record<string, unknown>;
				warning?: string;
			} = {
				success: true,
				data: responseData,
			};
			const warning = buildWarning(warnings);
			if (warning !== undefined) {
				payload.warning = warning;
			}
			return payload;
		} finally {
			await browser.close();
		}
	}
}
