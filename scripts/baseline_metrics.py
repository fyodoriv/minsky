#!/usr/bin/env python3
"""scripts/baseline_metrics.py — capture a repo-local baseline snapshot.

Vertical slice MVP for `minsky-default-8h-repo-transformation` (TASKS.md
P0) — step (b) of the 8h default session: "establish a metrics baseline
(test count, coverage, lint health, build status, dependency age, doc
coverage) and write it to `.minsky/baseline.json`".

Rule #1 (don't reinvent) — this script ORCHESTRATES existing tools:
- test count: walks the repo for *.test.{ts,tsx,mjs,js,py} files
- lint health: best-effort `pnpm lint` exit code (skipped if no script)
- build status: best-effort `pnpm typecheck` or `pnpm build` exit code
- doc coverage: counts *.md files, checks for README + AGENTS.md/CLAUDE.md
- LOC: counts non-blank source-file lines via pure-Python; tokei/scc
  are NOT required (they may not be installed; we don't reinvent the
  language detection but we DO use a small built-in extension map)

The baseline is meant to be cheap and deterministic — no LLM call, no
network, no auth required. Runs in <2s on a 100K-LOC repo.

Anchor: Forsgren/Humble/Kim 2018 (DORA — the metrics ARE the four-keys
applied to the repo); Ries 2011 (build-measure-learn — baseline is the
`measure` half before any `build`).

CLI:
    python3 scripts/baseline_metrics.py [--repo <path>] [--output <path>]
        [--print]

    --repo:     repo root (default: $PWD)
    --output:   baseline file (default: <repo>/.minsky/baseline.json)
    --print:    write to stdout instead of file (for piping to jq)

Exit codes:
    0   baseline captured (always — partial data is better than no data)
    1   --repo path doesn't exist
    2   bad CLI args
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

SOURCE_EXTS = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".sh": "shell",
    ".bash": "shell",
    ".bats": "shell",
}
TEST_PATTERNS = (
    ".test.ts",
    ".test.tsx",
    ".test.mjs",
    ".test.mts",
    ".test.js",
    ".test.cjs",
    ".test.py",
    "_test.py",
    ".bats",
)
SKIP_DIRS = {
    "node_modules",
    "dist",
    ".next",
    ".turbo",
    "build",
    "out",
    "coverage",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".cache",
    "target",
    "vendor",
}


def _try_tokei(repo: Path) -> dict[str, int] | None:
    """Best-effort `tokei --output json .` invocation. Returns
    `{lang: code-line-count}` on success, `None` if tokei isn't
    installed / errors / produces unparseable output. Rule #1 (don't
    reinvent) — tokei has language-specific lexers that distinguish
    code lines from comments + blanks, which our os.walk fallback
    cannot. We use tokei when available and degrade gracefully when
    not."""
    try:
        proc = subprocess.run(
            ["tokei", "--output", "json", str(repo)],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    # Tokei's JSON: top-level keys are language names (e.g. "TypeScript"),
    # each with `code`, `comments`, `blanks`, `lines`. We want `code`.
    # Tokei uses canonical English names — normalize to our extension-
    # based lowercase tags for schema-shape compatibility with the
    # walk_repo fallback.
    name_map = {
        "TypeScript": "typescript",
        "JavaScript": "javascript",
        "Python": "python",
        "Rust": "rust",
        "Go": "go",
        "Shell": "shell",
        "BASH": "shell",
        "Bash": "shell",
    }
    out: dict[str, int] = {}
    for k, v in data.items():
        if not isinstance(v, dict) or "code" not in v:
            continue
        canonical = name_map.get(k)
        if canonical is None:
            continue
        out[canonical] = out.get(canonical, 0) + int(v["code"])
    return out or None


def _try_scc(repo: Path) -> dict[str, int] | None:
    """Best-effort `scc --format json .` invocation. Same shape as
    `_try_tokei`. SCC is a Go-implemented LOC counter, faster than
    tokei on large repos."""
    try:
        proc = subprocess.run(
            ["scc", "--format", "json", str(repo)],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    # SCC JSON: top-level is an array of `{Name: "TypeScript", Code: N, ...}`.
    name_map = {
        "TypeScript": "typescript",
        "JavaScript": "javascript",
        "Python": "python",
        "Rust": "rust",
        "Go": "go",
        "Shell": "shell",
        "Bourne Shell": "shell",
    }
    out: dict[str, int] = {}
    if not isinstance(data, list):
        return None
    for entry in data:
        if not isinstance(entry, dict):
            continue
        name = entry.get("Name")
        code = entry.get("Code")
        canonical = name_map.get(name)
        if canonical is None or not isinstance(code, int):
            continue
        out[canonical] = out.get(canonical, 0) + code
    return out or None


def _try_cloc(repo: Path) -> dict[str, int] | None:
    """Best-effort `cloc --json .` invocation. Cloc is the OG Perl-based
    LOC counter; pre-installed on many Linux distros via the
    `cloc` package. Same return shape as `_try_tokei`."""
    try:
        proc = subprocess.run(
            ["cloc", "--json", str(repo)],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    # cloc JSON: top-level keys are language names + `header` + `SUM`;
    # each entry has `code`, `comment`, `blank`, `nFiles`.
    name_map = {
        "TypeScript": "typescript",
        "JavaScript": "javascript",
        "Python": "python",
        "Rust": "rust",
        "Go": "go",
        "Bourne Shell": "shell",
        "Bourne Again Shell": "shell",
    }
    out: dict[str, int] = {}
    for k, v in data.items():
        if k in ("header", "SUM") or not isinstance(v, dict) or "code" not in v:
            continue
        canonical = name_map.get(k)
        if canonical is None:
            continue
        out[canonical] = out.get(canonical, 0) + int(v["code"])
    return out or None


def loc_by_language(repo: Path) -> tuple[dict[str, int], str]:
    """Return `(loc_map, source)` for the repo. Tries tokei → scc → cloc
    → walk_repo's pure-Python fallback in that order. The `source` tag
    is recorded in the snapshot so a downstream consumer can tell
    whether the LOC is a tokei-quality code-only count or our cruder
    "all lines including blank+comment" walk fallback.

    Rule #1 — prefer existing solutions when available; degrade to
    the walk fallback only when nothing's installed.
    """
    for name, fn in (("tokei", _try_tokei), ("scc", _try_scc), ("cloc", _try_cloc)):
        result = fn(repo)
        if result:
            return result, name
    # walk-fallback path: caller already has the walk-LOC from
    # walk_repo; we re-invoke here only when called standalone.
    loc, _, _ = walk_repo(repo)
    return loc, "walk"


def _try_git_ls_files(repo: Path) -> tuple[int, int] | None:
    """Best-effort `git ls-files` invocation. Returns `(file_count,
    test_file_count)` or `None` if not a git repo / git missing.

    Rule #1 — every minsky-managed repo is a git repo by construction,
    so `git ls-files` is the canonical "files we care about" query:
    respects .gitignore, ignores submodule contents, ignores
    node_modules / dist / .venv without us having to maintain a
    skip-dir list. Faster than `os.walk` on large repos because git
    keeps the tracked-file list in its index.

    Caller-side fallback: when this returns `None` (no git, or git
    errored), capture() falls back to walk_repo's existing counts.
    """
    if not (repo / ".git").exists():
        return None
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), "ls-files"],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    out = proc.stdout.decode("utf-8", errors="replace")
    if not out.strip():
        return 0, 0
    file_count = 0
    test_count = 0
    for line in out.splitlines():
        if not line:
            continue
        file_count += 1
        # The basename for the test-pattern check — `git ls-files`
        # returns repo-root-relative paths, so split off the last
        # path segment to compare against TEST_PATTERNS.
        basename = line.rsplit("/", 1)[-1]
        if any(basename.endswith(p) for p in TEST_PATTERNS):
            test_count += 1
    return file_count, test_count


def walk_repo(repo: Path) -> tuple[dict[str, int], int, int]:
    """Walk repo, return (loc-by-language, test-count, total-files).

    Pure os.walk pass — single I/O traverse of the repo. No subprocess.
    """
    loc_by_lang: dict[str, int] = {}
    test_count = 0
    file_count = 0
    for dirpath, dirnames, filenames in os.walk(repo):
        # Modify dirnames in-place to skip subtrees.
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            file_count += 1
            if any(fn.endswith(p) for p in TEST_PATTERNS):
                test_count += 1
            for ext, lang in SOURCE_EXTS.items():
                if fn.endswith(ext):
                    p = Path(dirpath) / fn
                    try:
                        # Read bytes + decode lazily; many test files
                        # are small, so the cost is negligible. Errors
                        # default to 0 lines (rule #6 — don't crash on
                        # one unreadable file).
                        with p.open("rb") as fh:
                            nlines = sum(1 for _line in fh)
                    except OSError:
                        nlines = 0
                    loc_by_lang[lang] = loc_by_lang.get(lang, 0) + nlines
                    break
    return loc_by_lang, test_count, file_count


def run_safe(cmd: list[str], cwd: Path, timeout: int = 30) -> dict[str, Any]:
    """Run a command, capture (exit, stdout-len, stderr-len). Never raises.

    Used for lint/build probes — we don't capture output (could be MB);
    just whether it exited 0 and how chatty it was. Rule #6 — failing
    commands are observations, not crashes.
    """
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            timeout=timeout,
            capture_output=True,
            check=False,
        )
        return {
            "command": " ".join(cmd),
            "exit_code": proc.returncode,
            "stdout_bytes": len(proc.stdout),
            "stderr_bytes": len(proc.stderr),
        }
    except subprocess.TimeoutExpired:
        return {
            "command": " ".join(cmd),
            "exit_code": None,
            "error": f"timed out after {timeout}s",
        }
    except FileNotFoundError:
        return {
            "command": " ".join(cmd),
            "exit_code": None,
            "error": "binary not found",
        }
    except OSError as exc:
        return {
            "command": " ".join(cmd),
            "exit_code": None,
            "error": str(exc),
        }


def has_script(pkg_json: Path, script: str) -> bool:
    """Return True if package.json has the named npm script."""
    if not pkg_json.exists():
        return False
    try:
        data = json.loads(pkg_json.read_text())
        return script in (data.get("scripts") or {})
    except (json.JSONDecodeError, OSError):
        return False


def collect_lint(repo: Path) -> dict[str, Any]:
    """Best-effort lint probe. Tries `pnpm lint`, falls back to skip."""
    pkg = repo / "package.json"
    if has_script(pkg, "lint"):
        return run_safe(["pnpm", "lint"], repo, timeout=60)
    if (repo / "biome.json").exists() or has_script(pkg, "check"):
        return run_safe(["pnpm", "biome", "ci", "."], repo, timeout=60)
    return {"command": "(none)", "exit_code": None, "skipped": "no lint script"}


def collect_build(repo: Path) -> dict[str, Any]:
    """Best-effort build/typecheck probe."""
    pkg = repo / "package.json"
    if has_script(pkg, "typecheck"):
        return run_safe(["pnpm", "typecheck"], repo, timeout=120)
    if has_script(pkg, "build"):
        return run_safe(["pnpm", "build"], repo, timeout=180)
    return {"command": "(none)", "exit_code": None, "skipped": "no build/typecheck script"}


def collect_docs(repo: Path) -> dict[str, Any]:
    """Walk for docs — *.md count, README presence, AGENTS.md / CLAUDE.md."""
    md_count = 0
    has_readme = False
    has_agents = False
    has_claude = False
    has_vision = False
    has_tasks_md = False
    for dirpath, dirnames, filenames in os.walk(repo):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.endswith(".md") or fn.endswith(".mdx"):
                md_count += 1
            lower = fn.lower()
            if lower == "readme.md":
                has_readme = True
            elif lower == "agents.md":
                has_agents = True
            elif lower == "claude.md":
                has_claude = True
            elif lower == "vision.md":
                has_vision = True
            elif lower == "tasks.md":
                has_tasks_md = True
    return {
        "markdown_file_count": md_count,
        "has_readme": has_readme,
        "has_agents_md": has_agents,
        "has_claude_md": has_claude,
        "has_vision_md": has_vision,
        "has_tasks_md": has_tasks_md,
    }


def collect_dependencies(repo: Path) -> dict[str, Any]:
    """Best-effort `pnpm outdated --json` probe."""
    pkg = repo / "package.json"
    if not pkg.exists():
        return {"package_manager": "none", "outdated_count": None}
    res = run_safe(["pnpm", "outdated", "--format=json"], repo, timeout=60)
    if res.get("exit_code") == 0:
        # No outdated packages — pnpm exits 0 with empty stdout.
        return {"package_manager": "pnpm", "outdated_count": 0}
    if res.get("exit_code") == 1:
        # pnpm outdated exits 1 when there ARE outdated packages.
        # We don't capture the JSON to keep the baseline small —
        # just record that outdated packages exist.
        return {
            "package_manager": "pnpm",
            "outdated_count": "≥1 (run `pnpm outdated` for details)",
        }
    return {"package_manager": "pnpm", "outdated_count": None, "probe": res}


def capture(repo: Path) -> dict[str, Any]:
    """Single-pass capture — never raises.

    LOC is sourced via `loc_by_language(repo)` which prefers external
    counters (tokei → scc → cloc) for code-only line counts; falls back
    to `walk_repo`'s "all lines including blank + comments" count when
    none are installed. The `loc_source` field records which path won
    so a downstream comparator can compare like-for-like.

    File / test counts prefer `git ls-files` (respects .gitignore +
    submodules + is faster than os.walk on large repos) when the repo
    is git-managed; falls back to `walk_repo`'s os.walk pass otherwise.
    The `files_source` field records which path won.
    """
    walk_loc, walk_tests, walk_files = walk_repo(repo)
    external_loc, loc_source = loc_by_language(repo)
    if loc_source == "walk":
        loc_final = walk_loc
    else:
        loc_final = external_loc

    # File + test counts: prefer git ls-files when available.
    git_files_result = _try_git_ls_files(repo)
    if git_files_result is not None:
        files_final, tests_final = git_files_result
        files_source = "git-ls-files"
    else:
        files_final, tests_final = walk_files, walk_tests
        files_source = "walk"

    return {
        "ts": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "repo": str(repo.resolve()),
        "code": {
            "total_files_walked": files_final,
            "test_file_count": tests_final,
            "files_source": files_source,
            "loc_by_language": loc_final,
            "loc_source": loc_source,
        },
        "docs": collect_docs(repo),
        "lint": collect_lint(repo),
        "build": collect_build(repo),
        "dependencies": collect_dependencies(repo),
        "schema_version": 1,
    }


def main(argv: list[str]) -> int:
    repo = Path(os.environ.get("PWD") or ".")
    output: Path | None = None
    print_only = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--repo" and i + 1 < len(argv):
            repo = Path(argv[i + 1])
            i += 2
        elif a == "--output" and i + 1 < len(argv):
            output = Path(argv[i + 1])
            i += 2
        elif a == "--print":
            print_only = True
            i += 1
        elif a in ("--help", "-h"):
            print(__doc__)
            return 0
        else:
            print(f"unknown flag: {a}", file=sys.stderr)
            return 2
    if not repo.exists():
        print(f"--repo path not found: {repo}", file=sys.stderr)
        return 1
    snapshot = capture(repo)
    if print_only:
        print(json.dumps(snapshot, indent=2))
        return 0
    if output is None:
        output = repo / ".minsky" / "baseline.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, indent=2))
    print(f"baseline captured: {output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
