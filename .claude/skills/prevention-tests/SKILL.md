---
name: prevention-tests
description: Writes tests when the goal is to PREVENT a class of bugs from ever shipping — a CI gate, not a behavior spec. Use when the operator asks to "make it impossible to merge X", "prevent Y from ever landing", "block CI when Z happens", "add a gate", "add a lint", or to convert an observed bug into a class-of-bug guard. Produces multi-layer assertions with diagnostic matchers, self-explanatory test names that name the violation, mutation-verified negative cases, and `it.fails(...)` tripwires that lock each layer's contract against future regressions. Don't use for ordinary unit testing of existing behavior (use `tdd`), Storybook play-function tests (use `tdd` + the repo's Storybook conventions), end-to-end tests (use `playwright-best-practices`), or `it.fails` as a way to defer a flaky test (the tripwires are an active gate, not a TODO).
---

# prevention-tests

## When to invoke

Trigger phrases — invoke when the operator says:

- "make it impossible to merge X" / "block X from ever shipping"
- "prevent the class of bugs where Y"
- "add a CI gate / lint / invariant for Z"
- "turn this bug into a regression test that catches the whole category"
- "rule #17 / proactive heal / fix the class, not the instance"
- "make this check stricter" / "make this check extra strict"
- After fixing a bug: "the same shape of bug must never re-enter"

Hard signals that this skill applies (auto-detect even without trigger phrase):

- The change adds a `*.spec.ts` whose `describe` reads "registry gate", "icon must X", "engagement type must Y", "config invariant", "no foo without bar"
- A bug-fix PR where the prose is "TypeScript can't catch X" / "the type system doesn't enforce Y"
- A linter / hookfile / CI-script PR labelled "iron law" / "constitutional gate" / "rule #N"
- A test the author is calling a "tripwire" / "tests-the-test" / "self-test"
- A spec that uses `it.fails(...)` for any reason (active-tripwire pattern, see Phase 4 below)

## When NOT to invoke

- Unit testing existing behavior — use the repo's `tdd` skill
- Component / visual testing via Storybook play functions — use the repo's Storybook conventions
- End-to-end Playwright tests — use `playwright-best-practices`
- `it.fails(...)` as a TODO marker for a flaky test (the tripwire pattern is an ACTIVE gate; using `.fails` to silence is the anti-pattern)
- One-off bug-fix tests that don't generalize to a class (just write a normal failing test, fix the bug, ship)

## The core principle

> **The CI failure output IS the spec.** A reviewer looking at a red Vitest line should be able to answer (1) what was tested, (2) what the violation was, (3) which layer of the gate caught it — without opening the spec file.

Three corollaries:

1. **Multi-layer defense, one assertion per evasion.** TypeScript can't catch empty strings; an empty-string check can't catch typos; a typo check can't catch downstream-consumer mismatches. Each layer guards against a different evasion class. The gate is the union.
2. **Diagnostic matchers over generic ones.** `expect(set).toContain(x)` prints the set AND the violating value; `expect(set.has(x)).toBeTruthy()` prints "expected false to be truthy". Same correctness, dramatically different debuggability.
3. **Tripwires lock the contract.** Without them, a future PR that weakens a layer (e.g. relaxes the catalog match) passes its own tests and the live config's tests because no real-world violation exists today. A `it.fails(...)` tripwire holds a synthetic violation in place — if the layer's assertion stops biting on the synthetic, the tripwire turns red and names the regression.

## The procedure — 6 phases

### Phase 1 — Enumerate the failure modes the type system can't catch

Before writing a single `expect`, list every way a violator could ship the bug despite TypeScript. For each mode, name:

- The exact concrete shape that escapes (`icon: ""`, `icon: "Emial"`, `order: ["ghost_tab"]`)
- The runtime symptom (CircleAlert fallback + per-engagement-load error log; toolbar silently missing a tab)
- Why TypeScript can't reject it (`string` accepts empty; no string-literal union over 549 names; `string[]` accepts any tab id)

Put this list in the spec's top-level JSDoc. The list is the gate's contract.

### Phase 2 — Write one layer per failure mode, in order of narrowness

Each layer's assertion takes the value, runs ONE check, and either passes or names the violation. Order layers narrow-to-broad so the most diagnostic error fires first.

Worked example (Command Center icon registry, PROJ-994 — 4 layers):

```ts
it.each(
  Object.entries(defaultTools).map(([tabId, config]) => [
    // Test name embeds the violation surface. A FAIL line names the
    // engagement + tab + icon value WITHOUT an inline assertion message.
    `defaultTools["${tabId}"] icon "${config.icon}" — non-empty? PascalCase? catalog member?`,
    config,
  ] as const),
)("%s", (_label, config) => {
  // Layer 1 — non-empty / non-whitespace. Catches `icon: ""` and `icon: "   "`.
  expect(config.icon).not.toBe("");
  expect(config.icon.trim()).not.toBe("");

  // Layer 2 — typed shape (PascalCase regex). Catches "email" / "EMAIL" /
  // "tax-icon" BEFORE the bland "not in catalog" message in Layer 2.5.
  expect(config.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);

  // Layer 2.5 — catalog membership via a Set. Catches typos / removed icons.
  expect(KNOWN_ICON_NAMES).toContain(config.icon);
});

// Layer 3 — downstream-consumer fallback. Mirror the runtime resolution chain
// exactly so a violator can't slip through by satisfying upstream layers but
// failing where it actually matters.
it.each(orderedToolReferences)("%s", (_label, engagementType, tabId) => {
  const config = commandCenterToolsConfigByEngagementType[engagementType];
  const resolved = config.tools ? config.tools[tabId] : defaultTools[tabId];
  expect(resolved).toBeDefined();
  if (resolved) {
    expect(KNOWN_ICON_NAMES).toContain(resolved.icon);
  }
});
```

Layer-design rules:

- One assertion per concept. Don't combine "non-empty AND in-catalog" — split so the FAIL line names exactly which subcondition failed.
- Earlier layers should reject more violations than later layers. Empty string fails Layer 1; "Emial" passes Layers 1+2 but fails Layer 2.5; "ghost_tab" in an `order` array passes everything until Layer 3.
- Layer 3+ MUST mirror the runtime resolution chain (`config.tools ?? defaultTools` here) — if the test's resolution disagrees with production, the gate has a blind spot.

### Phase 3 — Use diagnostic matchers, not generic ones

The CI failure output should name the catalog AND the violating value. Translation table:

| Bad (generic)                                  | Good (diagnostic)                                | Failure output                                                                   |
|------------------------------------------------|--------------------------------------------------|----------------------------------------------------------------------------------|
| `expect(set.has(x)).toBeTruthy()`              | `expect(set).toContain(x)`                       | `expected [ 'Accountant', …(548) ] to include 'Emial'`                            |
| `expect(regex.test(x)).toBeTruthy()`           | `expect(x).toMatch(regex)`                       | `expected 'email' to match /^[A-Z][A-Za-z0-9]*$/`                                  |
| `expect(x !== undefined).toBeTruthy()`         | `expect(x).toBeDefined()`                        | `expected undefined to be defined`                                               |
| `expect(arr.length).toBeGreaterThan(0)`        | `expect(arr).not.toHaveLength(0)`                | `expected [] not to have length 0`                                               |
| `expect(deepEqual(a, b)).toBe(true)`           | `expect(a).toEqual(b)`                           | Full per-field diff with `+ Received / − Expected`                               |
| `expect(promise.catch(() => true)).toBe(true)` | `await expect(promise).rejects.toThrow(/regex/)` | `expected promise to reject with message matching /regex/`                       |

**Most repos lint inline assertion messages.** The repo's `vitest/valid-expect` rule rejects `expect(value, "diagnostic message")`. Don't disable the rule — switch to a richer matcher AND embed diagnostic context in the test name. The test name is printed on every FAIL line, so it carries the same diagnostic load as the would-be message arg.

### Phase 4 — Add `it.fails(...)` tripwires that lock the contract

After the live gate is green, add one `it.fails(...)` test per layer. Each tripwire:

1. Constructs a synthetic **broken** fixture matching the failure mode for that layer
2. Runs the **same assertion shape** the live gate uses against it
3. Is wrapped in `it.fails(...)` so the test passes if-and-only-if the inner assertion throws

Worked example (one tripwire per layer of the icon gate):

```ts
describe("tripwires — synthetic violating fixtures (deliberately failing)", () => {
  it.fails(
    "Layer 1 tripwire: a fixture with `icon: \"\"` must trigger the empty-string assertion",
    () => {
      const broken: ToolConfig = { icon: "", included: true };
      expect(broken.icon).not.toBe(""); // MUST throw — that's what it.fails checks for
    },
  );

  it.fails(
    "Layer 2 tripwire: a lowercase icon name must trigger the PascalCase assertion",
    () => {
      const broken: ToolConfig = { icon: "email", included: true };
      expect(broken.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    },
  );

  it.fails(
    "Layer 2.5 tripwire: a typo'd icon name must trigger the catalog-membership assertion",
    () => {
      const broken: ToolConfig = { icon: "Emial", included: true };
      expect(KNOWN_ICON_NAMES).toContain(broken.icon);
    },
  );

  it.fails(
    "Layer 3 tripwire: an order entry that resolves to undefined must trigger toBeDefined",
    () => {
      const broken = { order: ["ghost_tab"] };
      expect(defaultTools[broken.order[0]]).toBeDefined();
    },
  );
});
```

Why this matters: if a future PR weakens a layer (relaxes the catalog match, drops the `trim()`, swaps the resolver to default-fallback), the inner assertion no longer throws on its synthetic fixture, and `it.fails` flips the test from PASSING to FAILING — telling CI **exactly which layer regressed** without anyone needing to discover the regression in production.

Tripwire authoring rules:

- One tripwire per layer. If you have 4 layers, ship 4 tripwires.
- Each tripwire uses the **exact same matcher shape** as the live gate — not a paraphrase. The tripwire is the gate, frozen against a broken fixture.
- The tripwire's test name names the layer (`Layer 2 tripwire: ...`) so CI failure points to the regressed layer immediately.
- Use synthetic in-test fixtures, not the live config. Mutating the live config to create a violation would also fail the live gate and obscure which test is the tripwire.
- **Never** write `it.fails(..., () => { expect(1).toBe(1); })`. A deliberately-passing inner assertion fails `it.fails` and becomes a real CI failure. Tripwires must assert against a fixture that the live gate's assertion SHOULD reject.

### Phase 5 — Verify by mutation: prove the gate bites before declaring it done

Before claiming the gate works, mutate the live config to introduce a violation for EACH layer, run the spec, and confirm the right layer fires with the right diagnostic. The verification table belongs in the PR's `## How to test` section.

Mutation discipline (Red/Green for the gate itself):

```bash
# Layer 1 (empty string)
sed -i.bak 's/icon: "Email"/icon: ""/' src/.../config.ts && yarn vitest run <spec> --project=unit
# → 1+ failed with "expected '' not to be ''" — Layer 1 caught it ✓
git restore src/.../config.ts

# Layer 2 (wrong casing)
sed -i.bak 's/icon: "Email"/icon: "email"/' src/.../config.ts && yarn vitest run <spec> --project=unit
# → 1+ failed with "expected 'email' to match /^[A-Z][A-Za-z0-9]*$/" — Layer 2 ✓
git restore src/.../config.ts

# Layer 2.5 (typo)
sed -i.bak 's/icon: "Email"/icon: "Emial"/' src/.../config.ts && yarn vitest run <spec> --project=unit
# → 1+ failed with "expected [ 'Accountant', …(548) ] to include 'Emial'" ✓
git restore src/.../config.ts

# Layer 3 (unregistered tool in order)
# Edit config to inject `__ghost__: { order: ["ghost_tab"] }`; run spec; observe Layer 3 fires.
git restore src/.../config.ts
```

The PR's `## How to test` shows a table mapping (mutation → layer that fires → sample failure line). Without the verification table, the gate is unproven.

**Also verify the tripwires themselves.** Mutate ONE layer's live-spec assertion to a tautology (e.g., `expect(broken.icon).not.toBe("__never__")` instead of `not.toBe("")`). Confirm the matching tripwire flips red while the other tripwires and the standard live tests stay green. If the tripwire doesn't flip, the tripwire isn't testing what you think it is — rewrite it.

### Phase 6 — Connect to the PR's `## Why` and `## How to test`

The spec ships with prose evidence that the operator can read without opening the file:

- `## Why` opens with a one-sentence merge-blocking guarantee: "Once this PR lands, it is impossible to merge a future PR that ships X without Y — the Vitest CI gate turns red and master is blocked."
- `## Why` enumerates the N failure modes the type system doesn't catch (matches the JSDoc list from Phase 1)
- `## What changed` lists each layer + the tripwires + the matcher choice (PR Rule 3 from `reader-priority-docs`: outcome-first, no leading file paths)
- `## How to test` has the mutation table from Phase 5 + the tripwire mutation result
- `## Screenshots / recordings` embeds a screenshot of the actual Vitest CI failure output — the picture is the spec (apply `reader-priority-docs` PR Rule 2)

The screenshot proves the diagnostic-matcher choice paid off: a reviewer sees `expected [ 'Accountant', …(548) ] to include 'Emial'` and doesn't need to open the spec to know what's wrong.

## Anti-patterns

| Red flag                                                                          | Why it's wrong                                                                                                                       | Fix                                                                                                                                                            |
|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Single-layer gate** (`expect(catalog.has(icon)).toBeTruthy()` only)            | Empty strings, lowercase names, downstream-consumer mismatches all evade a single check. The "class of bugs" is partially uncovered. | Phase 1: enumerate failure modes. Phase 2: one layer per mode.                                                                                                 |
| **Generic matchers that hide the violation** (`toBeTruthy(set.has(x))`)          | FAIL line reads "expected false to be truthy" — reviewer has to open the spec to know what `set.has(x)` returned `false` for.        | Phase 3 matcher table. `toContain`, `toMatch`, `toEqual` over `toBeTruthy`.                                                                                    |
| **Bland test names** (`it("rejects empty icon", ...)`)                            | FAIL line names the test but not the engagement / tab / value that triggered the failure                                             | `defaultTools["${tabId}"] icon "${config.icon}" — non-empty? PascalCase? catalog member?` — embed the violation surface in the name                            |
| **Inline assertion messages** (`expect(x, "diagnostic").toBe(y)`)                 | Most repos lint `vitest/valid-expect` which rejects the 2-arg form                                                                   | Move the diagnostic into a richer matcher + the test name                                                                                                      |
| **No tripwires**                                                                  | A future PR can quietly relax a layer; tests stay green because no real-world violation exists                                       | Phase 4: one `it.fails(...)` tripwire per layer, asserting against a synthetic broken fixture                                                                  |
| **Tripwire with a passing assertion** (`it.fails(..., () => expect(1).toBe(1))`)  | `it.fails` requires the inner assertion to throw; passing assertions cause the outer test to FAIL — turning the tripwire into a bug | Always assert against a fixture that the gate SHOULD reject. If you need a positive-control, write a normal `it(...)` instead.                                  |
| **No mutation verification**                                                      | The gate might be vacuously true (e.g., empty iterable, wrong glob path)                                                             | Phase 5: mutate the live config to introduce each violation, confirm the right layer fires with the right diagnostic. Table belongs in `## How to test`.       |
| **Tripwire doesn't mirror the live assertion shape**                              | Future weakening of the live gate might not affect the tripwire's paraphrased shape — tripwire stays green, gate still regresses     | Copy the live `expect(...)...toMatch(...)` line into the tripwire body verbatim                                                                                |
| **Layer 3+ uses test-only resolution logic, not production's**                    | Gate has a blind spot — violators can satisfy the test's check while failing in production                                          | Phase 2: copy the runtime resolution chain into the test (`config.tools ?? defaultTools`); add a comment naming the production file it mirrors                 |
| **`it.fails(...)` used as a TODO marker for a flaky test**                        | `it.fails` is an ACTIVE gate, not a soft-skip. Using it to silence a flake hides the real problem.                                  | Either fix the flake (use `diagnose` skill) or `it.skip(...)` with a TASKS.md entry linking the unblock path                                                   |
| **Spec asserts on a Boolean-wrapper variable** (`const ok = ...; expect(ok)...`)  | Loses the operand information that diagnostic matchers expose                                                                        | Inline the comparison so `toMatch` / `toContain` / `toBeDefined` get the operand directly                                                                      |

## Verification checklist

Before claiming a prevention-test gate is done:

**Phase 1 — Failure-mode enumeration:**
- [ ] Spec's top-level JSDoc lists every failure mode the type system can't catch — concrete shape, runtime symptom, why TS can't reject
- [ ] Each failure mode maps to exactly one layer in the spec

**Phase 2 — Multi-layer assertions:**
- [ ] One layer per failure mode (don't combine concepts in one `expect`)
- [ ] Layers ordered narrow-to-broad
- [ ] Layer 3+ mirrors the runtime resolution chain exactly (with a comment citing the production file)

**Phase 3 — Diagnostic matchers:**
- [ ] No `.toBeTruthy(predicate)` / `.toBe(true)(predicate)` — replaced with `toContain` / `toMatch` / `toBeDefined` / `toEqual`
- [ ] Test names embed the violation surface (engagement type + tab id + the actual value)
- [ ] No inline `expect(value, "message")` second-arg messages (use richer matcher + descriptive test name)

**Phase 4 — Tripwires:**
- [ ] One `it.fails(...)` tripwire per layer
- [ ] Each tripwire uses the SAME matcher shape as the live gate (verbatim)
- [ ] Tripwire test names name the specific layer they guard
- [ ] No tripwire uses a deliberately-passing inner assertion
- [ ] All tripwires GREEN today (the inner assertion throws on the synthetic broken fixture)

**Phase 5 — Mutation verification:**
- [ ] For each layer, a mutation was applied to the live config, the spec was run, the right layer fired with the expected diagnostic, and the mutation was reverted
- [ ] For at least one tripwire, the live-spec assertion was weakened to a tautology, the matching tripwire flipped red, and the change was reverted
- [ ] Verification table is included in the PR's `## How to test` section

**Phase 6 — PR description:**
- [ ] TL;DR opens with the merge-blocking guarantee in one sentence
- [ ] `## Why` enumerates the N failure modes (matches the JSDoc list)
- [ ] `## Screenshots / recordings` embeds a screenshot of the real Vitest CI failure output
- [ ] Diagnostic-matcher choice is visible in the screenshot (a reviewer can read the violation from the FAIL line)

## Worked example

The full pattern shipped as example-capabilities PR #2095 (PROJ-994 — "block CC tools with empty icon strings"):

- **4 failure modes enumerated** in the spec's top JSDoc: empty string, wrong casing, typo/removed name, unregistered tool ID in an engagement's `order`
- **4 layers** assert the union: Layer 1 non-empty, Layer 2 PascalCase via `toMatch`, Layer 2.5 catalog membership via `toContain` on a `Set`, Layer 3 runtime-fallback-resolved via `toBeDefined`
- **4 `it.fails(...)` tripwires** at the bottom of the spec, each constructing a synthetic broken `ToolConfig` and running the same matcher against it
- **Mutation verification table** in the PR body shows each mutation, the layer that fires, and the sample diagnostic line — proving each layer bites
- **Tripwire verification** by mutating Layer 1's assertion to `not.toBe("__never__")` — the Layer 1 tripwire flipped red, the other tripwires + 142 standard tests stayed green, demonstrating the tripwire's specificity
- **Screenshot** in `## Screenshots / recordings` shows the four failure-mode FAIL lines with diagnostic output: `expected '' not to be ''`, `expected 'email' to match /^[A-Z][A-Za-z0-9]*$/`, `expected [ 'Accountant', …(548) ] to include 'Emial'`, `expected undefined to be defined`

PR: https://github.example.com/example-org/example-capabilities/pull/2095

## Source

The pattern is the convergence of three established disciplines:

- **Constitutional CI gates** — Minsky vision.md rule #10 ("Every constitutional rule must be enforced by a deterministic CI check"). The gates here are the CI shape of an invariant.
- **Fix the class, not the instance** — Minsky vision.md rule #17 ("Land the lint or invariant that prevents the entire category"). Multi-layer assertions are the "lint" shape for runtime invariants.
- **Tests-the-test (`it.fails(...)` tripwire)** — Wynne & Hellesøy, *The Cucumber Book*, 2012, § "Self-verifying tests"; Feathers, *Working Effectively with Legacy Code*, 2004, Ch. 4 "The Seam Model" (testing the test seam). Vitest's `test.fails` / `it.fails` is the modern API for the same pattern.
- **Diagnostic-matcher discipline** — informed by Vitest's printed-diff output ergonomics. `toContain` / `toMatch` / `toEqual` were designed to print actionable failure messages; `toBeTruthy(predicate)` discards that signal.

Operator directive that crystallised the skill (2026-05-25): "Amazing, now this is kind of tests I expect when we need something to be prevented" — applied to the PROJ-994 spec after two rounds of strictness iteration (initial 3-layer gate → added PascalCase layer + diagnostic matchers + 4 tripwires).
