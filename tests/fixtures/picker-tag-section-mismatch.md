# Tasks

## P0

- [ ] Misfiled p1-tagged block sitting in the P0 section
  - **ID**: misplaced-p1-in-p0
  - **Tags**: p1, picker, throughput
  - **Hypothesis**: a p1-tagged block in P0 must not shadow genuine P0 work
  - **Success**: picker skips this misfiled block
  - **Pivot**: <0.5
  - **Measurement**: python3 -m pytest tests/test_pick_task.py
  - **Anchor**: Liskov & Wing 1994 — section invariant
  - **Details**: This block's tags disagree with its `## P0` section.

- [ ] Genuine P0 work that should be picked
  - **ID**: genuine-p0
  - **Tags**: p0, picker, throughput
  - **Hypothesis**: the first tag-aligned p0 block is returned
  - **Success**: picker returns this block
  - **Pivot**: <0.5
  - **Measurement**: python3 -m pytest tests/test_pick_task.py
  - **Anchor**: Liskov & Wing 1994 — section invariant
  - **Details**: This block's tags agree with its `## P0` section.
