import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AiConfig,
	AiConfigError,
	type AiEnv,
	type ChatRequest,
} from "../../src/ai/types";
import {
	WorkersAiProvider,
	buildWorkersAiInput,
} from "../../src/ai/workersAiProvider";

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
	return {
		provider: "workers-ai",
		model: "@cf/meta/llama-3.1-8b-instruct",
		timeoutMs: 20000,
		maxRepairs: 2,
		maxInputChars: 48000,
		strictJson: "auto",
		...overrides,
	};
}

function makeEnv(run: ReturnType<typeof vi.fn>): AiEnv {
	return { AI: { run } } as unknown as AiEnv;
}

const userMessage: ChatRequest = {
	messages: [{ role: "user", content: "hello" }],
};

describe("buildWorkersAiInput", () => {
	it("carries messages with default temperature and max_tokens", () => {
		const input = buildWorkersAiInput(userMessage, false);
		expect(input).toEqual({
			messages: userMessage.messages,
			temperature: 0,
			max_tokens: 2048,
		});
		expect("response_format" in input).toBe(false);
	});

	it("honours explicit temperature and maxTokens", () => {
		const input = buildWorkersAiInput(
			{ ...userMessage, temperature: 0.7, maxTokens: 512 },
			false,
		);
		expect(input.temperature).toBe(0.7);
		expect(input.max_tokens).toBe(512);
	});

	it("uses json_schema when strict applies", () => {
		const schema = { type: "object", properties: { title: { type: "string" } } };
		const input = buildWorkersAiInput({ ...userMessage, jsonSchema: schema }, true);
		expect(input.response_format).toEqual({
			type: "json_schema",
			json_schema: schema,
		});
	});

	it("uses json_object when non-strict with a schema", () => {
		const input = buildWorkersAiInput(
			{ ...userMessage, jsonSchema: { type: "object" } },
			false,
		);
		expect(input.response_format).toEqual({ type: "json_object" });
	});

	it("omits response_format without a schema", () => {
		const input = buildWorkersAiInput(userMessage, true);
		expect("response_format" in input).toBe(false);
	});
});

describe("WorkersAiProvider.chat", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("normalizes an object response and parses it", async () => {
		const run = vi.fn().mockResolvedValue({
			response: { title: "Hi" },
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});
		const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));
		const result = await provider.chat(userMessage);

		expect(result.parsed).toEqual({ title: "Hi" });
		expect(result.content).toBe(JSON.stringify({ title: "Hi" }));
		expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
		expect(result.model).toBe("@cf/meta/llama-3.1-8b-instruct");
		expect(run).toHaveBeenCalledWith(
			"@cf/meta/llama-3.1-8b-instruct",
			expect.objectContaining({ temperature: 0, max_tokens: 2048 }),
		);
	});

	it("maps a string response to content without parsed", async () => {
		const run = vi.fn().mockResolvedValue({ response: "plain text" });
		const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));
		const result = await provider.chat(userMessage);

		expect(result.content).toBe("plain text");
		expect(result.parsed).toBeUndefined();
		expect(result.usage).toBeUndefined();
	});

	it("accepts a bare string response", async () => {
		const run = vi.fn().mockResolvedValue("bare string");
		const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));
		const result = await provider.chat(userMessage);

		expect(result.content).toBe("bare string");
		expect(result.parsed).toBeUndefined();
	});

	it.each([42, null, undefined, [1, 2], { foo: "bar" }])(
		"throws on an unexpected response shape (%s)",
		async (shape) => {
			const run = vi.fn().mockResolvedValue(shape);
			const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));
			await expect(provider.chat(userMessage)).rejects.toThrow(
				"ai: unexpected response shape from workers-ai",
			);
		},
	);

	it("normalizes a nested usage object", async () => {
		const run = vi.fn().mockResolvedValue({
			response: "ok",
			usage: { input_tokens: 3, output_tokens: 7 },
		});
		const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));
		const result = await provider.chat(userMessage);

		expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 7 });
	});

	it("tolerates an absent usage object", async () => {
		const run = vi.fn().mockResolvedValue({ response: "ok" });
		const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));
		const result = await provider.chat(userMessage);

		expect(result.usage).toBeUndefined();
	});

	it("retries once without response_format on a strict JSON mode failure (auto)", async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("JSON Mode couldn't be met"))
			.mockResolvedValueOnce({ response: '{"title":"Hi"}' });
		const provider = new WorkersAiProvider(
			makeConfig({ strictJson: "auto" }),
			makeEnv(run),
		);
		const result = await provider.chat({
			...userMessage,
			jsonSchema: { type: "object" },
		});

		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[0][1].response_format).toEqual({
			type: "json_schema",
			json_schema: { type: "object" },
		});
		expect(run.mock.calls[1][1].response_format).toBeUndefined();
		expect(result.strictJson).toBe(false);
		expect(result.content).toBe('{"title":"Hi"}');
	});

	it("rethrows a JSON mode failure without retrying under strictJson on", async () => {
		const run = vi
			.fn()
			.mockRejectedValue(new Error("JSON Mode couldn't be met"));
		const provider = new WorkersAiProvider(
			makeConfig({ strictJson: "on" }),
			makeEnv(run),
		);

		await expect(
			provider.chat({ ...userMessage, jsonSchema: { type: "object" } }),
		).rejects.toThrow("JSON Mode couldn't be met");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("prefixes other binding errors", async () => {
		const run = vi.fn().mockRejectedValue(new Error("capacity exceeded"));
		const provider = new WorkersAiProvider(makeConfig(), makeEnv(run));

		await expect(provider.chat(userMessage)).rejects.toThrow(
			"workers-ai: capacity exceeded",
		);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("rejects with a timeout when run never resolves", async () => {
		const run = vi.fn(() => new Promise(() => {}));
		const provider = new WorkersAiProvider(
			makeConfig({ timeoutMs: 20000 }),
			makeEnv(run),
		);

		vi.useFakeTimers();
		try {
			const promise = provider.chat(userMessage);
			const assertion = expect(promise).rejects.toThrow(
				"workers-ai: timeout after 20000ms",
			);
			await vi.advanceTimersByTimeAsync(20000);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears the timer when run resolves in time", async () => {
		const run = vi.fn().mockResolvedValue("done");
		const provider = new WorkersAiProvider(
			makeConfig({ timeoutMs: 20000 }),
			makeEnv(run),
		);

		vi.useFakeTimers();
		const promise = provider.chat(userMessage);
		await expect(promise).resolves.toMatchObject({ content: "done" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("throws AiConfigError when the binding is missing", () => {
		expect(() => new WorkersAiProvider(makeConfig(), {} as AiEnv)).toThrow(
			AiConfigError,
		);
		expect(
			() => new WorkersAiProvider(makeConfig(), {} as AiEnv),
		).toThrow("workers-ai binding missing");
	});
});
