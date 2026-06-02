# Tasks

## P1

- [ ] Make the date formatter timezone-explicit instead of host-local
  - **ID**: host-05-date-formatter-tz
  - **Tags**: p1, bug, throughput-fixture
  - **Hypothesis**: making the formatter timezone-explicit drops off-by-one-day render bugs from observed-across-timezones to 0, measured by the test asserting a fixed UTC instant renders identically regardless of `TZ`
  - **Success**: `format(instant)` returns the same string under `TZ=UTC` and `TZ=America/Los_Angeles`
  - **Pivot**: if callers genuinely need host-local rendering, expose a `timezone` arg instead of hardcoding UTC
  - **Measurement**: `node --test test/date.test.mjs` asserts TZ-stable output
  - **Anchor**: Lampson 1983 (push the constraint to the cheapest point); fixture seed for throughput-at-scale-benchmark
  - **Details**: stand-in seed task so the throughput fixture host always has one pickable item.
  - **Files**: `src/date.mjs`, `test/date.test.mjs`
  - **Acceptance**: the formatter is timezone-explicit; the test pins TZ-stable output.
