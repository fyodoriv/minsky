# Fixture for advisory rule A5 — pattern-conformance level doesn't match the source

This fixture demonstrates a scenario where the diff adds a new pattern-conformance index row that claims `full` conformance, but the source file's own docstring openly declares a deviation. The deterministic linter (`scripts/check-pattern-index.mjs`) only verifies that the new file is *mentioned* in the index — it cannot read source-code semantics. The Skill should advise the reviewer.

## Diff: `vision.md`

```diff
+| 99 | `novel/example-cache/src/index.ts` | LRU cache | Knuth, *TAOCP* Vol 1 | full | The reference implementation. |
```

## Diff: `novel/example-cache/src/index.ts`

```diff
+/**
+ * Pattern: LRU cache.
+ * Source: Knuth, *TAOCP* Vol 1.
+ * Conformance: deviation — we evict on insertion-time only, not on
+ *   access-time, so this is closer to FIFO than LRU. Restoring full
+ *   conformance would require a doubly-linked list keyed by access
+ *   timestamp; deferred to v0.2.
+ */
+export class ExampleCache { /* … */ }
```

## Expected advisory

| rule_id | evidence | severity | suggested_repair |
|---------|----------|----------|------------------|
| A5 | Index row claims `full` but source docstring declares a deviation (FIFO, not LRU) | high | Change the conformance column to `deviation` and copy the source-docstring rationale into the row's Notes column, per rule #8 ("deviations are explicit, not silent"). |
