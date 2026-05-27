# Research: Agent hooks vs AGENTS.md rules — a Minsky-shaped reorganization

> **Status**: research document — read once, decide, act, then archive.
> **Date**: 2026-05-27
> **Author**: agent session, requested by operator (`@user`).
>
> **Anchors**:
>
> - Sitnik 2026, "Stop writing rules in AGENTS.md: use agent hooks and nano-staged instead", Evil Martians Chronicles, 2026-05-26.
> - Anthropic 2026, "Automate workflows with hooks" + "Hooks reference", `code.claude.com/docs/en/hooks{-guide}`.
> - Johnson 2026, "AGENTS.md is Not a Junk Drawer", DEV Community, 2026-05-27.
> - Patel 2026, "Claude Code Hooks vs Skills: When to Use Which", DEV Community, 2026-05-27.
> - Tuszynski 2026, "The Five Hooks That Change How You Ship With Claude Code", DEV Community.
> - OpenAI 2026, "Hooks", `developers.openai.com/codex/hooks`.
> - Minsky `vision.md` rule #10 "Deterministic enforcement", rule #12 "Proactive healing", `AGENTS.md`, `lefthook.yml`.
> - usmanyunusov/nano-staged + es-tooling/module-replacements#214 — maintenance debate.

## TL;DR (read this first)

The Evil Martians thesis — **"every rule you can encode as a tool is a rule the LLM can't forget"** — is correct, and it is the same idea Minsky already canonised as constitutional rule #10. The article gives you almost no new information at the *principle* level.

Where it gives you new information is the *mechanism*: **Claude Code's `Stop` hook with exit code 2 makes the agent's own session a deterministic-enforcement substrate, not just CI**. Minsky has 50+ deterministic checks (`scripts/check-*.mjs`) that fire at commit/push/CI time. They do not fire inside the agent's loop. That is a missing tier.

**Honest critique** of the article:

| Claim | Verdict |
|---|---|
| "Hooks > rules in AGENTS.md" | **Strong, correct, applies to Minsky.** |
| "nano-staged over lint-staged" | **Weak — irrelevant to Minsky** (already uses lefthook). The author works at Evil Martians, which authors lefthook AND happens to recommend nano-staged for JS-only projects. nano-staged itself has open security issues, slow maintenance, and the supply-chain argument cuts both ways. |
| "oxlint/oxfmt 5–10× faster than ESLint/Prettier" | **Half-true.** Real, but Minsky already uses Biome, which sits in the same speed class. No move needed. |
| "Wrap nano-staged in a `stop_hook_active` check for unsupervised loops" | **Important** — Minsky's tick-loop is the canonical unsupervised loop. Without this guard, an agent that can't fix a lint will burn budget infinitely. |

**Concrete recommendation in one paragraph.** Adopt Claude Code hooks at three scopes — user-global (already done by you), Minsky project (missing), and per-worktree daemon (new). Don't adopt nano-staged. Keep lefthook. Layer the agent-hook tier *under* the lefthook tier so the agent fails fast in its own loop, lefthook fails fast at commit, CI fails fast at PR. Three layers, same scripts (`scripts/check-*.mjs`) reused, no duplication. Then **prune** AGENTS.md by ≥40% by deleting rules whose enforcement now lives in a hook. The remaining AGENTS.md becomes the small, curated, judgment-only layer — exactly what Johnson 2026 ("not a junk drawer") prescribes.

The rest of this document defends every line of that paragraph.

---

## 1. What the Evil Martians article actually says

Compressed to the essential claims:

1. **Rules in AGENTS.md are forgotten.** LLMs probabilistically attend to context; deterministic shell hooks do not. Moving rule enforcement out of prose into code is monotonically a win on three axes: token cost, reliability, and feedback-loop tightness.
2. **The hook surface is more leverage than the rule surface.** Specifically, Claude Code's `Stop` hook with `exit 2` blocks the agent from finishing the turn and feeds stderr back as the next instruction. This converts "I hope the agent runs the linter" into "the agent cannot terminate the turn until the linter is green".
3. **Pre-commit managers (nano-staged / lefthook) belong in the same hook surface**, not only on `git commit`. The pre-commit substrate is reusable as the agent's lint-on-stop substrate.
4. **Tool speed compounds.** A 30s hook × 12 hooks per session × N engineers = real wall-clock and real psychology. Faster linters (oxlint, oxfmt, Biome) widen the moat.
5. **Wrap for unsupervised use.** Without a `stop_hook_active` guard, an agent that cannot resolve a lint enters an infinite exit-2 → retry → exit-2 loop.

These five claims are individually defensible. The article packages them with a promo for `nano-staged` (Evil Martians authors lefthook; nano-staged is a third-party project they cite); that recommendation deserves separate scrutiny — see §4.

## 2. The Claude Code hook surface, accurately

The article uses one event (`Stop`) and one hook type (`type: command`). The actual 2026-05 surface is *much* wider, and most of it is more important to Minsky than `Stop` is.

### 2.1 Event lifecycle (lifted from Anthropic's reference)

Three cadences:

- **Once per session**: `SessionStart`, `Setup`, `SessionEnd`, `InstructionsLoaded` (new — fires when `CLAUDE.md` or `.claude/rules/*.md` loads), `PreCompact`, `PostCompact`.
- **Once per turn**: `UserPromptSubmit`, `UserPromptExpansion`, `Stop`, `StopFailure`, `TeammateIdle`.
- **Per tool call**: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PermissionDenied`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`.
- **Side-channel async**: `FileChanged`, `CwdChanged`, `WorktreeCreate`, `WorktreeRemove`, `ConfigChange`, `Notification`, `Elicitation`.

### 2.2 Hook types (the article uses one of five)

| Type | What it is | Cost | Best Minsky use |
|---|---|---|---|
| `command` | Shell command, stdin = JSON, exit 2 = block | $0, fast | Lint/format/typecheck the just-edited file (PostToolUse); deterministic gate the agent's `Stop` |
| `http` | POST to a URL | Network latency | Forward to a centralised governance bus (would be ideal for Minsky's tick-loop telemetry but not P0) |
| `mcp_tool` | Call an MCP tool | MCP-server-dependent | Reach existing MCP servers without re-wiring |
| `prompt` | Send the hook input + your prompt to Haiku, returns `{ok, reason}` | ~$0.001/call | "Should this turn really stop?" judgment when no deterministic check is possible |
| `agent` | Spawn a full subagent (up to 50 turns) with tools | Significant Haiku/Sonnet cost | Last-resort semantic verification (e.g. "does the new code violate scope discipline?") |

The article does not even mention `prompt` or `agent` hooks. Those are the deeper leverage — they let you put **LLM-as-advisory-judge** *inside* the agent's own loop, which is the missing half of Minsky vision rule #10's "LLM-driven checks are advisory only".

### 2.3 The exit-code-2 contract (the load-bearing mechanism)

For most events, `exit 2` blocks the action and Claude is shown `stderr` as the reason. The list of events where exit-2 actually blocks (from the reference):

- `PreToolUse` → tool call denied, agent retries.
- `PostToolUse` → agent's next turn ingests the stderr.
- `Stop` / `SubagentStop` → turn cannot end, agent must continue with stderr as instruction.
- `UserPromptSubmit` / `UserPromptExpansion` → prompt blocked, user sees stderr.

This is the entire mechanism by which "rule = script" works at the agent layer. Internalise it.

### 2.4 `InstructionsLoaded` — the dark-horse event

Shipped in `claude-code` v2.1.64. Fires when `CLAUDE.md` / `.claude/rules/*.md` loads. *Does not currently support decision control or context injection* (per Anthropic issue #30897), but it does support observability. Right now it lets you **measure** which of your AGENTS.md rules actually get loaded into context — which is the ground truth for the deletion question Johnson 2026 prescribes ("if I deleted this line, would the agent behave differently?"). If Anthropic ships the proposed `additionalContext` support in #30897, this event becomes the right place to **conditionally inject** the small judgment-only rules Minsky still keeps in prose.

### 2.5 `WorktreeCreate` / `WorktreeRemove` — Minsky-specific leverage

Minsky's daemon spawns a worktree per task and tears it down when the iteration finishes. Right now the worktree-lifecycle observability lives in OTEL spans inside `novel/cross-repo-runner`. With `WorktreeCreate` Claude Code itself emits the event — meaning **every Claude session run inside a Minsky worktree can install per-worktree hooks that the daemon does not have to deploy**. This is the cleanest possible split of concerns: daemon owns the supervisor loop, Claude session owns the in-session enforcement.

## 3. Honest critique of the article

### 3.1 What the article gets right

- **Migration direction.** Rules → tools is monotonically correct. There is no scenario where "the agent reads the rule" beats "the script fires on every action that would violate the rule", *if* the rule is mechanisable.
- **Speed compounds.** Especially in a worker-per-worktree loop like Minsky's. A 30s pre-commit × 144 ticks/day × 6 worktrees = ~7 hours of waiting per day per host. Cutting hook cost by 5× recovers 5+ wall-clock hours/day for actual model work.
- **Wrap for unsupervised use.** Mandatory. The `stop_hook_active` guard is the difference between "tight feedback loop" and "infinite token burn".

### 3.2 What the article overstates

- **The novelty.** "Use scripts instead of docs" is Beck 1999 (Extreme Programming, "code is the documentation"); Fowler 2003 (continuous integration); Humble & Farley 2010 (Continuous Delivery). The article packages this as a 2026 LLM insight, but it's the same insight wearing a new hat. Minsky's vision.md rule #10 already enshrines it. Recognising the article as "old wisdom, new substrate" is more useful than treating it as a revelation.
- **The single-tool framing.** The article picks one event (`Stop`) and acts as though it's the lever. `PreToolUse` (block dangerous edits *before* they land) and `PostToolUse` (lint *every* file after every write, instead of waiting for the turn to end) are stronger leverage in most setups.

### 3.3 What the article gets wrong (or at least debatable)

- **nano-staged recommendation.** This is the weakest part of the article. Three honest signals:
  1. `nano-staged` has open security issues from months ago (es-tooling/module-replacements #214) and slow maintainer responsiveness.
  2. `lint-staged` has 24 dependencies — but the e18e community thread argues this isn't enough to justify recommending a less-maintained alternative.
  3. **For Minsky specifically the comparison is irrelevant** — Minsky already uses `lefthook` (the Go-binary pre-commit manager that the *same Evil Martians* maintain). lefthook has 0 npm runtime deps because it's a Go binary, and is the explicit recommendation in the article for "non-JS projects". Minsky is a TypeScript project that already chose lefthook. Stay there.
- **"oxlint/oxfmt 5–10× faster than ESLint/Prettier".** True in absolute terms, but Minsky uses Biome which is in the same speed class. There's no win to capture by adopting oxlint over Biome.
- **The article assumes a single repo.** It does not address: cross-repo enforcement, machine-global rules, fleet-wide agent governance, or unsupervised daemon loops. All four are core Minsky concerns.

### 3.4 What the article omits

- `prompt` and `agent` hook types (LLM-as-advisory-judge layer).
- `InstructionsLoaded` event (the audit surface for the deletion question).
- `WorktreeCreate` event (cleanest split of supervisor vs in-session enforcement).
- The cross-agent portability question — Codex hooks, OpenCode plugins, Cursor rules, Windsurf rules all use *different* schemas. A single source of truth that compiles to N agent-specific hook configs is a real engineering problem the article doesn't acknowledge. (See `iamfakeguru/agent-md` and `agentic-thinking/hookbus-publisher-codex` for prior art.)
- The deletion discipline. Adding hooks without pruning rules just adds a second junk drawer. Johnson 2026 is the missing companion piece.

## 4. The Minsky reality check

### 4.1 What Minsky already has

| Surface | Already present | Scope |
|---|---|---|
| User-global Claude hooks | `~/.claude/settings.json` — PostToolUse runs `biome check` on edited file; Stop appends to session-log; SessionStart loads project context | Every session, every repo |
| Git pre-commit | `lefthook.yml` — `toolchain` → `scan-secrets` → `biome` → `typecheck` → `vitest related` | Every commit |
| Git pre-push | `lefthook.yml` — `pnpm pre-pr-lint --stage=fast` | Every push |
| Deterministic CI | 50+ `scripts/check-*.mjs`, of which 17+ are `check-rule-N-*.mjs` matching vision.md rules | Every PR |
| Local pre-merge | `scripts/local-gate-merge.mjs` runs `--stage=full` in `git clone --shared` scratch | Every merge to main |
| Constitution | `vision.md` 17 rules, `AGENTS.md` 462 lines | Every agent, every session |

### 4.2 What's missing — the gap the article exposes

| Surface | Status |
|---|---|
| **Minsky project Claude hooks** (`./.claude/settings.json`) | **Absent.** Only `.claude/skills/` and `.claude/worktrees/` exist. None of the 50+ deterministic checks fire in the agent's own session — only at commit/push/CI. |
| **Per-worktree hooks** for Minsky's tick-loop workers | **Absent.** Workers run with the user-global settings.json, not a Minsky-aware one. |
| **AGENTS.md pruning** to mirror the move-rules-to-hooks shift | **Absent.** AGENTS.md is 462 lines + vision.md is 822 lines; growth is monotonic. |
| **Cross-agent hook schema** (Claude / Codex / OpenCode / Devin) | **Partial.** `agentbrew` syncs skills/MCP/rules; does NOT yet sync hooks. |

The gap is one tier deep: **the agent's own loop is not running Minsky's deterministic checks**. Every rule-N script runs at commit/push/CI — which is fine for catching violations before they ship, but means an agent in an unsupervised loop discovers the violation 30–120 seconds AFTER committing, not in the same edit operation. That's an order-of-magnitude latency multiplier on the agent's iteration speed.

### 4.3 Quantifying the gap

A representative iteration today:

```text
agent edits file              0.5s
agent runs tests              ~10s
agent commits                 0.5s
lefthook fires                ~8s  (toolchain + biome + typecheck + vitest related)
[FAILURE HERE — back to step 1]
```

With agent hooks in place:

```text
agent edits file              0.5s
PostToolUse fires (biome on JUST THAT FILE)  ~0.2s
[FAILURE FED BACK IMMEDIATELY]
agent fixes                   2s
PostToolUse passes            0.2s
agent commits                 0.5s
lefthook re-runs everything   ~8s
```

The win isn't the 8s pre-commit savings (that's still spent). The win is the **first failure** is caught at 0.7s instead of 19s — a 27× tighter loop on the most common case (single-file edits). Across a tick-loop iteration with 5–10 edits, this compounds to multi-minute wall-clock saves per iteration.

## 5. Concrete reorganisation proposal

### 5.1 Architecture — three enforcement tiers, one script library

```text
┌──────────────────────────────────────────────────────────────────┐
│ TIER 1 — Agent loop (NEW)                                        │
│ .claude/settings.json hooks: PostToolUse, Stop, PreToolUse       │
│ Fires every edit / tool call / turn end                          │
│ Calls scripts/check-*.mjs subsets at single-file scope           │
│ Latency budget: <500ms per hook                                  │
└──────────────────────────────────────────────────────────────────┘
                              │ identical scripts ↓
┌──────────────────────────────────────────────────────────────────┐
│ TIER 2 — Local gate (EXISTING, mostly unchanged)                 │
│ lefthook.yml pre-commit + pre-push                                │
│ Fires on git commit / push                                       │
│ Calls scripts/run-pre-pr-lint-stack.mjs --stage=fast              │
│ Latency budget: ≤7s (already enforced by P1 task)                 │
└──────────────────────────────────────────────────────────────────┘
                              │ identical scripts ↓
┌──────────────────────────────────────────────────────────────────┐
│ TIER 3 — CI gate (EXISTING, unchanged)                            │
│ .github/workflows/ci.yml + local-gate-merge.mjs                   │
│ Fires on PR open / push to branch                                 │
│ Calls scripts/run-pre-pr-lint-stack.mjs --stage=full              │
│ Latency budget: ~5min (CI standard)                               │
└──────────────────────────────────────────────────────────────────┘
```

**Single source of truth**: the `scripts/check-*.mjs` library. Tier 1 calls subsets at file scope; tiers 2/3 call them at repo scope. Zero script duplication. This is the only reorg shape that respects vision.md rule #1 ("don't reinvent the wheel") and rule #2 ("every dependency through an interface" — the interface here is the script's stdin/stdout contract).

### 5.2 Which checks belong in which tier

Heuristic: **the tighter the tier, the smaller the scope**. The same check can run in all three tiers at different scopes.

| Check | Tier 1 (per edit) | Tier 2 (per commit) | Tier 3 (per PR) |
|---|---|---|---|
| `biome check` | ✅ single file | ✅ staged | ✅ all |
| `tsc -b` | ❌ too slow (3–8s) | ✅ project | ✅ project |
| `vitest related` | ❌ too slow | ✅ related to staged | — |
| `vitest` (full) | ❌ | ❌ | ✅ |
| `scan-secrets` | ✅ on PreToolUse Write | ✅ staged | ✅ all |
| `check-rule-2-dep-coverage` | ❌ needs diff | ✅ diff vs main | ✅ diff vs main |
| `check-rule-3-doc-first` | ❌ needs diff | ✅ diff vs main | ✅ diff vs main |
| `check-rule-6-let-it-crash` | ✅ on PostToolUse for `.ts` | ✅ diff | ✅ diff |
| `check-rule-9-tasksmd-fields` | ✅ on PostToolUse if `TASKS.md` edited | ✅ staged | ✅ all |
| `check-rule-12-scope-discipline` | ❌ needs git status | ✅ session | ✅ PR |
| `check-rule-13-sibling-anchors` | ✅ on PostToolUse for `.md` | ✅ diff | ✅ diff |
| `check-rule-17-proactive-heal` | ❌ needs PR body | ❌ | ✅ PR body |
| `check-no-hardcoded-user-paths` | ✅ on PostToolUse | ✅ staged | ✅ diff |
| `check-orphan-tests` | ❌ | ✅ staged | ✅ all |
| `check-otel-no-pii` | ✅ on PostToolUse for `*.ts` | ✅ staged | ✅ all |
| `check-pr-self-grade` | ❌ no PR yet | ❌ | ✅ PR body |
| `check-pr-security-review` | ❌ no PR yet | ❌ | ✅ PR body |

**~12 of the existing 50+ checks become Tier-1 candidates** — meaningful but bounded. The bulk stays at Tier 2/3 because they require diff context or are too slow per-edit.

### 5.3 The `.claude/settings.json` for Minsky (concrete)

```jsonc
{
  // Project-scoped settings — agent loop tier (Tier 1).
  // Pattern: PostToolUse on Write|Edit fans out to a single dispatch script
  // that picks the right per-file linter based on extension. Single hook
  // entry, single script dispatch — minimises hook startup overhead.
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/post-edit.sh",
          "timeout": 10
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-dangerous-bash.sh"
        }]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          // Reuses the existing secret scanner — DIFFERENT scope (the proposed
          // write, not committed files) — same script, same regex set.
          "command": "node ${CLAUDE_PROJECT_DIR}/scripts/scan-secrets.mjs --stdin-content"
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-gate.sh"
        }]
      }
    ],
    "SessionStart": [
      {
        // Already-existing pattern from user-global settings — inject
        // Minsky-specific context (current TASKS.md head, recent CHANGELOG,
        // active worktree task brief).
        "hooks": [{
          "type": "command",
          "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/session-context.sh",
          "timeout": 5
        }]
      }
    ]
  }
}
```

Where `post-edit.sh` dispatches to the right per-file lint subset (Biome on `*.ts`, markdownlint on `*.md`, JSON-shape check on `experiments/*.yaml`, etc.) and `stop-gate.sh` runs the Tier-1 subset of `run-pre-pr-lint-stack.mjs` with `--stage=stop-gate` (a new stage flag).

Critically: `stop-gate.sh` MUST include the `stop_hook_active` guard from the article. Sketch:

```bash
#!/usr/bin/env bash
# .claude/hooks/stop-gate.sh
# Enforces the daemon-pre-pr-lint-gate subset on every Stop.
# Uses `stop_hook_active` to avoid infinite retry loops in unsupervised mode.
set -eu
INPUT=$(cat)
ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

if [ "$ACTIVE" = "true" ]; then
  # Already in a forced-continuation loop — run advisory only, never block.
  node "${CLAUDE_PROJECT_DIR}/scripts/run-pre-pr-lint-stack.mjs" --stage=stop-gate --json || true
  exit 0
fi

# First-pass: actually block on failure.
if ! node "${CLAUDE_PROJECT_DIR}/scripts/run-pre-pr-lint-stack.mjs" --stage=stop-gate --json 1>&2; then
  exit 2  # blocks Stop, feeds stderr back to Claude
fi
exit 0
```

### 5.4 Cross-agent portability (machine-wide)

`agentbrew` already syncs skills + MCP + rules across Claude / Codex / Cursor / Windsurf / OpenCode. **Hooks should be the fifth axis.** Codex's hook schema is close-but-different (per `developers.openai.com/codex/hooks` and `openai/codex#19949`). The mapping is:

| Claude event | Codex equivalent | OpenCode equivalent |
|---|---|---|
| `PostToolUse` | `PostToolUse` | plugin `onToolResult` |
| `PreToolUse` | `PreToolUse` | plugin `onToolRequest` |
| `Stop` | `Stop` | plugin `onTurnEnd` |
| `SessionStart` | `SessionStart` | plugin `onSessionStart` |
| `InstructionsLoaded` | — | — |
| `WorktreeCreate` | — (root config shared per `openai/codex#21969`) | — |

A new `Agentfile.yaml` block — `hooks:` — could declare the events + commands once and `agentbrew sync` could generate `.claude/settings.json`, `.codex/hooks.json`, OpenCode plugin manifest. This is the agentbrew-shaped extension of the article's mechanism. **Don't write a fleet-wide hook bus before this primitive exists** — that's a step-4 ("absorb") move from the agentbrew "GET, don't IMPLEMENT" rule. File this as a TASKS.md entry, not as week-1 work.

### 5.5 AGENTS.md pruning — the deletion discipline

Once Tier 1 fires, every rule in AGENTS.md whose enforcement now lives in a hook should be **deleted from AGENTS.md** in the same PR that introduces the hook (vision.md rule #10 ratchet pattern). Concrete pruning candidates from a skim of the 462 lines:

| AGENTS.md section | Move to | Delete from AGENTS.md? |
|---|---|---|
| "Repository setup" prose | Keep — it's reference, not enforcement | No |
| "Identity" + "What Minsky is" | Keep — it's framing | No |
| Constitutional rule #6 prose ("Stay alive") | The `check-rule-6-let-it-crash.mjs` script + PostToolUse hook | **Yes** — keep one-line summary, delete the prose justification |
| Constitutional rule #9 prose ("Pre-registered HDD") | The `check-rule-9-tasksmd-fields.mjs` script + PreToolUse on TASKS.md edits | **Yes** — keep one-line summary, delete the 30-line argument |
| "Iron rule" labels | Keep — they're meta about which rules are non-negotiable | No |
| Per-rule "Source:" citations | Move into the script's top comment | **Yes** — citation belongs next to the enforcing code |
| "Orchestrator discipline" section | Keep — judgment layer, no mechanisation possible | No |
| Per-rule "Conformance: full" boilerplate | Move into the script | **Yes** |

Estimated reduction: ~40% of AGENTS.md lines. The remaining file is the judgment-only layer Johnson 2026 prescribes. Use the deletion question on every line: *if I delete this, does the agent behave differently?* If no, delete. If yes but a hook now enforces the same constraint, delete. If yes and no hook is feasible, keep.

This work is not optional. Adding hooks without pruning AGENTS.md leaves the worst of both worlds — duplicate enforcement (one prose, one script) that can drift apart silently. Vision.md rule #10 already mandates the ratchet pattern; this section just operationalises it.

## 6. What NOT to do

Specific anti-patterns the article doesn't warn you about:

1. **Don't add nano-staged.** You have lefthook. The article's promo doesn't apply when lefthook is already installed. The "0 dependencies" argument is moot when the alternative is a Go binary with 0 npm deps.
2. **Don't move slow checks into PostToolUse.** `tsc -b` takes 3–8s on a warm cache. If it fires after every edit, the agent's per-edit latency triples. Hard line: hooks that fire per tool call must complete in <500ms p95, <2s p99. Anything slower goes to Tier 2.
3. **Don't use `agent`-type hooks for routine enforcement.** Each one is a Sonnet/Haiku call with a 50-turn budget. That's expensive and probabilistic. Use `agent` hooks only for last-resort semantic gates where no deterministic check is possible (e.g. "does this PR description describe what was actually changed?"). Vision rule #10 still applies: advisory only, never load-bearing.
4. **Don't put `stop_hook_active` guards on Tier 2 or Tier 3.** Those are operator-facing gates that humans look at. Only the agent-loop Tier 1 needs the guard.
5. **Don't ship hook scripts that fail silently.** If a hook exits 0 when it meant to exit 2, the rule it enforces becomes invisible. Wrap every hook script in `set -eu` and explicit exit codes. The article's `nano-staged || exit 2` pattern is correct.
6. **Don't duplicate the script library.** Tier 1 must call the exact same `scripts/check-*.mjs` Tier 2 and Tier 3 call. The interface is the script's `--stage=` flag (already a pattern in `run-pre-pr-lint-stack.mjs`). Add `--stage=stop-gate` as a new value, don't write a parallel `.claude/hooks/scripts/` library.
7. **Don't enforce constitutional rules via prompt-type hooks.** Every `prompt`-type hook is a Haiku call — fast but probabilistic. The rules in `vision.md` are explicitly required to be deterministic per rule #10. Prompt hooks are fine for *discovery* ("does this turn need to keep going?") but never for enforcement.
8. **Don't add hooks to `~/.claude/settings.json` that depend on a specific project.** Your global hooks already run biome on every `*.ts` edit in every repo. Minsky-specific hooks belong in `<minsky-repo>/.claude/settings.json`, not in the global file. The article doesn't make this scope distinction; it matters at fleet scale.

## 7. Fleet-wide picture (your "whole machine and all projects" goal)

You have ~10 repos with TASKS.md. Each should declare its own Tier 1 in `<repo>/.claude/settings.json`. The user-global `~/.claude/settings.json` should stay generic (biome on `*.ts`, audit logger, session-log). The split:

| Layer | Lives in | Scope |
|---|---|---|
| **Generic per-file linting** (biome, prettier on stage) | `~/.claude/settings.json` PostToolUse | Every repo, every session |
| **Project-specific rule enforcement** (Minsky's `check-rule-*.mjs`) | `<repo>/.claude/settings.json` PostToolUse + Stop | Per-repo |
| **Cross-repo policies** (TASKS.md format, secret-scan, vision-trace shape) | Generated by `agentbrew sync` into each repo's `.claude/settings.json` | All `agentbrew`-managed repos |
| **Worktree-level overrides** | `<worktree>/.claude/settings.json` written by Minsky's tick-loop on `WorktreeCreate` | Per task iteration |

This is the layered model the article doesn't describe. It's also the model that makes vision.md rule #2 hold ("every dependency through an interface") — the interface between layers is the JSON merge order Claude Code already implements (`user > project > local > plugin`).

## 8. Recommended sequencing — first three weeks

If you take only one thing from this doc, make it this sequence. No new abstractions. Reuse what's there.

### Week 1 — Tier 1 minimum viable (2 days of focused work)

1. Add `scripts/run-pre-pr-lint-stack.mjs --stage=stop-gate` (new flag, subset of `--stage=fast`).
2. Write `.claude/hooks/stop-gate.sh`, `.claude/hooks/post-edit.sh`, `.claude/hooks/block-dangerous-bash.sh`, `.claude/hooks/session-context.sh` (~150 lines total, all dispatch to existing scripts).
3. Write `.claude/settings.json` (~50 lines).
4. Test in a worktree by running an agent task — measure: how many fewer commits land with rule-violating code.
5. Add a deterministic gate (`scripts/check-claude-hooks-installed.mjs`) that asserts `.claude/settings.json` has the expected event keys. This makes the hook installation itself rule-#10-compliant.

### Week 2 — AGENTS.md pruning (1 day)

1. Read `AGENTS.md` and `vision.md` end-to-end.
2. On every line, apply Johnson 2026's deletion question.
3. Delete what's redundant with the new hooks; move citations into the corresponding script's top comment.
4. Target: −40% lines.
5. PR: "docs(agents): prune rules now enforced by Tier 1 hooks".

### Week 3 — Cross-agent portability (filed, not built)

1. Open a TASKS.md task: `agentbrew-hooks-as-fifth-axis` — extend `Agentfile.yaml` schema to declare hooks; sync writes per-agent hook configs.
2. **Do not start building.** This is an "absorb" candidate (step 4 in the GET-don't-IMPLEMENT order). Wait 90 days; check if `agentbrew` upstream ships it; if not, build then.

Out of scope for these three weeks: prompt-type hooks, agent-type hooks, fleet-wide observability bus, HTTP hooks. Those are interesting; they're not where the leverage is right now.

## 9. The honest summary

The Evil Martians article is correct at the principle level (rules → tools), recommends one tactic that doesn't apply to Minsky (nano-staged), and stops short of the deeper Claude Code hook surface. The version of its thesis that actually applies to Minsky is:

> **Move every mechanisable rule from `AGENTS.md` into a hook in `.claude/settings.json` that calls the existing `scripts/check-*.mjs` library. Keep the same scripts; just add a tighter trigger. Prune `AGENTS.md` of every line whose enforcement now lives in a hook. The remaining `AGENTS.md` is the small, judgment-only layer.**

Three weeks of focused work. Zero new abstractions. No nano-staged. No oxlint. No new lint library. Reuses everything you already have. Tightens the agent loop by an order of magnitude on the per-edit case.

If you want a single follow-up question to make this concrete: **which 12 of the 50+ `scripts/check-*.mjs` checks are file-scoped enough to run in PostToolUse?** That's the one piece of judgment work this doc can't do for you without reading every script. Pick those 12, write `.claude/hooks/post-edit.sh` to dispatch to them, and you have Week-1 ship.
