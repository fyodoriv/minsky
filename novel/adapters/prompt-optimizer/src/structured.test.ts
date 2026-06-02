// Chaos test for failure-mode row 3 of `../README.md` § Failure modes:
// "Model returns malformed JSON inside `structured()`" → expected behavior
// `loud-crash-supervisor-restart`. Per constitutional rule #7 (chaos
// engineering, vision.md § 7) + rule #6 (let-it-crash, Armstrong 2007 ch. 13):
// the chaos test proves `structured()` throws synchronously on malformed model
// output rather than swallowing it into a Result type or a silent retry.

import { describe, expect, it, vi } from "vitest";

import {
  AnthropicPromptOptimizer,
  type MessagesClient,
  type MessagesCreateRequest,
  type MessagesCreateResponse,
} from "./anthropic.js";

/**
 * Stub `MessagesClient` whose `messages.create` always returns a single text
 * block of `replyText`. Lets a chaos drill inject arbitrary (well-formed or
 * malformed) model output deterministically, with no `ANTHROPIC_API_KEY` and
 * no network — the fault axis under test is upstream-malformed output, not
 * auth or transport.
 */
function clientReplying(replyText: string): MessagesClient {
  const reply = (_req: MessagesCreateRequest): MessagesCreateResponse => ({
    content: [{ type: "text", text: replyText }],
  });
  return { messages: { create: vi.fn(async (req: MessagesCreateRequest) => reply(req)) } };
}

const SCHEMA = { type: "object", properties: { answer: { type: "number" } } } as const;

describe("AnthropicPromptOptimizer.structured — malformed-JSON chaos (README row 3)", () => {
  it("throws synchronously (rejects) when the model returns non-JSON text", async () => {
    const opt = new AnthropicPromptOptimizer({ client: clientReplying("not json at all") });
    await expect(
      opt.structured<{ answer: number }>({ system: "S", user: "U", schema: SCHEMA }),
    ).rejects.toThrow(SyntaxError);
  });

  it("rejects on a truncated JSON object (the common streaming-cutoff fault)", async () => {
    const opt = new AnthropicPromptOptimizer({ client: clientReplying('{"answer":4') });
    await expect(
      opt.structured<{ answer: number }>({ system: "S", user: "U", schema: SCHEMA }),
    ).rejects.toThrow(SyntaxError);
  });

  it("does not swallow the parse error into a degraded value (let-it-crash, rule #6)", async () => {
    const opt = new AnthropicPromptOptimizer({ client: clientReplying("```json\n{}\n```") });
    let caught: unknown;
    try {
      await opt.structured<Record<string, never>>({ system: "S", user: "U", schema: SCHEMA });
    } catch (err) {
      caught = err;
    }
    // The fenced-code wrapper is not valid JSON: the contract is a loud throw,
    // never a `null` / `undefined` / Result-typed soft-fail the supervisor
    // can't distinguish from success.
    expect(caught).toBeInstanceOf(SyntaxError);
  });

  it("resolves with the typed value when the model returns well-formed JSON (steady-state control)", async () => {
    const opt = new AnthropicPromptOptimizer({ client: clientReplying('{"answer":42}') });
    const got = await opt.structured<{ answer: number }>({
      system: "S",
      user: "U",
      schema: SCHEMA,
    });
    expect(got).toEqual({ answer: 42 });
  });
});
