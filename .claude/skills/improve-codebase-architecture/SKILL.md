---
name: improve-codebase-architecture
description: >
  Find deepening opportunities in Minsky's codebase, informed by the domain
  language in vision.md § Glossary and the architecture in ARCHITECTURE.md.
  Use when the user wants to improve architecture, find refactoring
  opportunities, consolidate tightly-coupled modules, make the tick-loop /
  MAPE-K / adapters more testable, or reduce cognitive surface area in any
  novel/* package.
allowed-tools: Read, Bash
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability, AI-navigability, and a codebase where the tick-loop can iterate without rediscovering the same seams.

## Glossary

Use these terms exactly. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Use Minsky domain terms for the domain and architectural terms for structure.

**Architectural terms:**

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam. Lives in `novel/adapters/` by Minsky convention.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

**Minsky domain terms (from vision.md § Glossary):**

- tick-loop, MAPE-K, budget-guard, brief, span, claim, circuit-breaker, chaos-gate, worker, daemon, supervisor, self-diagnose, invariant, operator.

Key principles:

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Tests at the deepened module's interface survive internal refactors.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a port unless at least two adapters are justified (production + test).

## Process

### 1. Explore

Read `vision.md § Glossary`, `ARCHITECTURE.md`, and any ADRs in `docs/adr/` touching the area before writing anything.

Walk the codebase organically. Note friction points:

- Where does understanding one concept require bouncing between many small modules in `novel/*`?
- Where are modules **shallow** — adapter modules that just re-export or pass through without adding invariants?
- Where have pure functions been extracted for testability but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams — e.g., `tick-loop` directly importing from `novel/experiment-record/` rather than going through the adapter interface?
- Which parts of `novel/adapters/` expose too much implementation detail to callers?
- Which self-diagnose invariants fire frequently because the module they guard is shallow and lets bad state in?

Apply the **deletion test** to anything suspicious: would deleting it concentrate complexity in callers, or just move it? "Yes, concentrates" is the signal.

Minsky-specific heuristics (not rigid — explore organically):

- `novel/tick-loop/src/` modules that import vendor names directly (violates the "no vendor names in business logic" policy) — these are seam violations, not just style issues.
- MAPE-K stage boundaries (Monitor / Analyze / Plan / Execute) are natural seams. If code crosses two stages in one module, that's a depth opportunity.
- Budget-guard logic scattered across callers vs. concentrated in one deep module.
- Self-diagnose probes that duplicate invariant checks already in adapters.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Modules involved** — which `novel/*` packages and files
- **Problem** — why the current architecture causes friction (be specific about which failure mode or cognitive cost)
- **Solution** — plain English description of what would change
- **Benefits** — in terms of locality, leverage, and how tests would improve. Mention which existing self-diagnose invariants would shrink or disappear if this seam existed.

**Use vision.md vocabulary for the domain, and this skill's LANGUAGE section for structure.** "The budget-guard module" not "the BudgetGuardManager." "The execute seam" not "the boundary layer."

**ADR conflicts**: if a candidate contradicts an existing ADR in `docs/adr/`, surface it only when friction is real enough to warrant revisiting. Mark it clearly: _"contradicts ADR-0007 — but worth reopening because [specific friction]."_ Do not list every theoretical refactor an ADR forbids.

Do NOT propose interfaces yet. Ask: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree: constraints, dependencies, shape of the deepened module, what sits behind the seam, what tests survive the refactor, what existing chaos-gate tests need rewiring.

Dependency categories — determines how the deepened module is tested:

1. **In-process** (pure computation, in-memory state): always deepenable. Merge and test through the new interface directly. No adapter needed.
2. **Local-substitutable** (e.g., in-memory task queue, filesystem stub): deepenable if the stand-in exists. The deepened module tests with the stand-in. Seam is internal.
3. **Remote but owned** (daemon ↔ worker process boundary, MCP server): define a **port** at the seam. Deep module owns the logic; transport injected as adapter. Tests use in-memory adapter. Production uses real adapter.
4. **True external** (Anthropic API, GitHub API, mlx_lm.server): deepened module takes dependency as injected port. Tests provide mock adapter. Vendor name appears only in `novel/adapters/`.

Side effects inline as decisions crystallize:

- **Naming a deepened module after a concept not in `vision.md § Glossary`?** Propose adding it — the skill's grill session is the right moment to extend the glossary. Commit the glossary entry in the same PR as the refactor.
- **Sharpening a fuzzy domain term during conversation?** Update `vision.md § Glossary` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR in `docs/adr/`: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only when the reason would be needed by a future explorer — skip ephemeral reasons ("not worth it right now").
- **Want to explore alternative interfaces?** Spawn 3+ parallel sub-agents each constrained by a different design priority (minimize surface, maximize flexibility, optimize for common callers, ports & adapters). Present designs side-by-side with depth/locality/seam comparison.

### Testing discipline

- Old unit tests on shallow modules become waste once tests at the deepened module's interface exist — delete them.
- New tests go at the deepened module's interface. **The interface is the test surface.**
- Tests assert observable outcomes through the interface, not internal state.
- Tests must survive internal refactors. If a test has to change when implementation changes, it is testing past the interface.
- Seam discipline: **one adapter = hypothetical seam; two adapters = real seam.** Don't introduce a port unless production + test adapters both exist.

### Pre-registration (rule #9)

Every refactor candidate proposed in the grilling loop must carry a pre-registered hypothesis before any code changes:

> **Hypothesis**: merging modules A + B behind a deep interface will reduce the number of self-diagnose invariant checks from N to M and reduce test count from X to Y while preserving observable behaviour.
> **Measurement**: `pnpm vitest run <path>` passes; `grep -r "invariant" novel/tick-loop/src | wc -l` drops from N to M.
> **Success threshold**: test count stable or reduced, invariant checks reduced by ≥1, no regression.
> **Anchor**: Ousterhout, *A Philosophy of Software Design*, 2018 (deep modules); rule #9.
