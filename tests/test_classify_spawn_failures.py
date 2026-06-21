"""Tests for scripts/classify-spawn-failures.py."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "classify-spawn-failures.py"


def _load_classify_module():
    spec = importlib.util.spec_from_file_location("classify_spawn_failures", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestClassifyText:
    def setup_method(self):
        mod = _load_classify_module()
        self._classify = mod.classify_text

    def test_module_not_found(self):
        assert self._classify("ModuleNotFoundError: No module named 'openhands'") == "ModuleNotFoundError"

    def test_command_not_found(self):
        assert self._classify("bash: claude: command not found") == "command not found"

    def test_killed(self):
        assert self._classify("Killed") == "Killed"

    def test_signal_15(self):
        assert self._classify("received signal 15") == "signal 15"

    def test_enoent(self):
        assert self._classify("ENOENT: no such file or directory") == "ENOENT"

    def test_not_logged_in(self):
        assert self._classify("Not logged in · Please run /login") == "Not logged in"

    def test_unknown(self):
        assert self._classify("some random error with no pattern") == "unknown"

    def test_empty_string(self):
        assert self._classify("") == "unknown"

    def test_first_match_wins(self):
        # ModuleNotFoundError appears first in PATTERNS, so it wins over "command not found"
        text = "command not found\nModuleNotFoundError: openhands"
        result = self._classify(text)
        assert result == "ModuleNotFoundError"


class TestClassifyFailures:
    def setup_method(self):
        mod = _load_classify_module()
        self._classify_failures = mod.classify_failures

    def test_empty_dir_returns_zero(self, tmp_path: Path):
        result = self._classify_failures(tmp_path, 3600)
        assert result["total_failures"] == 0
        assert result["top_class"] is None
        assert result["classes"] == {}

    def test_missing_dir_returns_zero(self, tmp_path: Path):
        result = self._classify_failures(tmp_path / "nonexistent", 3600)
        assert result["total_failures"] == 0
        assert result["top_class"] is None

    def test_single_failure_classifies_correctly(self, tmp_path: Path):
        entry = tmp_path / "my-task-20260101T120000Z"
        entry.mkdir()
        (entry / "stderr.txt").write_text("ModuleNotFoundError: No module named 'openhands'")
        result = self._classify_failures(tmp_path, 3600)
        assert result["total_failures"] == 1
        assert result["top_class"] == "ModuleNotFoundError"
        assert result["classes"]["ModuleNotFoundError"] == 1

    def test_multiple_failures_top_class_is_dominant(self, tmp_path: Path):
        for i in range(3):
            d = tmp_path / f"task-enoent-{i}"
            d.mkdir()
            (d / "stderr.txt").write_text("ENOENT: no such file")
        for i in range(1):
            d = tmp_path / f"task-module-{i}"
            d.mkdir()
            (d / "stderr.txt").write_text("ModuleNotFoundError: openhands")
        result = self._classify_failures(tmp_path, 3600)
        assert result["total_failures"] == 4
        assert result["top_class"] == "ENOENT"
        assert result["classes"]["ENOENT"] == 3
        assert result["classes"]["ModuleNotFoundError"] == 1

    def test_old_failures_excluded_by_window(self, tmp_path: Path):
        entry = tmp_path / "old-task-20200101T000000Z"
        entry.mkdir()
        stderr = entry / "stderr.txt"
        stderr.write_text("ModuleNotFoundError: old")
        # Backdate mtime by 4 hours (outside 1h window)
        old_time = time.time() - 4 * 3600
        import os
        os.utime(stderr, (old_time, old_time))
        result = self._classify_failures(tmp_path, 3600)
        assert result["total_failures"] == 0

    def test_empty_stderr_counts_as_unknown(self, tmp_path: Path):
        entry = tmp_path / "silent-task-20260101T120000Z"
        entry.mkdir()
        (entry / "stderr.txt").write_text("")
        result = self._classify_failures(tmp_path, 3600)
        assert result["total_failures"] == 1
        assert result["top_class"] == "unknown"

    def test_window_hours_matches_input(self, tmp_path: Path):
        result = self._classify_failures(tmp_path, 48 * 3600)
        assert result["window_hours"] == 48

    def test_dirs_without_stderr_txt_are_skipped(self, tmp_path: Path):
        entry = tmp_path / "incomplete-task"
        entry.mkdir()
        (entry / "stdout.txt").write_text("some output")
        result = self._classify_failures(tmp_path, 3600)
        assert result["total_failures"] == 0


class TestCLI:
    def test_json_flag_emits_json(self, tmp_path: Path):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--failures-dir", str(tmp_path), "--window=1h", "--json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert "total_failures" in data
        assert "top_class" in data
        assert data["window_hours"] == 1

    def test_invalid_window_exits_1(self, tmp_path: Path):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--failures-dir", str(tmp_path), "--window=bad"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1

    def test_top_class_none_when_no_failures(self, tmp_path: Path):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--failures-dir", str(tmp_path), "--json"],
            capture_output=True,
            text=True,
        )
        data = json.loads(result.stdout)
        assert data["top_class"] is None


class TestCLIFileMode:
    """Tests for --file single-file classification (inline heal-dispatch path)."""

    def test_file_known_class_json(self, tmp_path: Path):
        f = tmp_path / "spawn.log"
        f.write_text("Not logged in · Please run /login")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--file", str(f), "--json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["class"] == "Not logged in"
        assert data["confidence"] == "high"

    def test_file_unknown_class_low_confidence(self, tmp_path: Path):
        f = tmp_path / "spawn.log"
        f.write_text("some unexpected error with no recognized pattern")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--file", str(f), "--json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["class"] == "unknown"
        assert data["confidence"] == "low"

    def test_file_killed_class(self, tmp_path: Path):
        f = tmp_path / "spawn.log"
        f.write_text("Killed\nProcess terminated by signal")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--file", str(f), "--json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["class"] == "Killed"
        assert data["confidence"] == "high"

    def test_file_module_not_found(self, tmp_path: Path):
        f = tmp_path / "spawn.log"
        f.write_text("ModuleNotFoundError: No module named 'openhands'")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--file", str(f), "--json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["class"] == "ModuleNotFoundError"

    def test_file_missing_returns_nonzero(self, tmp_path: Path):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--file", str(tmp_path / "nonexistent.log"), "--json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        data = json.loads(result.stdout)
        assert data["class"] == "unknown"
        assert "error" in data

    def test_file_non_json_output(self, tmp_path: Path):
        f = tmp_path / "spawn.log"
        f.write_text("Not logged in")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--file", str(f)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "Not logged in" in result.stdout
        assert "high" in result.stdout
