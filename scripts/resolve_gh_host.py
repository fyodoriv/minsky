#!/usr/bin/env python3
"""resolve_gh_host: pure resolver for the GH_HOST env var the bash runner
should export before invoking ``gh`` against a host repository.

Why this exists
---------------

Without GH_HOST set, ``gh`` inherits whatever host is the active account in
``gh auth status`` — on Intuit machines that defaults to
``github.intuit.com``. Any iteration whose host repo lives on
``github.com`` (e.g. ``fyodoriv/minsky`` itself) then produces a 401 /
"Could not resolve to a Repository" cascade, repeated per-iteration ≥6×.

Per ``vision.md`` rule #17 (proactive healing — the daemon's gh-host probe
IS the fix for the 401 flood) and operator directive 2026-05-19, the
runner must read the host's ``git remote get-url origin``, parse the
hostname, and export GH_HOST to that value for every gh call the
iteration makes.

This module is the **Python parity port** of
``novel/cross-repo-runner/src/gh-host-resolve.ts``. The TS version exists
because the legacy ``cross-repo-runner`` package is invoked from
``novel/cross-repo-runner/bin/minsky-run.mjs``. The bash equivalent
(``bin/minsky-run.sh``) had NO equivalent — every ``gh`` call inside the
host directory would 401 silently on Intuit machines. This closes that
parity gap.

Conformance
-----------

- **Rule #2** — every dependency behind an interface. The function is
  pure; the caller supplies both env_gh_host (string|None) and
  git_remote_url (string|None) probes. The CLI binding is the only side-
  effecting layer.
- **Rule #6** — let dry-run be the safe default; failure surfaces in the
  plan, not the side-effect. Malformed input → ("", "fallback") with no
  raise.
- **Rule #7** — graceful-degrade. Probe failures fall through to gh's
  own default; we never invent a hostname.

Resolution order
----------------

1. Explicit ``GH_HOST`` env var (operator override / escape hatch).
2. Hostname parsed from ``git remote get-url origin``.
3. ``("", "fallback")`` — caller must NOT set GH_HOST; let gh use its
   own default. An empty string for the host signals "do not set".

CLI mode (this is what bin/minsky-run.sh shells out to)
-------------------------------------------------------

::

    python3 scripts/resolve_gh_host.py --host-root <abs-path>

Reads ``GH_HOST`` from this process's env and runs
``git -C <host-root> remote get-url origin``. Prints two lines on stdout:

::

    <host>     # empty string if fallback
    <source>   # "env" | "git-remote" | "fallback"

Exit codes:

- 0 — always (no error paths; graceful-degrade is the contract)

Cross-references
----------------

- ``novel/cross-repo-runner/src/gh-host-resolve.ts``   — TS source of truth
- ``novel/cross-repo-runner/src/gh-host-resolve.test.ts`` — TS test cases
  (this Python module is paired with ``tests/test_resolve_gh_host.py``
  which mirrors every test case for parity).
- ``bin/minsky-run.sh``                                — bash caller
- ``tests/minsky-run.bats``                            — bats integration
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlparse


GhHostSource = Literal["env", "git-remote", "fallback"]


@dataclass(frozen=True)
class ResolveGhHostResult:
    """Output of :func:`resolve_gh_host`.

    ``host`` is the empty string when the caller MUST NOT set GH_HOST
    (matches the TS ``null`` return — empty-string is the natural shell
    sentinel for "absent value"). ``source`` is one of the three labels
    documented in the module docstring.
    """

    host: str
    source: GhHostSource


def resolve_gh_host(
    env_gh_host: Optional[str],
    git_remote_url: Optional[str],
) -> ResolveGhHostResult:
    """Pure resolver. No I/O. Mirrors the TS signature in
    ``novel/cross-repo-runner/src/gh-host-resolve.ts``.

    Args:
        env_gh_host: ``$GH_HOST`` at process startup. ``None`` and ``""``
            are equivalent (matches TS — and matches ``gh``'s own
            behaviour which treats an empty string as unset).
        git_remote_url: Output of ``git -C <hostRoot> remote get-url
            origin``, or ``None`` when the probe failed.

    Returns:
        :class:`ResolveGhHostResult` with the resolved host and the
        source label.
    """
    if env_gh_host is not None and len(env_gh_host) > 0:
        return ResolveGhHostResult(host=env_gh_host, source="env")
    from_remote = _parse_hostname_from_remote(git_remote_url)
    if from_remote is not None:
        return ResolveGhHostResult(host=from_remote, source="git-remote")
    return ResolveGhHostResult(host="", source="fallback")


def _parse_hostname_from_remote(url: Optional[str]) -> Optional[str]:
    """Parse the hostname out of a git remote URL.

    Handles three URL shapes (matches the TS port byte-for-byte):

    - ``https://host[:port]/owner/repo[.git]``
    - ``git://host[:port]/owner/repo[.git]``
    - ``git@host:owner/repo[.git]``  (scp-style SSH)

    Returns ``None`` when the URL is malformed or doesn't contain a host.
    """
    if url is None or len(url) == 0:
        return None
    trimmed = url.strip()
    from_scheme = _parse_scheme_url(trimmed)
    if from_scheme is not None:
        return from_scheme
    return _parse_scp_style_ssh(trimmed)


def _parse_scheme_url(url: str) -> Optional[str]:
    """``https?://`` or ``git://`` scheme. Returns hostname or ``None``.

    Notes:
        urlparse extracts the hostname without the port (parity with
        ``new URL(url).hostname`` in the TS port).
    """
    if not (
        url.startswith("https://")
        or url.startswith("http://")
        or url.startswith("git://")
    ):
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    hostname = parsed.hostname
    if hostname is None or len(hostname) == 0:
        return None
    return hostname


def _parse_scp_style_ssh(url: str) -> Optional[str]:
    """``[user@]host:path`` — the colon separates host from path; no
    scheme. Returns hostname or ``None``.
    """
    if "://" in url:
        return None
    at = url.find("@")
    colon = url.find(":")
    if colon == -1:
        return None
    host_start = 0 if at == -1 else at + 1
    if colon <= host_start:
        return None
    host = url[host_start:colon]
    if len(host) == 0 or "/" in host:
        return None
    return host


def probe_git_remote(host_root: Path) -> Optional[str]:
    """Side-effecting probe: ``git -C <host_root> remote get-url origin``.

    This is the I/O boundary kept thin per rule #2. Returns the trimmed
    remote URL string, or ``None`` when the probe failed for any reason
    (no remote, not a git repo, git not installed, …). Never raises.
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(host_root), "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if result.returncode != 0:
            return None
        url = result.stdout.strip()
        if len(url) == 0:
            return None
        return url
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="resolve_gh_host.py",
        description="Resolve GH_HOST for the bash runner (parity port of "
        "novel/cross-repo-runner/src/gh-host-resolve.ts).",
    )
    parser.add_argument(
        "--host-root",
        required=True,
        type=Path,
        help="Absolute path to the host repository (used for the git remote probe).",
    )
    parser.add_argument(
        "--env-gh-host",
        default=None,
        help="Override the GH_HOST env probe (test hook; defaults to $GH_HOST).",
    )
    parser.add_argument(
        "--git-remote-url",
        default=None,
        help="Override the git-remote probe (test hook; default: shell out to git).",
    )
    args = parser.parse_args(argv)

    # When --env-gh-host is provided on CLI, prefer it over $GH_HOST. This
    # is purely a test hook — the bash caller never passes --env-gh-host.
    env_value: Optional[str]
    if args.env_gh_host is not None:
        env_value = args.env_gh_host
    else:
        import os

        env_value = os.environ.get("GH_HOST")

    # When --git-remote-url is provided on CLI, prefer it over the probe.
    if args.git_remote_url is not None:
        remote = args.git_remote_url
        if len(remote) == 0:
            remote = None
    else:
        remote = probe_git_remote(args.host_root)

    result = resolve_gh_host(env_value, remote)
    # Two-line output: host then source. Empty first line ⇒ caller MUST
    # NOT set GH_HOST (matches the TS null-host contract).
    print(result.host)
    print(result.source)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
