"""Tests for scripts/synth_experiment_yaml.py — Path A Phase 7 EXPERIMENT.yaml synthesiser.

Pins the Python port to byte-equivalent output with the TS substrate
`novel/cross-repo-runner/src/experiment-synth.ts` (`synthesiseExperimentYaml`
+ `renderExperimentYaml`). Closes a parity gap that left the bash
runner silently NOT writing `.minsky/experiments/<task-id>.yaml` (Acceptance
criterion of user-stories/006-runner-on-any-repo.md).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import pick_task  # noqa: E402  pylint: disable=wrong-import-position
import synth_experiment_yaml  # noqa: E402  pylint: disable=wrong-import-position


def _make_task(
    *,
    task_id: str = "fixture-task",
    hypothesis: str = "hyp",
    success: str = "succ",
    pivot: str = "pvt",
    measurement: str = "node x.mjs",
    anchor: str = "Beck 1999",
) -> pick_task.ParsedTask:
    return pick_task.ParsedTask(
        title="Fixture",
        priority="P0",
        id=task_id,
        hypothesis=hypothesis,
        success=success,
        pivot=pivot,
        measurement=measurement,
        anchor=anchor,
    )


class TestSynthesise:
    """Pure function — same input → same output (rule #10)."""

    def test_all_fields_present_returns_yaml(self) -> None:
        yaml, missing = synth_experiment_yaml.synthesise_experiment_yaml(_make_task())
        assert missing == []
        assert "id: fixture-task" in yaml
        assert "hypothesis: |" in yaml
        assert "success:" in yaml
        assert "pivot:" in yaml
        assert "measurement:" in yaml
        assert "anchor: |" in yaml

    def test_host_repo_optional_omitted_when_none(self) -> None:
        yaml, _ = synth_experiment_yaml.synthesise_experiment_yaml(_make_task())
        assert "host_repo:" not in yaml

    def test_host_repo_included_when_provided(self) -> None:
        yaml, _ = synth_experiment_yaml.synthesise_experiment_yaml(
            _make_task(), host_repo="acme/widgets"
        )
        assert 'host_repo: "acme/widgets"' in yaml

    def test_missing_hypothesis_returns_missing(self) -> None:
        task = _make_task()
        task.hypothesis = None
        yaml, missing = synth_experiment_yaml.synthesise_experiment_yaml(task)
        assert yaml == ""
        assert "Hypothesis" in missing

    def test_missing_multiple_fields(self) -> None:
        task = _make_task()
        task.hypothesis = None
        task.success = None
        task.pivot = None
        yaml, missing = synth_experiment_yaml.synthesise_experiment_yaml(task)
        assert yaml == ""
        assert "Hypothesis" in missing
        assert "Success" in missing
        assert "Pivot" in missing

    def test_missing_id_returns_missing(self) -> None:
        task = _make_task()
        task.id = None
        yaml, missing = synth_experiment_yaml.synthesise_experiment_yaml(task)
        assert yaml == ""
        assert missing == ["ID"]

    def test_multiline_hypothesis_indented(self) -> None:
        task = _make_task(hypothesis="line one\nline two\nline three")
        yaml, _ = synth_experiment_yaml.synthesise_experiment_yaml(task)
        # Each line of multiline hypothesis must be indented by 2 spaces
        # (matches the YAML block-scalar `|` shape the TS renderer emits).
        assert "  line one" in yaml
        assert "  line two" in yaml
        assert "  line three" in yaml

    def test_multiline_anchor_indented(self) -> None:
        task = _make_task(anchor="Beck 1999\nFowler 2018")
        yaml, _ = synth_experiment_yaml.synthesise_experiment_yaml(task)
        assert "  Beck 1999" in yaml
        assert "  Fowler 2018" in yaml

    def test_quotes_in_success_are_escaped(self) -> None:
        # JSON-style quoting (matches TS `JSON.stringify`).
        task = _make_task(success='ratio "ok" when > 0.8')
        yaml, _ = synth_experiment_yaml.synthesise_experiment_yaml(task)
        # JSON escapes inner double-quotes as \"
        assert '\\"ok\\"' in yaml


class TestQuoteParity:
    """Tests the `_quote` helper matches `JSON.stringify` from the TS path."""

    def test_simple_string(self) -> None:
        assert synth_experiment_yaml._quote("hello") == '"hello"'

    def test_string_with_double_quotes(self) -> None:
        assert synth_experiment_yaml._quote('a "b" c') == '"a \\"b\\" c"'

    def test_string_with_backslash(self) -> None:
        assert synth_experiment_yaml._quote("a\\b") == '"a\\\\b"'

    def test_empty_string(self) -> None:
        assert synth_experiment_yaml._quote("") == '""'


class TestParseHostRepoFromYaml:
    """Tests the flat-yaml host_repo extractor."""

    def test_double_quoted(self) -> None:
        assert synth_experiment_yaml._parse_host_repo_from_yaml('host_repo: "acme/widgets"') == "acme/widgets"

    def test_single_quoted(self) -> None:
        assert synth_experiment_yaml._parse_host_repo_from_yaml("host_repo: 'acme/widgets'") == "acme/widgets"

    def test_unquoted(self) -> None:
        assert synth_experiment_yaml._parse_host_repo_from_yaml("host_repo: acme/widgets") == "acme/widgets"

    def test_missing_returns_none(self) -> None:
        assert synth_experiment_yaml._parse_host_repo_from_yaml("default_branch: main") is None

    def test_with_other_fields(self) -> None:
        yaml = """default_branch: "main"
host_repo: "acme/widgets"
tasks_md_path: "TASKS.md"
"""
        assert synth_experiment_yaml._parse_host_repo_from_yaml(yaml) == "acme/widgets"


class TestCli:
    """End-to-end CLI tests against a tmp host fixture."""

    SCRIPT = Path(__file__).parent.parent / "scripts" / "synth_experiment_yaml.py"

    def _make_host(self, tmp_path: Path, tasks_md: str, repo_yaml: str | None = None) -> Path:
        host = tmp_path / "host"
        host.mkdir()
        (host / "TASKS.md").write_text(tasks_md, encoding="utf-8")
        if repo_yaml is not None:
            (host / ".minsky").mkdir()
            (host / ".minsky" / "repo.yaml").write_text(repo_yaml, encoding="utf-8")
        return host

    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(self.SCRIPT), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_writes_yaml_to_default_path(self, tmp_path: Path) -> None:
        tasks_md = """# Tasks

## P0

- [ ] Test fixture task
  - **ID**: fixture-1
  - **Hypothesis**: hyp text
  - **Success**: succ text
  - **Pivot**: pivot text
  - **Measurement**: node scripts/x.mjs
  - **Anchor**: Beck 1999
"""
        host = self._make_host(tmp_path, tasks_md, repo_yaml='host_repo: "acme/widgets"\n')
        result = self._run("fixture-1", str(host))
        assert result.returncode == 0
        target = host / ".minsky" / "experiments" / "fixture-1.yaml"
        assert target.exists()
        content = target.read_text(encoding="utf-8")
        assert "id: fixture-1" in content
        assert 'host_repo: "acme/widgets"' in content
        assert "hypothesis: |" in content

    def test_stdout_mode(self, tmp_path: Path) -> None:
        tasks_md = """# Tasks

## P0

- [ ] Test fixture task
  - **ID**: fixture-1
  - **Hypothesis**: hyp text
  - **Success**: succ text
  - **Pivot**: pivot text
  - **Measurement**: node scripts/x.mjs
  - **Anchor**: Beck 1999
"""
        host = self._make_host(tmp_path, tasks_md)
        result = self._run("fixture-1", str(host), "--output=-")
        assert result.returncode == 0
        assert "id: fixture-1" in result.stdout
        # No file should have been written
        assert not (host / ".minsky" / "experiments" / "fixture-1.yaml").exists()

    def test_missing_task_exits_1(self, tmp_path: Path) -> None:
        tasks_md = "# Tasks\n\n## P0\n\n- [ ] Other task\n  - **ID**: other-task\n"
        host = self._make_host(tmp_path, tasks_md)
        result = self._run("missing-id", str(host))
        assert result.returncode == 1
        assert "missing-id" in result.stderr or "not found" in result.stderr.lower()

    def test_missing_rule_9_field_exits_3(self, tmp_path: Path) -> None:
        # No Hypothesis field
        tasks_md = """# Tasks

## P0

- [ ] Incomplete task
  - **ID**: incomplete
  - **Success**: succ
"""
        host = self._make_host(tmp_path, tasks_md)
        result = self._run("incomplete", str(host))
        assert result.returncode == 3
        assert "Hypothesis" in result.stderr

    def test_no_repo_yaml_falls_back_to_no_host_repo(self, tmp_path: Path) -> None:
        tasks_md = """# Tasks

## P0

- [ ] Test fixture
  - **ID**: fixture-1
  - **Hypothesis**: hyp
  - **Success**: s
  - **Pivot**: p
  - **Measurement**: m
  - **Anchor**: a
"""
        # No repo.yaml
        host = self._make_host(tmp_path, tasks_md)
        result = self._run("fixture-1", str(host))
        assert result.returncode == 0
        content = (host / ".minsky" / "experiments" / "fixture-1.yaml").read_text(encoding="utf-8")
        assert "host_repo:" not in content
