// Tests for `cost-tier-picker-io.ts`. Slice 2 of `interactive-model-cost-picker`.
// Paired positive/negative fixtures over the menu renderer, the
// selection parser, and the atomic config writer.

import { describe, expect, test } from "vitest";

import {
  type ConfigWriteIo,
  type ExistingConfig,
  parseUserSelection,
  renderTierMenu,
  writeConfigPatchAtomic,
} from "./cost-tier-picker-io.js";
import { COST_TIERS, type ConfigPatch, DEFAULT_TIER_ID } from "./cost-tier-picker.js";

describe("renderTierMenu", () => {
  test("renders all 7 tiers, numbered 1-7 in order", () => {
    const menu = renderTierMenu();
    for (let i = 0; i < COST_TIERS.length; i++) {
      const tier = COST_TIERS[i];
      if (tier) expect(menu).toContain(`(${i + 1}) ${tier.label}`);
    }
  });

  test("includes a tier-id and price reference for each tier", () => {
    const menu = renderTierMenu();
    for (const t of COST_TIERS) {
      // Label includes tier name; price line shows $X/hr.
      expect(menu).toContain(t.label);
      if (t.estimatedUsdPerHour === 0) {
        expect(menu).toContain("$0/hr");
      } else {
        expect(menu).toContain(`~$${t.estimatedUsdPerHour}/hr`);
      }
    }
  });

  test("ends with a prompt that names the default tier id", () => {
    const menu = renderTierMenu();
    expect(menu).toContain(`[default: ${DEFAULT_TIER_ID}]`);
    expect(menu).toMatch(/Enter a number \(1-7\) or tier id/);
  });

  test("pending tiers carry a `[pending YYYY-MM-DD]` suffix in the menu", () => {
    const menu = renderTierMenu();
    expect(menu).toContain("OpenHands + Claude workers");
    expect(menu).toContain("[pending 2026-06-01]");
  });

  test("shipped tiers do NOT carry the pending suffix", () => {
    const menu = renderTierMenu();
    // The opus-sonnet line should not include the "[pending ...]" text.
    const opusSonnetLine = menu
      .split("\n")
      .find((l) => l.includes("opus-sonnet") || l.includes("Opus brain + Sonnet workers"));
    expect(opusSonnetLine).toBeDefined();
    expect(opusSonnetLine ?? "").not.toContain("[pending");
  });
});

describe("parseUserSelection — numeric input", () => {
  test('"1" picks the first tier (opus-opus)', () => {
    const r = parseUserSelection("1");
    expect(r?.id).toBe("opus-opus");
  });

  test('"6" picks the last tier (windsurf-devin)', () => {
    const r = parseUserSelection("6");
    expect(r?.id).toBe("windsurf-devin");
  });

  test("whitespace-padded numeric input still picks the tier", () => {
    const r = parseUserSelection("  2  ");
    expect(r?.id).toBe("opus-sonnet");
  });

  test('"0" returns null (1-indexed; not a valid pick)', () => {
    expect(parseUserSelection("0")).toBeNull();
  });

  test('"7" returns null (out of range)', () => {
    expect(parseUserSelection("7")).toBeNull();
  });

  test('"99" returns null (out of range)', () => {
    expect(parseUserSelection("99")).toBeNull();
  });
});

describe("parseUserSelection — tier-id input", () => {
  test("recognises a valid tier id", () => {
    const r = parseUserSelection("local-local");
    expect(r?.id).toBe("local-local");
  });

  test("whitespace-padded tier id still resolves", () => {
    const r = parseUserSelection("  sonnet-local  ");
    expect(r?.id).toBe("sonnet-local");
  });

  test("returns null on unknown tier id", () => {
    expect(parseUserSelection("does-not-exist")).toBeNull();
  });

  test("tier id lookup is case-sensitive (matches slice 1 invariant)", () => {
    expect(parseUserSelection("OPUS-OPUS")).toBeNull();
  });

  test("pending tier (openhands-claude) by id returns null today (pre-2026-06-01)", () => {
    // The picker MUST refuse to persist an unrunnable tier. Returning
    // null routes the CLI shell back into the prompt loop where it
    // can emit the actionable "tier not yet available" message.
    expect(parseUserSelection("openhands-claude")).toBeNull();
  });

  test("pending tier (openhands-claude) by numeric pick (7) returns null today", () => {
    // The openhands-claude row is position 7 in the 7-tier table.
    expect(parseUserSelection("7")).toBeNull();
  });
});

describe("parseUserSelection — default fallback", () => {
  test("empty input returns the DEFAULT tier", () => {
    const r = parseUserSelection("");
    expect(r?.id).toBe(DEFAULT_TIER_ID);
  });

  test("whitespace-only input returns the DEFAULT tier", () => {
    const r = parseUserSelection("   \t   ");
    expect(r?.id).toBe(DEFAULT_TIER_ID);
  });
});

// --- writeConfigPatchAtomic ---

/** Build a recording IO double; tracks every writeFile + rename call. */
function makeRecordingIo(): {
  io: ConfigWriteIo;
  writes: Array<{ path: string; data: string; mode?: number }>;
  renames: Array<{ from: string; to: string }>;
} {
  const writes: Array<{ path: string; data: string; mode?: number }> = [];
  const renames: Array<{ from: string; to: string }> = [];
  const io: ConfigWriteIo = {
    writeFile: (path, data, opts) => {
      const entry: { path: string; data: string; mode?: number } = { path, data };
      if (opts?.mode !== undefined) entry.mode = opts.mode;
      writes.push(entry);
      return Promise.resolve();
    },
    rename: (from, to) => {
      renames.push({ from, to });
      return Promise.resolve();
    },
  };
  return { io, writes, renames };
}

const SAMPLE_PATCH: ConfigPatch = {
  cost_tier: "opus-sonnet",
  cloud_agent: "claude",
  cloud_agent_model: "claude-sonnet-4-5",
  local_agent: null,
  local_agent_model: null,
};

describe("writeConfigPatchAtomic", () => {
  test("writes to .tmp first, then renames over the target (atomic)", async () => {
    const { io, writes, renames } = makeRecordingIo();
    await writeConfigPatchAtomic("/etc/minsky.json", {}, SAMPLE_PATCH, io);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/etc/minsky.json.tmp");
    expect(renames).toHaveLength(1);
    expect(renames[0]).toEqual({ from: "/etc/minsky.json.tmp", to: "/etc/minsky.json" });
  });

  test("writes the merged config as pretty-printed JSON with trailing newline", async () => {
    const { io, writes } = makeRecordingIo();
    await writeConfigPatchAtomic("/etc/minsky.json", {}, SAMPLE_PATCH, io);
    const data = writes[0]?.data ?? "";
    expect(data.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(data.trimEnd());
    expect(parsed.cost_tier).toBe("opus-sonnet");
    expect(parsed.cloud_agent).toBe("claude");
  });

  test("preserves unrelated fields from the existing config", async () => {
    const { io, writes } = makeRecordingIo();
    const existing: ExistingConfig = {
      some_other_field: "preserve-me",
      telemetry_consent: true,
    };
    await writeConfigPatchAtomic("/etc/minsky.json", existing, SAMPLE_PATCH, io);
    const parsed = JSON.parse(writes[0]?.data ?? "{}");
    expect(parsed.some_other_field).toBe("preserve-me");
    expect(parsed.telemetry_consent).toBe(true);
    expect(parsed.cost_tier).toBe("opus-sonnet");
  });

  test("the patch overrides existing cost_tier (not the other way around)", async () => {
    const { io, writes } = makeRecordingIo();
    const existing: ExistingConfig = { cost_tier: "sonnet-sonnet" };
    await writeConfigPatchAtomic("/etc/minsky.json", existing, SAMPLE_PATCH, io);
    const parsed = JSON.parse(writes[0]?.data ?? "{}");
    expect(parsed.cost_tier).toBe("opus-sonnet"); // patch wins
  });

  test("writes with mode 0o600 (operator-only read/write)", async () => {
    const { io, writes } = makeRecordingIo();
    await writeConfigPatchAtomic("/etc/minsky.json", {}, SAMPLE_PATCH, io);
    expect(writes[0]?.mode).toBe(0o600);
  });
});
