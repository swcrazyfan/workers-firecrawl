# Spec 010a — AI layer core: types, config, provider interface, OpenAI-compatible provider

Task slug: `ai-core`. Branch: `feat/v2-port-010a-ai-core`.

## Why
The AI/LLM foundation for JSON-mode extraction and summaries. Must support ANY
OpenAI-compatible endpoint (the user's preferred model is GLM-5.3 Flash served by
z.ai or OpenRouter) and keep a provider seam for Cloudflare Workers AI (task 010b).

## Scope — create EXACTLY these files

### 1. `src/ai/types.ts` (no imports from `src/index.ts` — keep the module graph one-way)
```ts
export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string }
export interface ChatRequest { messages: ChatMessage[]; temperature?: number; maxTokens?: number; jsonSchema?: Record<string, unknown>; signal?: AbortSignal }
export interface ChatUsage { inputTokens?: number; outputTokens?: number }
export interface ChatResponse { content: string; parsed?: unknown; usage?: ChatUsage; model: string; strictJson: boolean }
export interface AiConfig { provider: "openai" | "workers-ai"; model: string; baseUrl?: string; apiKey?: string; timeoutMs: number; maxRepairs: number; maxInputChars: number; strictJson: "auto" | "on" | "off" }
export class AiConfigError extends Error {}
export interface AiEnv { AI?: unknown; LLM_PROVIDER?: string; LLM_BASE_URL?: string; LLM_MODEL?: string; LLM_API_KEY?: string; OPENAI_API_KEY?: string; LLM_STRICT_JSON?: string; LLM_TIMEOUT_MS?: string; LLM_MAX_REPAIRS?: string; LLM_MAX_INPUT_CHARS?: string }
```

### 2. `src/ai/config.ts`
```ts
export function resolveAiConfig(env: AiEnv): AiConfig
```
- Provider selection: `env.LLM_PROVIDER` if set ("openai" | "workers-ai", unknown → `AiConfigError`);
  else `"openai"` when a key (`LLM_API_KEY ?? OPENAI_API_KEY`) exists; else `"workers-ai"` when
  `env.AI` is present; else `AiConfigError("no AI provider configured: set LLM_API_KEY/OPENAI_API_KEY or bind Workers AI")`.
- openai: `baseUrl = env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1"` (strip trailing `/`);
  `model = env.LLM_MODEL ?? "z-ai/glm-5.3-flash"`; `apiKey` from `LLM_API_KEY ?? OPENAI_API_KEY`.
- workers-ai: `model = env.LLM_MODEL ?? "@cf/meta/llama-3.1-8b-instruct"`; no baseUrl/apiKey.
- Numbers parsed with safe defaults: `timeoutMs` 20000 (min 1000), `maxRepairs` 2 (0..5),
  `maxInputChars` 48000 (min 1000). Non-numeric/garbage input → default, never NaN.
- `strictJson`: `env.LLM_STRICT_JSON` in {"auto","on","off"} else `"auto"`.
- Configuration errors are thrown at CALL time, never at import time.

### 3. `src/ai/provider.ts`
```ts
export interface AiProvider { readonly id: string; readonly model: string; chat(req: ChatRequest): Promise<ChatResponse> }
export function getAiProvider(config: AiConfig, env: AiEnv): AiProvider
```
The provider is constructed with `config` (and `env` where a binding is needed, e.g. Workers AI)
and holds them internally, so `chat()` stays a clean single-argument call.
Dispatch to the openai-compatible provider or the Workers AI provider
(`./workersAiProvider`, task 010b) — import it lazily or via a registry so this module
compiles before 010b lands (see the stub rule below).

### 4. `src/ai/openaiProvider.ts`
```ts
export class OpenAiProvider implements AiProvider { constructor(config: AiConfig) }  // throws AiConfigError when baseUrl/apiKey missing
export function buildRequestBody(req: ChatRequest, config: AiConfig, useStrictJson: boolean): Record<string, unknown>  // exported for tests
```
- POST `${config.baseUrl}/chat/completions` with `Authorization: Bearer ${apiKey}`,
  `content-type: application/json`, plus `HTTP-Referer` / `X-Title` headers only when the
  baseUrl host contains `openrouter.ai` (OpenRouter attribution).
- Body: `{ model, messages, temperature: req.temperature ?? 0, max_tokens: req.maxTokens ?? 2048 }`;
  when `req.jsonSchema` is present and strict mode applies:
  `response_format: { type: "json_schema", json_schema: { name: "extraction", strict: true, schema: <jsonSchema> } }`.
- Strict-mode resolution for `strictJson: "auto"`: attempt strict; on HTTP 400 whose body
  mentions `response_format`/`json_schema`, retry ONCE with
  `response_format: { type: "json_object" }` and set `strictJson: false` on the response.
  `"on"` → strict only (surface the error). `"off"` → `json_object` directly (when a schema
  is present) or no `response_format` (when none).
- `AbortSignal.timeout(config.timeoutMs)` merged with `req.signal` when provided
  (use `AbortSignal.any([...])` if available, else the timeout only — document the choice).
- Retry policy: on HTTP 429 or 5xx → retry ONCE after `min(Retry-After seconds, 5)` or 500ms;
  never retry other 4xx. Timeouts/network errors → retry once (500ms).
- Response parsing: `choices[0].message.content` (string) and `choices[0].message.parsed`
  (when the provider returns structured output); prefer `parsed` when present, else leave
  `content` for the extraction pipeline to parse. Usage from `usage.prompt_tokens`/
  `completion_tokens`. Malformed response (no choices) → throw `AiConfigError`? No —
  throw a plain `Error("ai: unexpected response shape from <provider>")`.
- Never log the API key.

### 5. `src/index.ts` — Env additions ONLY
Add the `AiEnv` fields (as optional) to the exported `Env` type. No route changes.

### 6. `tests/unit/ai-core.test.ts`
Mock `globalThis.fetch`. Cases:
- `resolveAiConfig`: openai when key set (defaults applied: baseUrl, model, 20000/2/48000);
  workers-ai when only `AI` present; explicit `LLM_PROVIDER` overrides; unknown provider string
  → `AiConfigError`; nothing configured → `AiConfigError`; garbage numerics fall back to defaults
  (e.g. `LLM_TIMEOUT_MS="abc"`); `strictJson` parsing of auto/on/off/garbage.
- `buildRequestBody`: json_schema shape under strict; json_object under off; no
  `response_format` when no schema; temperature default 0; OpenRouter headers only for
  openrouter hosts.
- `chat()`: happy path (content + usage + model); strict 400 → single retry with
  json_object and `strictJson:false`; `strictJson:"on"` 400 → throws (no fallback);
  429 with `Retry-After: 3` → one retry; 400 non-json_schema error → no retry, throws;
  malformed body → throws; timeout → throws; Authorization header asserted (and never
  logged); `message.parsed` preferred over `content`.

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — FULLY clean. 5 new files + Env-only
`src/index.ts` diff. No new dependencies.

## Do NOT
- implement the extraction pipeline, prompts, or route wiring (tasks 010c)
- implement the Workers AI provider (task 010b) — but DO import it behind the seam described
  above; if `./workersAiProvider` does not exist on your branch, create a minimal stub that
  throws `AiConfigError("workers-ai provider not available")` and flag it in the PR body
- add dependencies or log secrets
