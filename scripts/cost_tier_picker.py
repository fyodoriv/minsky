#!/usr/bin/env python3
"""scripts/cost_tier_picker.py — first-run brain+workers cost-tier picker.

Why this file exists: on a fresh machine `~/.minsky/config.json` has no
`cost_tier`, so a new operator hand-edits JSON blind — they pick a
`cloud_agent` + `cloud_agent_model` + `local_agent` with zero visibility
into the $/hr each combination costs. Competitors do no better: Devin
charges $500/mo flat, OpenHands/SWE-agent give no estimate, Aider shows
token counts only post-hoc. This module is the pure decision + config-merge
core that `bin/minsky-init` wires into its config-write step (action (d)):
on a config WITHOUT `cost_tier` it presents a tier menu with $/hr
expectations, persists the choice, and never asks again. Upfront cost
transparency at setup is the trust differentiator (Krug 2014, progressive
disclosure; Nielsen 1993, visibility of system status).

Design (rule #1 — don't reinvent): this is a pure tier-decision helper,
NOT a new startup flow. It exports three pure functions plus one
file-merge helper; `bin/minsky-init` owns the I/O and the prompt. The
deleted `novel/tick-loop/src/cost-tier-picker.ts` is NOT recreated — that
startup flow is gone; per-machine config now lives in `bin/minsky-init`.

Public surface:
    tier_definitions()                         -> list[dict]   (6 tiers)
    decide_tier(existing, env_choice, is_tty)  -> str          (skip|use-default|prompt)
    tier_to_config(tier)                       -> dict         ({cloud_agent,...})
    merge_tier_into_config(cfg, tier)          -> dict         (cost_tier + keys merged)
    resolve_config_path()                      -> Path         (MINSKY_CONFIG|state-dir)
    read_config(path)                          -> dict
    write_config(path, cfg)                    -> None

CLI (used by bin/minsky-init):
    python3 scripts/cost_tier_picker.py --decide            # print skip|use-default|prompt
    python3 scripts/cost_tier_picker.py --apply <tier>      # merge tier into config, write, print summary
    python3 scripts/cost_tier_picker.py --summary           # print one-line current-tier summary
    python3 scripts/cost_tier_picker.py --menu              # print the human-readable tier menu

Env:
    MINSKY_COST_TIER   — non-interactive tier choice (1..6); honored for tests / launchd / SSH / CI.
    MINSKY_CONFIG      — explicit config path (highest precedence).
    MINSKY_STATE_DIR   — state dir; config is <state-dir>/config.json (default ~/.minsky).

Exit codes:
    0  — decided / applied / summarized.
    2  — bad CLI args, or an out-of-range tier.

Anchor: Krug *Don't Make Me Think* 2014 (progressive disclosure — show the
        price at the decision point, not buried in docs); Nielsen *Usability
        Engineering* 1993 (visibility of system status); rule #1 (a pure
        decision helper, not a reinvented startup flow); rule #11 (sensible
        default — tier 2 is the default when non-interactive).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

# --- Tier table (single source of truth) ---------------------------------
#
# Six tiers, brain (cloud_agent + model) + workers (local_agent). The
# `est_usd_per_hr` is a coarse upper-bound expectation shown at setup — it
# is a transparency signal, not a billing guarantee (the real cost depends
# on iteration cadence + token volume, which `dynamic_timeout.py` governs).
# Order is most-expensive → cheapest so the menu reads as a price ladder;
# tier 2 (Opus brain + Sonnet workers) is the default — the balance point
# the operator picks 90% of the time.

DEFAULT_TIER = 2

_TIERS: list[dict[str, Any]] = [
    {
        "tier": 1,
        "name": "Opus + Opus",
        "cloud_agent": "claude",
        "cloud_agent_model": "claude-opus-4-8",
        "local_agent": "claude",
        "est_usd_per_hr": "$18–30",
        "blurb": "Max quality both lanes — Opus brain, Opus workers. Hardest tasks.",
    },
    {
        "tier": 2,
        "name": "Opus + Sonnet",
        "cloud_agent": "claude",
        "cloud_agent_model": "claude-opus-4-8",
        "local_agent": "claude",
        "est_usd_per_hr": "$8–15",
        "blurb": "Default — Opus brain plans, Sonnet workers execute. Best value.",
    },
    {
        "tier": 3,
        "name": "Sonnet + Sonnet",
        "cloud_agent": "claude",
        "cloud_agent_model": "claude-sonnet-4-6",
        "local_agent": "claude",
        "est_usd_per_hr": "$4–8",
        "blurb": "Sonnet both lanes — cheaper, still cloud-quality.",
    },
    {
        "tier": 4,
        "name": "Sonnet + local",
        "cloud_agent": "claude",
        "cloud_agent_model": "claude-sonnet-4-6",
        "local_agent": "aider",
        "est_usd_per_hr": "$2–5",
        "blurb": "Sonnet brain, local workers (aider + ollama). Cloud only for planning.",
    },
    {
        "tier": 5,
        "name": "local + local",
        "cloud_agent": "claude",
        "cloud_agent_model": "claude-sonnet-4-6",
        "local_agent": "aider",
        "est_usd_per_hr": "$0",
        "blurb": "Fully local (aider + ollama). Zero cloud tokens — run minsky --local.",
    },
    {
        "tier": 6,
        "name": "Windsurf + Devin",
        "cloud_agent": "devin",
        "cloud_agent_model": "claude-opus-4-8-max",
        "local_agent": "aider",
        "est_usd_per_hr": "$20+ flat",
        "blurb": "Devin brain (flat-rate seat), local workers. For Devin/Windsurf seats.",
    },
]

_TIER_BY_ID = {t["tier"]: t for t in _TIERS}

# Keys this picker owns in config.json. cost_tier is the marker; the three
# agent keys are derived from the tier. We never touch default_host or any
# other key (rule: non-destructive merge — bin/minsky init owns default_host).
_TIER_CONFIG_KEYS = ("cloud_agent", "cloud_agent_model", "local_agent")


# --- Pure functions ------------------------------------------------------


def tier_definitions() -> list[dict[str, Any]]:
    """Return the 6 tier definitions (deep copy — callers may not mutate)."""
    return [dict(t) for t in _TIERS]


def is_valid_tier(tier: Any) -> bool:
    """True iff `tier` (int or integer-valued str) names one of the 6 tiers.

    Floats and non-integer strings ("2.5", "abc") are rejected — a tier id
    is a whole number, never a coerced fraction (int(2.5) == 2 would be a
    silent footgun).
    """
    if isinstance(tier, bool):
        return False
    if isinstance(tier, int):
        return tier in _TIER_BY_ID
    if isinstance(tier, str):
        s = tier.strip()
        if not (s.isdigit() or (s.startswith("-") and s[1:].isdigit())):
            return False
        return int(s) in _TIER_BY_ID
    return False


def decide_tier(existing_cost_tier: Any, env_choice: Any, is_tty: bool) -> str:
    """Decide what bin/minsky-init should do about the cost tier.

    Returns one of:
        "skip"        — config already carries a cost_tier; do nothing, do
                        NOT re-prompt (idempotency — the first-run promise).
        "use-default" — no existing tier AND (an env override is set OR we
                        are not interactive). The caller applies the env
                        choice if valid, else DEFAULT_TIER. This is the
                        rule-#11 sensible default + the Pivot path (a non-
                        interactive trip never blocks on a TTY prompt).
        "prompt"      — no existing tier, no env override, interactive TTY:
                        present the menu and read the operator's choice.

    Precedence rationale (Pivot of the task): an existing cost_tier always
    wins (never re-ask); a valid env choice short-circuits the prompt so
    launchd/SSH/CI runs are deterministic; only a genuine interactive TTY
    with nothing pre-decided reaches the prompt branch.
    """
    if is_valid_tier(existing_cost_tier):
        return "skip"
    if is_valid_tier(env_choice):
        return "use-default"
    if not is_tty:
        return "use-default"
    return "prompt"


def tier_to_config(tier: Any) -> dict[str, str]:
    """Map a tier id to its `{cloud_agent, cloud_agent_model, local_agent}`.

    Raises ValueError for an unknown tier — the caller validates first via
    is_valid_tier / decide_tier, so reaching here with garbage is a bug.
    """
    if not is_valid_tier(tier):
        raise ValueError(f"unknown cost tier: {tier!r} (expected 1..{len(_TIERS)})")
    t = _TIER_BY_ID[int(tier)]
    return {k: t[k] for k in _TIER_CONFIG_KEYS}


def merge_tier_into_config(cfg: dict[str, Any], tier: Any) -> dict[str, Any]:
    """Return a new config dict with cost_tier + the tier's agent keys merged.

    Non-destructive: every key NOT owned by the picker (e.g. default_host,
    local_agent_model, ollama_base_url) is preserved untouched. The returned
    dict is a fresh copy — the input is not mutated (referential safety so
    callers can diff before/after).
    """
    out = dict(cfg)
    out["cost_tier"] = int(tier)
    out.update(tier_to_config(tier))
    return out


def summarize_config(cfg: dict[str, Any]) -> str:
    """One-line human summary of the current tier (for the no-reprompt path)."""
    tier = cfg.get("cost_tier")
    if is_valid_tier(tier):
        t = _TIER_BY_ID[int(tier)]
        return (
            f"cost_tier {t['tier']} ({t['name']}, ~{t['est_usd_per_hr']}/hr): "
            f"cloud_agent={cfg.get('cloud_agent')} "
            f"model={cfg.get('cloud_agent_model')} "
            f"local_agent={cfg.get('local_agent')}"
        )
    return "cost_tier: not set"


def render_menu() -> str:
    """Render the human-readable tier menu (shown before an interactive prompt)."""
    lines = ["Choose a brain+workers cost tier (sets cloud_agent + model + local_agent):", ""]
    for t in _TIERS:
        default_mark = "  [default]" if t["tier"] == DEFAULT_TIER else ""
        lines.append(f"  {t['tier']}) {t['name']:<16} ~{t['est_usd_per_hr']:<10}/hr{default_mark}")
        lines.append(f"       {t['blurb']}")
    lines.append("")
    lines.append(f"Pick 1-{len(_TIERS)} (Enter = {DEFAULT_TIER}): ")
    return "\n".join(lines)


# --- Config-path resolution + I/O ----------------------------------------


def resolve_config_path() -> Path:
    """Resolve the config.json path.

    Precedence (highest first):
        1. MINSKY_CONFIG          — explicit override (tests / non-default homes)
        2. $MINSKY_STATE_DIR/config.json
        3. ~/.minsky/config.json
    Mirrors bin/minsky's own resolution so the picker and the daemon never
    disagree about which file is canonical.
    """
    explicit = os.environ.get("MINSKY_CONFIG")
    if explicit:
        return Path(explicit)
    state_dir = os.environ.get("MINSKY_STATE_DIR")
    if state_dir:
        return Path(state_dir) / "config.json"
    return Path.home() / ".minsky" / "config.json"


def read_config(path: Path) -> dict[str, Any]:
    """Read config.json; return {} for a missing or unreadable/empty file.

    rule #6 (let it crash) does NOT apply here: a missing config is the
    EXPECTED fresh-machine state, not an error — return an empty dict so
    the caller can merge into it and create the file.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, FileNotFoundError):
        return {}
    text = text.strip()
    if not text:
        return {}
    try:
        loaded = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def write_config(path: Path, cfg: dict[str, Any]) -> None:
    """Write config.json (2-space indent, trailing newline). Creates parents."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")


def env_choice() -> Any:
    """The MINSKY_COST_TIER env value (or None)."""
    return os.environ.get("MINSKY_COST_TIER")


# --- CLI -----------------------------------------------------------------


def _cmd_decide() -> int:
    """Print the decision verb for the current config + env + tty state."""
    cfg = read_config(resolve_config_path())
    decision = decide_tier(cfg.get("cost_tier"), env_choice(), sys.stdin.isatty())
    print(decision)
    return 0


def _cmd_apply(tier_arg: str) -> int:
    """Merge `tier_arg` into config, write it, print the summary."""
    if not is_valid_tier(tier_arg):
        print(f"cost_tier_picker: invalid tier {tier_arg!r} (expected 1..{len(_TIERS)})", file=sys.stderr)
        return 2
    path = resolve_config_path()
    merged = merge_tier_into_config(read_config(path), tier_arg)
    write_config(path, merged)
    print(summarize_config(merged))
    return 0


def _cmd_summary() -> int:
    """Print the one-line summary of the current config's tier."""
    print(summarize_config(read_config(resolve_config_path())))
    return 0


def _cmd_menu() -> int:
    """Print the tier menu (no trailing newline coercion beyond render_menu)."""
    print(render_menu())
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.split("\n\n")[0] if __doc__ else "cost_tier_picker", file=sys.stderr)
        print("usage: cost_tier_picker.py --decide|--apply <tier>|--summary|--menu", file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd == "--decide":
        return _cmd_decide()
    if cmd == "--apply":
        if len(argv) != 3:
            print("usage: cost_tier_picker.py --apply <tier>", file=sys.stderr)
            return 2
        return _cmd_apply(argv[2])
    if cmd == "--summary":
        return _cmd_summary()
    if cmd == "--menu":
        return _cmd_menu()
    print(f"cost_tier_picker: unknown command {cmd!r}", file=sys.stderr)
    print("usage: cost_tier_picker.py --decide|--apply <tier>|--summary|--menu", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
