"""Tests for the re-engagement loop in
``novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py``
(``_run_conversation``).

The re-engagement loop converts OpenHands SDK's one-shot-or-die
semantics into a multi-attempt nudge loop when the local model
(qwen3-coder:30b) disengages with a prose-only reply. The loop is
opt-in via ``--reengage-budget N``; ``N=0`` (default for cloud Claude)
preserves the original single-shot behavior.

These tests stub the OpenHands ``Conversation`` so we don't need the
SDK or a live LLM. The stub records ``send_message`` / ``run`` calls
and lets the test simulate "no progress" vs "made progress" outcomes
between ``run()`` invocations.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SHIM_PATH = (
    REPO_ROOT
    / "novel"
    / "adapters"
    / "agent-runtime-openhands"
    / "bin"
    / "minsky-openhands-spawn.py"
)


class _FakeConversation:
    """Stub for openhands.sdk.Conversation. Defined at module scope so
    `from openhands.sdk import Conversation` (inside the shim) resolves
    it via the sys.modules stub installed by `_install_openhands_stub`.

    Records send_message + run calls. Each instance also exposes the
    last instance via a class-level `_instances` list so tests can
    inspect interactions without re-patching the Conversation factory.
    """

    _instances: list["_FakeConversation"] = []

    def __init__(self, **_kwargs: Any) -> None:
        self.messages: list[str] = []
        self.run_count = 0
        _FakeConversation._instances.append(self)

    def send_message(self, message: str) -> None:
        self.messages.append(message)

    def run(self) -> None:
        self.run_count += 1


def _install_openhands_stub() -> None:
    """Inject a fake `openhands.sdk` module into sys.modules so the
    shim's `from openhands.sdk import Conversation` resolves to our
    stub instead of failing with ModuleNotFoundError. Idempotent —
    safe to call from every test that needs it."""
    if "openhands.sdk" in sys.modules and getattr(
        sys.modules["openhands.sdk"], "Conversation", None
    ) is _FakeConversation:
        return
    openhands_pkg = types.ModuleType("openhands")
    openhands_sdk = types.ModuleType("openhands.sdk")
    openhands_sdk.Conversation = _FakeConversation  # type: ignore[attr-defined]
    openhands_pkg.sdk = openhands_sdk  # type: ignore[attr-defined]
    sys.modules["openhands"] = openhands_pkg
    sys.modules["openhands.sdk"] = openhands_sdk


def _load_shim_module():
    """Import the shim as a module so we can call its private helpers
    directly in tests. The shim isn't a package — it's a single .py at
    a path with a hyphen in the name — so we use spec_from_file_location.
    """
    _install_openhands_stub()
    spec = importlib.util.spec_from_file_location(
        "minsky_openhands_spawn", SHIM_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["minsky_openhands_spawn"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def shim():
    return _load_shim_module()


@pytest.fixture
def fake_conversation_class(shim):
    """Patch the shim's progress check + reset the conversation
    instance recorder so each test starts with a clean state."""
    _FakeConversation._instances = []
    with patch.object(shim, "_agent_made_progress") as progress_mock:
        # Default: no progress on every check (worst case — exhaust budget)
        progress_mock.return_value = False
        yield {"shim": shim, "progress_mock": progress_mock}


class TestReengageBudgetZeroPreservesSingleShot:
    """Cloud-LLM path (default budget=0) preserves the original behavior:
    one send_message + one run, no nudge loop."""

    def test_budget_zero_runs_once(self, fake_conversation_class):
        shim = fake_conversation_class["shim"]
        shim._run_conversation(
            agent=object(),
            brief="task brief content",
            repo_root=Path("/tmp"),
            max_iterations=50,
            baseline_sha="abc123",
            reengage_budget=0,
        )
        assert len(_FakeConversation._instances) == 1
        conv = _FakeConversation._instances[0]
        # Initial brief send + zero nudges
        assert conv.messages == ["task brief content"]
        # Single run, no re-runs
        assert conv.run_count == 1


class TestReengageBudgetNudgesOnNoProgress:
    """When budget>0 and the agent makes no progress, the shim sends
    nudge prompts and re-runs the conversation until budget is exhausted."""

    def test_budget_three_no_progress_sends_three_nudges(self, fake_conversation_class):
        shim = fake_conversation_class["shim"]
        # progress_mock default is False (no progress on any check)
        shim._run_conversation(
            agent=object(),
            brief="task brief content",
            repo_root=Path("/tmp"),
            max_iterations=50,
            baseline_sha="abc123",
            reengage_budget=3,
        )
        assert len(_FakeConversation._instances) == 1
        conv = _FakeConversation._instances[0]
        # Initial brief + 3 nudge prompts = 4 messages
        assert len(conv.messages) == 4
        # First message is the original brief
        assert conv.messages[0] == "task brief content"
        # Remaining three are escalating nudges from the canonical set
        for i in range(3):
            assert conv.messages[i + 1] == shim._REENGAGE_NUDGES[i]
        # 1 initial run + 3 nudge runs = 4 runs total
        assert conv.run_count == 4


class TestReengageStopsOnProgress:
    """If the agent makes progress mid-loop, the shim stops nudging."""

    def test_progress_on_first_check_skips_all_nudges(
        self, fake_conversation_class
    ):
        shim = fake_conversation_class["shim"]
        progress_mock = fake_conversation_class["progress_mock"]
        progress_mock.return_value = True  # immediate progress
        shim._run_conversation(
            agent=object(),
            brief="task brief",
            repo_root=Path("/tmp"),
            max_iterations=50,
            baseline_sha="abc123",
            reengage_budget=3,
        )
        conv = _FakeConversation._instances[0]
        # Only initial brief sent; progress detected before any nudge
        assert conv.messages == ["task brief"]
        assert conv.run_count == 1

    def test_progress_after_second_nudge_stops_loop(
        self, fake_conversation_class
    ):
        shim = fake_conversation_class["shim"]
        progress_mock = fake_conversation_class["progress_mock"]
        # Sequence: no-progress, no-progress, progress → stop after 2nd nudge
        progress_mock.side_effect = [False, False, True]
        shim._run_conversation(
            agent=object(),
            brief="task brief",
            repo_root=Path("/tmp"),
            max_iterations=50,
            baseline_sha="abc123",
            reengage_budget=3,
        )
        conv = _FakeConversation._instances[0]
        # 1 brief + 2 nudges (third loop iter detects progress, breaks)
        assert len(conv.messages) == 3
        assert conv.messages[1] == shim._REENGAGE_NUDGES[0]
        assert conv.messages[2] == shim._REENGAGE_NUDGES[1]
        # 1 initial run + 2 nudge runs = 3
        assert conv.run_count == 3


class TestReengageBudgetCappedByNudgeList:
    """If the budget exceeds the number of available nudge prompts,
    the shim caps at len(_REENGAGE_NUDGES) instead of crashing."""

    def test_budget_above_nudge_count_caps_at_list_length(
        self, fake_conversation_class
    ):
        shim = fake_conversation_class["shim"]
        shim._run_conversation(
            agent=object(),
            brief="task brief",
            repo_root=Path("/tmp"),
            max_iterations=50,
            baseline_sha="abc123",
            reengage_budget=999,  # absurd budget
        )
        conv = _FakeConversation._instances[0]
        # Brief + at most len(_REENGAGE_NUDGES) nudges
        assert len(conv.messages) == 1 + len(shim._REENGAGE_NUDGES)
        assert conv.run_count == 1 + len(shim._REENGAGE_NUDGES)


class TestReengageNudgeContent:
    """The nudge prompts must explicitly forbid prose-only replies —
    that's the load-bearing instruction that recovers the disengaged
    conversation."""

    def test_all_nudges_mention_tool_call(self, shim):
        for nudge in shim._REENGAGE_NUDGES:
            assert "tool call" in nudge.lower(), (
                f"every nudge must explicitly require a tool call; "
                f"got: {nudge!r}"
            )

    def test_nudges_are_escalating_in_directness(self, shim):
        # First nudge: general. Last: most prescriptive ("ANY file" / "1-line").
        assert "ANY single file" in shim._REENGAGE_NUDGES[-1] or "any file" in shim._REENGAGE_NUDGES[-1].lower()
