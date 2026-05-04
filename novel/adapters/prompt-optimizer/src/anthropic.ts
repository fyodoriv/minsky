/**
 * Anthropic-SDK-backed `PromptOptimizer` — Strategy implementation
 * (Gamma et al., *Design Patterns*, 1994) of the {@link PromptOptimizer}
 * interface defined in `./index.ts`.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Strategy of `PromptOptimizer`. Conformance: full.
 *   - Cache-prefix discipline: `cache_control` block on the system prefix per
 *                            ARCHITECTURE.md § "Token economy" — protects the
 *                            reusable system prompt across A/B variants.
 *                            Conformance: full.
 *
 * The constructor accepts an injected `MessagesClient` (the minimal subset of
 * `@anthropic-ai/sdk`'s `Anthropic` shape we use) so tests can substitute a
 * deterministic stub without an `ANTHROPIC_API_KEY`. The default is an
 * `Anthropic` instance lazily constructed when `selfTest()` / `runABTest()` /
 * `structured()` first runs against the real SDK — matched to the rule-#7
 * graceful-degrade path: missing API key produces a `yellow` selfTest, not a
 * crash, since the surrounding supervisor expects a degradable adapter.
 *
 * Anchors:
 *   - Anthropic Messages API specification (vendor docs, current).
 *   - Gamma et al., *Design Patterns*, 1994 (Strategy + Adapter).
 *   - ARCHITECTURE.md § "Token economy" (cache-prefix invariant).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SelfTestResult } from "@minsky/adapter-types";

import type { ABResult, PromptOptimizer, RunABTestArgs, StructuredArgs, Variant } from "./index.js";
import { runABTestPure } from "./index.js";

/**
 * The minimal subset of `@anthropic-ai/sdk` this strategy uses. Declared as
 * an explicit shape so tests can inject a deterministic stub without
 * pulling the real SDK and without an API key.
 */
export interface MessagesClient {
  messages: {
    create(req: MessagesCreateRequest): Promise<MessagesCreateResponse>;
  };
}

export interface MessagesCreateRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system?:
    | string
    | ReadonlyArray<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  readonly messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
}

export interface MessagesCreateResponse {
  readonly content: ReadonlyArray<{ type: string; text?: string }>;
  readonly usage?: { input_tokens?: number; output_tokens?: number };
  readonly id?: string;
}

export interface AnthropicPromptOptimizerConfig {
  readonly client?: MessagesClient;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly apiKey?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 1024;

/** Strategy implementation of {@link PromptOptimizer} backed by Anthropic. */
export class AnthropicPromptOptimizer implements PromptOptimizer {
  private readonly client: MessagesClient;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: AnthropicPromptOptimizerConfig = {}) {
    this.client = config.client ?? defaultClient(config.apiKey);
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * Runs the A/B via the shared pure kernel, calling Anthropic Messages once
   * per (variant × input) pair. Cache-pinned system prefix per the
   * token-economy invariant.
   *
   * @otel adapters.prompt-optimizer.run-ab-test
   */
  async runABTest(args: RunABTestArgs): Promise<ABResult> {
    return runABTestPure(args, async (_variantId, input, variant) =>
      callOne(this.client, this.model, this.maxTokens, variant, renderUser(variant.user, input)),
    );
  }

  /**
   * Single typed call. The schema is appended to the system prompt as a JSON
   * Schema directive so the model is biased toward schema-shaped output; the
   * caller (one layer up) is responsible for `JSON.parse` + ajv-style
   * validation. This is the `Signature` analogue Khattab 2023 names; the
   * tighter "tool-use response constraint" path is a follow-up.
   *
   * @otel adapters.prompt-optimizer.structured
   */
  async structured<T>(args: StructuredArgs): Promise<T> {
    const { text } = await callOne(
      this.client,
      this.model,
      this.maxTokens,
      { id: "structured", system: args.system, user: args.user },
      args.user,
      JSON.stringify(args.schema),
    );
    return JSON.parse(text) as T;
  }

  /**
   * Health probe. Without a live API key the probe returns `yellow` (the
   * graceful-degrade response per rule #7); with a key, it makes one minimal
   * `messages.create` call and returns `green` on success, `red` on error.
   *
   * @otel adapters.prompt-optimizer.self-test
   */
  async selfTest(): Promise<SelfTestResult> {
    const start = Date.now();
    const apiKeyPresent = Boolean(process.env["ANTHROPIC_API_KEY"]);
    if (!apiKeyPresent && this.client === defaultClientCache.last) {
      return {
        status: "yellow",
        message: "ANTHROPIC_API_KEY not set; selfTest skipped (graceful-degrade per rule #7)",
        latencyMs: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 16,
        system: "You are a health probe. Reply with the single token: ok.",
        messages: [{ role: "user", content: "ping" }],
      });
      const text = extractText(resp);
      return {
        status: "green",
        message: `AnthropicPromptOptimizer.selfTest: replied (${text.length} chars)`,
        latencyMs: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
      // rule-6: handled-locally — health-probe contract converts upstream errors into a `red` SelfTestResult per Avizienis 1985 / Burns 2016
    } catch (err) {
      return {
        status: "red",
        message: `AnthropicPromptOptimizer.selfTest failed: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
  }
}

/**
 * Cached default client. Tracking the last-issued instance lets `selfTest`
 * tell injected-client code paths apart from the implicit-default path
 * without breaking strict typing or the public API.
 */
const defaultClientCache: { last: MessagesClient | null } = { last: null };

/**
 * Lazily construct a real `Anthropic` client. The SDK does not validate the
 * key until a request runs, so this is safe to call without a key — the
 * absence is surfaced by `selfTest()` as `yellow`.
 *
 * @otel-exempt construction-only helper; no I/O until a method is called on
 *   the returned object.
 */
function defaultClient(apiKey?: string): MessagesClient {
  const opts: { apiKey?: string } = {};
  if (apiKey !== undefined) opts.apiKey = apiKey;
  // The SDK's runtime shape includes `messages.create` returning a Promise;
  // we narrow to our `MessagesClient` shape via a structural cast. Dead-API
  // failures still surface through `selfTest()`'s `red` branch.
  const sdk = new Anthropic(opts) as unknown as MessagesClient;
  defaultClientCache.last = sdk;
  return sdk;
}

/**
 * One call to `messages.create` on behalf of a single variant. Returns the
 * extracted text + token count + id-as-trace.
 *
 * @otel-exempt private helper — span is emitted by the public method that
 *   invokes this. Splitting the span here would double-count.
 */
async function callOne(
  client: MessagesClient,
  model: string,
  maxTokens: number,
  variant: Pick<Variant, "id" | "system" | "user">,
  userText: string,
  schemaText?: string,
): Promise<{ text: string; tokens: number; traceId: string }> {
  const systemBlocks = buildSystem(variant.system, schemaText);
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [{ role: "user", content: userText }],
  });
  return {
    text: extractText(resp),
    tokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    traceId: resp.id ?? "",
  };
}

/**
 * Build the `system` field with `cache_control` on the prefix per
 * ARCHITECTURE.md § "Token economy". When a `schemaText` rider is present
 * (the `structured` path), it goes into a *second* block that is NOT
 * cache-pinned — schemas vary per call and would defeat the cache.
 *
 * @otel-exempt pure helper.
 */
function buildSystem(
  systemText: string,
  schemaText: string | undefined,
): NonNullable<MessagesCreateRequest["system"]> {
  const prefix = {
    type: "text" as const,
    text: systemText,
    cache_control: { type: "ephemeral" as const },
  };
  if (schemaText === undefined) return [prefix];
  return [
    prefix,
    {
      type: "text" as const,
      text: `Respond ONLY with JSON matching this JSON Schema:\n${schemaText}`,
    },
  ];
}

/**
 * Concatenate every text-typed content block in a `MessagesCreateResponse`.
 * Tool-use blocks (different `type`) are skipped at this layer; the
 * `structured` path will lift them in a follow-up.
 *
 * @otel-exempt pure helper.
 */
function extractText(resp: MessagesCreateResponse): string {
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

/**
 * Render a user-template string with `{{key}}` placeholders. Lightweight and
 * intentional — full templating belongs to a separate concern.
 *
 * @otel-exempt pure helper.
 */
function renderUser(template: string, input: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (full, key: string) => {
    if (Object.hasOwn(input, key)) {
      const v = input[key];
      return typeof v === "string" ? v : JSON.stringify(v);
    }
    return full;
  });
}
