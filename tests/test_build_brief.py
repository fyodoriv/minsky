"""Tests for scripts/build_brief.py — Phase 7 brief builder.

Pins the Python port to TS-parity with `renderBrief` + `renderSystemPromptOverlay`
in `novel/cross-repo-runner/src/spawn-plan.ts`. The brief that gets fed to
`openhands solve` MUST include the rule-9 fields (Hypothesis, Success, Pivot,
Measurement, Anchor), the system-prompt overlay (constitution + deliverables),
and the FINAL STEP block (claude-print-must-ship-pr regression fix).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import build_brief  # noqa: E402  pylint: disable=wrong-import-position
import pick_task  # noqa: E402  pylint: disable=wrong-import-position


SAMPLE_TASKS_MD = """# Tasks

## P0

- [ ] Fix the slash command labels PROJ-840
  - **ID**: proj-840-slash-command-labels
  - **Tags**: bug, ai-native, one-shot
  - **Details**: titles "hold" and "lead" should read "Put on hold" / "Lead support"
  - **Hypothesis**: Replacing the title strings closes the labels gap.
  - **Success**: tests pass; titles render as expected
  - **Pivot**: <0.5
  - **Measurement**: yarn vitest run plugins/example-ai-native
  - **Anchor**: rule #9; vision.md § 9
"""


def _pick_task_from_sample() -> pick_task.ParsedTask:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    assert tasks
    return tasks[0]


# --- render_brief — task block parity tests -------------------------------


def test_render_brief_includes_task_id() -> None:
    task = _pick_task_from_sample()
    brief = build_brief.render_brief(task, "fyodoriv/minsky", "feat/proj-840-slash-command-labels")
    assert "# Task: proj-840-slash-command-labels" in brief


def test_render_brief_includes_host_repo_and_branch() -> None:
    task = _pick_task_from_sample()
    brief = build_brief.render_brief(task, "fyodoriv/minsky", "feat/proj-840-slash-command-labels")
    assert "Host repo: fyodoriv/minsky" in brief
    assert "Branch: feat/proj-840-slash-command-labels" in brief


def test_render_brief_includes_priority_and_tags() -> None:
    task = _pick_task_from_sample()
    brief = build_brief.render_brief(task, "h", "b")
    assert "Priority: P0" in brief
    assert "Tags: bug, ai-native, one-shot" in brief


def test_render_brief_includes_all_5_rule_9_fields() -> None:
    """Hypothesis / Success / Pivot / Measurement / Anchor must all land."""
    task = _pick_task_from_sample()
    brief = build_brief.render_brief(task, "h", "b")
    assert "## Hypothesis (rule #9)" in brief
    assert "Replacing the title strings closes the labels gap" in brief
    assert "## Success threshold" in brief
    assert "tests pass; titles render as expected" in brief
    assert "## Pivot threshold" in brief
    assert "<0.5" in brief
    assert "## Measurement" in brief
    assert "yarn vitest run plugins/example-ai-native" in brief
    assert "## Anchor" in brief
    assert "rule #9; vision.md" in brief


def test_render_brief_includes_details_when_present() -> None:
    task = _pick_task_from_sample()
    brief = build_brief.render_brief(task, "h", "b")
    assert "## Details" in brief
    assert "Put on hold" in brief


def test_render_brief_skips_tags_section_when_empty() -> None:
    """When tags is empty, the `Tags: ` line is filtered out (matches TS)."""
    bare = pick_task.ParsedTask(
        title="t", priority="P0", id="bare", tags=[],
        hypothesis="h", success="s", pivot="p", measurement="m", anchor="a",
    )
    brief = build_brief.render_brief(bare, "h", "b")
    assert "Tags:" not in brief


def test_render_brief_filters_empty_lines() -> None:
    """Matches TS `.filter((line) => line !== "")`."""
    task = _pick_task_from_sample()
    brief = build_brief.render_brief(task, "h", "b")
    # No double-blank lines anywhere.
    assert "\n\n\n" not in brief


# --- render_system_prompt_overlay — overlay parity tests -----------------


def test_overlay_includes_constitution_header() -> None:
    out = build_brief.render_system_prompt_overlay(
        vision_md_path=".minsky/vision.md",
        task_id="x", host_repo="h", pre_commit_command="",
    )
    assert "minsky's full constitution" in out
    assert ".minsky/vision.md" in out


def test_overlay_includes_5_deliverables_and_self_grade_block() -> None:
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="x", host_repo="h", pre_commit_command="",
    )
    assert "Required deliverables (rule #9 is iron)" in out
    assert "1. Cut a branch" in out
    assert "2. Ship the code" in out
    assert "3. Run the host's pre-commit hooks" in out
    assert "4. Remove the shipped task block" in out
    assert "5. Open a PR" in out
    assert "Hypothesis self-grade" in out
    assert "Predicted:" in out
    assert "Observed:" in out
    assert "Match: yes | no | partial" in out
    assert "Lesson:" in out


def test_overlay_uses_custom_pre_commit_command_when_set() -> None:
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="x", host_repo="h",
        pre_commit_command="pnpm pre-pr-lint",
    )
    assert "Run `pnpm pre-pr-lint`" in out
    assert "Run the host's pre-commit hooks" not in out


def test_overlay_includes_final_step_block() -> None:
    """The FINAL STEP block (claude-print-must-ship-pr regression) is iron."""
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="x", host_repo="h", pre_commit_command="",
    )
    assert "FINAL STEP" in out
    assert "git checkout -b" in out
    assert "git push -u origin HEAD" in out
    assert "gh pr create" in out
    assert "scope-leak detector" in out


# --- build_brief — full integration ---------------------------------------


def test_build_brief_concatenates_task_block_and_overlay_with_separator() -> None:
    task = _pick_task_from_sample()
    cfg = build_brief.HostConfig(host_repo="h", branch_prefix="feat/", pre_commit_command="", default_branch="main")
    brief = build_brief.build_brief(task, cfg)
    # Section separator between task block and overlay (matches TS).
    assert "\n---\n" in brief
    # Task block first.
    assert brief.index("# Task: proj-840-slash-command-labels") < brief.index("\n---\n")
    # Overlay after.
    assert brief.index("\n---\n") < brief.index("FINAL STEP")


def test_build_brief_uses_branch_prefix_from_config() -> None:
    task = _pick_task_from_sample()
    cfg = build_brief.HostConfig(host_repo="h", branch_prefix="agent/", pre_commit_command="", default_branch="main")
    brief = build_brief.build_brief(task, cfg)
    assert "Branch: agent/proj-840-slash-command-labels" in brief


# --- load_host_config — repo.yaml parsing ---------------------------------


def test_load_host_config_returns_defaults_when_no_repo_yaml(tmp_path: Path) -> None:
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.host_repo == tmp_path.name
    assert cfg.branch_prefix == "feat/"
    assert cfg.pre_commit_command == ""
    assert cfg.default_branch == "main"


def test_load_host_config_reads_repo_yaml(tmp_path: Path) -> None:
    minsky_dir = tmp_path / ".minsky"
    minsky_dir.mkdir()
    (minsky_dir / "repo.yaml").write_text(
        'host_repo: "fyodoriv/minsky"\n'
        "branch_prefix: agent/\n"
        'pre_commit_command: "pnpm pre-pr-lint"\n'
        'default_branch: "master"\n',
        encoding="utf-8",
    )
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.host_repo == "fyodoriv/minsky"
    assert cfg.branch_prefix == "agent/"
    assert cfg.pre_commit_command == "pnpm pre-pr-lint"
    assert cfg.default_branch == "master"


def test_load_host_config_default_branch_falls_back_to_main(tmp_path: Path) -> None:
    """When repo.yaml omits default_branch, it should default to 'main'
    (matches the GitHub-default for new repos and the TS substrate's
    loadRepoConfig fallback)."""
    minsky_dir = tmp_path / ".minsky"
    minsky_dir.mkdir()
    (minsky_dir / "repo.yaml").write_text(
        'host_repo: "team/repo"\n',  # no default_branch
        encoding="utf-8",
    )
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.host_repo == "team/repo"
    assert cfg.default_branch == "main"


def test_load_host_config_tolerates_comments_and_blank_lines(tmp_path: Path) -> None:
    minsky_dir = tmp_path / ".minsky"
    minsky_dir.mkdir()
    (minsky_dir / "repo.yaml").write_text(
        "# header comment\n\nhost_repo: a/b\n\n# trailing\n",
        encoding="utf-8",
    )
    cfg = build_brief.load_host_config(tmp_path)
    assert cfg.host_repo == "a/b"


# --- CLI smoke ------------------------------------------------------------


def _run_cli(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    script = str(Path(__file__).parent.parent / "scripts" / "build_brief.py")
    return subprocess.run(
        [sys.executable, script, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).parent.parent / "scripts")},
    )


def test_cli_prints_brief_to_stdout(tmp_path: Path) -> None:
    (tmp_path / "TASKS.md").write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    result = _run_cli(["proj-840-slash-command-labels", str(tmp_path)], cwd=tmp_path)
    assert result.returncode == 0
    assert "# Task: proj-840-slash-command-labels" in result.stdout
    assert "FINAL STEP" in result.stdout


def test_cli_exits_1_when_task_id_not_found(tmp_path: Path) -> None:
    (tmp_path / "TASKS.md").write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    result = _run_cli(["no-such-task", str(tmp_path)], cwd=tmp_path)
    assert result.returncode == 1
    assert "not found" in result.stderr


def test_cli_exits_1_when_no_tasks_md(tmp_path: Path) -> None:
    result = _run_cli(["any-task", str(tmp_path)], cwd=tmp_path)
    assert result.returncode == 1
    assert "TASKS.md not found" in result.stderr


def test_cli_exits_2_on_bad_args(tmp_path: Path) -> None:
    result = _run_cli([], cwd=tmp_path)
    assert result.returncode == 2
    assert "usage" in result.stderr
