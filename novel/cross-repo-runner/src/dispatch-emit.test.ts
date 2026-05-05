// Tests for the dispatch-emit pure function. xUnit paired fixtures
// (Meszaros 2007). Pinning the argv shape is the test surface — if the
// `gh api …/dispatches` contract changes, these tests catch it before the
// harness emits a malformed dispatch into the cross-repo wire.

import { describe, expect, test } from "vitest";

import {
  DEFAULT_MINSKY_DISPATCH_REPO,
  DISPATCH_EVENT_TYPE,
  buildDispatchPayload,
} from "./dispatch-emit.js";

const validInput = {
  hostRepo: "owner/host",
  prNumber: 42,
  experimentYamlUrl:
    "https://api.github.com/repos/owner/host/contents/.minsky/experiments/foo.yaml?ref=abc123",
};

describe("buildDispatchPayload", () => {
  test("produces a flat argv that starts with `api repos/<minsky>/dispatches`", () => {
    const argv = buildDispatchPayload(validInput);
    expect(argv[0]).toBe("api");
    expect(argv[1]).toBe(`repos/${DEFAULT_MINSKY_DISPATCH_REPO}/dispatches`);
  });

  test("encodes event_type, host_repo, pr_number, experiment_yaml_url as -f pairs", () => {
    const argv = buildDispatchPayload(validInput);
    const fPairs = collectFFields(argv);
    expect(fPairs).toEqual({
      event_type: DISPATCH_EVENT_TYPE,
      "client_payload[host_repo]": validInput.hostRepo,
      "client_payload[pr_number]": String(validInput.prNumber),
      "client_payload[experiment_yaml_url]": validInput.experimentYamlUrl,
    });
  });

  test("default minsky repo is fyodoriv/minsky (decision C2)", () => {
    expect(DEFAULT_MINSKY_DISPATCH_REPO).toBe("fyodoriv/minsky");
  });

  test("event_type is `cross-repo-pr` (the workflow's repository_dispatch trigger)", () => {
    expect(DISPATCH_EVENT_TYPE).toBe("cross-repo-pr");
  });

  test("custom minskyRepo is honoured (fork-friendliness)", () => {
    const argv = buildDispatchPayload({ ...validInput, minskyRepo: "fork/minsky" });
    expect(argv[1]).toBe("repos/fork/minsky/dispatches");
  });

  test("rejects malformed hostRepo (must be owner/name)", () => {
    expect(() => buildDispatchPayload({ ...validInput, hostRepo: "no-slash" })).toThrow(
      /hostRepo must be owner\/name/,
    );
  });

  test("rejects non-positive prNumber", () => {
    expect(() => buildDispatchPayload({ ...validInput, prNumber: 0 })).toThrow(
      /prNumber must be a positive integer/,
    );
    expect(() => buildDispatchPayload({ ...validInput, prNumber: -1 })).toThrow(
      /prNumber must be a positive integer/,
    );
  });

  test("rejects non-http experimentYamlUrl (defence-in-depth at boundary)", () => {
    expect(() =>
      buildDispatchPayload({ ...validInput, experimentYamlUrl: "file:///etc/passwd" }),
    ).toThrow(/experimentYamlUrl must be an http\(s\) URL/);
    expect(() => buildDispatchPayload({ ...validInput, experimentYamlUrl: "" })).toThrow(
      /experimentYamlUrl must be a non-empty string/,
    );
  });
});

function collectFFields(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-f" && i + 1 < argv.length) {
      const pair = argv[i + 1] ?? "";
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        out[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }
  }
  return out;
}
