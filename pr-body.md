## Summary

- Add missing `set + EACCES` test case to `git-config-path-checks.test.ts`, completing the 3 keys × 4 outcomes coverage called out in the Verification criteria (unset / set+exists / set+missing / set+EACCES)
- Remove completed task `minsky-cross-machine-dotfile-checks` from TASKS.md — implementation shipped in PR #399; task block was not removed at that time

## Hypothesis self-grade

- **Predicted**: adding the EACCES test case satisfies the final gap in the Verification criterion "3 keys × 4 outcomes (unset / set+exists / set+missing / set+EACCES)"; existing tests already covered 3 of 4 outcomes
- **Observed**: test file now has 11 tests for `checkGitConfigPaths` (was 10); new `set + EACCES` describe block explicitly documents that `existsSync` returns `false` on permission-denied paths, making EACCES indistinguishable from "missing" at the helper boundary
- **Match**: yes
- **Lesson**: pure-over-injection helpers make EACCES and "missing" identical at the seam; the test value is documentation, not coverage novelty — pin the behavior explicitly so a future reader doesn't need to check Node.js docs

## Optimization

optimization: none-this-iteration: the new test adds 12 lines; the TASKS.md removal saves ~540 bytes — no 10-byte-minimum measurable saving in the daemon-loop sense

<!-- security: not-applicable — test-only addition + TASKS.md task removal; no new runtime surface, no secrets, no auth, no PII -->
