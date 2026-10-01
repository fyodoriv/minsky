# Tasks

## P1

- [ ] Cache the config parse so repeated reads stop re-parsing the file
  - **ID**: host-02-config-parse-cache
  - **Tags**: p1, perf, throughput-fixture
  - **Hypothesis**: memoizing the config parse cuts cold-start config reads from N parses to 1, measured by the parse-count counter staying at 1 across 10 reads
  - **Success**: the parse-count counter reports 1 after 10 `loadConfig()` calls
  - **Pivot**: if config mutates between reads, drop memoization and revisit with a file-watch invalidation
  - **Measurement**: `node --test test/config.test.mjs` asserts parse-count === 1 after 10 reads
  - **Anchor**: Bentley 1982 (caching as the cheapest speedup); fixture seed for throughput-at-scale-benchmark
  - **Details**: stand-in seed task so the throughput fixture host always has one pickable item.
  - **Files**: `src/config.mjs`, `test/config.test.mjs`
  - **Acceptance**: repeated reads parse the file once; the test pins the counter at 1.
