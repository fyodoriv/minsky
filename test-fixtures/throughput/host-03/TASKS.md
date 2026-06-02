# Tasks

## P1

- [ ] Reject negative quantities in the cart total reducer
  - **ID**: host-03-cart-negative-guard
  - **Tags**: p1, bug, throughput-fixture
  - **Hypothesis**: guarding against negative quantities drops the negative-total defect rate from observed-in-staging to 0, measured by the reducer throwing on a negative line item
  - **Success**: `cartTotal([{qty: -1}])` throws a `RangeError` instead of returning a negative number
  - **Pivot**: if negative quantities are a valid refund path, replace the guard with a signed-line-item model
  - **Measurement**: `node --test test/cart.test.mjs` asserts the throw on a negative qty
  - **Anchor**: Hoare 1969 (preconditions as assertions); fixture seed for throughput-at-scale-benchmark
  - **Details**: stand-in seed task so the throughput fixture host always has one pickable item.
  - **Files**: `src/cart.mjs`, `test/cart.test.mjs`
  - **Acceptance**: the reducer rejects negative quantities; the test pins the throw.
