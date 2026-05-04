// Doctor diagnostic — `minsky bootstrap --doctor <host>` self-tests against
// the bootstrap's expected substrate. Returns a structured report the CLI
// renders as GREEN / YELLOW / RED, mirroring `setup.sh`'s lattice.
//
// Pattern: pure verdict over typed inputs (Martin 2017 — referentially
//   transparent given the readable surface; the CLI is the I/O boundary)
//   + status lattice (Avizienis et al., "Basic Concepts and Taxonomy of
//   Dependable and Secure Computing", *IEEE TDSC* 1 (1), 2004 — the
//   green / yellow / red lattice mirrors the existing
//   `@minsky/adapter-types` `aggregateStatus()` pattern).
// Source: rule #6 (vision.md § 6 — let-it-crash; the doctor surfaces
//   broken state loudly so the operator can `--repair`); rule #7 (vision.md
//   § 7 — failure-mode discipline; each row of the report names a failure
//   axis); user-stories/006-runner-on-any-repo.md (failure modes #10
//   broken-symlink and #13 readonly-ignore-file are surfaced here).
// Conformance: full — pure function over typed inputs.

/**
 * One readable surface signal. Each row of `doctor`'s output corresponds
 * to one of these.
 */
export interface DoctorSignals {
  /** True if `<host>/.minsky/repo.yaml` exists. */
  repoYamlExists: boolean;
  /** True if `<host>/.minsky/repo.yaml` parses and validates. */
  repoYamlValid: boolean;
  /** True if `<host>/.minsky/vision.md` is a symlink. */
  visionMdIsSymlink: boolean;
  /** True if the symlink target exists (i.e. resolves). */
  visionMdSymlinkResolves: boolean;
  /** True if `<host>/.minsky/experiments/` exists. */
  experimentsDirExists: boolean;
  /**
   * True if `git check-ignore <host>/.minsky/` indicates the directory
   * is gitignored from the host's git history. False indicates the
   * sidecar may pollute the host's history.
   */
  gitIgnoresMinskyDir: boolean;
}

export type DoctorStatus = "green" | "yellow" | "red";

export interface DoctorReportRow {
  status: DoctorStatus;
  message: string;
}

export interface DoctorReport {
  /** Aggregate status — red dominates yellow dominates green. */
  status: DoctorStatus;
  /** One row per signal, in the order the operator most cares about. */
  rows: DoctorReportRow[];
}

function buildRepoYamlRows(signals: DoctorSignals): DoctorReportRow[] {
  if (!signals.repoYamlExists) {
    return [
      {
        status: "red",
        message: ".minsky/repo.yaml MISSING — run `minsky bootstrap <host>`",
      },
    ];
  }
  return [
    { status: "green", message: ".minsky/repo.yaml exists" },
    signals.repoYamlValid
      ? { status: "green", message: ".minsky/repo.yaml parses and validates" }
      : {
          status: "red",
          message: ".minsky/repo.yaml fails validation — run `minsky bootstrap --repair <host>`",
        },
  ];
}

function buildExperimentsRow(signals: DoctorSignals): DoctorReportRow {
  return signals.experimentsDirExists
    ? { status: "green", message: ".minsky/experiments/ exists" }
    : {
        status: "red",
        message: ".minsky/experiments/ MISSING — run `minsky bootstrap --repair <host>`",
      };
}

function buildVisionMdRow(signals: DoctorSignals): DoctorReportRow {
  if (!signals.visionMdIsSymlink) {
    return {
      status: "red",
      message: ".minsky/vision.md is not a symlink — run `minsky bootstrap --repair <host>`",
    };
  }
  if (!signals.visionMdSymlinkResolves) {
    return {
      status: "red",
      message:
        ".minsky/vision.md symlink is broken (target missing) — run `minsky bootstrap --repair <host>`",
    };
  }
  return { status: "green", message: ".minsky/vision.md symlink resolves" };
}

function buildIgnoreRow(signals: DoctorSignals): DoctorReportRow {
  return signals.gitIgnoresMinskyDir
    ? { status: "green", message: "host git ignores .minsky/ (sidecar invisible to history)" }
    : {
        status: "yellow",
        message:
          "host git does NOT ignore .minsky/ — sidecar MAY enter history; consider `minsky bootstrap --repair <host>` to re-register the ignore",
      };
}

function aggregateStatus(rows: DoctorReportRow[]): DoctorStatus {
  let status: DoctorStatus = "green";
  for (const row of rows) {
    if (row.status === "red") return "red";
    if (row.status === "yellow") status = "yellow";
  }
  return status;
}

/**
 * Pure function: produce the doctor report for a host directory.
 *
 * @otel sidecar-bootstrap.diagnose
 */
export function diagnose(signals: DoctorSignals): DoctorReport {
  const rows: DoctorReportRow[] = [
    ...buildRepoYamlRows(signals),
    buildExperimentsRow(signals),
    buildVisionMdRow(signals),
    buildIgnoreRow(signals),
  ];
  return { status: aggregateStatus(rows), rows };
}
