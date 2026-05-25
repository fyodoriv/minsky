#!/usr/bin/env python3
"""extract_pr_url: extract the PR URL from openhands stdout.

Why this exists
---------------

After ``openhands solve`` finishes, the bash runner records an
``IterationRecord`` JSONL row with the PR URL the agent created. The
previous extraction was a bash one-liner:

::

    pr_url="$(grep -oE 'https://github\\.com/[^[:space:]]+/pull/[0-9]+' \\
              "$stdout_log" | head -1 || true)"

Two bugs:

1. ``github\\.com`` is hard-coded — on Example machines, the agent's
   PR URLs look like ``https://github.example.com/team/repo/pull/42``
   which doesn't match. **Every successful Example-host iteration
   silently recorded ``pr_url=null``.**
2. ``head -1`` picks the **first** match — but the TS substrate
   (``novel/cross-repo-runner/src/runner.ts § extractPrUrl``) picks the
   **last** match. When the agent's stdout cites a related PR before
   creating its own (e.g. "see #310 for prior art ... Opened
   https://github.com/.../pull/315"), the bash runner would record the
   citation, not the new PR.

Parity port of ``extractPrUrl`` from
``novel/cross-repo-runner/src/runner.ts``. Same regex, same last-match
semantic.

Conformance
-----------

- **Rule #1** — port, don't reinvent. Same regex as TS.
- **Rule #7** — graceful-degrade. No match ⇒ empty stdout (bash
  callers naturally handle this).
- **Rule #2** — pure function; CLI is the only I/O layer.

CLI mode
--------

::

    python3 scripts/extract_pr_url.py --stdout-file <path>
    python3 scripts/extract_pr_url.py --stdout <inline-text>

Prints the matched URL on stdout (or nothing when no match). Always
exits 0 (matches the graceful-degrade contract — the bash caller
checks for non-empty output).

Cross-references
----------------

- ``novel/cross-repo-runner/src/runner.ts`` § ``extractPrUrl`` — source
- ``novel/cross-repo-runner/src/runner.test.ts`` § ``describe("extractPrUrl", …)`` — parity oracle
- ``bin/minsky-run.sh``                                — bash caller
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Optional


# Same pattern as TS `extractPrUrl` in runner.ts:
#   /https:\/\/(?:[\w.-]+)\/[^\s/]+\/[^\s/]+\/pull\/\d+/g
# Python's re.findall returns all matches; we take the last one.
_PR_URL_PATTERN = re.compile(r"https://(?:[\w.-]+)/[^\s/]+/[^\s/]+/pull/\d+")


def extract_pr_url(stdout: str) -> Optional[str]:
    """Pure regex helper. Returns the **last** PR URL in ``stdout``, or
    ``None`` when no URL is present.

    Args:
        stdout: The captured stdout from an ``openhands solve``
            invocation (or any text payload).

    Returns:
        The last matched PR URL string, or ``None``.

    Notes:
        Matches any github-like host (``[\\w.-]+``), not just
        ``github.com``. This is the parity bug fix vs the bash one-
        liner the runner used to use.
    """
    matches = _PR_URL_PATTERN.findall(stdout)
    if not matches:
        return None
    return matches[-1]


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="extract_pr_url.py",
        description="Extract the last PR URL from openhands stdout "
        "(parity port of novel/cross-repo-runner/src/runner.ts § extractPrUrl).",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--stdout-file",
        type=Path,
        help="Path to a file containing the captured stdout.",
    )
    group.add_argument(
        "--stdout",
        type=str,
        help="Inline stdout text (test hook).",
    )
    args = parser.parse_args(argv)

    if args.stdout_file is not None:
        try:
            text = args.stdout_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            # Graceful degrade — empty stdout if the file can't be read.
            text = ""
    else:
        text = args.stdout or ""

    url = extract_pr_url(text)
    if url is not None:
        print(url)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
