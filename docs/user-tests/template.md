# User test — &lt;initials&gt;

This is the template for a single M1.11 user-test run. Copy it to
`docs/user-tests/<YYYY-MM-DD>-<initials>.md`, fill in the metadata block, and
list the friction points. The aggregator
([`scripts/user-test-results.mjs`](../../scripts/user-test-results.mjs)) skips
this `template.md` file — only real per-developer reports are counted.

## Run metadata

- **Developer**: AB
- **Date**: 2026-06-15
- **Time to first iteration (minutes)**: 4
- **Outcome**: success
- **Needed operator help**: no

## Background

One or two lines on the developer's background — stack, years of experience,
and crucially whether they are inside or outside the operator's direct network
(M1.11 wants at least one outside tester).

## Friction points

List each point where the developer hesitated, backtracked, or got stuck.
Note the elapsed time at which it happened and whether it was self-resolved.

- (e.g. "2:30 — unclear whether `pnpm` or `npm`; resolved by re-reading line 4")

## Improvement opportunities

Concrete README edits the friction points suggest. File anything that cost the
developer more than five minutes as a P1 task against the README.

- (e.g. "Add an explicit `Node ≥ 20` prerequisite line above the clone step")
