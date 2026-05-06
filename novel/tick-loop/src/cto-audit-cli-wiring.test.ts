import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CTO_AUDIT_ENABLE_ENV_VAR,
  type ExecFileLike,
  createFileBackedCtoAuditLock,
  createGitGhSignalsBuilder,
  detectCtoAuditEnvDrift,
  ensureCtoAuditLabel,
  extractPrUrl,
  parseFilesChangedFromGit,
  parsePlistEnv,
  parseRecentMainCommitsFromGit,
} from "./cto-audit-cli-wiring.js";
import { CTO_AUDIT_PR_LABEL } from "./post-task-cto-audit.js";

describe("createFileBackedCtoAuditLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "cto-audit-lock-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports lockExists=false before any acquireLock", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    expect(lock.lockExists("some-task")).toBe(false);
  });

  it("reports lockExists=true after acquireLock for the same id", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    lock.acquireLock("some-task");
    expect(lock.lockExists("some-task")).toBe(true);
  });

  it("isolates locks per taskId", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    lock.acquireLock("task-a");
    expect(lock.lockExists("task-a")).toBe(true);
    expect(lock.lockExists("task-b")).toBe(false);
  });

  it("persists lock state across instances (crash-safe)", () => {
    const first = createFileBackedCtoAuditLock(dir);
    first.acquireLock("persisted");
    // Simulate daemon restart — fresh factory pointing at the same dir.
    const second = createFileBackedCtoAuditLock(dir);
    expect(second.lockExists("persisted")).toBe(true);
  });

  it("creates the lock directory lazily on first acquire", () => {
    const nested = resolve(dir, "nested", "deep");
    const lock = createFileBackedCtoAuditLock(nested);
    expect(() => lock.acquireLock("first-ever")).not.toThrow();
    expect(lock.lockExists("first-ever")).toBe(true);
  });

  it("sanitises non-conforming taskId characters to defend against path traversal", () => {
    const lock = createFileBackedCtoAuditLock(dir);
    // Path-traversal would otherwise touch the parent dir; sanitisation
    // keeps the lock file inside `dir`.
    lock.acquireLock("../../escape");
    const sanitisedSentinel = resolve(dir, "______escape");
    expect(() => readFileSync(sanitisedSentinel, "utf-8")).not.toThrow();
  });
});

describe("extractPrUrl", () => {
  it("returns the first GitHub PR URL when present", () => {
    const tail = "PR #176 opened: https://github.com/fyodoriv/minsky/pull/176\nDone";
    expect(extractPrUrl(tail)).toBe("https://github.com/fyodoriv/minsky/pull/176");
  });

  it("returns null when no PR URL is present", () => {
    expect(extractPrUrl("noop, exiting")).toBeNull();
  });

  it("returns the first match when multiple URLs are present", () => {
    const tail = ["https://github.com/x/y/pull/1", "https://github.com/x/y/pull/2"].join("\n");
    expect(extractPrUrl(tail)).toBe("https://github.com/x/y/pull/1");
  });

  it("ignores non-PR github URLs (issues, commits)", () => {
    const tail = ["https://github.com/x/y/issues/3", "https://github.com/x/y/commit/abcdef"].join(
      "\n",
    );
    expect(extractPrUrl(tail)).toBeNull();
  });
});

describe("parseFilesChangedFromGit", () => {
  it("returns one entry per non-empty line", () => {
    const out = "src/foo.ts\nsrc/bar.ts\nREADME.md";
    expect(parseFilesChangedFromGit(out)).toEqual(["src/foo.ts", "src/bar.ts", "README.md"]);
  });

  it("returns empty array for empty input (no commit landed)", () => {
    expect(parseFilesChangedFromGit("")).toEqual([]);
    expect(parseFilesChangedFromGit("\n\n  \n")).toEqual([]);
  });
});

describe("parseRecentMainCommitsFromGit", () => {
  it("reverses git's newest-first order to oldest-first", () => {
    const out = "newest\nmiddle\noldest";
    expect(parseRecentMainCommitsFromGit(out)).toEqual(["oldest", "middle", "newest"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseRecentMainCommitsFromGit("")).toEqual([]);
  });
});

/** Per-call response keyed by the routing predicate; first-match wins. */
type Route = { match: (file: string, args: readonly string[]) => boolean; out: string };

function fakeExec(routes: readonly Route[]): ExecFileLike {
  return vi.fn(async (file, args) => {
    const hit = routes.find((r) => r.match(file, args));
    return hit ? hit.out : "";
  });
}

const isGitNameOnly: Route["match"] = (file, args) =>
  file === "git" && args.includes("--name-only");
const isGitLog: Route["match"] = (file) => file === "git";
const isGhKind =
  (kind: "issue" | "pr"): Route["match"] =>
  (file, args) =>
    file === "gh" && args[0] === kind;
const isGh: Route["match"] = (file) => file === "gh";

describe("createGitGhSignalsBuilder", () => {
  it("threads taskId + extracts prUrl from spawnStdoutTail", async () => {
    const execFile = fakeExec([
      { match: isGitNameOnly, out: "a.ts\nb.ts" },
      { match: isGitLog, out: "feat: c\nfeat: b\nfeat: a" },
      { match: isGh, out: "[]" },
    ]);
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({
      taskId: "my-task",
      spawnStdoutTail: "PR opened https://github.com/x/y/pull/42",
    });
    expect(signals.completedTaskId).toBe("my-task");
    expect(signals.prUrl).toBe("https://github.com/x/y/pull/42");
    expect(signals.filesChanged).toEqual(["a.ts", "b.ts"]);
    expect(signals.recentMainCommits).toEqual(["feat: a", "feat: b", "feat: c"]);
    expect(signals.lintScores).toEqual({});
  });

  it("sums open-issue and open-pr counts via gh ... --json=number", async () => {
    const execFile = fakeExec([
      { match: isGhKind("issue"), out: '[{"number":1},{"number":2}]' },
      { match: isGhKind("pr"), out: '[{"number":3},{"number":4},{"number":5}]' },
    ]);
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({ taskId: "x", spawnStdoutTail: "" });
    expect(signals.openWorkItems).toBe(5);
  });

  it("graceful-degrades to zero/empty when execFile rejects (rule #7)", async () => {
    const execFile: ExecFileLike = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({ taskId: "x", spawnStdoutTail: "" });
    expect(signals.filesChanged).toEqual([]);
    expect(signals.recentMainCommits).toEqual([]);
    expect(signals.openWorkItems).toBe(0);
    expect(signals.prUrl).toBeNull();
  });

  it("graceful-degrades when gh returns non-array JSON", async () => {
    const execFile = fakeExec([{ match: isGh, out: '{"unexpected":"shape"}' }]);
    const build = createGitGhSignalsBuilder({ execFile });
    const signals = await build({ taskId: "x", spawnStdoutTail: "" });
    expect(signals.openWorkItems).toBe(0);
  });
});

describe("ensureCtoAuditLabel", () => {
  const isLabelList: Route["match"] = (file, args) =>
    file === "gh" && args[0] === "label" && args[1] === "list";
  const isLabelCreate: Route["match"] = (file, args) =>
    file === "gh" && args[0] === "label" && args[1] === "create";

  it("returns 'exists' when the label is already present (no create call)", async () => {
    const execFile = vi.fn(fakeExec([{ match: isLabelList, out: `${CTO_AUDIT_PR_LABEL}\n` }]));
    const outcome = await ensureCtoAuditLabel({ execFile });
    expect(outcome).toBe("exists");
    const createCalls = execFile.mock.calls.filter(
      (call) => call[1][0] === "label" && call[1][1] === "create",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("returns 'created' when label-list comes back empty and create succeeds", async () => {
    const execFile = vi.fn(
      fakeExec([
        { match: isLabelList, out: "" },
        { match: isLabelCreate, out: 'Label "minsky:cto-audit" created in fyodoriv/minsky' },
      ]),
    );
    const outcome = await ensureCtoAuditLabel({ execFile });
    expect(outcome).toBe("created");
    expect(execFile).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["label", "create", CTO_AUDIT_PR_LABEL]),
    );
  });

  it("ignores substring-only matches (e.g. minsky:cto-audit-future)", async () => {
    const execFile = vi.fn(
      fakeExec([
        { match: isLabelList, out: "minsky:cto-audit-future\nminsky:other" },
        { match: isLabelCreate, out: "ok" },
      ]),
    );
    const outcome = await ensureCtoAuditLabel({ execFile });
    expect(outcome).toBe("created");
  });

  it("returns 'skipped-degraded' when gh label list rejects (offline / gh missing)", async () => {
    const execFile: ExecFileLike = vi.fn(async () => {
      throw new Error("gh: command not found");
    });
    const outcome = await ensureCtoAuditLabel({ execFile });
    expect(outcome).toBe("skipped-degraded");
  });

  it("treats a race-condition 'already exists' create error as 'exists'", async () => {
    const execFile = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "gh" && args[0] === "label" && args[1] === "list") return "";
      if (file === "gh" && args[0] === "label" && args[1] === "create") {
        throw new Error('a label with the name "minsky:cto-audit" already exists');
      }
      return "";
    });
    const outcome = await ensureCtoAuditLabel({ execFile });
    expect(outcome).toBe("exists");
  });

  it("returns 'skipped-degraded' when gh label create rejects with an unrelated error", async () => {
    const execFile: ExecFileLike = vi.fn(async (file, args) => {
      if (file === "gh" && args[0] === "label" && args[1] === "list") return "";
      throw new Error("HTTP 403: rate-limited");
    });
    const outcome = await ensureCtoAuditLabel({ execFile });
    expect(outcome).toBe("skipped-degraded");
  });
});

describe("parsePlistEnv", () => {
  it("returns an empty object when the plist has no EnvironmentVariables dict", () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>x</string></dict></plist>`;
    expect(parsePlistEnv(xml)).toEqual({});
  });

  it("extracts every <key>/<string> pair within the EnvironmentVariables dict", () => {
    const xml = `<plist><dict>
      <key>EnvironmentVariables</key>
      <dict>
        <key>${CTO_AUDIT_ENABLE_ENV_VAR}</key><string>1</string>
        <key>MINSKY_HOME</key><string>/path/to/repo</string>
      </dict>
    </dict></plist>`;
    const env = parsePlistEnv(xml);
    expect(env[CTO_AUDIT_ENABLE_ENV_VAR]).toBe("1");
    expect(env["MINSKY_HOME"]).toBe("/path/to/repo");
  });

  it("ignores keys outside the EnvironmentVariables dict (e.g. Label)", () => {
    const xml = `<plist><dict>
      <key>Label</key><string>com.minsky.tick-loop</string>
      <key>EnvironmentVariables</key><dict>
        <key>${CTO_AUDIT_ENABLE_ENV_VAR}</key><string>1</string>
      </dict>
    </dict></plist>`;
    const env = parsePlistEnv(xml);
    expect(Object.keys(env)).toEqual([CTO_AUDIT_ENABLE_ENV_VAR]);
  });

  it("matches the production plist's CTO-audit env var", () => {
    // Pin against the real source plist so a future edit that drops the
    // env-var line breaks the test rather than silently bypassing the drift
    // detector. The test runs from the package dir; resolve up to repo root.
    const repoRoot = resolve(__dirname, "..", "..", "..");
    const plistPath = resolve(repoRoot, "distribution/launchd/com.minsky.tick-loop.plist");
    const xml = readFileSync(plistPath, "utf-8");
    const env = parsePlistEnv(xml);
    expect(env[CTO_AUDIT_ENABLE_ENV_VAR]).toBe("1");
  });
});

describe("detectCtoAuditEnvDrift", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "cto-audit-drift-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePlist(env: Record<string, string>): string {
    const pairs = Object.entries(env)
      .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
      .join("\n");
    const xml = `<plist><dict>
      <key>Label</key><string>com.minsky.tick-loop</string>
      <key>EnvironmentVariables</key><dict>
        ${pairs}
      </dict>
    </dict></plist>`;
    const p = resolve(dir, "tick-loop.plist");
    writeFileSync(p, xml, "utf-8");
    return p;
  }

  it("returns 'in-sync-enabled' when source plist and live env both enable the var", () => {
    const sourcePlistPath = writePlist({ [CTO_AUDIT_ENABLE_ENV_VAR]: "1" });
    const outcome = detectCtoAuditEnvDrift({
      sourcePlistPath,
      liveEnv: { [CTO_AUDIT_ENABLE_ENV_VAR]: "1" },
    });
    expect(outcome).toBe("in-sync-enabled");
  });

  it("returns 'in-sync-disabled' when neither side enables the var", () => {
    const sourcePlistPath = writePlist({});
    const outcome = detectCtoAuditEnvDrift({ sourcePlistPath, liveEnv: {} });
    expect(outcome).toBe("in-sync-disabled");
  });

  it("returns 'drift-stale-install' when source enables but live env is unset (the load-bearing case)", () => {
    const sourcePlistPath = writePlist({ [CTO_AUDIT_ENABLE_ENV_VAR]: "1" });
    const outcome = detectCtoAuditEnvDrift({ sourcePlistPath, liveEnv: {} });
    expect(outcome).toBe("drift-stale-install");
  });

  it("returns 'drift-stale-install' when live env has the var set to a non-truthy value", () => {
    const sourcePlistPath = writePlist({ [CTO_AUDIT_ENABLE_ENV_VAR]: "1" });
    const outcome = detectCtoAuditEnvDrift({
      sourcePlistPath,
      liveEnv: { [CTO_AUDIT_ENABLE_ENV_VAR]: "0" },
    });
    expect(outcome).toBe("drift-stale-install");
  });

  it("returns 'drift-local-override' when live env enables the var but source plist doesn't", () => {
    const sourcePlistPath = writePlist({});
    const outcome = detectCtoAuditEnvDrift({
      sourcePlistPath,
      liveEnv: { [CTO_AUDIT_ENABLE_ENV_VAR]: "true" },
    });
    expect(outcome).toBe("drift-local-override");
  });

  it("returns 'plist-unreadable' when the source plist is missing (graceful-degrade per rule #7)", () => {
    const outcome = detectCtoAuditEnvDrift({
      sourcePlistPath: resolve(dir, "does-not-exist.plist"),
      liveEnv: { [CTO_AUDIT_ENABLE_ENV_VAR]: "1" },
    });
    expect(outcome).toBe("plist-unreadable");
  });

  it("treats 'true' (case-insensitive) as enabled in both source and live env", () => {
    const sourcePlistPath = writePlist({ [CTO_AUDIT_ENABLE_ENV_VAR]: "TRUE" });
    const outcome = detectCtoAuditEnvDrift({
      sourcePlistPath,
      liveEnv: { [CTO_AUDIT_ENABLE_ENV_VAR]: " True " },
    });
    expect(outcome).toBe("in-sync-enabled");
  });
});
