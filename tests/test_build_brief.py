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


REPO_ROOT = Path(__file__).parent.parent
LIVE_TASKS_MD = REPO_ROOT / "TASKS.md"


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


def test_overlay_mandates_block_removal_on_shipped_work() -> None:
    """Shipped-work iterations must REMOVE the block, not annotate it.

    Pin for brief-mandates-task-block-removal-on-shipped-work: devin was
    observed ticking `[x]` boxes and adding a `**Status**:` line instead of
    deleting the block, which re-picks the same task forever.
    """
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="my-task", host_repo="h", pre_commit_command="",
    )
    assert "ALREADY SHIPPED" in out
    assert "REMOVE the entire" in out
    assert "Do NOT add `[x]` annotations" in out
    assert "Do NOT add a `**Status**:` line" in out


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


def test_overlay_default_exits_after_pr_without_waiting_for_ci() -> None:
    """Default overlay tells the agent to exit code 0 after `gh pr create`.

    Pin for brief-instructs-exit-after-pr-open: devin idled after opening a
    PR until the spawn watchdog SIGKILLed it, wasting compute. The brief now
    instructs an immediate clean exit and explicitly says not to wait for CI.
    """
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="x", host_repo="h", pre_commit_command="",
    )
    assert "EXIT CLEANLY with exit code 0 immediately" in out
    assert "Do NOT wait for" in out
    assert "the NEXT minsky iteration" in out


def test_overlay_wait_mode_reverts_to_legacy_run_until_something_happens() -> None:
    """MINSKY_BRIEF_WAIT_AFTER_PR_OPEN escape hatch keeps the agent alive.

    The Pivot opt-out (operators who need to react to red CI in the same
    iteration) restores the legacy behaviour and drops the immediate-exit
    instruction.
    """
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="x", host_repo="h", pre_commit_command="",
        wait_after_pr_open=True,
    )
    assert "MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true" in out
    assert "You MAY stay alive after the PR opens" in out
    # The immediate-exit instruction must NOT appear in legacy/wait mode.
    assert "EXIT CLEANLY with exit code 0 immediately" not in out


def test_build_brief_passes_wait_flag_through_to_overlay() -> None:
    """build_brief threads wait_after_pr_open down to the overlay."""
    task = _pick_task_from_sample()
    cfg = build_brief.HostConfig(
        host_repo="h", branch_prefix="feat/", pre_commit_command="", default_branch="main",
    )
    default_brief = build_brief.build_brief(task, cfg)
    wait_brief = build_brief.build_brief(task, cfg, wait_after_pr_open=True)
    assert "EXIT CLEANLY with exit code 0 immediately" in default_brief
    assert "EXIT CLEANLY with exit code 0 immediately" not in wait_brief
    assert "You MAY stay alive after the PR opens" in wait_brief


def test_cli_env_var_enables_wait_after_pr_open(tmp_path: Path) -> None:
    """MINSKY_BRIEF_WAIT_AFTER_PR_OPEN=true exported to the CLI reverts to
    legacy wait behaviour; absent (or any non-truthy value) keeps the
    default immediate-exit instruction."""
    (tmp_path / "TASKS.md").write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    script = str(Path(__file__).parent.parent / "scripts" / "build_brief.py")
    base_env = {**os.environ, "PYTHONPATH": str(Path(__file__).parent.parent / "scripts")}

    wait = subprocess.run(
        [sys.executable, script, "proj-840-slash-command-labels", str(tmp_path)],
        cwd=tmp_path, capture_output=True, text=True, check=False,
        env={**base_env, "MINSKY_BRIEF_WAIT_AFTER_PR_OPEN": "true"},
    )
    assert wait.returncode == 0, wait.stderr
    assert "You MAY stay alive after the PR opens" in wait.stdout
    assert "EXIT CLEANLY with exit code 0 immediately" not in wait.stdout

    default_env = {k: v for k, v in base_env.items() if k != "MINSKY_BRIEF_WAIT_AFTER_PR_OPEN"}
    default = subprocess.run(
        [sys.executable, script, "proj-840-slash-command-labels", str(tmp_path)],
        cwd=tmp_path, capture_output=True, text=True, check=False,
        env=default_env,
    )
    assert default.returncode == 0, default.stderr
    assert "EXIT CLEANLY with exit code 0 immediately" in default.stdout


def test_overlay_includes_tool_call_discipline_block() -> None:
    """TOOL-CALL DISCIPLINE (2026-05-27 disengagement-fix regression).

    Non-Claude models (observed: qwen3-coder:30b) emit `Let me examine X` as
    PROSE without an attached tool call. The OpenHands SDK interprets a reply
    with no tool call as the conversation-end signal and TERMINATES the
    conversation immediately. Pre-fix, this caused 13/13 iterations on
    2026-05-27 to exit after a single `ls -la` with verdict=no-progress (post
    the verdict-classifier fix that landed in #900; pre-#900 the verdict was
    false-positive `validated`).

    The brief now carries an explicit `TOOL-CALL DISCIPLINE` block that names
    the failure mode by example and gives the corrective pattern. This test
    pins the block so a future refactor can't quietly drop it.
    """
    out = build_brief.render_system_prompt_overlay(
        vision_md_path="v", task_id="x", host_repo="h", pre_commit_command="",
    )
    assert "TOOL-CALL DISCIPLINE" in out
    assert "every reply you emit must include a tool" in out.lower()
    # Names the specific failure-mode prose patterns
    assert "Let me examine X" in out
    assert "qwen3-coder" in out


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


# --- --max-tokens flag (heal-brief-too-long-for-context-window) -----------


def test_clamp_unbounded_returns_brief_unchanged() -> None:
    brief = "task block\n---\noverlay block"
    assert build_brief.clamp_brief_to_tokens(brief, 0) == brief
    assert build_brief.clamp_brief_to_tokens(brief, -1) == brief


def test_clamp_under_budget_returns_brief_unchanged() -> None:
    brief = "a" * 100 + "\n---\n" + "b" * 100
    assert build_brief.clamp_brief_to_tokens(brief, 1000) == brief


def test_clamp_over_budget_truncates_overlay_preserves_task_block() -> None:
    task_block = "task " * 50
    overlay = "overlay " * 500
    brief = task_block + "\n---\n" + overlay
    clamped = build_brief.clamp_brief_to_tokens(brief, 1000)
    assert len(clamped) <= 1000 * build_brief.BYTES_PER_TOKEN
    assert clamped.startswith(task_block)
    assert "[truncated by build_brief.py --max-tokens=1000" in clamped


def test_clamp_rejects_below_min_tokens_for_load_bearing() -> None:
    brief = "a" * 5000
    try:
        build_brief.clamp_brief_to_tokens(brief, 500)
    except ValueError as e:
        assert "MIN_TOKENS_FOR_LOAD_BEARING" in str(e)
    else:
        raise AssertionError("expected ValueError for budget below MIN_TOKENS_FOR_LOAD_BEARING")


def test_cli_max_tokens_flag_clamps_output(tmp_path: Path) -> None:
    (tmp_path / "TASKS.md").write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    result = _run_cli(
        ["proj-840-slash-command-labels", str(tmp_path), "--max-tokens", "1000"],
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert len(result.stdout) <= 1000 * build_brief.BYTES_PER_TOKEN + 1


def test_cli_max_tokens_equals_form(tmp_path: Path) -> None:
    (tmp_path / "TASKS.md").write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    result = _run_cli(
        ["proj-840-slash-command-labels", str(tmp_path), "--max-tokens=1000"],
        cwd=tmp_path,
    )
    assert result.returncode == 0
    assert len(result.stdout) <= 1000 * build_brief.BYTES_PER_TOKEN + 1


def test_cli_max_tokens_rejects_non_integer(tmp_path: Path) -> None:
    (tmp_path / "TASKS.md").write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    result = _run_cli(
        ["proj-840-slash-command-labels", str(tmp_path), "--max-tokens", "abc"],
        cwd=tmp_path,
    )
    assert result.returncode == 2
    assert "--max-tokens" in result.stderr


# --- local_llm_mode tests (2026-05-28 disengagement-fix for qwen3-coder:30b) ---


def test_local_llm_mode_front_loads_tool_call_discipline() -> None:
    """In local-LLM mode, the brief's overlay starts with the
    TOOL-CALL DISCIPLINE block, not the constitution preamble."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    brief = build_brief.build_brief(task, host_cfg, local_llm_mode=True)
    overlay = brief.split("\n---\n", 1)[1].lstrip()
    assert overlay.startswith("TOOL-CALL DISCIPLINE"), (
        f"expected overlay to lead with TOOL-CALL DISCIPLINE, got: {overlay[:120]!r}"
    )


def test_local_llm_mode_drops_constitution_preamble() -> None:
    """The 'Read .minsky/vision.md' preamble is dropped — local model
    cannot hold the constitution in its context window."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    brief = build_brief.build_brief(task, host_cfg, local_llm_mode=True)
    assert "You are working under minsky's full constitution" not in brief
    assert "Read .minsky/vision.md" not in brief


def test_local_llm_mode_preserves_final_step_block() -> None:
    """The FINAL STEP block (gh pr create invocation) is load-bearing
    and MUST appear regardless of mode."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    brief = build_brief.build_brief(task, host_cfg, local_llm_mode=True)
    assert "FINAL STEP" in brief
    assert "gh pr create" in brief
    assert "git push -u origin HEAD" in brief


def test_local_llm_mode_preserves_rule_9_fields() -> None:
    """Task block (Hypothesis / Success / Pivot / Measurement / Anchor)
    is preserved verbatim in local-LLM mode."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    brief = build_brief.build_brief(task, host_cfg, local_llm_mode=True)
    for header in (
        "## Hypothesis (rule #9)",
        "## Success threshold",
        "## Pivot threshold",
        "## Measurement",
        "## Anchor",
    ):
        assert header in brief, f"missing rule-9 header: {header}"


def test_cloud_mode_keeps_preamble_for_back_compat() -> None:
    """Default (non-local) mode keeps the constitution preamble — the
    cloud-LLM path (Claude / Devin) is unchanged by this PR."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    brief = build_brief.build_brief(task, host_cfg)
    assert "You are working under minsky's full constitution" in brief
    assert "Read .minsky/vision.md" in brief


def test_local_llm_mode_is_shorter_than_cloud_mode() -> None:
    """The local-LLM brief should be at least 100 bytes smaller than the
    cloud-mode brief on the same task (the preamble is dropped)."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    cloud = build_brief.build_brief(task, host_cfg, local_llm_mode=False)
    local = build_brief.build_brief(task, host_cfg, local_llm_mode=True)
    saved = len(cloud) - len(local)
    assert saved >= 100, f"local-mode brief should be ≥100 bytes shorter; saved {saved}"


# --- think-tool spam heal (2026-05-28 monitoring round) -----------------


def test_brief_explicitly_forbids_think_tool_spam() -> None:
    """The brief must explicitly forbid calling the `think` tool more
    than once per task. Observed 2026-05-28: qwen3-coder:30b hit the
    50-iteration cap by calling `think` 44 times to satisfy the tool-
    call-discipline above without ever calling file_editor / terminal.
    The original brief told the model 'Use the think tool for pure
    deliberation' — the model interpreted that as license to call think
    forever. Anti-think rule heals this."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    brief = build_brief.build_brief(task, host_cfg, local_llm_mode=True)
    # Must contain the explicit forbiddance:
    assert "EXPLICITLY FORBIDDEN" in brief
    assert "`think` tool more than ONCE" in brief
    # Must redirect the agent to real-side-effect tools:
    assert "`terminal` to `ls` or `cat`" in brief
    # Must NOT contain the OLD "use think for pure deliberation" guidance
    # which created the failure mode in the first place:
    assert "Use the `think` tool" not in brief
    assert "use the `think` tool for pure deliberation" not in brief.lower()


def test_brief_cloud_mode_also_gets_anti_think_rule() -> None:
    """The anti-think rule applies to BOTH cloud and local modes — Claude
    may also call think excessively under the original guidance, just less
    pathologically. The discipline block is shared between modes."""
    task = _pick_task_from_sample()
    host_cfg = build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )
    cloud_brief = build_brief.build_brief(task, host_cfg, local_llm_mode=False)
    assert "EXPLICITLY FORBIDDEN" in cloud_brief
    assert "`think` tool more than ONCE" in cloud_brief


# --- persona overlay (--persona) — M2 multi-persona pipeline ----------------


def _host_cfg() -> "build_brief.HostConfig":
    return build_brief.HostConfig(
        host_repo="test/host",
        branch_prefix="feat/",
        pre_commit_command="",
        default_branch="main",
    )


def test_pipeline_personas_are_the_five_canonical_roles() -> None:
    """The pipeline order is the load-bearing contract: persona N consumes
    persona N-1's artifact. It must match novel/personas/*.md and the driver."""
    assert build_brief.PIPELINE_PERSONAS == (
        "researcher",
        "planner",
        "developer",
        "qa",
        "reviewer",
    )


def test_load_persona_overlay_rejects_unknown_role() -> None:
    """An unknown role must raise ValueError (rule #6 — never silently spawn a
    persona whose template is missing)."""
    import pytest

    with pytest.raises(ValueError, match="unknown persona role"):
        build_brief.load_persona_overlay("architect")


def test_load_persona_overlay_reads_each_template() -> None:
    """Every canonical persona has a brief template under novel/personas/."""
    for role in build_brief.PIPELINE_PERSONAS:
        overlay = build_brief.load_persona_overlay(role)
        assert f"# Persona: {role}" in overlay


def test_render_persona_overlay_without_prior_artifact() -> None:
    overlay = build_brief.render_persona_overlay("researcher")
    assert "# Persona: researcher" in overlay
    # No prior artifact section when none is supplied.
    assert "Prior persona artifact" not in overlay


def test_render_persona_overlay_chains_prior_artifact() -> None:
    overlay = build_brief.render_persona_overlay(
        "planner", prior_artifact="RESEARCHER-CONTEXT-MARKER"
    )
    assert "# Persona: planner" in overlay
    assert "Prior persona artifact" in overlay
    assert "RESEARCHER-CONTEXT-MARKER" in overlay


def test_build_brief_persona_front_loads_the_role() -> None:
    """When --persona is set, the persona template comes FIRST so the agent
    reads its role before the task block."""
    task = _pick_task_from_sample()
    brief = build_brief.build_brief(task, _host_cfg(), persona="developer")
    # The persona overlay precedes the task block.
    assert brief.index("# Persona: developer") < brief.index("# Task:")


def test_build_brief_persona_includes_task_block_and_overlay() -> None:
    """The persona path still ships the task block + the system-prompt overlay
    (FINAL STEP + rule-9 fields are never dropped)."""
    task = _pick_task_from_sample()
    brief = build_brief.build_brief(task, _host_cfg(), persona="qa")
    assert "# Persona: qa" in brief
    assert "# Task: proj-840-slash-command-labels" in brief
    assert "FINAL STEP" in brief


def test_build_brief_without_persona_is_unchanged() -> None:
    """Default behaviour (no --persona) is byte-identical to the pre-persona
    brief — the overlay is purely additive."""
    task = _pick_task_from_sample()
    without = build_brief.build_brief(task, _host_cfg())
    assert "# Persona:" not in without
    assert without.startswith("# Task:")


def test_build_brief_persona_cli_smoke(tmp_path: Path) -> None:
    """End-to-end CLI: build_brief.py --persona <role> exits 0 and front-loads
    the persona; an unknown role exits non-zero."""
    tasks_md = tmp_path / "TASKS.md"
    tasks_md.write_text(SAMPLE_TASKS_MD, encoding="utf-8")
    script = Path(__file__).parent.parent / "scripts" / "build_brief.py"
    ok = subprocess.run(
        [sys.executable, str(script), "proj-840-slash-command-labels", str(tmp_path),
         "--persona", "reviewer"],
        capture_output=True, text=True, check=False,
    )
    assert ok.returncode == 0, ok.stderr
    assert "# Persona: reviewer" in ok.stdout

    bad = subprocess.run(
        [sys.executable, str(script), "proj-840-slash-command-labels", str(tmp_path),
         "--persona", "architect"],
        capture_output=True, text=True, check=False,
    )
    assert bad.returncode != 0
    assert "unknown persona role" in bad.stderr


# --- Real-world-derived fixture -------------------------------------------


def test_render_brief_from_live_tasks_md_real_world_fixture() -> None:
    """REAL-WORLD FIXTURE: build a brief from a task block in minsky's own live
    TASKS.md, not the SAMPLE_TASKS_MD literal.

    SAMPLE_TASKS_MD is a convenient hand-written shape that drifts from the real
    file (Fake Fixture smell, Meszaros 2007). Picking a live task and rendering
    its brief proves the picker -> brief pipeline survives the actual task-block
    format the daemon feeds an agent spawn, catching drift the synthetic misses.
    """
    assert LIVE_TASKS_MD.is_file()
    content = LIVE_TASKS_MD.read_text(encoding="utf-8")
    task = pick_task.pick_host_task(content)
    assert task is not None, "live TASKS.md yielded no pickable task"
    assert pick_task.is_rule_9_compliant(task)

    brief = build_brief.render_brief(task, "fyodoriv/minsky", f"feat/{task.id}")
    assert f"# Task: {task.id}" in brief
    assert "## Hypothesis (rule #9)" in brief
    assert "## Measurement" in brief
    assert task.hypothesis is not None and task.hypothesis in brief
