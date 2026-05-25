#!/usr/bin/env python3
"""tests/test_baseline_metrics.py — paired tests for scripts/baseline_metrics.py.

Pinned scope:
- walk_repo: returns (loc_by_language, test_count, total_files); skips
  node_modules / dist / .git; counts test files via the documented patterns.
- collect_docs: detects README / AGENTS / CLAUDE / VISION / TASKS / *.md count.
- capture: returns the full snapshot shape with all top-level keys present.
- run_safe: graceful degrade — never raises on FileNotFoundError / TimeoutExpired.
- main: exits 1 on missing --repo, exits 2 on bad flag, exits 0 on print.

No subprocess calls in the test suite for lint / build / dependencies —
those probes are best-effort and depend on the host's tooling. The
`run_safe` test pins the never-raises contract, which is enough.

Anchor: same as scripts/baseline_metrics.py — DORA four-keys baseline.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

# Add the scripts/ directory to sys.path so we can import the module.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import baseline_metrics as bm  # noqa: E402


def write(p: Path, content: str = "") -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


def test_walk_repo_counts_loc_and_tests(tmp_path: Path) -> None:
    write(tmp_path / "src" / "a.ts", "line1\nline2\n")
    write(tmp_path / "src" / "a.test.ts", "test1\ntest2\ntest3\n")
    write(tmp_path / "scripts" / "foo.py", "py1\n")
    write(tmp_path / "lib" / "x.js", "js1\njs2\n")
    loc, tests, files = bm.walk_repo(tmp_path)
    assert loc == {"typescript": 5, "python": 1, "javascript": 2}
    assert tests == 1
    assert files == 4


def test_walk_repo_skips_node_modules_and_dist(tmp_path: Path) -> None:
    write(tmp_path / "node_modules" / "lib.ts", "skipped\nskipped\n")
    write(tmp_path / "dist" / "bundle.js", "skipped\n")
    write(tmp_path / "src" / "real.ts", "real\n")
    loc, tests, files = bm.walk_repo(tmp_path)
    assert loc == {"typescript": 1}
    assert tests == 0
    assert files == 1


def test_walk_repo_skips_dot_directories(tmp_path: Path) -> None:
    # .git is the canonical case; .venv / __pycache__ / .pytest_cache too.
    write(tmp_path / ".git" / "config", "skipped\n")
    write(tmp_path / ".venv" / "lib.py", "skipped\n")
    write(tmp_path / "__pycache__" / "a.py", "skipped\n")
    write(tmp_path / "main.py", "real\n")
    loc, tests, files = bm.walk_repo(tmp_path)
    assert loc == {"python": 1}
    assert files == 1


def test_walk_repo_recognizes_bats_as_tests(tmp_path: Path) -> None:
    write(tmp_path / "tests" / "minsky-run.bats", "@test foo {}\n")
    _, tests, _ = bm.walk_repo(tmp_path)
    assert tests == 1


def test_walk_repo_unreadable_file_does_not_crash(tmp_path: Path) -> None:
    write(tmp_path / "ok.ts", "1\n")
    # Create a path that os.walk lists but open() will fail on
    # (a directory in the file-walk path). The function should
    # default to 0 lines for that entry, not crash.
    weird = tmp_path / "weird.ts"
    weird.mkdir()  # a DIRECTORY named foo.ts — listed by os.walk's filenames? no.
    # The above is not actually a filename in os.walk filenames. So
    # we use a more realistic case: chmod 0 on the file.
    blocked = tmp_path / "blocked.ts"
    blocked.write_text("1\n")
    os.chmod(blocked, 0o000)
    try:
        loc, _, _ = bm.walk_repo(tmp_path)
        # ok.ts contributes 1; blocked.ts contributes 0.
        assert loc.get("typescript", 0) == 1
    finally:
        os.chmod(blocked, 0o644)


def test_collect_docs_detects_canonical_files(tmp_path: Path) -> None:
    write(tmp_path / "README.md", "# proj")
    write(tmp_path / "AGENTS.md", "# agents")
    write(tmp_path / "docs" / "guide.md", "# guide")
    docs = bm.collect_docs(tmp_path)
    assert docs["has_readme"] is True
    assert docs["has_agents_md"] is True
    assert docs["has_claude_md"] is False
    assert docs["has_vision_md"] is False
    assert docs["has_tasks_md"] is False
    assert docs["markdown_file_count"] == 3


def test_collect_docs_case_insensitive(tmp_path: Path) -> None:
    write(tmp_path / "readme.md", "# proj")
    write(tmp_path / "Claude.md", "# claude")
    write(tmp_path / "tasks.MD", "# tasks")
    docs = bm.collect_docs(tmp_path)
    assert docs["has_readme"] is True
    assert docs["has_claude_md"] is True
    # The `tasks.md` / `agents.md` / `claude.md` / `readme.md` /
    # `vision.md` detection is case-INsensitive (filename compared
    # via .lower()), so `tasks.MD` is also detected.
    assert docs["has_tasks_md"] is True


def test_run_safe_returns_dict_on_missing_binary(tmp_path: Path) -> None:
    result = bm.run_safe(["this-binary-does-not-exist-xyz"], tmp_path)
    assert result["exit_code"] is None
    assert "binary not found" in result.get("error", "")


def test_run_safe_returns_exit_code_on_normal_run(tmp_path: Path) -> None:
    # `true` exits 0, `false` exits 1 — both standard POSIX.
    ok = bm.run_safe(["true"], tmp_path)
    assert ok["exit_code"] == 0
    bad = bm.run_safe(["false"], tmp_path)
    assert bad["exit_code"] == 1


def test_run_safe_respects_timeout(tmp_path: Path) -> None:
    # `sleep 5` with timeout=1 should timeout.
    result = bm.run_safe(["sleep", "5"], tmp_path, timeout=1)
    assert result["exit_code"] is None
    assert "timed out" in result.get("error", "")


def test_has_script_returns_true_for_existing_script(tmp_path: Path) -> None:
    pkg = tmp_path / "package.json"
    pkg.write_text(json.dumps({"name": "x", "scripts": {"lint": "eslint ."}}))
    assert bm.has_script(pkg, "lint") is True
    assert bm.has_script(pkg, "build") is False


def test_has_script_handles_missing_package_json(tmp_path: Path) -> None:
    pkg = tmp_path / "package.json"
    assert bm.has_script(pkg, "lint") is False


def test_has_script_handles_malformed_json(tmp_path: Path) -> None:
    pkg = tmp_path / "package.json"
    pkg.write_text("{not valid json")
    assert bm.has_script(pkg, "lint") is False


def test_try_tokei_returns_none_when_binary_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Force PATH to a dir with no tokei → graceful None return.
    monkeypatch.setenv("PATH", str(tmp_path))
    assert bm._try_tokei(tmp_path) is None


def test_try_scc_returns_none_when_binary_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))
    assert bm._try_scc(tmp_path) is None


def test_try_cloc_returns_none_when_binary_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))
    assert bm._try_cloc(tmp_path) is None


def test_loc_by_language_falls_back_to_walk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # With no external counters installed, the fallback returns the
    # walk_repo LOC + source="walk".
    monkeypatch.setenv("PATH", str(tmp_path))
    write(tmp_path / "src" / "a.ts", "line1\nline2\n")
    write(tmp_path / "main.py", "py1\npy2\npy3\n")
    loc, source = bm.loc_by_language(tmp_path)
    assert source == "walk"
    assert loc == {"typescript": 2, "python": 3}


def test_loc_by_language_uses_tokei_when_available(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Stub a fake `tokei` binary on PATH that emits the documented JSON.
    fake_bin = tmp_path / "fakebin"
    fake_bin.mkdir()
    tokei_stub = fake_bin / "tokei"
    tokei_stub.write_text(
        '#!/bin/bash\ncat <<\'JSON\'\n'
        '{"TypeScript": {"code": 1234, "comments": 5, "blanks": 10, "lines": 1249},'
        ' "Python": {"code": 567, "comments": 2, "blanks": 3, "lines": 572}}\n'
        "JSON\n"
    )
    os.chmod(tokei_stub, 0o755)
    monkeypatch.setenv("PATH", f"{fake_bin}:{os.environ.get('PATH', '')}")
    loc, source = bm.loc_by_language(tmp_path)
    assert source == "tokei"
    assert loc == {"typescript": 1234, "python": 567}


def test_loc_by_language_uses_scc_when_tokei_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_bin = tmp_path / "fakebin"
    fake_bin.mkdir()
    scc_stub = fake_bin / "scc"
    scc_stub.write_text(
        '#!/bin/bash\ncat <<\'JSON\'\n'
        '[{"Name": "TypeScript", "Code": 100}, {"Name": "Python", "Code": 50}]\n'
        "JSON\n"
    )
    os.chmod(scc_stub, 0o755)
    monkeypatch.setenv("PATH", f"{fake_bin}:{os.environ.get('PATH', '')}")
    loc, source = bm.loc_by_language(tmp_path)
    assert source == "scc"
    assert loc == {"typescript": 100, "python": 50}


def test_loc_by_language_uses_cloc_when_others_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_bin = tmp_path / "fakebin"
    fake_bin.mkdir()
    cloc_stub = fake_bin / "cloc"
    cloc_stub.write_text(
        '#!/bin/bash\ncat <<\'JSON\'\n'
        '{"header": {"foo": "bar"},'
        ' "TypeScript": {"code": 200, "comment": 5, "blank": 3, "nFiles": 2},'
        ' "SUM": {"code": 200, "nFiles": 2}}\n'
        "JSON\n"
    )
    os.chmod(cloc_stub, 0o755)
    monkeypatch.setenv("PATH", f"{fake_bin}:{os.environ.get('PATH', '')}")
    loc, source = bm.loc_by_language(tmp_path)
    assert source == "cloc"
    assert loc == {"typescript": 200}


def test_loc_by_language_falls_through_on_malformed_tokei(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # If tokei is installed but emits non-JSON, fall through to scc / cloc
    # / walk. Here all 3 are absent except tokei → fall through to walk.
    fake_bin = tmp_path / "fakebin"
    fake_bin.mkdir()
    broken = fake_bin / "tokei"
    broken.write_text("#!/bin/bash\necho 'NOT JSON AT ALL'\n")
    os.chmod(broken, 0o755)
    monkeypatch.setenv("PATH", f"{fake_bin}:{tmp_path}")
    write(tmp_path / "x.ts", "1\n")
    loc, source = bm.loc_by_language(tmp_path)
    assert source == "walk"
    assert loc == {"typescript": 1}


def test_capture_includes_loc_source_field(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # With no external counters, source defaults to "walk".
    monkeypatch.setenv("PATH", str(tmp_path))
    write(tmp_path / "a.ts", "1\n")
    snap = bm.capture(tmp_path)
    assert snap["code"]["loc_source"] == "walk"


def test_try_git_ls_files_returns_none_for_non_git_dir(tmp_path: Path) -> None:
    # tmp_path has no .git → graceful None return.
    assert bm._try_git_ls_files(tmp_path) is None


def test_try_git_ls_files_returns_counts_for_git_repo(tmp_path: Path) -> None:
    # Initialize a real git repo with tracked + untracked files.
    write(tmp_path / "src" / "a.ts", "x\n")
    write(tmp_path / "src" / "a.test.ts", "y\n")
    write(tmp_path / "ignored.log", "noise\n")
    write(tmp_path / ".gitignore", "*.log\n")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    # The host's global commit-msg hook enforces conventional commits;
    # `--no-verify` bypasses it for the fixture commit only (no
    # behavior tested by the hook is relevant to this unit test).
    subprocess.run(
        ["git", "commit", "-q", "--no-verify", "-m", "fixture"],
        cwd=tmp_path,
        check=True,
    )
    result = bm._try_git_ls_files(tmp_path)
    assert result is not None
    files, tests = result
    # 3 tracked files: src/a.ts + src/a.test.ts + .gitignore
    # (ignored.log is NOT tracked → not in ls-files output)
    assert files == 3
    assert tests == 1


def test_try_git_ls_files_empty_repo_returns_zero_zero(tmp_path: Path) -> None:
    # Git-initialized but no tracked files yet → (0, 0).
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    result = bm._try_git_ls_files(tmp_path)
    assert result == (0, 0)


def test_capture_uses_git_ls_files_when_available(tmp_path: Path) -> None:
    # End-to-end: capture()'s code block reports files_source=git-ls-files
    # when the repo is git-managed, and the count matches the tracked-only
    # set (not the os.walk all-files set).
    write(tmp_path / "src" / "a.ts", "x\n")
    write(tmp_path / "ignored.log", "noise\n")
    write(tmp_path / ".gitignore", "*.log\n")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "commit", "-q", "--no-verify", "-m", "fixture"],
        cwd=tmp_path,
        check=True,
    )

    snap = bm.capture(tmp_path)
    assert snap["code"]["files_source"] == "git-ls-files"
    # 2 tracked files: src/a.ts + .gitignore (ignored.log is untracked).
    assert snap["code"]["total_files_walked"] == 2


def test_capture_falls_back_to_walk_when_not_a_git_repo(tmp_path: Path) -> None:
    # No .git → files_source falls back to walk.
    write(tmp_path / "a.ts", "1\n")
    write(tmp_path / "b.ts", "2\n")
    snap = bm.capture(tmp_path)
    assert snap["code"]["files_source"] == "walk"
    assert snap["code"]["total_files_walked"] == 2


def test_capture_returns_full_schema(tmp_path: Path) -> None:
    write(tmp_path / "README.md", "# t")
    write(tmp_path / "src" / "a.ts", "x\n")
    snapshot = bm.capture(tmp_path)
    # Required top-level keys.
    for key in ("ts", "repo", "code", "docs", "lint", "build", "dependencies", "schema_version"):
        assert key in snapshot
    assert snapshot["schema_version"] == 1
    assert snapshot["code"]["test_file_count"] == 0
    assert snapshot["docs"]["has_readme"] is True


def test_main_writes_baseline_to_default_path(tmp_path: Path) -> None:
    write(tmp_path / "src" / "a.ts", "x\n")
    rc = bm.main(["--repo", str(tmp_path)])
    assert rc == 0
    out = tmp_path / ".minsky" / "baseline.json"
    assert out.exists()
    data = json.loads(out.read_text())
    assert data["schema_version"] == 1


def test_main_writes_to_custom_output(tmp_path: Path) -> None:
    output = tmp_path / "custom.json"
    rc = bm.main(["--repo", str(tmp_path), "--output", str(output)])
    assert rc == 0
    assert output.exists()


def test_main_print_mode_does_not_write_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    write(tmp_path / "README.md", "x")
    rc = bm.main(["--repo", str(tmp_path), "--print"])
    assert rc == 0
    captured = capsys.readouterr()
    # JSON on stdout.
    data = json.loads(captured.out)
    assert data["schema_version"] == 1
    # No .minsky/ directory created in print mode.
    assert not (tmp_path / ".minsky").exists()


def test_main_exits_1_on_missing_repo() -> None:
    rc = bm.main(["--repo", "/this/path/does/not/exist/anywhere"])
    assert rc == 1


def test_main_exits_2_on_unknown_flag() -> None:
    rc = bm.main(["--unknown-flag"])
    assert rc == 2


def test_main_help_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    rc = bm.main(["--help"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "baseline_metrics" in captured.out
