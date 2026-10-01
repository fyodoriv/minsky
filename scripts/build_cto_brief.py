#!/usr/bin/env python3
"""build_cto_brief: build the CTO-audit brief sent to the agent when
the bash daemon's TASKS.md queue drains.

Why this exists
---------------

The bash runner's autonomous loop reads tasks from each host's
``TASKS.md`` and ships PRs against them. When the queue drains, the
daemon has no work and just respawns idle. The TS substrate's
``runHostCtoAudit`` closes this gap: when drained, it spawns a SECOND
agent session with a "CTO-mode" brief telling the agent to look at
the host's recent commits + iteration history and propose new
high-leverage tasks. The proposed tasks land in the host's TASKS.md
via a PR. On the next daemon respawn, the bash runner picks up those
tasks and ships them. That's the **self-improving** half of the
operator's "24/7 self-improving factory" brief.

This module is the **Python parity port** of the brief-builder half
of ``novel/cross-repo-runner/src/host-cto-audit.ts``:

- ``HOST_CTO_PROMPT_HEADER`` constant — verbatim ported (rule #1 —
  don't reinvent the prompt the TS substrate has tuned in production)
- ``HostCtoSignals`` dataclass — same shape as the TS interface
- ``build_host_cto_brief()`` — pure function rendering the brief
- ``HostCtoTriggerReason`` literal — same two values as TS
  (``post-iteration``, ``queue-empty``)

The orchestrator half (``runHostCtoAudit`` — spawning the LLM and
collecting the outcome) lives in the bash runner; this module is just
the brief renderer so the orchestration logic can call it via a thin
shell-out.

Conformance
-----------

- **Rule #1** — port, don't reinvent. The prompt header is verbatim
  identical to the TS source. Any future tuning happens on BOTH
  surfaces (the brief-builder paired tests catch drift).
- **Rule #2** — pure function. ``build_host_cto_brief()`` takes a
  ``HostCtoSignals`` (typed dataclass) and returns the brief text.
  No I/O. The CLI is the only I/O layer.
- **Rule #6** — graceful-degrade in the bash caller (the brief
  builder fails loud; the caller skips the audit on failure).

CLI mode
--------

::

    python3 scripts/build_cto_brief.py \\
        --host-repo <owner/repo> \\
        --host-root <abs-path> \\
        --tasks-md-path TASKS.md \\
        --reason queue-empty \\
        --utc-date 2026-05-25 \\
        [--completed-task-id <id>] \\
        [--pr-url <url>] \\
        [--files-changed <path>] \\
        [--files-changed <path> ...]

Prints the brief to stdout. Always exits 0.

Cross-references
----------------

- ``novel/cross-repo-runner/src/host-cto-audit.ts`` — TS source of truth
- ``novel/cross-repo-runner/src/host-cto-audit.test.ts`` — TS test cases (mirrored here)
- ``bin/minsky-run.sh``                                — bash caller (next PR)
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from typing import Literal, Optional


# PR label the audit applies to its opened PRs. Operator dashboards
# query `gh pr list --label minsky:cto-audit` to count audit-PRs
# against the rolling 60d ship-rate metric. The constant lives here
# so it stays in sync with the prompt header below.
HOST_CTO_AUDIT_PR_LABEL = "minsky:cto-audit"


# CTO-mode prompt header. Verbatim port of HOST_CTO_PROMPT_HEADER
# from novel/cross-repo-runner/src/host-cto-audit.ts. Any change must
# land in BOTH places (test_build_cto_brief asserts byte-equivalence).
HOST_CTO_PROMPT_HEADER = "\n".join(
    [
        "You are reviewing what just shipped in a HOST REPO from a CTO perspective.",
        "",
        "Goal: find the single highest-leverage next task FOR THE HOST.",
        "",
        "Bias toward:",
        "  (1) automation that removes operator babysitting on the host;",
        "  (2) instrumentation gaps in the host that mask drift;",
        "  (3) duplicated patterns in the host that should become a primitive;",
        "  (4) failure classes in the host likely to recur.",
        "",
        "Output: 1-3 task blocks with full rule-#9 substrate, written directly into",
        "the host's TASKS.md at:",
        "  - P0 if the leverage is mechanical (CI lint, automation);",
        "  - P1 if it's a feature;",
        "  - P2 if it's docs/polish.",
        "",
        "Rule-#9 substrate MUST include for each task:",
        "  - **ID**: kebab-case-task-id",
        "  - **Hypothesis**: what changes if this ships, framed as a falsifiable claim",
        "  - **Success**: numeric or rubric threshold for when the experiment succeeds",
        "  - **Pivot**: numeric threshold below which the approach is abandoned",
        "  - **Measurement**: exact runnable shell command that produces the success/pivot value",
        "  - **Anchor**: literature citation (book / paper / RFC), NOT a blog post or wiki",
        "",
        "Refuse to file vanity-metric tasks (Ries 2011 — counts that always go up:",
        "LOC, commits, hours, tasks-in-flight). The metric must be falsifiable.",
        "",
        "If no high-leverage task is visible for this host, say so explicitly — DO NOT",
        "fabricate work. An empty audit (no PR opened, stdout `no high-leverage task`)",
        "is a valid outcome the operator can act on.",
        "",
        "## Branch + PR conventions (load-bearing for the audit's pre-registered metric)",
        "",
        "Open the PR on a branch named `audit/<UTC-date>-cross-repo-seed` (or",
        "`audit/<UTC-date>-<completed-task-id>` after a post-iteration audit).",
        "",
        f"Label the PR `{HOST_CTO_AUDIT_PR_LABEL}`. The pre-registered measurement",
        f"command (`gh pr list --label {HOST_CTO_AUDIT_PR_LABEL} ...`) queries this",
        "exact label; missing label silently zeroes the success metric.",
        "",
        "If the label does not yet exist on the host repository, create it first:",
        "",
        "```",
        f"gh label list --search {HOST_CTO_AUDIT_PR_LABEL} --json name --jq '.[].name' \\",
        f"  | grep -qx {HOST_CTO_AUDIT_PR_LABEL} \\",
        f"  || gh label create {HOST_CTO_AUDIT_PR_LABEL} \\",
        "       --description 'Filed by minsky cross-repo CTO audit' --color 0e8a16",
        "```",
        "",
        "Then add the label at PR-create time (`gh pr create --label",
        f"{HOST_CTO_AUDIT_PR_LABEL} ...`) so the metric sees it from open, not",
        "retroactively.",
        "",
    ]
)


HostCtoTriggerReason = Literal["post-iteration", "queue-empty"]


@dataclass(frozen=True)
class HostCtoSignals:
    """Signals the brief renders.

    Parity contract: mirrors ``HostCtoSignals`` in ``host-cto-audit.ts``.
    The ``completed_task_id`` and ``pr_url`` are ``None`` in the
    ``queue-empty`` case; the ``files_changed`` is an empty tuple when
    no iteration just completed.

    Frozen so the test suite can assert immutability (matches the TS
    ``readonly`` modifier).
    """

    host_repo: str
    host_root: str
    tasks_md_path: str
    reason: HostCtoTriggerReason
    utc_date: str
    completed_task_id: Optional[str] = None
    pr_url: Optional[str] = None
    files_changed: tuple[str, ...] = field(default_factory=tuple)


def build_host_cto_brief(signals: HostCtoSignals) -> str:
    """Render the CTO-audit brief from host signals.

    Pure function — same signature contract as TS
    ``buildHostCtoBrief``. The TS file's test suite asserts the brief
    contains specific phrases; the paired tests in this module mirror
    those assertions to keep both substrates byte-equivalent.

    Args:
        signals: Trigger context + host metadata.

    Returns:
        The brief text the agent reads.
    """
    if len(signals.files_changed) == 0:
        files_section = "Files changed: (none — first audit OR queue-empty seed run)"
    else:
        lines = [f"  - {f}" for f in signals.files_changed]
        files_section = (
            f"Files changed ({len(signals.files_changed)}):\n" + "\n".join(lines)
        )

    if signals.reason == "post-iteration":
        reason_header = f"## Just-completed iteration on {signals.host_repo}"
    else:
        reason_header = f"## Queue-empty seed audit for {signals.host_repo}"

    if signals.completed_task_id is None:
        completed_line = (
            "Completed task: (none — this is a seed audit; the queue had "
            "no rule-#9-compliant P0/P1 tasks)"
        )
    else:
        completed_line = f"Completed task: `{signals.completed_task_id}`"

    pr_display = signals.pr_url if signals.pr_url is not None else "(no PR opened)"

    if signals.reason == "post-iteration":
        completed_seg = signals.completed_task_id or "post-iteration"
        audit_branch = f"audit/{signals.utc_date}-{completed_seg}"
    else:
        audit_branch = f"audit/{signals.utc_date}-cross-repo-seed"

    if signals.reason == "post-iteration":
        task_instruction = (
            "Identify the single highest-leverage next task for this host that "
            "compounds on what just shipped. File it as a TASKS.md block on "
            "the host with the right priority and full rule-#9 substrate."
        )
    else:
        task_instruction = (
            "The host's queue has no eligible work. Seed it with 1-3 rule-#9-"
            "compliant task blocks that the cross-repo daemon can ship next. "
            "Focus on the user-story-006 framing — what would the host "
            "operator most want a continuous agent loop to work on?"
        )

    return "\n".join(
        [
            HOST_CTO_PROMPT_HEADER,
            reason_header,
            "",
            f"Host repo: {signals.host_repo}",
            f"Host root: {signals.host_root}",
            f"Host TASKS.md: {signals.tasks_md_path}",
            completed_line,
            f"PR: {pr_display}",
            "",
            files_section,
            "",
            f"Audit branch: `{audit_branch}`",
            f"Audit PR label: `{HOST_CTO_AUDIT_PR_LABEL}`",
            "",
            "## Your task now",
            "",
            task_instruction,
            "",
            "If you cannot identify a high-leverage task, output `no high-leverage task` to stdout and exit without opening a PR. An empty audit is a valid outcome.",
        ]
    )


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="build_cto_brief.py",
        description=(
            "Render the CTO-audit brief (parity port of "
            "novel/cross-repo-runner/src/host-cto-audit.ts § "
            "buildHostCtoBrief)."
        ),
    )
    parser.add_argument("--host-repo", required=True)
    parser.add_argument("--host-root", required=True)
    parser.add_argument(
        "--tasks-md-path", default="TASKS.md",
        help="Path to TASKS.md relative to host-root (default: TASKS.md).",
    )
    parser.add_argument(
        "--reason", required=True, choices=["post-iteration", "queue-empty"]
    )
    parser.add_argument(
        "--utc-date", required=True,
        help="UTC date prefix for the audit branch name (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--completed-task-id", default=None,
        help="Task id that just shipped (post-iteration only).",
    )
    parser.add_argument(
        "--pr-url", default=None,
        help="PR URL from the just-shipped iteration (post-iteration only).",
    )
    parser.add_argument(
        "--files-changed", action="append", default=None,
        help="Path of a file the just-shipped iteration changed. Repeatable.",
    )
    args = parser.parse_args(argv)

    signals = HostCtoSignals(
        host_repo=args.host_repo,
        host_root=args.host_root,
        tasks_md_path=args.tasks_md_path,
        reason=args.reason,
        utc_date=args.utc_date,
        completed_task_id=args.completed_task_id,
        pr_url=args.pr_url,
        files_changed=tuple(args.files_changed) if args.files_changed else (),
    )
    print(build_host_cto_brief(signals))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
