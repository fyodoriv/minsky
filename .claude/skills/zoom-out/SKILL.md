---
name: zoom-out
description: Get an architectural map of unfamiliar code. Use when you encounter an unknown module, don't understand how a component fits into the tick-loop/MAPE-K/budget-guard wiring, or need the domain vocabulary before reading further. Outputs a module map using vision.md § Glossary terms and ARCHITECTURE.md wiring.
disable-model-invocation: true
---

I don't know this area of the codebase well. Go up a layer of abstraction.

Give me:
1. A map of the relevant modules and their callers/callees in this area, using the vocabulary from `vision.md § Glossary` and `ARCHITECTURE.md`.
2. The architectural pattern each module conforms to (from `vision.md § Pattern conformance index`).
3. Which interfaces (in `novel/adapters/`) mediate access to external dependencies in this area.
4. The one user story (`user-stories/*.md`) this code most directly serves.

Use domain terms (tick-loop, MAPE-K, budget-guard, brief, span, claim, circuit-breaker, chaos-gate) not implementation-level names. One paragraph maximum per module.
