import { describe, expect, it, vi } from "vitest";

import {
  AnthropicPromptOptimizer,
  type MessagesClient,
  type MessagesCreateRequest,
  type MessagesCreateResponse,
} from "./anthropic.js";

/**
 * Make a stub `MessagesClient` that returns a deterministic completion
 * function of (system, userText) plus a fixed token count and id. Tests
 * never hit the real network — the SDK is constructor-injected.
 */
function stubClient(
  reply: (req: MessagesCreateRequest) => MessagesCreateResponse | Promise<MessagesCreateResponse>,
): MessagesClient {
  return {
    messages: {
      create: vi.fn(async (req: MessagesCreateRequest) => reply(req)),
    },
  };
}

describe("AnthropicPromptOptimizer.runABTest", () => {
  it("calls messages.create once per (variant × input) pair and picks the highest-mean winner", async () => {
    const calls: MessagesCreateRequest[] = [];
    const client = stubClient((req) => {
      calls.push(req);
      const sys = Array.isArray(req.system) ? (req.system[0]?.text ?? "") : (req.system ?? "");
      return {
        content: [{ type: "text", text: sys.includes("WIN") ? "great" : "meh" }],
        usage: { input_tokens: 5, output_tokens: 3 },
        id: "msg_01",
      };
    });
    const opt = new AnthropicPromptOptimizer({ client, model: "test-model", maxTokens: 32 });

    const result = await opt.runABTest({
      variants: [
        { id: "lose", system: "lose-prompt", user: "{{q}}" },
        { id: "win", system: "WIN-prompt", user: "{{q}}" },
      ],
      inputs: [{ q: "hello" }, { q: "world" }],
      metric: async (output) => (output === "great" ? 1 : 0),
    });

    expect(result.winnerId).toBe("win");
    expect(calls).toHaveLength(4);
    expect(result.results.every((r) => r.tokens === 8)).toBe(true);
    expect(result.results.every((r) => r.traceId === "msg_01")).toBe(true);
  });

  it("renders {{key}} placeholders in the user template from the input record", async () => {
    let observedUser = "";
    const client = stubClient((req) => {
      observedUser = req.messages[0]?.content ?? "";
      return { content: [{ type: "text", text: "ok" }] };
    });
    const opt = new AnthropicPromptOptimizer({ client });

    await opt.runABTest({
      variants: [{ id: "v", system: "S", user: "Hello {{name}}, age {{age}}." }],
      inputs: [{ name: "Alice", age: 30 }],
      metric: async () => 1,
    });

    expect(observedUser).toBe("Hello Alice, age 30.");
  });

  it("attaches cache_control to the system prefix per the token-economy invariant", async () => {
    let observedSystem: MessagesCreateRequest["system"];
    const client = stubClient((req) => {
      observedSystem = req.system;
      return { content: [{ type: "text", text: "ok" }] };
    });
    const opt = new AnthropicPromptOptimizer({ client });

    await opt.runABTest({
      variants: [{ id: "v", system: "the system", user: "u" }],
      inputs: [{}],
      metric: async () => 1,
    });

    expect(Array.isArray(observedSystem)).toBe(true);
    if (Array.isArray(observedSystem)) {
      expect(observedSystem[0]?.text).toBe("the system");
      expect(observedSystem[0]?.cache_control).toEqual({ type: "ephemeral" });
    }
  });
});

describe("AnthropicPromptOptimizer.structured", () => {
  it("parses the model's text reply as JSON and returns it typed as T", async () => {
    const client = stubClient(() => ({
      content: [{ type: "text", text: '{"answer":42}' }],
    }));
    const opt = new AnthropicPromptOptimizer({ client });

    const got = await opt.structured<{ answer: number }>({
      system: "S",
      user: "U",
      schema: { type: "object", properties: { answer: { type: "number" } } },
    });
    expect(got).toEqual({ answer: 42 });
  });

  it("appends the JSON Schema as a non-cached second system block", async () => {
    let observedSystem: MessagesCreateRequest["system"];
    const client = stubClient((req) => {
      observedSystem = req.system;
      return { content: [{ type: "text", text: "{}" }] };
    });
    const opt = new AnthropicPromptOptimizer({ client });

    await opt.structured<Record<string, never>>({
      system: "S",
      user: "U",
      schema: { type: "object" },
    });

    expect(Array.isArray(observedSystem)).toBe(true);
    if (Array.isArray(observedSystem)) {
      expect(observedSystem).toHaveLength(2);
      expect(observedSystem[0]?.cache_control).toEqual({ type: "ephemeral" });
      expect(observedSystem[1]?.cache_control).toBeUndefined();
      expect(observedSystem[1]?.text).toContain("JSON Schema");
    }
  });
});

describe("AnthropicPromptOptimizer.selfTest", () => {
  it("returns green when the injected client succeeds", async () => {
    const client = stubClient(() => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const opt = new AnthropicPromptOptimizer({ client });
    const r = await opt.selfTest();
    expect(r.status).toBe("green");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.message).toMatch(/replied/);
  });

  it("returns red when the injected client throws", async () => {
    const client = stubClient(() => {
      throw new Error("network");
    });
    const opt = new AnthropicPromptOptimizer({ client });
    const r = await opt.selfTest();
    expect(r.status).toBe("red");
    expect(r.message).toMatch(/network/);
  });

  it("returns yellow when no API key is set and no client was injected (graceful-degrade)", async () => {
    const previous = process.env["ANTHROPIC_API_KEY"];
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    try {
      const opt = new AnthropicPromptOptimizer();
      const r = await opt.selfTest();
      expect(r.status).toBe("yellow");
      expect(r.message).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      if (previous !== undefined) process.env["ANTHROPIC_API_KEY"] = previous;
    }
  });
});
