# Cross-repo portability — rule classification + sidecar architecture

This document records the classification of every constitutional rule lint for cross-repo portability, the architecture decision that resolves the naive 30.8 % portability gap, and the operative parameters of the resolution. It is the artefact `cross-repo-portability-doc` ships per the rule-#9 preparation-PR pattern: the metric (the classification) lands before any artefact that depends on it (the host-root-resolver refactor, the sidecar bootstrap, the runner).

## Why this file exists

Minsky's vision is to govern any host repo, not just `fyodoriv/minsky` itself. The classification below is the substrate decision behind that vision: it tells every future cross-repo task which rules its host inherits, which must be ported, and which the host's own substrate already covers. Without this artefact, every task would re-litigate scope; with it, scope is a lookup.

## Pre-flight (researcher subagent run, 2026-05-04)

A read-only researcher subagent walked all 13 `scripts/check-*.mjs` lints, read each script's leading comment block + `main()`/CLI usage, and classified each as `repo-local` / `cross-repo-portable` / `host-substrate-deferred`. The raw run is archived at [`cross-repo-portability/2026-05-04-classification-run.md`](./cross-repo-portability/2026-05-04-classification-run.md).

The naive number from that run was **4 / 13 = 30.8 %** cross-repo-portable — i.e., if a host repo is treated as a black box with no minsky artefacts inside it, only the per-task substrates (`EXPERIMENT.yaml`, PR-body self-grade) port. That number is below the `cross-repo-runner-v0` task's pre-registered pivot threshold of 40 % (Munafò et al. 2017).

## Sidecar architecture (the resolution)

The naive number frames the problem as "the host doesn't have `vision.md`, `novel/`, `ARCHITECTURE.md`". The sidecar architecture rejects that framing: minsky drops the substrate the rules need into a per-host gitignored `.minsky/` directory at the host repo's root, listed in the operator's global `~/.config/git/ignore` so it never enters the host's git history. The same lints walk the same shapes at a different filesystem root (set via `MINSKY_HOST_ROOT`).

The `Sidecar` column below records each rule's class under that architecture. Eight of the nine "repo-local" rules become `sidecar-portable` because their substrate is path-shaped and the path is parameter-isable. The sole exception that stays repo-local is `check-rule-1-novel-justification`, whose substrate is the `novel/` directory itself — a host repo's source code is the host's domain, not minsky's, so we deliberately do not port it. (This is the right boundary, not a portability defect: minsky only governs *what minsky does*, which is the meta layer; the host's source-tree-justification belongs to the host.)

## Per-rule classification

| Script | Naive class | Sidecar class | Substrate (what it walks) | Rationale |
|---|---|---|---|---|
| `check-anchor-primary-source.mjs` | cross-repo-portable | cross-repo-portable | `EXPERIMENT.yaml` `anchor` field, parsed via `@minsky/experiment-record` | Pure function over a string field of a YAML record that travels with the task. The substrate is per-task; deny/allow lists (blog domains, DOIs, ISBNs, "rule #N" cross-refs) are repo-agnostic. |
| `check-measurement-inspects-output.mjs` | cross-repo-portable | cross-repo-portable | `EXPERIMENT.yaml` `measurement` field | Pure check over a single string field; allowlist (`test`, `jq -e`, `vitest`, `grep -q`) is shell-token-level. The `pnpm`/`@tasks-md/lint`/`node scripts/check-*.mjs` allowlist entries assume minsky tooling but a small overlay can swap them for `yarn`/host equivalents per `repo.yaml`. |
| `check-pivot-success-margin.mjs` | cross-repo-portable | cross-repo-portable | `EXPERIMENT.yaml` `success` and `pivot` fields | Pure decision function over two strings (`extractLeadingNumber`); the substrate is the same per-task `EXPERIMENT.yaml` that travels with the runner. |
| `check-pr-self-grade.mjs` | cross-repo-portable | cross-repo-portable | PR body text via stdin or file path | Pure shape check on PR-body markdown (`Hypothesis self-grade` block). PR bodies travel with the task by definition — any host repo has them. |
| `check-pattern-index.mjs` | repo-local | sidecar-portable | `vision.md` § "Pattern conformance index" + new files under `novel/`, `distribution/`, `.github/workflows/`, root-md | The "Pattern conformance index" is a minsky-coined construct (rule #8). Sidecar-mode: minsky symlinks `.minsky/vision.md` into the host; the host's own pattern index lives in the sidecar (per-host overrides) and the lint walks both via `MINSKY_HOST_ROOT`. |
| `check-rule-1-novel-justification.mjs` | repo-local | repo-local | New top-level dirs under `novel/` + `research.md` "When the existing tools didn't fit" heading | Hard-coded `novel/` prefix; `research.md` heading match is minsky-specific. **Stays repo-local by design**: the host's source code is the host's domain, not minsky's — minsky governs the meta-layer (the runner, the constitution, the gate), not the host's package taxonomy. Forcing every host to grow `research.md` is ceremony, not portability. |
| `check-rule-2-dep-coverage.mjs` | repo-local | sidecar-portable | `ARCHITECTURE.md` "The dependency table" + `novel/**/*.ts` import scan | Vendor list extracted from a specific minsky table layout; import scan rooted in `novel/`. Sidecar: `.minsky/ARCHITECTURE.md` is a per-host file written at bootstrap from inferred `package.json` dependencies; the import scan reads `${MINSKY_HOST_ROOT}/<host_packages_path>` (declared in `repo.yaml`). Hosts that already have an approved-dep policy (syncpack, `.preferred-deps.yaml`) declare it in `repo.yaml.lint_substrate_overrides` and the rule defers. |
| `check-rule-3-doc-first.mjs` | repo-local | sidecar-portable | `novel/**/*.ts` non-test diff vs `user-stories/*.md` or per-package `README.md` | Hard-coded `novel/` and `user-stories/` paths. Sidecar: `repo.yaml` declares the host's source-paths and docs-paths; the rule reads them. Already has `RULE_3_DIFF_BASE` env override — diff-base normalisation slots in. |
| `check-rule-4-otel-coverage.mjs` | repo-local | sidecar-portable | `novel/**/*.ts` (non-test) AST scan for `@otel` JSDoc | OTEL annotation contract is a minsky-coined discipline. Sidecar: hosts that don't emit OTEL declare `lint_substrate_overrides.rule-4: skip` in `repo.yaml`; hosts that do emit OTEL inherit the contract via the `MINSKY_HOST_ROOT` override. The default for a fresh host is `skip` until the operator opts in. |
| `check-rule-5-glossary-discipline.mjs` | repo-local | sidecar-portable | `vision.md` Glossary section + Pattern-index table | Walks `vision.md`, a minsky-coined behavioral spec. Sidecar: `.minsky/vision.md` is the symlink to minsky's canonical vision; host-specific glossary additions live in `.minsky/glossary-host.md` and the lint reads both. |
| `check-rule-6-let-it-crash.mjs` | repo-local | host-substrate-deferred | `novel/**/*.ts` AST scan for nested-try and swallowing-catch | The check itself is generic TS-AST shape detection. Hosts like `example-capabilities-3` already have ESLint covering `try`/`catch` smells (`no-useless-catch`, custom rules). Sidecar architecture **declares the host's lint as substrate** via `repo.yaml.lint_substrate_overrides.rule-6: <host-lint-command>`; minsky doesn't re-enforce. |
| `check-rule-7-chaos-coverage.mjs` | repo-local | sidecar-portable | `novel/**/README.md` "Failure modes & chaos verification" section + table | The README convention (h2 heading + table with "Chaos test" column) is a minsky construct. Sidecar: hosts can either grow chaos sections in their own READMEs (declared in `repo.yaml.chaos_section_paths`), or defer to per-task `EXPERIMENT.yaml.chaos_table` (a new optional field) which travels with each task and the rule walks both substrates. |
| `check-skill-rule-cap.mjs` | repo-local | sidecar-portable | `novel/spec-monitor/SKILL.md` `### A<N>.` headings | Walks a single minsky-owned file. Sidecar: hosts that adopt `spec-monitor` symlink it into `.minsky/spec-monitor/`; hosts that don't, the rule no-ops with `lint_substrate_overrides.skill-rule-cap: skip`. |

## Aggregate

- **Naive (host = black box):** 4/13 = 30.8 % cross-repo-portable. **Below** the 40 % pivot threshold.
- **Sidecar (host has `.minsky/`):** 12/13 = 92.3 % portable (4 cross-repo-portable + 8 sidecar-portable). **Above** the 40 % threshold by 52 percentage points.
- **Host-substrate-deferred:** 1/13 (rule-6 — host's ESLint covers it).
- **Repo-local by design (won't port):** 1/13 (rule-1 — host's source taxonomy is host's domain; minsky governs the meta-layer, not the host's `novel/` equivalent).

## Decision

The sidecar architecture is the operative resolution. Three sub-decisions, recorded for audit:

- **A2** — sidecar location: `.minsky/` directory at the host repo root, listed in global `~/.config/git/ignore` so it never enters the host's git history. (Per-clone `.git/info/exclude` is the v1 fallback if the global ignore proves brittle on a host — see `minsky-sidecar-bootstrap` task's pivot.)
- **B1** — constitution: canonical `vision.md` inherited (symlinked from `~/apps/minsky/vision.md` into `.minsky/vision.md`); per-host `repo.yaml` overlay carries the host-specific bits (`host_repo`, `tasks_md_path`, `commit_format`, `pre_commit_command`, `branch_prefix`, `default_branch`, `lint_substrate_overrides`, `chaos_section_paths`, `host_packages_path`, `ticket_format`).
- **C2** — CI substrate: minsky-side GitHub Action listens for `repository_dispatch` events emitted by the runner on PR open, runs the 12 portable lints with `MINSKY_HOST_ROOT=<temp-clone-of-host>`, posts a check-run via the GitHub API. Host CI is untouched. (Local pre-push hook installed by `minsky bootstrap` is the v0 fallback — see `cross-repo-runner-v0` and `cross-repo-ci-action` tasks.)

## Consequences (downstream tasks pre-registered)

The classification implies a specific roadmap, recorded as P0 task blocks in [`TASKS.md`](../TASKS.md):

1. `cross-repo-portability-doc` — this file (the artefact).
2. `host-root-resolver-prep` — refactors every lint to take `MINSKY_HOST_ROOT`. Rule-9 preparation PR; behaviour-preserving for minsky-on-itself.
3. `minsky-sidecar-bootstrap` — `.minsky/` schema + `minsky bootstrap <host-dir>` command.
4. `cross-repo-runner-v0` — `minsky run <task-id> --host <host-dir>`.
5. `cross-repo-runner-proj-840-integration-test` — first real host integration.
6. `cross-repo-ci-action` — minsky-side GH Action posts verdicts via the GitHub API.

## Drift detection

The classification will rot as minsky's lint surface evolves. Two mechanisms keep it honest:

- **Mechanical:** a P3 follow-up task `ci-lint-cross-repo-portability-doc-coverage` ships a script that asserts every `scripts/check-*.mjs` has a row in this table; the lint runs in CI and fails the merge if a new check adds without a row. Filed as a P3 row in `TASKS.md` ratched-after this doc lands per rule #10.
- **Epistemic:** the quarterly review (`review-q3-2026` and successors) re-runs the classifier subagent on a different day; if >2/13 classifications disagree, the framework triggers `cross-repo-portability-doc`'s pivot (retreat to the 4 cross-repo-portable rules + sidecar architecture deferred to v2).

## Anchors

- Munafò et al., "A manifesto for reproducible science", *Nature Human Behaviour* 1, 0021, 2017 — pre-registration: the classification is recorded *before* the runner is built so the runner's design can't post-hoc rationalise the threshold.
- Beyer, Jones, Petoff, Murphy, *Site Reliability Engineering*, O'Reilly, 2016, Ch. 6 — every rule is a check; every check has a substrate; documenting the substrate is the first move.
- Hewitt, "A Universal Modular ACTOR Formalism", *IJCAI* 1973 — the substrate boundary is the actor's interface; making it parametric (via `MINSKY_HOST_ROOT`) is the move that lets the same actor live in many systems.
- Helland, "Life beyond Distributed Transactions", *CIDR* 2007 — the substrate-locality boundary defines the consistency boundary; making it explicit is the precondition for cross-system semantics.
- Rule #10 (vision.md § 10) — deterministic CI enforcement; the classification table is itself enforced by a tiny linter that fails when a new `check-*.mjs` ships without a row (P3 follow-up).
