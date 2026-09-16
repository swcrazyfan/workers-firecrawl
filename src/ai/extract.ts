import { resolveAiConfig } from "./config";
import {
	buildExtractionMessages,
	buildSummaryMessages,
	makeNonce,
	repairMessage,
	sanitizeUntrusted,
} from "./prompt";
import type { AiProvider } from "./provider";
import { getAiProvider } from "./provider";
import { normalizeJsonSchema, validateAgainstSchema } from "./schema";
import type { AiConfig, AiEnv, ChatMessage, ChatResponse } from "./types";

const SUMMARY_MAX_CHARS = 24000;

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function truncationMarker(droppedChars: number): string {
	return `\n\n…[truncated ${droppedChars} characters]…\n\n`;
}

// Never cut a surrogate pair in half.
function safeSliceStart(content: string, length: number): string {
	if (length <= 0) return "";
	let slice = content.slice(0, length);
	if (isHighSurrogate(slice.charCodeAt(slice.length - 1))) {
		slice = slice.slice(0, -1);
	}
	return slice;
}

export function budgetContent(
	content: string,
	maxChars: number,
): { content: string; truncated: boolean; droppedChars: number } {
	// A non-finite limit means "no limit" rather than "truncate everything".
	if (!Number.isFinite(maxChars)) {
		return { content, truncated: false, droppedChars: 0 };
	}

	const limit = Math.max(0, Math.trunc(maxChars));
	if (content.length <= limit) {
		return { content, truncated: false, droppedChars: 0 };
	}

	// The marker itself may not fit in a tiny budget. Estimate its length with
	// the largest possible drop count (the whole content) and hard-slice when
	// even that cannot fit, rather than exceeding the limit.
	const markerLength = truncationMarker(content.length).length;
	if (limit <= markerLength) {
		const kept = safeSliceStart(content, limit);
		return {
			content: kept,
			truncated: true,
			droppedChars: content.length - kept.length,
		};
	}

	const budget = limit - markerLength;
	const headLength = Math.ceil(budget / 2);
	const tailLength = budget - headLength;

	let head = content.slice(0, headLength);
	let tail = tailLength > 0 ? content.slice(content.length - tailLength) : "";

	if (head.length > 0 && isHighSurrogate(head.charCodeAt(head.length - 1))) {
		head = head.slice(0, -1);
	}
	if (tail.length > 0 && isLowSurrogate(tail.charCodeAt(0))) {
		tail = tail.slice(1);
	}

	const droppedChars = content.length - head.length - tail.length;
	return {
		content: `${head}${truncationMarker(droppedChars)}${tail}`,
		truncated: true,
		droppedChars,
	};
}

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

function tryJson(text: string): ParseResult {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false, error: "response was not valid JSON" };
	}
}

function fencedJson(text: string): string | undefined {
	const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	return match?.[1]?.trim();
}

function parseExtraction(response: ChatResponse): ParseResult {
	if (response.parsed !== undefined) {
		return { ok: true, value: response.parsed };
	}
	const text = response.content ?? "";
	const direct = tryJson(text);
	if (direct.ok) return direct;
	const fenced = fencedJson(text);
	if (fenced !== undefined) {
		const parsed = tryJson(fenced);
		if (parsed.ok) return parsed;
	}
	return { ok: false, error: "response was not valid JSON" };
}

// Prompt-only extraction has no schema to validate, so JSON is returned when it
// parses and the raw text otherwise.
function parsePromptOnly(response: ChatResponse): unknown {
	if (response.parsed !== undefined) return response.parsed;
	const text = response.content ?? "";
	const direct = tryJson(text);
	if (direct.ok) return direct.value;
	const fenced = fencedJson(text);
	if (fenced !== undefined) {
		const parsed = tryJson(fenced);
		if (parsed.ok) return parsed.value;
	}
	return text;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function joinWarning(...parts: Array<string | undefined>): string | undefined {
	const kept = parts.filter((part): part is string => Boolean(part));
	return kept.length > 0 ? kept.join("; ") : undefined;
}

function resolveConfig(env: AiEnv): AiConfig | string {
	try {
		return resolveAiConfig(env);
	} catch (error) {
		return `AI not configured: ${errorMessage(error)}`;
	}
}

function resolveProvider(config: AiConfig, env: AiEnv): AiProvider | string {
	try {
		return getAiProvider(config, env);
	} catch (error) {
		return `AI not configured: ${errorMessage(error)}`;
	}
}

export async function extractStructured(
	input: {
		content: string;
		jsonSchema?: Record<string, unknown>;
		prompt?: string;
	},
	env: AiEnv,
): Promise<{
	data?: unknown;
	warning?: string;
	attempts: number;
	model?: string;
	truncated?: boolean;
}> {
	const configOrError = resolveConfig(env);
	if (typeof configOrError === "string") {
		return { warning: configOrError, attempts: 0 };
	}
	const config = configOrError;

	const prompt = input.prompt?.trim();
	if (
		input.jsonSchema === undefined &&
		(prompt === undefined || prompt === "")
	) {
		return { warning: "json format requires a schema or prompt", attempts: 0 };
	}

	const warnings: string[] = [];
	let normalized: ReturnType<typeof normalizeJsonSchema> | undefined;
	try {
		normalized =
			input.jsonSchema !== undefined
				? normalizeJsonSchema(input.jsonSchema)
				: undefined;
	} catch (error) {
		return {
			warning: `schema normalization failed: ${errorMessage(error)}`,
			attempts: 0,
		};
	}
	if (normalized) warnings.push(...normalized.warnings);

	const budgeted = budgetContent(input.content ?? "", config.maxInputChars);
	if (budgeted.truncated) {
		warnings.push(
			`content truncated to ${config.maxInputChars} characters (${budgeted.droppedChars} dropped)`,
		);
	}

	const providerOrError = resolveProvider(config, env);
	if (typeof providerOrError === "string") {
		return {
			warning: joinWarning(...warnings, providerOrError),
			attempts: 0,
			truncated: budgeted.truncated || undefined,
		};
	}
	const provider = providerOrError;

	let nonce = "";
	let messages: ChatMessage[];
	try {
		nonce = makeNonce();
		messages = buildExtractionMessages({
			content: budgeted.content,
			instruction: prompt,
			jsonSchema: normalized?.schema,
			nonce,
		});
	} catch (error) {
		return {
			warning: joinWarning(
				...warnings,
				`AI extraction setup failed: ${errorMessage(error)}`,
			),
			attempts: 0,
			truncated: budgeted.truncated || undefined,
		};
	}

	const maxAttempts = config.maxRepairs + 1;
	let attempts = 0;
	let lastErrors: string[] = [];
	let model: string | undefined;

	while (attempts < maxAttempts) {
		attempts += 1;

		let response: ChatResponse;
		try {
			response = await provider.chat({
				messages,
				temperature: 0,
				jsonSchema: normalized?.schema,
			});
		} catch (error) {
			return {
				warning: joinWarning(
					...warnings,
					`AI extraction failed: ${errorMessage(error)}`,
				),
				attempts,
				model,
				truncated: budgeted.truncated || undefined,
			};
		}
		model = response.model;

		if (normalized === undefined) {
			return {
				data: parsePromptOnly(response),
				warning: joinWarning(...warnings),
				attempts,
				model,
				truncated: budgeted.truncated || undefined,
			};
		}

		const parsed = parseExtraction(response);
		if ("value" in parsed) {
			const validation = validateAgainstSchema(parsed.value, normalized.schema);
			if ("errors" in validation) {
				lastErrors = validation.errors;
			} else {
				return {
					data: parsed.value,
					warning: joinWarning(...warnings),
					attempts,
					model,
					truncated: budgeted.truncated || undefined,
				};
			}
		} else {
			lastErrors = [parsed.error];
		}

		if (attempts <= config.maxRepairs) {
			const previous = sanitizeUntrusted(response.content ?? "", nonce);
			if (previous.trim().length > 0) {
				messages.push({ role: "assistant", content: previous });
			}
			messages.push(repairMessage(lastErrors, previous, nonce));
		}
	}

	return {
		warning: joinWarning(
			...warnings,
			`extraction failed validation after ${attempts} attempts: ${lastErrors[0] ?? "unknown error"}`,
		),
		attempts,
		model,
		truncated: budgeted.truncated || undefined,
	};
}

export async function summarize(
	input: { content: string; instruction?: string; maxChars?: number },
	env: AiEnv,
): Promise<{
	summary?: string;
	warning?: string;
	model?: string;
	truncated?: boolean;
}> {
	const configOrError = resolveConfig(env);
	if (typeof configOrError === "string") {
		return { warning: configOrError };
	}
	const config = configOrError;

	const maxChars = input.maxChars ?? SUMMARY_MAX_CHARS;
	const budgeted = budgetContent(input.content ?? "", maxChars);
	const warnings: string[] = [];
	if (budgeted.truncated) {
		warnings.push(
			`content truncated to ${maxChars} characters (${budgeted.droppedChars} dropped)`,
		);
	}

	const providerOrError = resolveProvider(config, env);
	if (typeof providerOrError === "string") {
		return {
			warning: joinWarning(...warnings, providerOrError),
			truncated: budgeted.truncated || undefined,
		};
	}
	const provider = providerOrError;

	try {
		const nonce = makeNonce();
		const messages = buildSummaryMessages({
			content: budgeted.content,
			instruction: input.instruction,
			nonce,
		});
		const response = await provider.chat({ messages, temperature: 0 });
		return {
			summary: (response.content ?? "").trim(),
			warning: joinWarning(...warnings),
			model: response.model,
			truncated: budgeted.truncated || undefined,
		};
	} catch (error) {
		return {
			warning: joinWarning(
				...warnings,
				`AI summary failed: ${errorMessage(error)}`,
			),
			model: config.model,
			truncated: budgeted.truncated || undefined,
		};
	}
}
