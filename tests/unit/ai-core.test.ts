import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAiConfig } from "../../src/ai/config";
import { OpenAiProvider, buildRequestBody } from "../../src/ai/openaiProvider";
import { getAiProvider } from "../../src/ai/provider";
import {
	type AiConfig,
	type AiEnv,
	AiConfigError,
	type ChatRequest,
} from "../../src/ai/types";

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
	return {
		provider: "openai",
		model: "z-ai/glm-5.3-flash",
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey: "sk-test-secret",
		timeoutMs: 20000,
		maxRepairs: 2,
		maxInputChars: 48000,
		strictJson: "auto",
		...overrides,
	};
}

const baseRequest: ChatRequest = {
	messages: [{ role: "user", content: "extract this" }],
	jsonSchema: { type: "object", properties: { title: { type: "string" } } },
};

function jsonResponse(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function chatBody(content: string, parsed?: unknown): Record<string, unknown> {
	const message: Record<string, unknown> = { role: "assistant", content };
	if (parsed !== undefined) message.parsed = parsed;
	return {
		choices: [{ message }],
		usage: { prompt_tokens: 11, completion_tokens: 7 },
		model: "z-ai/glm-5.3-flash",
	};
}

function callAt(
	mock: ReturnType<typeof vi.fn>,
	index: number,
): { url: string; init: RequestInit } {
	const calls = mock.mock.calls as unknown as [string, RequestInit][];
	return { url: calls[index][0], init: calls[index][1] };
}

const CONSOLE_METHODS = ["log", "error", "warn", "info", "debug"] as const;

function spyOnConsole(): { restore: () => void; serialized: () => string } {
	const spies = CONSOLE_METHODS.map((method) =>
		vi.spyOn(console, method).mockImplementation(() => {}),
	);
	return {
		restore: () => {
			for (const spy of spies) spy.mockRestore();
		},
		serialized: () =>
			spies
				.flatMap((spy) => spy.mock.calls)
				.map((args) => JSON.stringify(args))
				.join(" "),
	};
}

describe("resolveAiConfig", () => {
	it("defaults to openai with OpenRouter defaults when a key is set", () => {
		const config = resolveAiConfig({ LLM_API_KEY: "sk-x" });
		expect(config).toEqual({
			provider: "openai",
			model: "z-ai/glm-5.3-flash",
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-x",
			timeoutMs: 20000,
			maxRepairs: 2,
			maxInputChars: 48000,
			strictJson: "auto",
		});
	});

	it("accepts OPENAI_API_KEY as the openai credential", () => {
		const config = resolveAiConfig({ OPENAI_API_KEY: "sk-o" });
		expect(config.provider).toBe("openai");
		expect(config.apiKey).toBe("sk-o");
	});

	it("selects workers-ai when only the AI binding is present", () => {
		const config = resolveAiConfig({ AI: {} });
		expect(config).toEqual({
			provider: "workers-ai",
			model: "@cf/meta/llama-3.1-8b-instruct",
			timeoutMs: 20000,
			maxRepairs: 2,
			maxInputChars: 48000,
			strictJson: "auto",
		});
	});

	it("honours an explicit LLM_PROVIDER over the inferred one", () => {
		const workers = resolveAiConfig({
			LLM_PROVIDER: "workers-ai",
			LLM_API_KEY: "sk-x",
			AI: {},
		});
		expect(workers.provider).toBe("workers-ai");
		const openai = resolveAiConfig({
			LLM_PROVIDER: "openai",
			LLM_API_KEY: "sk-x",
		});
		expect(openai.provider).toBe("openai");
	});

	it("rejects an unknown LLM_PROVIDER", () => {
		expect(() => resolveAiConfig({ LLM_PROVIDER: "anthropic" })).toThrow(
			AiConfigError,
		);
	});

	it("errors when nothing is configured", () => {
		expect(() => resolveAiConfig({})).toThrow(
			"no AI provider configured: set LLM_API_KEY/OPENAI_API_KEY or bind Workers AI",
		);
	});

	it("falls back to defaults on garbage numerics", () => {
		const config = resolveAiConfig({
			LLM_API_KEY: "sk-x",
			LLM_TIMEOUT_MS: "abc",
			LLM_MAX_REPAIRS: "nope",
			LLM_MAX_INPUT_CHARS: "",
		});
		expect(config.timeoutMs).toBe(20000);
		expect(config.maxRepairs).toBe(2);
		expect(config.maxInputChars).toBe(48000);
	});

	it("clamps out-of-range numerics into their bounds", () => {
		const config = resolveAiConfig({
			LLM_API_KEY: "sk-x",
			LLM_TIMEOUT_MS: "10",
			LLM_MAX_REPAIRS: "99",
			LLM_MAX_INPUT_CHARS: "5",
		});
		expect(config.timeoutMs).toBe(1000);
		expect(config.maxRepairs).toBe(5);
		expect(config.maxInputChars).toBe(1000);
	});

	it("parses strictJson to auto/on/off and defaults garbage to auto", () => {
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: "on" }).strictJson,
		).toBe("on");
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: "off" }).strictJson,
		).toBe("off");
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: "auto" }).strictJson,
		).toBe("auto");
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: "junk" }).strictJson,
		).toBe("auto");
	});

	it("strips trailing slashes from a custom base URL and keeps a custom model", () => {
		const config = resolveAiConfig({
			LLM_API_KEY: "k",
			LLM_BASE_URL: "https://api.z.ai/api/paas/v4/",
			LLM_MODEL: "glm-5.3-flash",
		});
		expect(config.baseUrl).toBe("https://api.z.ai/api/paas/v4");
		expect(config.model).toBe("glm-5.3-flash");
	});

	it("trims LLM_PROVIDER before comparing", () => {
		const config = resolveAiConfig({ LLM_PROVIDER: "  openai  ", LLM_API_KEY: "k" });
		expect(config.provider).toBe("openai");
	});

	it("tolerates case and whitespace in LLM_STRICT_JSON", () => {
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: "  ON " }).strictJson,
		).toBe("on");
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: "Off" }).strictJson,
		).toBe("off");
		expect(
			resolveAiConfig({ LLM_API_KEY: "k", LLM_STRICT_JSON: " AUTO " }).strictJson,
		).toBe("auto");
	});

	it("caps an oversized timeout so AbortSignal.timeout cannot overflow", () => {
		const config = resolveAiConfig({
			LLM_API_KEY: "k",
			LLM_TIMEOUT_MS: "99999999",
		});
		expect(config.timeoutMs).toBe(300000);
	});
});

describe("buildRequestBody", () => {
	it("emits a strict json_schema response_format when strict", () => {
		const body = buildRequestBody(baseRequest, makeConfig(), true);
		expect(body.response_format).toEqual({
			type: "json_schema",
			json_schema: {
				name: "extraction",
				strict: true,
				schema: baseRequest.jsonSchema,
			},
		});
	});

	it("emits json_object when not strict and a schema is present", () => {
		const body = buildRequestBody(baseRequest, makeConfig(), false);
		expect(body.response_format).toEqual({ type: "json_object" });
	});

	it("omits response_format when no schema is supplied", () => {
		const body = buildRequestBody(
			{ messages: baseRequest.messages },
			makeConfig(),
			true,
		);
		expect(body.response_format).toBeUndefined();
	});

	it("defaults temperature to 0 and max_tokens to 2048, honouring overrides", () => {
		const body = buildRequestBody(baseRequest, makeConfig(), true);
		expect(body.temperature).toBe(0);
		expect(body.max_tokens).toBe(2048);
		expect(body.model).toBe("z-ai/glm-5.3-flash");
		const overridden = buildRequestBody(
			{ ...baseRequest, temperature: 0.7, maxTokens: 100 },
			makeConfig(),
			true,
		);
		expect(overridden.temperature).toBe(0.7);
		expect(overridden.max_tokens).toBe(100);
	});
});

describe("OpenAiProvider", () => {
	it("rejects construction without a baseUrl or apiKey", () => {
		expect(() => new OpenAiProvider(makeConfig({ baseUrl: undefined }))).toThrow(
			AiConfigError,
		);
		expect(() => new OpenAiProvider(makeConfig({ apiKey: undefined }))).toThrow(
			AiConfigError,
		);
	});

	describe("chat", () => {
		let fetchMock: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it("returns content, usage and model on the happy path and sends auth", async () => {
			const console = spyOnConsole();
			try {
				fetchMock.mockResolvedValueOnce(jsonResponse(chatBody("hello")));
				const provider = new OpenAiProvider(makeConfig());
				const result = await provider.chat(baseRequest);
				expect(result).toEqual({
					content: "hello",
					parsed: undefined,
					usage: { inputTokens: 11, outputTokens: 7 },
					model: "z-ai/glm-5.3-flash",
					strictJson: true,
				});
				const { url, init } = callAt(fetchMock, 0);
				expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
				const headers = init.headers as Record<string, string>;
				expect(headers.Authorization).toBe("Bearer sk-test-secret");
				expect(headers["content-type"]).toBe("application/json");
				expect(headers["HTTP-Referer"]).toBeDefined();
				expect(headers["X-Title"]).toBeDefined();
				expect(init.signal).toBeInstanceOf(AbortSignal);
				expect(console.serialized()).not.toContain("sk-test-secret");
			} finally {
				console.restore();
			}
		});

		it("never logs the API key on the error path", async () => {
			const console = spyOnConsole();
			try {
				fetchMock.mockResolvedValueOnce(
					jsonResponse({ error: { message: "bad request" } }, 400),
				);
				const provider = new OpenAiProvider(makeConfig());
				await expect(provider.chat(baseRequest)).rejects.toThrow();
				expect(console.serialized()).not.toContain("sk-test-secret");
				expect(console.serialized()).not.toContain("Bearer");
			} finally {
				console.restore();
			}
		});

		it("omits OpenRouter attribution headers for non-openrouter hosts", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(chatBody("hi")));
			const provider = new OpenAiProvider(
				makeConfig({ baseUrl: "https://api.z.ai/api/paas/v4" }),
			);
			await provider.chat({ messages: baseRequest.messages });
			const headers = callAt(fetchMock, 0).init.headers as Record<string, string>;
			expect(headers["HTTP-Referer"]).toBeUndefined();
			expect(headers["X-Title"]).toBeUndefined();
		});

		it("does not treat openrouter lookalike hosts as OpenRouter", async () => {
			for (const baseUrl of [
				"https://notopenrouter.ai/api/v1",
				"https://openrouter.ai.evil.example/v1",
			]) {
				fetchMock.mockResolvedValueOnce(jsonResponse(chatBody("hi")));
				const provider = new OpenAiProvider(makeConfig({ baseUrl }));
				await provider.chat({ messages: baseRequest.messages });
			}
			for (const index of [0, 1]) {
				const headers = callAt(fetchMock, index).init.headers as Record<
					string,
					string
				>;
				expect(headers["HTTP-Referer"]).toBeUndefined();
				expect(headers["X-Title"]).toBeUndefined();
			}
		});

		it("sets attribution headers on an openrouter.ai subdomain", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(chatBody("hi")));
			const provider = new OpenAiProvider(
				makeConfig({ baseUrl: "https://api.openrouter.ai/v1" }),
			);
			await provider.chat({ messages: baseRequest.messages });
			const headers = callAt(fetchMock, 0).init.headers as Record<string, string>;
			expect(headers["HTTP-Referer"]).toBeDefined();
			expect(headers["X-Title"]).toBeDefined();
		});

		it("prefers message.parsed over content", async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse(chatBody('{"title":"x"}', { title: "x" })),
			);
			const provider = new OpenAiProvider(makeConfig());
			const result = await provider.chat(baseRequest);
			expect(result.parsed).toEqual({ title: "x" });
		});

		it("falls back to json_object once on a schema-rejection 400 in auto mode", async () => {
			fetchMock
				.mockResolvedValueOnce(
					jsonResponse(
						{ error: { message: "response_format is invalid" } },
						400,
					),
				)
				.mockResolvedValueOnce(jsonResponse(chatBody("{}")));
			const provider = new OpenAiProvider(makeConfig());
			const result = await provider.chat(baseRequest);
			expect(result.strictJson).toBe(false);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			const first = JSON.parse(callAt(fetchMock, 0).init.body as string);
			expect(first.response_format.type).toBe("json_schema");
			const second = JSON.parse(callAt(fetchMock, 1).init.body as string);
			expect(second.response_format).toEqual({ type: "json_object" });
		});

		it("does not fall back when a 400 never references the schema param", async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({ error: { message: "invalid api key" } }, 400),
			);
			const provider = new OpenAiProvider(makeConfig());
			await expect(provider.chat(baseRequest)).rejects.toThrow(/HTTP 400/);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("reports both the schema rejection and the fallback failure", async () => {
			fetchMock
				.mockResolvedValueOnce(
					jsonResponse(
						{ error: { message: "response_format not supported" } },
						400,
					),
				)
				.mockResolvedValueOnce(
					jsonResponse({ error: { message: "json_object rejected" } }, 422),
				);
			const provider = new OpenAiProvider(makeConfig());
			const error = await provider.chat(baseRequest).then(
				() => null,
				(e: unknown) => e as Error,
			);
			expect(error?.message).toContain("response_format not supported");
			expect(error?.message).toContain("json_object rejected");
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("throws on a schema-rejection 400 when strictJson is on", async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({ error: { message: "json_schema unsupported" } }, 400),
			);
			const provider = new OpenAiProvider(makeConfig({ strictJson: "on" }));
			await expect(provider.chat(baseRequest)).rejects.toThrow(/HTTP 400/);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("retries once on 429 honouring Retry-After", async () => {
			fetchMock
				.mockResolvedValueOnce(
					jsonResponse({ error: "slow down" }, 429, { "Retry-After": "3" }),
				)
				.mockResolvedValueOnce(jsonResponse(chatBody("after")));
			const provider = new OpenAiProvider(makeConfig());
			vi.useFakeTimers();
			const promise = provider.chat(baseRequest);
			await vi.advanceTimersByTimeAsync(3000);
			await expect(promise).resolves.toMatchObject({ content: "after" });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("clamps a large Retry-After to the 5s cap", async () => {
			fetchMock
				.mockResolvedValueOnce(
					jsonResponse({ error: "slow down" }, 429, { "Retry-After": "120" }),
				)
				.mockResolvedValueOnce(jsonResponse(chatBody("after")));
			const provider = new OpenAiProvider(makeConfig());
			vi.useFakeTimers();
			const promise = provider.chat(baseRequest);
			await vi.advanceTimersByTimeAsync(5000);
			await expect(promise).resolves.toMatchObject({ content: "after" });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("parses an HTTP-date Retry-After and clamps it to the cap", async () => {
			const futureDate = new Date(Date.now() + 3600_000).toUTCString();
			fetchMock
				.mockResolvedValueOnce(
					jsonResponse({ error: "slow down" }, 429, {
						"Retry-After": futureDate,
					}),
				)
				.mockResolvedValueOnce(jsonResponse(chatBody("after")));
			const provider = new OpenAiProvider(makeConfig());
			vi.useFakeTimers();
			const promise = provider.chat(baseRequest);
			await vi.advanceTimersByTimeAsync(5000);
			await expect(promise).resolves.toMatchObject({ content: "after" });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("retries once on 5xx", async () => {
			fetchMock
				.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 502))
				.mockResolvedValueOnce(jsonResponse(chatBody("recovered")));
			const provider = new OpenAiProvider(makeConfig());
			vi.useFakeTimers();
			const promise = provider.chat(baseRequest);
			await vi.advanceTimersByTimeAsync(500);
			await expect(promise).resolves.toMatchObject({ content: "recovered" });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("never retries a non-schema 400", async () => {
			fetchMock.mockResolvedValueOnce(
				jsonResponse({ error: { message: "bad request" } }, 400),
			);
			const provider = new OpenAiProvider(makeConfig());
			await expect(provider.chat(baseRequest)).rejects.toThrow(/HTTP 400/);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("throws on a malformed response body", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({}));
			const provider = new OpenAiProvider(makeConfig());
			await expect(provider.chat(baseRequest)).rejects.toThrow(
				"ai: unexpected response shape from openai",
			);
		});

		it("throws after retrying a timeout/network error", async () => {
			fetchMock.mockRejectedValue(
				new DOMException("The operation was aborted.", "AbortError"),
			);
			const provider = new OpenAiProvider(makeConfig());
			vi.useFakeTimers();
			const promise = provider.chat(baseRequest);
			await vi.advanceTimersByTimeAsync(500);
			await expect(promise).rejects.toThrow();
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("does not retry a caller-initiated abort", async () => {
			const controller = new AbortController();
			controller.abort();
			fetchMock.mockRejectedValue(
				new DOMException("The operation was aborted.", "AbortError"),
			);
			const provider = new OpenAiProvider(makeConfig());
			await expect(
				provider.chat({ ...baseRequest, signal: controller.signal }),
			).rejects.toThrow();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});
});

describe("getAiProvider", () => {
	it("dispatches openai configs to OpenAiProvider and workers-ai to the seam", () => {
		expect(getAiProvider(makeConfig(), {}).id).toBe("openai");
		// Pass a stub binding so this stays green once 010b's real provider
		// (whose constructor validates the binding) merges.
		const workers = getAiProvider(
			makeConfig({
				provider: "workers-ai",
				baseUrl: undefined,
				apiKey: undefined,
				model: "@cf/meta/llama-3.1-8b-instruct",
			}),
			{ AI: { run: vi.fn() } } as unknown as AiEnv,
		);
		expect(workers.id).toBe("workers-ai");
	});
});
