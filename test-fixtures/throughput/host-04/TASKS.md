# Tasks

## P1

- [ ] Document the retry backoff schedule in the client README
  - **ID**: host-04-retry-backoff-doc
  - **Tags**: p1, docs, throughput-fixture
  - **Hypothesis**: documenting the backoff schedule drops "why is the client slow" support questions from recurring to 0, measured by the README carrying the exact base/cap/jitter values
  - **Success**: the README contains a table with base, cap, and jitter for each retry attempt
  - **Pivot**: if the schedule is dynamically computed, document the formula and its inputs instead of static values
  - **Measurement**: `grep -q "backoff" README.md` exits 0 and the table lists base/cap/jitter
  - **Anchor**: Knuth 1984 (literate programming — doc and code are one artifact); fixture seed for throughput-at-scale-benchmark
  - **Details**: stand-in seed task so the throughput fixture host always has one pickable item.
  - **Files**: `README.md`, `src/client.mjs`
  - **Acceptance**: the README documents the backoff schedule with concrete values or the formula.
