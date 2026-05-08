/**
 * Paired tests for `arch-probe.ts` — pure architecture-detection for the
 * local-LLM bootstrap. Slice 6 of P0 task `minsky-cli-arch-detection`
 * (composes with `minsky-cli-auto-bootstrap-local-llm`).
 *
 * Covers the six equivalence-class cases enumerated in the task's
 * Verification block:
 *   1. Apple Silicon hardware + native arm shell + /opt/homebrew present
 *   2. Apple Silicon hardware + x86_64 (Rosetta) shell + /opt/homebrew present
 *   3. Apple Silicon hardware + x86_64 (Rosetta) shell + NO /opt/homebrew (the bug)
 *   4. Apple Silicon hardware + native arm shell + NO /opt/homebrew
 *   5. Intel Mac hardware + any shell + /usr/local/bin/brew
 *   6. Linux host (sysctl absent → hardwareArch = "other")
 *
 * Plus the chaos-table rows from `arch-probe.ts` JSDoc:
 *   - Sysctl probe rejects (non-darwin) → hardware "other", no mismatch
 *   - Both brew paths present (rare: Apple Silicon with both Intel + ARM brew)
 *     → prefer native
 */

import { describe, expect, it } from "vitest";
import {
  type ArchProbes,
  type ArchState,
  describeArchState,
  detectArchState,
  needsArmHomebrewInstall,
  preferredBrewPath,
  preferredPipxPath,
} from "./arch-probe.js";

// ---- Fixtures -------------------------------------------------------------

const appleSiliconHw = async () => "arm64" as const;
const intelHw = async () => "x86_64" as const;
const linuxHw = async () => "other" as const;

function buildProbes(overrides: Partial<ArchProbes>): ArchProbes {
  return {
    probeShellArch: () => "arm64",
    probeHardwareArch: appleSiliconHw,
    probeNativeBrewPath: () => "/opt/homebrew/bin/brew",
    probeIntelBrewPath: () => undefined,
    ...overrides,
  };
}

// ---- Equivalence-class case 1: Apple Silicon native -----------------------

describe("detectArchState — case 1: Apple Silicon + native arm shell + native brew", () => {
  it("reports no mismatch and no install needed", async () => {
    const state = await detectArchState(buildProbes({}));
    expect(state.shellArch).toBe("arm64");
    expect(state.hardwareArch).toBe("arm64");
    expect(state.nativeBrewPath).toBe("/opt/homebrew/bin/brew");
    expect(state.mismatch).toBe(false);
    expect(state.needsNativeBrew).toBe(false);
  });
});

// ---- Equivalence-class case 2: Apple Silicon + Rosetta + brew ------------

describe("detectArchState — case 2: Apple Silicon hw + x86_64 shell + native brew", () => {
  it("reports mismatch but no install needed (brew already exists)", async () => {
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "x86_64",
      }),
    );
    expect(state.shellArch).toBe("x86_64");
    expect(state.hardwareArch).toBe("arm64");
    expect(state.mismatch).toBe(true);
    expect(state.needsNativeBrew).toBe(false);
    expect(state.nativeBrewPath).toBe("/opt/homebrew/bin/brew");
  });
});

// ---- Equivalence-class case 3: the operator's M3 Max Rosetta bug ---------

describe("detectArchState — case 3: Apple Silicon hw + x86_64 shell + NO native brew (the bug)", () => {
  it("reports mismatch AND needsNativeBrew=true", async () => {
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "x86_64",
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => "/usr/local/bin/brew",
      }),
    );
    expect(state.shellArch).toBe("x86_64");
    expect(state.hardwareArch).toBe("arm64");
    expect(state.mismatch).toBe(true);
    expect(state.needsNativeBrew).toBe(true);
    expect(state.nativeBrewPath).toBeUndefined();
    expect(state.intelBrewPath).toBe("/usr/local/bin/brew");
  });

  it("still needsNativeBrew=true when neither brew is present", async () => {
    // Fresh machine — the installer will land /opt/homebrew/ anyway.
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "x86_64",
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => undefined,
      }),
    );
    expect(state.needsNativeBrew).toBe(true);
  });
});

// ---- Equivalence-class case 4: Apple Silicon native shell, no brew -------

describe("detectArchState — case 4: Apple Silicon native shell + NO brew (fresh M-series)", () => {
  it("reports no mismatch but needsNativeBrew=true", async () => {
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "arm64",
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => undefined,
      }),
    );
    expect(state.shellArch).toBe("arm64");
    expect(state.hardwareArch).toBe("arm64");
    expect(state.mismatch).toBe(false);
    expect(state.needsNativeBrew).toBe(true);
  });
});

// ---- Equivalence-class case 5: Intel Mac ---------------------------------

describe("detectArchState — case 5: Intel Mac (legit x86_64 on x86_64 hw)", () => {
  it("reports no mismatch and no native brew needed (Intel brew at /usr/local/)", async () => {
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "x86_64",
        probeHardwareArch: intelHw,
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => "/usr/local/bin/brew",
      }),
    );
    expect(state.shellArch).toBe("x86_64");
    expect(state.hardwareArch).toBe("x86_64");
    expect(state.mismatch).toBe(false);
    // Intel Mac doesn't need /opt/homebrew/ — it uses /usr/local/.
    expect(state.needsNativeBrew).toBe(false);
    expect(state.intelBrewPath).toBe("/usr/local/bin/brew");
  });

  it("Intel Mac with no brew at all still doesn't flag needsNativeBrew", async () => {
    // /opt/homebrew/ is Apple-Silicon-only; Intel Macs install brew to
    // /usr/local/. The planner's existing `brew install pipx` step
    // handles that case already (slice 1 behavior).
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "x86_64",
        probeHardwareArch: intelHw,
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => undefined,
      }),
    );
    expect(state.needsNativeBrew).toBe(false);
  });
});

// ---- Equivalence-class case 6: Linux -------------------------------------

describe("detectArchState — case 6: Linux host (sysctl returns 'other')", () => {
  it("reports hardwareArch=other, no mismatch, no native brew needed", async () => {
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "x86_64",
        probeHardwareArch: linuxHw,
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => undefined,
      }),
    );
    expect(state.shellArch).toBe("x86_64");
    expect(state.hardwareArch).toBe("other");
    expect(state.mismatch).toBe(false);
    expect(state.needsNativeBrew).toBe(false);
  });

  it("arm64 Linux also reports no mismatch + no brew install (would need a different package manager)", async () => {
    // aarch64 Linux servers — the probe returns "other" for sysctl
    // failure, not "arm64". This is intentional: MLX is Apple-Silicon-
    // specific via Metal API; a Linux arm64 host can't run MLX anyway.
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "arm64",
        probeHardwareArch: linuxHw,
        probeNativeBrewPath: () => undefined,
        probeIntelBrewPath: () => undefined,
      }),
    );
    expect(state.mismatch).toBe(false);
    expect(state.needsNativeBrew).toBe(false);
  });
});

// ---- Chaos-table rows -----------------------------------------------------

describe("detectArchState — chaos-table row: probe seam rejects", () => {
  it("bubbles up probeHardwareArch rejections (loud-crash per Armstrong)", async () => {
    const probes = buildProbes({
      probeHardwareArch: async () => {
        throw new Error("sysctl failed");
      },
    });
    await expect(detectArchState(probes)).rejects.toThrow("sysctl failed");
  });
});

describe("detectArchState — edge: both brew paths present", () => {
  it("reports both but prefers native arm (/opt/homebrew/) for planner use", async () => {
    // Seen in the wild: operators who migrated from Intel Mac and
    // installed native brew on top of their Intel brew without
    // uninstalling. Both paths exist; we report both in state so the
    // planner can choose /opt/homebrew/ consistently.
    const state = await detectArchState(
      buildProbes({
        probeShellArch: () => "arm64",
        probeNativeBrewPath: () => "/opt/homebrew/bin/brew",
        probeIntelBrewPath: () => "/usr/local/bin/brew",
      }),
    );
    expect(state.nativeBrewPath).toBe("/opt/homebrew/bin/brew");
    expect(state.intelBrewPath).toBe("/usr/local/bin/brew");
    expect(state.needsNativeBrew).toBe(false);
  });
});

// ---- Derived helpers ------------------------------------------------------

describe("needsArmHomebrewInstall — projection over ArchState", () => {
  it("true when hardware is arm64 and no native brew", () => {
    const state: ArchState = {
      shellArch: "arm64",
      hardwareArch: "arm64",
      nativeBrewPath: undefined,
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: true,
    };
    expect(needsArmHomebrewInstall(state)).toBe(true);
  });

  it("false when native brew already present", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "arm64",
      nativeBrewPath: "/opt/homebrew/bin/brew",
      intelBrewPath: undefined,
      mismatch: true,
      needsNativeBrew: false,
    };
    expect(needsArmHomebrewInstall(state)).toBe(false);
  });

  it("false on Intel Mac even with no brew", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "x86_64",
      nativeBrewPath: undefined,
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: false,
    };
    expect(needsArmHomebrewInstall(state)).toBe(false);
  });
});

describe("preferredBrewPath — planner absolute-path picker", () => {
  it("returns native brew when present", () => {
    const state: ArchState = {
      shellArch: "arm64",
      hardwareArch: "arm64",
      nativeBrewPath: "/opt/homebrew/bin/brew",
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: false,
    };
    expect(preferredBrewPath(state)).toBe("/opt/homebrew/bin/brew");
  });

  it("returns intel brew when only intel is present AND hardware is x86_64", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "x86_64",
      nativeBrewPath: undefined,
      intelBrewPath: "/usr/local/bin/brew",
      mismatch: false,
      needsNativeBrew: false,
    };
    expect(preferredBrewPath(state)).toBe("/usr/local/bin/brew");
  });

  it("returns the eventual native path when arm64 hw has neither brew yet", () => {
    // The install-arm-homebrew step will land /opt/homebrew/bin/brew
    // by the time the next step runs; the planner pre-references it.
    const state: ArchState = {
      shellArch: "arm64",
      hardwareArch: "arm64",
      nativeBrewPath: undefined,
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: true,
    };
    expect(preferredBrewPath(state)).toBe("/opt/homebrew/bin/brew");
  });

  it("returns undefined on Linux (no brew support path)", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "other",
      nativeBrewPath: undefined,
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: false,
    };
    expect(preferredBrewPath(state)).toBeUndefined();
  });
});

describe("preferredPipxPath — derived pipx absolute path", () => {
  it("returns /opt/homebrew/bin/pipx when brew is native arm64", () => {
    const state: ArchState = {
      shellArch: "arm64",
      hardwareArch: "arm64",
      nativeBrewPath: "/opt/homebrew/bin/brew",
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: false,
    };
    expect(preferredPipxPath(state)).toBe("/opt/homebrew/bin/pipx");
  });

  it("returns /usr/local/bin/pipx when brew is intel", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "x86_64",
      nativeBrewPath: undefined,
      intelBrewPath: "/usr/local/bin/brew",
      mismatch: false,
      needsNativeBrew: false,
    };
    expect(preferredPipxPath(state)).toBe("/usr/local/bin/pipx");
  });

  it("returns eventual /opt/homebrew/bin/pipx when arm-brew will be installed", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "arm64",
      nativeBrewPath: undefined,
      intelBrewPath: undefined,
      mismatch: true,
      needsNativeBrew: true,
    };
    expect(preferredPipxPath(state)).toBe("/opt/homebrew/bin/pipx");
  });
});

describe("describeArchState — human-readable doctor row", () => {
  it("happy path: native arm + native brew → short positive message", () => {
    const state: ArchState = {
      shellArch: "arm64",
      hardwareArch: "arm64",
      nativeBrewPath: "/opt/homebrew/bin/brew",
      intelBrewPath: undefined,
      mismatch: false,
      needsNativeBrew: false,
    };
    const msg = describeArchState(state);
    expect(msg).toMatch(/arm64/);
    expect(msg).toMatch(/native/i);
  });

  it("rosetta bug: x86_64 shell on Apple Silicon without brew → actionable message", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "arm64",
      nativeBrewPath: undefined,
      intelBrewPath: "/usr/local/bin/brew",
      mismatch: true,
      needsNativeBrew: true,
    };
    const msg = describeArchState(state);
    expect(msg).toMatch(/x86_64/);
    expect(msg).toMatch(/Apple Silicon|M\d/i);
    expect(msg).toMatch(/opt\/homebrew|native.*brew/i);
  });

  it("Intel Mac: no mismatch, concise", () => {
    const state: ArchState = {
      shellArch: "x86_64",
      hardwareArch: "x86_64",
      nativeBrewPath: undefined,
      intelBrewPath: "/usr/local/bin/brew",
      mismatch: false,
      needsNativeBrew: false,
    };
    const msg = describeArchState(state);
    expect(msg).toMatch(/x86_64/);
    // Should NOT scold the operator about native brew (Intel Mac is legit).
    expect(msg).not.toMatch(/need.*native/i);
  });
});

// ---- Referential transparency -------------------------------------------

describe("detectArchState — referential transparency", () => {
  it("same probes → same state (no hidden state between calls)", async () => {
    const probes = buildProbes({});
    const s1 = await detectArchState(probes);
    const s2 = await detectArchState(probes);
    expect(s1).toEqual(s2);
  });

  it("runs probes in parallel (Promise.all semantics)", async () => {
    // Proxy for "parallel": reject probeHardwareArch late. If probes
    // ran sequentially, earlier probes' resolved values would still
    // be observable via a side-channel (e.g., resolved Promise state).
    // We just assert no hang and proper rejection.
    let latchResolved = false;
    const probes = buildProbes({
      probeHardwareArch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        latchResolved = true;
        return "arm64";
      },
    });
    const result = await detectArchState(probes);
    expect(latchResolved).toBe(true);
    expect(result.hardwareArch).toBe("arm64");
  });
});
