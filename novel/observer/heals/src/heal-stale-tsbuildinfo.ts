// Helper: heal-stale-tsbuildinfo
//
// Catalogued failure mode: `.tsbuildinfo` files reference a prior node
// version (e.g. node 18 hash after the host flipped to node 20).
// `tsc -b` reads the stale info and produces incoherent build output.
// Detect → unlink the stale info; tsc will regenerate.
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-stale-tsbuildinfo detects and unlinks build cache from old node version"
//   - "heal-stale-tsbuildinfo recurses into subpaths"
//   - "heal-stale-tsbuildinfo is idempotent"

import type { ApplyResult, DetectResult, VerifyResult } from "./types.js";

/** Injected I/O seams. */
export type StaleTsbuildinfoSeams = {
  /** Root directory to scan recursively. */
  hostDir: string;
  /** Node major version of the running process (e.g. "20"). */
  currentNodeMajor: string;
  /** List `.tsbuildinfo` files under hostDir. Tests inject the result. */
  listTsbuildinfoFn: (rootDir: string) => string[];
  readFileSyncFn: (path: string, encoding: "utf8") => string;
  unlinkSyncFn: (path: string) => void;
  existsSyncFn: (path: string) => boolean;
};

type TsbuildinfoContent = {
  version?: string;
  // tsc's actual .tsbuildinfo has more fields; we only care about version.
};

const isStale = (
  content: TsbuildinfoContent | null,
  currentNodeMajor: string,
): boolean => {
  if (content === null) return true; // unparseable → safe to remove
  if (typeof content.version !== "string") return true;
  // tsc records its own version in .tsbuildinfo, not node's. But the
  // common case in this repo's catalogue: after a node version flip, the
  // tsc version embedded in the file references a different node hash.
  // Heuristic: any string mentioning a node major different from current
  // is stale.
  const nodeMajors = ["16", "17", "18", "19", "20", "21", "22"].filter(
    (v) => v !== currentNodeMajor,
  );
  return nodeMajors.some((v) => content.version!.includes(`node-${v}`));
};

const parseContent = (
  raw: string,
): TsbuildinfoContent | null => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as TsbuildinfoContent;
    }
    return null;
  } catch {
    return null;
  }
};

export function detect(seams: StaleTsbuildinfoSeams): DetectResult {
  const paths = seams.listTsbuildinfoFn(seams.hostDir);
  const stalePaths = paths.filter((path) => {
    const raw = seams.readFileSyncFn(path, "utf8");
    const content = parseContent(raw);
    return isStale(content, seams.currentNodeMajor);
  });
  if (stalePaths.length === 0) {
    return { present: false };
  }
  return {
    present: true,
    signal: "stale-tsbuildinfo",
    evidence: { stalePaths, currentNodeMajor: seams.currentNodeMajor },
  };
}

export function apply(seams: StaleTsbuildinfoSeams): ApplyResult {
  const paths = seams.listTsbuildinfoFn(seams.hostDir);
  const changedFiles: string[] = [];
  for (const path of paths) {
    if (!seams.existsSyncFn(path)) continue; // raced with another helper
    const raw = seams.readFileSyncFn(path, "utf8");
    const content = parseContent(raw);
    if (isStale(content, seams.currentNodeMajor)) {
      seams.unlinkSyncFn(path);
      changedFiles.push(path);
    }
  }
  if (changedFiles.length === 0) {
    return { applied: false, changedFiles: [], notes: "no stale files found" };
  }
  return {
    applied: true,
    changedFiles,
    notes: `removed ${changedFiles.length} stale .tsbuildinfo file(s)`,
  };
}

export function verify(seams: StaleTsbuildinfoSeams): VerifyResult {
  const remaining = detect(seams);
  if (remaining.present) {
    return {
      healed: false,
      residualSignal: "stale-tsbuildinfo-still-present",
    };
  }
  return { healed: true };
}
