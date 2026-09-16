import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAiConfig } from "../../src/ai/config";
import { OpenAiProvider, buildRequestBody } from "../../src/ai/openaiProvider";
import { getAiProvider } from "../../src/ai/provider";
import {
	type AiConfig,
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
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
			const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls]
				.flat()
				.join(" ");
			expect(logged).not.toContain("sk-test-secret");
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
	});
});

describe("getAiProvider", () => {
	it("dispatches openai configs to OpenAiProvider and workers-ai to the seam", () => {
		expect(getAiProvider(makeConfig(), {}).id).toBe("openai");
		const workers = getAiProvider(
			makeConfig({
				provider: "workers-ai",
				baseUrl: undefined,
				apiKey: undefined,
				model: "@cf/meta/llama-3.1-8b-instruct",
			}),
			{},
		);
		expect(workers.id).toBe("workers-ai");
	});
});
