<!-- pattern: not-applicable — ask-human.md documents the adopted ask-human-mcp convention (github.com/masony817/ask-human-mcp); no novel implementation pattern to catalog -->
# ask-human.md — async human-↔-agent comm channel

> Adopted convention: [ask-human-mcp](https://github.com/masony817/ask-human-mcp) by masony817 (MIT, 150★).
>
> **Agents write questions to this file. The operator answers by replacing `answer: PENDING` inline. The agent re-reads and continues.** Q blocks are never deleted after they're answered — this file is the audit trail of every decision the operator was asked to make and how they decided.

## How to use this file

### As an agent

Generate a Q-id with `openssl rand -hex 4`. Append a block at the **bottom** of the `## Questions` section using the canonical format below. Then do non-blocking work until the operator answers (or queue a polite reminder via `ask-human-mcp --timeout <seconds>` if you've installed the file-watching daemon).

```markdown
### Q<8-char-hex-id>
ts: YYYY-MM-DD HH:MM
q: <one-paragraph question — specific, no preamble>
ctx: <2-3 sentences: what you're working on, what file/PR/task, why you can't decide alone>
answer: PENDING
```

For **strategic-research / vision-changing** questions (from the `/competitor-research --deep` skill), include the extra `ctx` lines per the agentbrew shared rule:

```markdown
### Q<id>
ts: YYYY-MM-DD HH:MM
q: vision-threat: <one-line headline>. <The specific decision the operator must make.>
ctx: competitor: <id>. vision section threatened: `vision.md § <section>` line N: "<exact quoted text>".
     what they do instead: <2-3 sentences>. source: <citation>. recommendation: <pivot | absorb pattern | reject as off-strategy>.
answer: PENDING
```

### As the operator (Fyodor)

Find any `answer: PENDING` line. Replace `PENDING` with your decision. Done. The agent that asked will pick up the change on its next file read (or instantly if `ask-human-mcp` daemon is running). Optionally add `decided: YYYY-MM-DD HH:MM` on a new line under `answer:` for the audit trail.

If the question is unclear, ambiguous, or asks for something you'd rather not decide: write `answer: <your concern, or "rephrase">` and the agent will iterate.

### When to ask vs. when to decide

**Ask** — irreversible decisions, choices that cross moats in `vision.md`, names of people/teams/products, private-knowledge gaps (which Slack channel, which Jira project, which API key), anything that would force a vision-doc rewrite if wrong.

**Decide** — reversible choices, established repo conventions, routine implementation details. Operator time is the scarcest resource on this project; asking about a reversible choice is a tax on it.

### Installing the file-watching daemon (optional but recommended)

```bash
pipx install ask-human-mcp
# Then add to .cursor/mcp.json or .claude/mcp.json:
#   { "mcpServers": { "ask-human": { "command": "ask-human-mcp" } } }
```

The daemon watches this file, unblocks the asking agent the instant `PENDING` is replaced, and supports concurrent questions / size limits / file rotation. See the [ask-human-mcp README](https://github.com/masony817/ask-human-mcp) for the full option list.

## Anchor

- agentbrew shared rule "Async human comms — ask-human.md" (in your agentbrew install's `shared-rules.md`) — the global convention this file instantiates.
- agentbrew catalog entry `ask-human` (in your agentbrew install's `src/catalog.yaml`) — the installable MCP server.
- `/competitor-research --deep` skill Phase 7 — the primary producer of vision-threat entries here.
- minsky TASKS.md `minsky-human-comm-via-file` P0 — the operator's original ask for this channel; adopted via this file plus `ask-human-mcp` instead of being rebuilt from scratch (rule #1 — don't reinvent the wheel).

## Questions

<!--
  Append new blocks below this line. Newest Qs go at the BOTTOM.
  Never delete a Q after it's answered — they are the audit trail.
  Format spec is in the "How to use this file" section above.
-->

<!-- First competitor deep-dive Q below; appended by `competitor-add-auto-code-rover`. -->

### Qa3f1c7e2

ts: 2026-06-01 00:00
q: vision-threat (NEGATIVE finding — recorded for audit trail): AutoCodeRover's AST-aware code search + spectrum-based fault localization (ISSTA 2024, arXiv:2404.05427; 46.2% SWE-bench Verified pass@1 at <$0.70/issue) is strong research, but the project went dormant after Sonar acquired the NUS spin-off (2025-02-19). Recommended decision: absorb the retrieval techniques as an optional context adapter behind `novel/adapters/` — NO vision change. Confirm you agree, or flag if you want a deeper wrap/adapter spike filed as a task.
ctx: competitor: auto-code-rover. vision section threatened: none — the finding is technique/strategy level, not constitutional. No rewrite of `vision.md § What Minsky is` and no invalidation of any of the 17 rules is implied. what they do instead: structure-aware (AST) retrieval over classes/methods plus spectrum-based fault localization to pre-rank suspect code before the LLM patches, in a fixed retrieve-then-patch pipeline. source: Zhang/Ruan/Fan/Roychoudhury, *AutoCodeRover: Autonomous Program Improvement*, ACM ISSTA 2024 (arXiv:2404.05427); repo README github.com/AutoCodeRoverSG/auto-code-rover; Sonar acquisition press release sonarsource.com (2025-02-19). recommendation: absorb pattern (context adapter), reject wrap (dormant OSS, closed-commercial successor) — no vision change.
answer: PENDING
