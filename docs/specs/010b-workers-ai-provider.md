# Spec 010b — Workers AI provider (Cloudflare binding)

Task slug: `ai-workers-ai`. Branch: `feat/v2-port-010b-workers-ai`.
Depends on: `src/ai/types.ts` + `src/ai/provider.ts` (task 010a, built in parallel).
If those files are missing on your branch, create MINIMAL stubs matching 010a's contract
(`ChatRequest`, `ChatResponse`, `AiConfig`, `AiProvider`, `AiConfigError`) inside
`src/ai/types.ts` / `src/ai/provider.ts` and FLAG it in the PR body — 010a's versions win at merge.

## Why
Zero-config LLM fallback: when the user has no external key but has the Workers AI binding,
extraction should still work. This is the second implementation behind 010a's provider seam.

## Scope — create EXACTLY these files

### 1. `src/ai/workersAiProvider.ts`
```ts
export class WorkersAiProvider implements AiProvider {
  constructor(config: AiConfig, env: AiEnv)
  readonly id = "workers-ai";
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
export function buildWorkersAiInput(req: ChatRequest, useStrictJson: boolean): Record<string, unknown>  // exported for tests
```
- Call the binding: `await env.AI.run(config.model, buildWorkersAiInput(...))`. Cast the
  unknown `env.AI` once at the boundary with a narrow local interface
  (`{ run(model: string, input: Record<string, unknown>): Promise<unknown> }`) — no `any`
  leaking outward. If `env.AI` is absent → `AiConfigError("workers-ai binding missing")`.
- `buildWorkersAiInput`: `{ messages, temperature: req.temperature ?? 0, max_tokens: req.maxTokens ?? 2048 }`;
  when a `jsonSchema` is supplied and strict applies → `response_format: { type: "json_schema", json_schema: <schema> }`;
  when non-strict with a schema → `response_format: { type: "json_object" }`; no schema → omit.
- Response normalization (Workers AI is inconsistent — handle all shapes):
  - object with `response` property that is an object → `parsed = response.response`, `content = JSON.stringify(response.response)`
  - object with `response` string → `content = response.response`, no `parsed`
  - bare string → `content = <string>`
  - anything else → throw `Error("ai: unexpected response shape from workers-ai")`
  - `usage` when present (`prompt_tokens`/`completion_tokens` or `usage.*`) → normalize into `ChatUsage`.
- Errors: if the thrown message contains `JSON Mode`/`json mode` and a schema was requested →
  under `strictJson: "auto"` retry ONCE without `response_format` (and `strictJson:false`);
  under `"on"` rethrow. Other errors → rethrow with a `workers-ai: ` prefix.
- Timeout: race the `run()` call against a timer of `config.timeoutMs` and reject with
  `Error("workers-ai: timeout after <ms>ms")`; always clear the timer (no dangling handles).
- No retry on schema/validation failures; at most one retry on a thrown transient error,
  mirroring the OpenAI provider's policy. Never log the binding internals.

### 2. `tests/unit/ai-workers-ai.test.ts`
Mock the binding (`env = { AI: { run: vi.fn() } } as unknown as AiEnv`). Cases:
- object-with-`response`-object → `parsed` populated, `content` is its JSON string
- object-with-`response`-string → `content` set, `parsed` undefined
- bare-string response → `content` set
- unexpected shape (number/null) → throws
- `response_format` shape: `json_schema` when strict with schema; `json_object` when off with
  schema; absent when no schema; model string and `max_tokens`/`temperature` defaults asserted
- "JSON Mode couldn't be met" + `strictJson:"auto"` → single retry without `response_format`
- same error + `strictJson:"on"` → rethrows (no retry)
- timeout: a `run` that never resolves (or resolves after the race) → rejects with the timeout
  message (use fake timers)
- `env.AI` missing → `AiConfigError`
- usage normalization when present; absent usage is tolerated

## Acceptance
`npm run lint`, `npm test`, `npx tsc --noEmit` — FULLY clean. 2 new files
(plus flagged stubs only if 010a had not landed). No new dependencies.

## Do NOT
- implement the OpenAI-compatible provider, the extraction pipeline, prompts, or route wiring
- touch `src/index.ts`, or add dependencies
