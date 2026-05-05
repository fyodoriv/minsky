#!/usr/bin/env node
// Test stub for `gh` used by `cross-repo-check-runner.mjs`'s self-test and
// vitest cases. Reads `MINSKY_GH_STUB_MODE` from env to choose which
// canned response to emit:
//
//   happy            — valid PR body + valid EXPERIMENT.yaml + diff;
//                      head SHA stable across the two `pr view` calls.
//   missing-self-grade — PR body lacks the rule-#9 self-grade block.
//   experiment-unreadable — `gh api …/contents/…` returns a 404-ish
//                           envelope (no `content` field).
//   force-pushed     — first `pr view` returns sha "AAA"; second returns
//                      "BBB" (mid-run force-push).
//   bad-anchor       — EXPERIMENT.yaml's anchor is a Medium URL (deny-list
//                      hit per check-anchor-primary-source).
//
// The stub never touches the network. It only inspects argv to decide
// which response to emit.
//
// Usage from runner:
//   `--gh-bin scripts/fixtures/cross-repo-check-runner-gh-stub.mjs`
// plus `MINSKY_GH_STUB_MODE=<mode>` in env.

const argv = process.argv.slice(2);
const mode = process.env["MINSKY_GH_STUB_MODE"] ?? "happy";

const VALID_PR_BODY = [
  "## Summary",
  "Bumps the foo widget from 1.0 to 2.0.",
  "",
  "## Hypothesis self-grade",
  "",
  "- Predicted: foo widget v2 reduces p99 latency by 20%",
  "- Observed: p99 latency dropped from 450ms to 360ms (20%)",
  "- Match: yes",
  "- Lesson: the predicted threshold matched; tighten next time.",
  "",
  "## Test plan",
  "- [x] tests pass",
  "",
].join("\n");

const MISSING_SELF_GRADE_BODY = [
  "## Summary",
  "Bumps the foo widget from 1.0 to 2.0.",
  "",
  "## Test plan",
  "- [x] tests pass",
  "",
].join("\n");

const VALID_EXPERIMENT_YAML = [
  "id: foo-widget-bump-2026-05-04",
  "hypothesis: |",
  "  Bumping foo widget v1 to v2 reduces p99 latency from 450ms to 360ms",
  "  (20% reduction) on the canary fleet.",
  "success: |",
  "  jq -e '.latency_ms <= 380' < /tmp/canary-metrics.json",
  "pivot: |",
  "  jq -e '.latency_ms > 470' < /tmp/canary-metrics.json (rolls back v2; foo",
  "  widget contract is not a fit).",
  "measurement: |",
  "  jq -e '.latency_ms <= 380' < /tmp/canary-metrics.json",
  'anchor: "rule #9; vision.md § 9; Beyer et al., *Site Reliability Engineering*, O\'Reilly, 2016, Ch. 6"',
  "",
].join("\n");

const BAD_ANCHOR_EXPERIMENT_YAML = [
  "id: foo-widget-bump-2026-05-04",
  "hypothesis: |",
  "  Bumping foo widget v1 to v2 reduces p99 latency.",
  "success: |",
  "  jq -e '.latency_ms <= 380' < /tmp/canary-metrics.json",
  "pivot: |",
  "  jq -e '.latency_ms > 470' < /tmp/canary-metrics.json",
  "measurement: |",
  "  jq -e '.latency_ms <= 380' < /tmp/canary-metrics.json",
  'anchor: "https://medium.com/@somebody/the-foo-widget-pattern-deadbeef"',
  "",
].join("\n");

const VALID_DIFF = [
  "diff --git a/foo b/foo",
  "--- a/foo",
  "+++ b/foo",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

/**
 * @param {string} stdout
 * @returns {never}
 */
function emit(stdout) {
  process.stdout.write(stdout);
  process.exit(0);
}

// `gh pr view --repo X N --json body,headRefOid --jq .` (first call, fetch step).
// `gh pr view --repo X N --json headRefOid --jq .headRefOid` (second call, post-run).
if (argv[0] === "pr" && argv[1] === "view") {
  const wantsHeadRefOidOnly = argv.includes("headRefOid") && !argv.includes("body");
  if (wantsHeadRefOidOnly) {
    if (mode === "force-pushed") emit("BBB\n");
    emit("AAA\n");
  }
  // body + headRefOid envelope.
  const headSha = "AAA";
  const body = mode === "missing-self-grade" ? MISSING_SELF_GRADE_BODY : VALID_PR_BODY;
  emit(`${JSON.stringify({ body, headRefOid: headSha })}\n`);
}

// `gh api <url>` for EXPERIMENT.yaml.
if (argv[0] === "api" && typeof argv[1] === "string" && argv[1].includes("/contents/")) {
  if (mode === "experiment-unreadable") {
    emit(`${JSON.stringify({ message: "Not Found", documentation_url: "..." })}\n`);
  }
  const yaml = mode === "bad-anchor" ? BAD_ANCHOR_EXPERIMENT_YAML : VALID_EXPERIMENT_YAML;
  const envelope = {
    content: Buffer.from(yaml, "utf8").toString("base64"),
    encoding: "base64",
  };
  emit(`${JSON.stringify(envelope)}\n`);
}

// `gh pr diff N --repo X` — return a small diff regardless of mode.
if (argv[0] === "pr" && argv[1] === "diff") {
  emit(VALID_DIFF);
}

// Unknown invocation — exit non-zero so the runner records it.
process.stderr.write(`gh-stub: unsupported argv: ${JSON.stringify(argv)}\n`);
process.exit(2);
