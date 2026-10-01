# Tasks

## P1

- [ ] Add a unit test pinning the slug normalizer's lowercase contract
  - **ID**: host-01-slug-normalizer-test
  - **Tags**: p1, test, throughput-fixture
  - **Hypothesis**: pinning the normalizer's lowercase contract drops slug-collision defects from 1/release to 0, measured by the new test going red on any case-folding regression
  - **Success**: the new test fails when `normalize("AB")` stops returning `"ab"`
  - **Pivot**: if the normalizer has no stable contract to pin, delete the test rather than assert on incidental behavior
  - **Measurement**: `node --test test/slug.test.mjs` exits 0 with the new case present
  - **Anchor**: Beck 1999 (test-first); fixture seed for throughput-at-scale-benchmark
  - **Details**: stand-in seed task so the throughput fixture host always has one pickable item.
  - **Files**: `src/slug.mjs`, `test/slug.test.mjs`
  - **Acceptance**: the test exists, fails on a folded-case regression, and passes on the current normalizer.
