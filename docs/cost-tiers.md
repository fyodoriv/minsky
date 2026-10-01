# Cost tiers

This file exists so a new operator can see — before the first iteration —
what each brain+workers model combination is expected to cost. On a fresh
machine `~/.minsky/config.json` has no `cost_tier`, and historically the
operator hand-edited that JSON blind. `bin/minsky-init` now presents these
six tiers at setup (with $/hr expectations), persists the choice as
`cost_tier`, and never asks again. Upfront cost transparency at the decision
point is the trust differentiator: Devin charges $500/mo flat, OpenHands and
SWE-agent give no estimate, Aider shows token counts only post-hoc.

The decision logic and config merge live in `scripts/cost_tier_picker.py`
(a pure, unit-tested helper); `bin/minsky-init` wires the TTY prompt around
it. See `tests/test_cost_tier_picker.py` for the behavior contract.

## The six tiers

The `$/hr` column is a coarse upper-bound expectation, not a billing
guarantee — real cost depends on iteration cadence and token volume (which
`scripts/dynamic_timeout.py` governs). Tiers are listed most-expensive
first so the menu reads as a price ladder.

| Tier | Name | cloud_agent | cloud_agent_model | local_agent | Est. $/hr | When to pick |
|------|------|-------------|-------------------|-------------|-----------|--------------|
| 1 | Opus + Opus | `claude` | `claude-opus-4-8` | `claude` | $18–30 | Max quality both lanes — hardest tasks. |
| 2 | Opus + Sonnet (default) | `claude` | `claude-opus-4-8` | `claude` | $8–15 | Opus brain plans, Sonnet workers execute. Best value. |
| 3 | Sonnet + Sonnet | `claude` | `claude-sonnet-4-5` | `claude` | $4–8 | Sonnet both lanes — cheaper, still cloud-quality. |
| 4 | Sonnet + local | `claude` | `claude-sonnet-4-5` | `aider` | $2–5 | Sonnet brain, local workers (aider + ollama). |
| 5 | local + local | `claude` | `claude-sonnet-4-5` | `aider` | $0 | Fully local — zero cloud tokens. Run `minsky --local`. |
| 6 | Windsurf + Devin | `devin` | `claude-opus-4-8-max` | `aider` | $20+ flat | Devin brain (flat-rate seat), local workers. |

Tier 2 is the default — the balance point most operators want. Pressing
Enter at the prompt, or running non-interactively (launchd, SSH, CI),
selects it unless `MINSKY_COST_TIER` overrides.

## How the choice is made

`bin/minsky-init` calls the picker's `--decide` command, which returns one
of three verbs:

- `skip` — the config already carries a valid `cost_tier`; the picker
  prints a one-line summary and does NOT re-prompt (the first-run promise).
- `use-default` — no existing tier AND either `MINSKY_COST_TIER` is set or
  the run is non-interactive (no TTY). The caller applies the env choice if
  valid, else tier 2. This is the Pivot path: a non-interactive run never
  blocks on a prompt.
- `prompt` — no existing tier, no env override, interactive TTY: the menu
  is shown and the operator's choice is read.

Precedence: an existing `cost_tier` always wins (never re-ask); a valid
`MINSKY_COST_TIER` short-circuits the prompt so launchd/SSH/CI runs are
deterministic; only a genuine interactive TTY with nothing pre-decided
reaches the prompt branch.

## Non-interactive selection

Set `MINSKY_COST_TIER` to pick a tier without a prompt — used by tests,
launchd units, SSH sessions, and CI:

```bash
MINSKY_COST_TIER=2 bin/minsky-init --skip-install
```

This writes `cost_tier` plus the matching `cloud_agent`,
`cloud_agent_model`, and `local_agent` keys into the resolved config file.
A second run prints the summary and does not re-prompt.

## Config path resolution

The picker writes to the same file `bin/minsky` reads, resolved in this
order (highest first):

1. `MINSKY_CONFIG` — explicit path override.
2. `$MINSKY_STATE_DIR/config.json`.
3. `~/.minsky/config.json` (the default).

The merge is non-destructive: only `cost_tier` and the three agent keys are
written; `default_host`, `local_agent_model`, `ollama_base_url`, and any
other key are preserved untouched.

## Changing tiers later

Re-running `bin/minsky-init` will NOT re-prompt once `cost_tier` is set.
To switch tiers, either edit `cost_tier` (and the three agent keys) in the
config directly, or re-apply via the picker:

```bash
python3 scripts/cost_tier_picker.py --apply 3
```

For a one-session override without touching the persisted config, set the
agent env vars `bin/minsky` already honors (for example
`MINSKY_CLOUD_AGENT=claude minsky ...`) — see `AGENTS.md` § "Per-machine
agent config".
