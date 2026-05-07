// Synthetic fixture for check-rule-otel-no-pii.mjs tests.
//
// This file intentionally contains a PII-shaped span attribute key so the
// lint exits 1 when run against it — proving the detection path works.
//
// DO NOT add @otel-pii-allowed here; the test asserts that the violation
// is detected (not suppressed).

// A hypothetical bad call that would leak an API credential into a span:
recorder.record({ apiKey: process.env["ANTHROPIC_API_KEY"] });

// Safe attributes below — these must NOT be flagged:
recorder.record({ "task.id": "example-task", "iteration.status": "completed" });
