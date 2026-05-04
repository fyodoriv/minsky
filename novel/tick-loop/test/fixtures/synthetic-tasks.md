# Synthetic TASKS.md fixture for `@minsky/tick-loop` smoke

This is a hand-curated fixture, not a real TASKS.md. The mock-tick daemon
picks tasks by their `**ID**: <kebab-id>` block-marker, mirroring the
real TASKS.md shape parsed by `scripts/check-rule-7-chaos-coverage.mjs`
(`parseTaskIds`). Four P2 tasks per the parent `first-integration-test`
brief — one per task type the user-story's P2-task-throughput Acceptance
exercises.

## P2

- [ ] Mock task one — happy path
  - **ID**: smoke-task-one
  - **Tags**: testing, mock
  - **Estimate**: 1m
  - **Hypothesis**: completes via mock-anthropic happy path.

- [ ] Mock task two — happy path
  - **ID**: smoke-task-two
  - **Tags**: testing, mock
  - **Estimate**: 1m
  - **Hypothesis**: completes via mock-anthropic happy path.

- [ ] Mock task three — happy path
  - **ID**: smoke-task-three
  - **Tags**: testing, mock
  - **Estimate**: 1m
  - **Hypothesis**: completes via mock-anthropic happy path.

- [ ] Mock task four — happy path
  - **ID**: smoke-task-four
  - **Tags**: testing, mock
  - **Estimate**: 1m
  - **Hypothesis**: completes via mock-anthropic happy path.
