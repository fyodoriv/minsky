"""Parity tests for scripts/pick_task.py against the TS task-finder fixtures.

These tests pin the Python port to behavior-parity with the TypeScript
parser at `novel/cross-repo-runner/src/task-finder.ts` whose own tests
live at `novel/cross-repo-runner/src/task-finder.test.ts`.

When the TS file is deleted in Phase 7b, these tests become the canonical
contract for `parseTasksMd` / `pickHostTask` / rule-9 enforcement.

Run: `python3 -m pytest tests/test_pick_task.py -v`
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow importing scripts/pick_task.py without installing the package.
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import pick_task  # noqa: E402  pylint: disable=wrong-import-position

# --- Fixture lifted verbatim from task-finder.test.ts ---------------------

SAMPLE_TASKS_MD = """# Tasks

## P0

- [ ] Fix the slash command labels PROJ-840
  **ID**: proj-840-slash-command-labels
  **Tags**: bug, ai-native, one-shot
  **Details**: titles "hold" and "lead" should read "Put on hold" / "Lead support"
  **Hypothesis**: Replacing the title strings closes the labels gap.
  **Success**: tests pass; titles render as expected
  **Pivot**: <0.5
  **Measurement**: yarn vitest run plugins/example-ai-native
  **Anchor**: rule #9; vision.md § 9

- [ ] Add storybook coverage SOLID-2313
  **ID**: storybook-coverage-solid-2313
  **Tags**: docs, storybook

## P1

- [x] Already-done task (should be ignored as no ID)
"""

DASH_BULLET_TASKS_MD = """## P0

- [ ] Task with dash-prefixed metadata
  - **ID**: dash-task-1
  - **Tags**: foo, bar
  - **Hypothesis**: leading dashes parse the same
  - **Success**: yes
  - **Pivot**: <0.3
  - **Measurement**: pytest tests/
  - **Anchor**: rule #9
"""

P0_BEFORE_P1_TASKS_MD = """## P0

- [ ] Higher-priority task
  **ID**: high-priority-task
  **Hypothesis**: P0 should always come first
  **Success**: P0 is picked
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9

## P1

- [ ] Lower-priority task
  **ID**: low-priority-task
  **Hypothesis**: P1 should be skipped when P0 is available
  **Success**: P1 not picked
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9
"""

BLOCKED_TASKS_MD = """## P0

- [ ] Task that is blocked
  **ID**: blocked-task
  **Hypothesis**: blocked tasks are skipped
  **Success**: skipped
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9
  **Blocked**: waiting on upstream

- [ ] Task that is fine
  **ID**: fine-task
  **Hypothesis**: this one is picked
  **Success**: picked
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9
"""

INCOMPLETE_RULE_9_TASKS_MD = """## P0

- [ ] Missing-anchor task
  **ID**: missing-anchor-task
  **Hypothesis**: should be filtered
  **Success**: should not be picked
  **Pivot**: <0.5
  **Measurement**: pytest

- [ ] Complete task
  **ID**: complete-task
  **Hypothesis**: this one is picked
  **Success**: picked
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9
"""

MULTILINE_DETAILS_TASKS_MD = """## P0

- [ ] Multi-line details task
  **ID**: multiline-task
  **Tags**: complex
  **Details**: first line of details
    continuation line, indented more than the bullet
    another continuation line
  **Hypothesis**: multi-line fields parse correctly
  **Success**: continuation is joined with spaces
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9
"""

# --- parseTasksMd parity tests -------------------------------------------


def test_parses_two_tasks_under_p0() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    assert len(tasks) == 2
    assert tasks[0].id == "proj-840-slash-command-labels"
    assert tasks[1].id == "storybook-coverage-solid-2313"


def test_captures_the_priority_for_each_task() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    assert tasks[0].priority == "P0"
    assert tasks[1].priority == "P0"


def test_captures_all_rule_9_fields_when_present() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    t = tasks[0]
    assert t.hypothesis is not None and "Replacing the title strings" in t.hypothesis
    assert t.success is not None and "tests pass" in t.success
    assert t.pivot == "<0.5"
    assert t.measurement is not None and "yarn vitest run" in t.measurement
    assert t.anchor is not None and "rule #9" in t.anchor


def test_returns_none_for_missing_rule_9_fields() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    t = tasks[1]  # storybook task — has no rule-9 fields
    assert t.hypothesis is None
    assert t.success is None
    assert t.pivot is None
    assert t.measurement is None
    assert t.anchor is None


def test_parses_dash_prefixed_metadata_bullets() -> None:
    tasks = pick_task.parse_tasks_md(DASH_BULLET_TASKS_MD)
    assert len(tasks) == 1
    t = tasks[0]
    assert t.id == "dash-task-1"
    assert t.tags == ["foo", "bar"]
    assert t.hypothesis == "leading dashes parse the same"


def test_already_done_tasks_with_no_id_are_skipped() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    ids = {t.id for t in tasks}
    assert "should be ignored as no ID" not in ids
    # And the [x] line itself doesn't contribute a task.
    assert all(t.id != None for t in tasks)  # noqa: E711


def test_parses_multi_line_details_field() -> None:
    tasks = pick_task.parse_tasks_md(MULTILINE_DETAILS_TASKS_MD)
    assert len(tasks) == 1
    t = tasks[0]
    assert t.details is not None
    assert "first line of details" in t.details
    assert "continuation line, indented more than the bullet" in t.details
    assert "another continuation line" in t.details


# --- isRule9Compliant parity tests ---------------------------------------


def test_is_rule_9_compliant_true_for_complete_task() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    assert pick_task.is_rule_9_compliant(tasks[0])


def test_is_rule_9_compliant_false_for_partial_task() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    assert not pick_task.is_rule_9_compliant(tasks[1])  # storybook is missing fields


def test_is_rule_9_compliant_false_when_anchor_missing() -> None:
    tasks = pick_task.parse_tasks_md(INCOMPLETE_RULE_9_TASKS_MD)
    missing = next(t for t in tasks if t.id == "missing-anchor-task")
    assert not pick_task.is_rule_9_compliant(missing)


# --- Success-alias parity tests ------------------------------------------
# `**Verification**`/`**Acceptance**` populate `success` when no explicit
# `**Success**` is present, mirroring `check-rule-9-tasksmd-fields.mjs` which
# already treats Success and Acceptance as equivalent. An explicit Success
# always wins; among aliases first-match wins.


def _alias_block(alias_line: str, *, extra: str = "") -> str:
    return f"""## P0

- [ ] Alias task
  - **ID**: alias-task
  - **Tags**: p0
  - **Hypothesis**: x causes y by z
{alias_line}
  - **Pivot**: <0.5
  - **Measurement**: pytest
  - **Anchor**: rule #9{extra}
"""


def test_acceptance_alias_populates_success_and_is_rule_9_compliant() -> None:
    tasks = pick_task.parse_tasks_md(_alias_block("  - **Acceptance**: tests pass"))
    assert len(tasks) == 1
    t = tasks[0]
    assert t.success == "tests pass"
    assert pick_task.is_rule_9_compliant(t)


def test_verification_alias_populates_success_and_is_rule_9_compliant() -> None:
    tasks = pick_task.parse_tasks_md(_alias_block("  - **Verification**: smoke passes"))
    assert len(tasks) == 1
    t = tasks[0]
    assert t.success == "smoke passes"
    assert pick_task.is_rule_9_compliant(t)


def test_explicit_success_wins_over_later_verification_alias() -> None:
    tasks = pick_task.parse_tasks_md(
        _alias_block("  - **Success**: real success\n  - **Verification**: alias loses")
    )
    assert tasks[0].success == "real success"


def test_explicit_success_wins_over_earlier_verification_alias() -> None:
    # Alias appears BEFORE the explicit Success — Success still wins.
    tasks = pick_task.parse_tasks_md(
        _alias_block("  - **Verification**: alias loses\n  - **Success**: real success")
    )
    assert tasks[0].success == "real success"


def test_first_alias_wins_when_verification_precedes_acceptance() -> None:
    tasks = pick_task.parse_tasks_md(
        _alias_block("  - **Verification**: V wins\n  - **Acceptance**: A loses")
    )
    assert tasks[0].success == "V wins"


def test_acceptance_alias_supports_multiline_continuation() -> None:
    md = _alias_block("  - **Acceptance**: first line\n    continued line")
    t = pick_task.parse_tasks_md(md)[0]
    assert t.success is not None
    assert "first line" in t.success
    assert "continued line" in t.success


def test_acceptance_only_task_is_picked_by_pick_host_task() -> None:
    # End-to-end: an Acceptance-only block is now eligible for picking.
    chosen = pick_task.pick_host_task(_alias_block("  - **Acceptance**: tests pass"))
    assert chosen is not None
    assert chosen.id == "alias-task"


# --- isNotBlocked parity tests -------------------------------------------


def test_is_not_blocked_true_when_field_absent() -> None:
    tasks = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
    assert pick_task.is_not_blocked(tasks[0])


def test_is_not_blocked_false_when_blocked_field_set() -> None:
    tasks = pick_task.parse_tasks_md(BLOCKED_TASKS_MD)
    blocked = next(t for t in tasks if t.id == "blocked-task")
    assert not pick_task.is_not_blocked(blocked)


def test_is_not_blocked_false_when_blocked_because_alias_set() -> None:
    """Regression for 2026-05-28: `**Blocked-because**:` was ignored by the
    picker, so a task that declared its external dependency under that
    field looped forever. The alias is now recognized."""
    tasks_md = """## P0

- [ ] Task that is blocked via alias
  **ID**: blocked-because-task
  **Hypothesis**: alias is honored
  **Success**: skipped
  **Pivot**: <0.5
  **Measurement**: pytest
  **Anchor**: rule #9
  **Blocked-because**: needs upstream X to ship first
"""
    tasks = pick_task.parse_tasks_md(tasks_md)
    blocked = next(t for t in tasks if t.id == "blocked-because-task")
    assert not pick_task.is_not_blocked(blocked)


# --- pickHostTask parity tests -------------------------------------------


def test_pick_host_task_picks_first_p0_when_available() -> None:
    chosen = pick_task.pick_host_task(SAMPLE_TASKS_MD)
    assert chosen is not None
    assert chosen.id == "proj-840-slash-command-labels"


def test_pick_host_task_prefers_p0_over_p1() -> None:
    chosen = pick_task.pick_host_task(P0_BEFORE_P1_TASKS_MD)
    assert chosen is not None
    assert chosen.id == "high-priority-task"


def test_pick_host_task_skips_blocked_tasks() -> None:
    chosen = pick_task.pick_host_task(BLOCKED_TASKS_MD)
    assert chosen is not None
    assert chosen.id == "fine-task"  # blocked task is skipped


def test_pick_host_task_skips_tasks_missing_rule_9_fields() -> None:
    chosen = pick_task.pick_host_task(INCOMPLETE_RULE_9_TASKS_MD)
    assert chosen is not None
    assert chosen.id == "complete-task"


def test_pick_host_task_skips_tasks_with_open_prs() -> None:
    chosen = pick_task.pick_host_task(
        P0_BEFORE_P1_TASKS_MD,
        open_pr_branches=["feat/high-priority-task"],
    )
    assert chosen is not None
    assert chosen.id == "low-priority-task"


def test_pick_host_task_skips_explicit_skip_ids() -> None:
    chosen = pick_task.pick_host_task(
        P0_BEFORE_P1_TASKS_MD,
        skip_task_ids=["high-priority-task"],
    )
    assert chosen is not None
    assert chosen.id == "low-priority-task"


def test_pick_host_task_returns_none_when_no_eligible_tasks() -> None:
    empty_md = "## P0\n\n- [x] All done with no IDs\n"
    chosen = pick_task.pick_host_task(empty_md)
    assert chosen is None


# --- Tag/section priority-discipline tests -------------------------------
# Regression for `daemon-priority-discipline-picktask-bug`: a `p1`-tagged
# block physically placed in `## P0` was returned ahead of every genuine
# `p0`-tagged block below it, because the picker walked `PRIORITY_ORDER` by
# section header only and never consulted `tags`.

TAG_SECTION_MISMATCH_FIXTURE = (
    Path(__file__).parent / "fixtures" / "picker-tag-section-mismatch.md"
)


def test_pick_host_task_skips_p1_tagged_block_misfiled_in_p0() -> None:
    content = TAG_SECTION_MISMATCH_FIXTURE.read_text(encoding="utf-8")
    chosen = pick_task.pick_host_task(content)
    assert chosen is not None
    # The misfiled p1-in-P0 block must NOT shadow the genuine p0 block.
    assert chosen.id != "misplaced-p1-in-p0"


def test_pick_host_task_returns_genuine_p0_over_misfiled_p1() -> None:
    content = TAG_SECTION_MISMATCH_FIXTURE.read_text(encoding="utf-8")
    chosen = pick_task.pick_host_task(content)
    assert chosen is not None
    assert chosen.id == "genuine-p0"


def test_tags_match_section_rejects_contradicting_priority_tag() -> None:
    misfiled = pick_task.ParsedTask(
        title="x", priority="P0", id="x", tags=["p1", "picker"]
    )
    assert not pick_task.tags_match_section(misfiled)


def test_tags_match_section_accepts_aligned_priority_tag() -> None:
    aligned = pick_task.ParsedTask(
        title="x", priority="P0", id="x", tags=["p0", "picker"]
    )
    assert pick_task.tags_match_section(aligned)


def test_tags_match_section_accepts_absent_priority_tag() -> None:
    # Back-compat: a block that omits the redundant priority tag is NOT a
    # contradiction and stays eligible.
    untagged = pick_task.ParsedTask(
        title="x", priority="P0", id="x", tags=["picker"]
    )
    assert pick_task.tags_match_section(untagged)


def test_tags_match_section_is_case_insensitive() -> None:
    # `P0` section vs an uppercase `P0` tag both normalise — no false skip.
    upper = pick_task.ParsedTask(
        title="x", priority="P0", id="x", tags=["P0", "picker"]
    )
    assert pick_task.tags_match_section(upper)


# --- findTask parity tests -----------------------------------------------


def test_find_task_returns_task_on_exact_id_match() -> None:
    result = pick_task.find_task(SAMPLE_TASKS_MD, "proj-840-slash-command-labels")
    assert result.ok
    assert result.task is not None
    assert result.task.id == "proj-840-slash-command-labels"


def test_find_task_id_match_is_case_sensitive() -> None:
    # Kebab IDs are lower-case by convention; uppercase query is NOT a
    # substring of the title either, so the lookup fails.
    result = pick_task.find_task(SAMPLE_TASKS_MD, "PROJ-840-SLASH-COMMAND-LABELS")
    assert not result.ok


def test_find_task_falls_through_to_title_substring() -> None:
    # "PROJ-840" appears in the title but is not the ID.
    result = pick_task.find_task(SAMPLE_TASKS_MD, "PROJ-840")
    assert result.ok
    assert result.task is not None
    assert result.task.id == "proj-840-slash-command-labels"


def test_find_task_title_substring_is_case_insensitive() -> None:
    result = pick_task.find_task(SAMPLE_TASKS_MD, "proj-840")
    assert result.ok
    assert result.task is not None
    assert result.task.id == "proj-840-slash-command-labels"


def test_find_task_substring_partial_match_works() -> None:
    result = pick_task.find_task(SAMPLE_TASKS_MD, "slash command")
    assert result.ok
    assert result.task is not None
    assert result.task.id == "proj-840-slash-command-labels"


def test_find_task_returns_available_ids_on_miss() -> None:
    result = pick_task.find_task(SAMPLE_TASKS_MD, "no-such-task")
    assert not result.ok
    assert "proj-840-slash-command-labels" in result.available_ids
    assert "storybook-coverage-solid-2313" in result.available_ids
    assert result.reason is not None
    assert "no-such-task" in result.reason


def test_find_task_returns_empty_ids_on_empty_tasks_md() -> None:
    result = pick_task.find_task("# Tasks\n", "anything")
    assert not result.ok
    assert result.available_ids == []


# --- Multi-line + asterisk-bullet parser regression tests ----------------


MULTILINE_OBSERVER_DOGFOOD_MD = """# Tasks

## P0

- [ ] Sample task with multi-line details

  - **ID**: sample-multiline
  - **Tags**: regression
  - **Hypothesis**: needs to survive multi-line
  - **Success**: details captures all 4 lines
  - **Pivot**: capture only first line
  - **Measurement**: yarn vitest run task-finder
  - **Anchor**: 2026-05-16 example-service-plugin run
  - **Details**: Walk the page state-by-state:
    1. `default` — the happy path
    2. `loading` — skeleton
    3. `empty` — no team
    4. `error` — PagerDuty 500

    Reuse `src/shared/components/{Skeleton, EmptyState}`.
"""

CONTINUATION_NO_BLEED_MD = """# Tasks

## P0

- [ ] Sample task

  - **ID**: sample-no-bleed
  - **Tags**: regression
  - **Details**: First line of details.

    Continuation paragraph still part of Details.
  - **Hypothesis**: separate field, not in details
  - **Success**: ok
  - **Pivot**: ok
  - **Measurement**: ok
  - **Anchor**: ok
"""

ASTERISK_BULLET_TASKS_MD = """# Tasks

## P1

- [ ] star-bullet
  * **ID**: star-bullet
  * **Hypothesis**: h
  * **Success**: s
  * **Pivot**: p
  * **Measurement**: m
  * **Anchor**: a
"""


def test_parser_captures_oncall_hub_multiline_details_regression() -> None:
    # 2026-05-16 example-service-plugin regression: parser dropped continuation
    # lines under **Details** so the brief was empty and claude --print
    # shipped nothing. This pins the fix.
    tasks = pick_task.parse_tasks_md(MULTILINE_OBSERVER_DOGFOOD_MD)
    assert len(tasks) == 1
    t = tasks[0]
    assert t.details is not None
    assert "Walk the page state-by-state" in t.details
    assert "1. `default`" in t.details
    assert "4. `error`" in t.details
    assert "Reuse" in t.details
    assert t.anchor == "2026-05-16 example-service-plugin run"
    assert t.hypothesis == "needs to survive multi-line"


def test_continuation_does_not_bleed_across_sibling_field_bullets() -> None:
    tasks = pick_task.parse_tasks_md(CONTINUATION_NO_BLEED_MD)
    assert len(tasks) == 1
    t = tasks[0]
    assert t.details is not None
    assert "First line of details." in t.details
    assert "Continuation paragraph still part of Details." in t.details
    assert "separate field" not in t.details
    assert t.hypothesis == "separate field, not in details"


def test_parser_handles_asterisk_bullet_metadata() -> None:
    # tasks.md spec allows either `- ` or `* ` as the bullet character.
    tasks = pick_task.parse_tasks_md(ASTERISK_BULLET_TASKS_MD)
    assert len(tasks) == 1
    assert tasks[0].id == "star-bullet"
    assert tasks[0].hypothesis == "h"


# --- Real-TASKS.md parity smoke test -------------------------------------


def test_pick_host_task_against_real_tasks_md() -> None:
    """Smoke test: the picker must return a non-None ID against the live TASKS.md.

    This catches the case where the picker's filter logic accidentally
    rejects every task (e.g. all become blocked, all lose rule-9 fields)
    — failing fast in CI rather than silently shipping a daemon that
    can't pick anything.
    """
    tasks_md = Path(__file__).parent.parent / "TASKS.md"
    if not tasks_md.is_file():
        return  # Tolerated when the test runs in a sub-directory checkout.
    chosen = pick_task.pick_host_task(tasks_md.read_text(encoding="utf-8"))
    assert chosen is not None
    assert chosen.id is not None
    assert chosen.priority in {"P0", "P1"}


# --- Duplicate-PR detection (parity with TS decideDuplicate) -------------


class TestPrTitleNamesTask:
    """Pure title-matching parity tests."""

    def test_matches_feat_prefix_with_parens(self) -> None:
        # The daemon's commit convention is `feat(<task-id>): …`.
        assert pick_task.pr_title_names_task(
            "feat(some-task-id): wire the substrate",
            "some-task-id",
        )

    def test_matches_fix_prefix_with_parens(self) -> None:
        assert pick_task.pr_title_names_task(
            "fix(daemon-noop-iteration-rate-too-high): bounded backoff",
            "daemon-noop-iteration-rate-too-high",
        )

    def test_matches_task_id_in_brackets(self) -> None:
        # Markdown autolink shape `[[task-id]]`.
        assert pick_task.pr_title_names_task("foo [[task-x]] bar", "task-x")

    def test_matches_id_at_start_of_title(self) -> None:
        assert pick_task.pr_title_names_task("task-x: bar", "task-x")

    def test_matches_id_at_end_of_title(self) -> None:
        assert pick_task.pr_title_names_task("foo task-x", "task-x")

    def test_rejects_substring_match(self) -> None:
        # `task-x` must not match `task-xy` (no word boundary).
        assert not pick_task.pr_title_names_task("feat(task-xy): bar", "task-x")

    def test_rejects_id_in_word_prefix(self) -> None:
        # `task-x` must not match a title containing `mytask-x`.
        assert not pick_task.pr_title_names_task("feat(mytask-x): bar", "task-x")

    def test_rejects_id_in_word_suffix(self) -> None:
        # `task-x` must not match `task-xtra`.
        assert not pick_task.pr_title_names_task("feat(task-xtra): bar", "task-x")

    def test_handles_empty_inputs(self) -> None:
        assert not pick_task.pr_title_names_task("", "task-x")
        assert not pick_task.pr_title_names_task("feat(task-x): foo", "")


class TestDecideDuplicate:
    """Parity port of `decideDuplicate` in duplicate-pr-detector.ts."""

    def test_no_matching_prs_returns_none(self) -> None:
        verdict = pick_task.decide_duplicate(
            "my-task",
            [{"number": 1, "title": "feat(other-task): foo", "state": "OPEN"}],
        )
        assert verdict is None

    def test_open_pr_takes_precedence(self) -> None:
        verdict = pick_task.decide_duplicate(
            "my-task",
            [
                {"number": 42, "title": "feat(my-task): shipping it", "state": "OPEN"},
                {
                    "number": 41,
                    "title": "feat(my-task): old attempt",
                    "state": "MERGED",
                    "closedAt": "2026-05-20T12:00:00Z",
                },
            ],
            now_ms=int(__import__("time").time() * 1000),
        )
        assert verdict == {"kind": "open", "pr_number": 42}

    def test_merged_recent_within_window(self) -> None:
        # Merged 3 days ago — within the default 7-day window.
        from datetime import datetime, timedelta, timezone

        three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat().replace(
            "+00:00", "Z"
        )
        verdict = pick_task.decide_duplicate(
            "my-task",
            [
                {
                    "number": 100,
                    "title": "feat(my-task): shipped",
                    "state": "MERGED",
                    "closedAt": three_days_ago,
                },
            ],
        )
        assert verdict is not None
        assert verdict["kind"] == "merged-recent"
        assert verdict["pr_number"] == 100
        assert 2.5 < verdict["days_ago"] < 3.5

    def test_merged_outside_window_returns_none(self) -> None:
        # Merged 10 days ago — outside the default 7-day window.
        from datetime import datetime, timedelta, timezone

        ten_days_ago = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat().replace(
            "+00:00", "Z"
        )
        verdict = pick_task.decide_duplicate(
            "my-task",
            [
                {
                    "number": 100,
                    "title": "feat(my-task): shipped long ago",
                    "state": "MERGED",
                    "closedAt": ten_days_ago,
                },
            ],
        )
        assert verdict is None

    def test_picks_most_recent_merged(self) -> None:
        from datetime import datetime, timedelta, timezone

        two_days_ago = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat().replace(
            "+00:00", "Z"
        )
        five_days_ago = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat().replace(
            "+00:00", "Z"
        )
        verdict = pick_task.decide_duplicate(
            "my-task",
            [
                {
                    "number": 200,
                    "title": "feat(my-task): older",
                    "state": "MERGED",
                    "closedAt": five_days_ago,
                },
                {
                    "number": 300,
                    "title": "feat(my-task): newer",
                    "state": "MERGED",
                    "closedAt": two_days_ago,
                },
            ],
        )
        assert verdict is not None
        assert verdict["pr_number"] == 300  # The newer one

    def test_closed_but_not_merged_returns_none(self) -> None:
        # CLOSED (not MERGED) PRs are NOT counted as duplicates — they
        # represent abandoned work; re-opening a fresh PR is OK.
        verdict = pick_task.decide_duplicate(
            "my-task",
            [
                {
                    "number": 1,
                    "title": "feat(my-task): abandoned",
                    "state": "CLOSED",
                    "closedAt": "2026-05-20T12:00:00Z",
                },
            ],
        )
        assert verdict is None

    def test_merged_without_closed_at_is_skipped(self) -> None:
        # MERGED without closedAt is malformed gh output — skip silently.
        verdict = pick_task.decide_duplicate(
            "my-task",
            [
                {
                    "number": 1,
                    "title": "feat(my-task): no timestamp",
                    "state": "MERGED",
                },
            ],
        )
        assert verdict is None


class TestPickHostTaskWithAllPrs:
    """`pick_host_task` accepts `all_prs` and filters via decide_duplicate."""

    def test_filters_task_with_matching_open_pr(self) -> None:
        # Build a TASKS.md with one rule-9-compliant task whose ID matches
        # an open PR in the snapshot. Picker must skip it.
        tasks_md = _build_tasks_md_with_one_task("my-task")
        chosen = pick_task.pick_host_task(
            tasks_md,
            all_prs=[{"number": 1, "title": "feat(my-task): foo", "state": "OPEN"}],
        )
        assert chosen is None

    def test_picks_task_when_no_matching_pr(self) -> None:
        tasks_md = _build_tasks_md_with_one_task("my-task")
        chosen = pick_task.pick_host_task(
            tasks_md,
            all_prs=[{"number": 1, "title": "feat(other-task): bar", "state": "OPEN"}],
        )
        assert chosen is not None
        assert chosen.id == "my-task"

    def test_filters_task_with_recent_merged_pr(self) -> None:
        from datetime import datetime, timedelta, timezone

        recent = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat().replace(
            "+00:00", "Z"
        )
        tasks_md = _build_tasks_md_with_one_task("my-task")
        chosen = pick_task.pick_host_task(
            tasks_md,
            all_prs=[
                {
                    "number": 1,
                    "title": "feat(my-task): shipped",
                    "state": "MERGED",
                    "closedAt": recent,
                },
            ],
        )
        assert chosen is None

    def test_backcompat_when_all_prs_not_provided(self) -> None:
        # Same TASKS.md, no all_prs → picker must return the task (no
        # filter applied). This is the back-compat case for callers
        # that haven't wired the broader fetch yet.
        tasks_md = _build_tasks_md_with_one_task("my-task")
        chosen = pick_task.pick_host_task(tasks_md)
        assert chosen is not None
        assert chosen.id == "my-task"


# --- TaskSource port (rule #2 — Ports & Adapters) ------------------------


class TestTaskSourcePort:
    """The `TaskSource` Protocol + `TasksMdTaskSource` adapter round-trip.

    Pins the rule-#2 seam: `TasksMdTaskSource` satisfies the `TaskSource`
    Protocol and routes the three port verbs (`list_open_tasks`,
    `get_task`, `find`) through the existing parser with zero behavior
    change vs the module-level functions.
    """

    def test_tasks_md_source_satisfies_task_source_protocol(self) -> None:
        source = pick_task.TasksMdTaskSource(content=SAMPLE_TASKS_MD)
        # runtime_checkable Protocol — structural conformance check.
        assert isinstance(source, pick_task.TaskSource)

    def test_list_open_tasks_matches_parse_tasks_md(self) -> None:
        source = pick_task.TasksMdTaskSource(content=SAMPLE_TASKS_MD)
        via_port = source.list_open_tasks()
        direct = pick_task.parse_tasks_md(SAMPLE_TASKS_MD)
        assert [t.id for t in via_port] == [t.id for t in direct]

    def test_get_task_returns_matching_record(self) -> None:
        source = pick_task.TasksMdTaskSource(content=SAMPLE_TASKS_MD)
        task = source.get_task("proj-840-slash-command-labels")
        assert task is not None
        assert task.id == "proj-840-slash-command-labels"

    def test_get_task_returns_none_for_unknown_id(self) -> None:
        source = pick_task.TasksMdTaskSource(content=SAMPLE_TASKS_MD)
        assert source.get_task("no-such-task") is None

    def test_find_matches_module_level_find_task(self) -> None:
        source = pick_task.TasksMdTaskSource(content=SAMPLE_TASKS_MD)
        via_port = source.find("slash command")
        direct = pick_task.find_task(SAMPLE_TASKS_MD, "slash command")
        assert via_port.ok == direct.ok
        assert via_port.task is not None and direct.task is not None
        assert via_port.task.id == direct.task.id

    def test_constructs_from_path(self) -> None:
        # The daemon's case: TasksMdTaskSource('TASKS.md').
        tasks_md = Path(__file__).parent.parent / "TASKS.md"
        if not tasks_md.is_file():
            return  # Tolerated when run from a sub-directory checkout.
        source = pick_task.TasksMdTaskSource(str(tasks_md))
        assert callable(getattr(source, "list_open_tasks"))
        tasks = source.list_open_tasks()
        assert len(tasks) > 0

    def test_requires_exactly_one_of_path_or_content(self) -> None:
        import pytest

        with pytest.raises(ValueError):
            pick_task.TasksMdTaskSource()  # neither
        with pytest.raises(ValueError):
            pick_task.TasksMdTaskSource("TASKS.md", content="x")  # both

    def test_pick_from_source_equals_pick_host_task(self) -> None:
        # The interface-routed picker must agree with the string-routed one.
        source = pick_task.TasksMdTaskSource(content=P0_BEFORE_P1_TASKS_MD)
        via_port = pick_task.pick_from_source(source)
        direct = pick_task.pick_host_task(P0_BEFORE_P1_TASKS_MD)
        assert via_port is not None and direct is not None
        assert via_port.id == direct.id == "high-priority-task"

    def test_pick_from_source_honors_filters(self) -> None:
        # open-PR filter routed through the port skips the P0, falls to P1.
        source = pick_task.TasksMdTaskSource(content=P0_BEFORE_P1_TASKS_MD)
        chosen = pick_task.pick_from_source(
            source,
            open_pr_branches=["feat/high-priority-task"],
        )
        assert chosen is not None
        assert chosen.id == "low-priority-task"


def _build_tasks_md_with_one_task(task_id: str) -> str:
    """Build a minimal rule-9-compliant TASKS.md with one P0 task."""
    return f"""# Tasks

## P0

- [ ] `{task_id}` — fixture task
  - **ID**: {task_id}
  - **Tags**: fixture
  - **Hypothesis**: fixture hypothesis
  - **Success**: fixture success
  - **Pivot**: fixture pivot
  - **Measurement**: test exits 0
  - **Anchor**: rule #1, fixture
  - **Details**: fixture
"""
