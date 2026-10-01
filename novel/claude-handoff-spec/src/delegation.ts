// Pattern: manager-agent delegation contract (CrewAI hierarchical process,
//   docs.crewai.com/en/learn/hierarchical-process) shaped as a synchronous,
//   acyclic-by-construction tree, with the OpenHands sub-agent shape (issue
//   OpenHands/OpenHands#14374) reserved as the second-iteration variant.
//   Conformance: full for the synchronous-baseline shape; the async/inline-critic
//   fields (`critic`, `async`) are declared but their runtime is M2 second-iteration.
// Source: research/delegation-patterns-comparison.md (the decision that informs
//   this interface); rule #1 (don't reinvent — two vendors shipped this);
//   rule #6 (let-it-crash + supervisor — the coordinator is a supervisor with a
//   delegation policy; Armstrong 2003); rule #10 (deterministic enforcement —
//   the handoff is a lintable data structure; the LLM routing decision is
//   advisory, not load-bearing).
//
// This file is **types only** — no runtime functions. It is the delegation
// contract that `multi-persona-pipeline-handoff-spec` (M2) implements. Keeping
// it type-only means it has zero blast radius and zero I/O: it cannot fail at
// runtime because it does not run.

/**
 * Which of the two researched delegation shapes a contract instance uses.
 * `"manager-sync"` is the baseline (CrewAI manager-agent shape); `"subagent-async"`
 * is the second-iteration shape (OpenHands sub-agent), gated on the sandbox
 * abstraction tracked at `research-finding-pluggable-sandbox-layer`.
 */
export type DelegationShape = "manager-sync" | "subagent-async";

/**
 * Terminal verdict the coordinator (or the inline critic, in the async shape)
 * assigns to a worker's output. Drives the re-delegation decision.
 */
export type DelegationVerdict = "accepted" | "revise" | "redelegate" | "failed";

/**
 * The serializable hand-off payload the coordinator gives a worker. Deterministic
 * by design (rule #10): a brief is a data structure you can lint, not an implicit
 * "the manager decides what to share". Shaped to be TASKS.md-block-compatible so
 * the documented pivot (deterministic handoff via TASKS.md sub-tasks) is a
 * format-preserving collapse, not a rewrite.
 */
export interface DelegationBrief {
  /** Stable id for the sub-task being delegated (kebab-case, TASKS.md-id-shaped). */
  readonly taskId: string;
  /** One-line statement of the bounded outcome the worker must produce. */
  readonly goal: string;
  /**
   * The explicit context slice handed to the worker. In the manager-sync shape
   * this is the coordinator's curated slice; in the subagent-async shape this is
   * the full brief that seeds the child's fresh, bounded context window.
   */
  readonly context: readonly string[];
  /** The shape of acceptable output the coordinator/critic validates against. */
  readonly expectedOutput: string;
}

/**
 * What a worker returns to the coordinator. In the subagent-async shape this is a
 * *summary* (plus artifact references), never the full trajectory — keeping the
 * parent's context window bounded (the OpenHands discipline). Reproducible
 * ordering in the manager-sync shape makes the aggregate assertable by the gate.
 */
export interface DelegationResult {
  /** Echoes the brief's task id so results aggregate deterministically. */
  readonly taskId: string;
  /** The coordinator/critic's terminal verdict on this result. */
  readonly verdict: DelegationVerdict;
  /** Summarized worker output — NOT the full trajectory (context-budget discipline). */
  readonly summary: string;
  /** Repo-relative paths to artifacts the worker produced (PRs, files, diffs). */
  readonly artifacts: readonly string[];
}

/**
 * The full delegation contract. One coordinator hands `DelegationBrief`s to
 * workers and collects `DelegationResult`s. Acyclic by construction in the
 * baseline (CrewAI tree); the `maxDepth` + `visited` fields carry the acyclic
 * guarantee into the async shape, where a child can spawn further children and
 * cycle prevention becomes the parent's responsibility.
 */
export interface DelegationContract {
  /** Which researched shape this contract instance uses. */
  readonly shape: DelegationShape;
  /**
   * Hard depth bound on the delegation tree. Even the manager-sync shape carries
   * it so the acyclic guarantee is explicit rather than implied by construction.
   */
  readonly maxDepth: number;
  /**
   * The chain of task ids already on the current delegation path. A coordinator
   * refuses to delegate to a `taskId` already in `visited` — the deterministic
   * cycle guard that OpenHands' async shape needs and CrewAI's tree gets free.
   */
  readonly visited: readonly string[];
  /**
   * Whether an inline critic verifies each result on the return edge before it
   * folds into the coordinator's context. Always present in `subagent-async`;
   * optional (off) in `manager-sync`, where the coordinator's own validation
   * suffices.
   */
  readonly critic: boolean;
}
