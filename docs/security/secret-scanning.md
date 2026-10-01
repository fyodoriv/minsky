# Secret scanning — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 1 ("No secrets in the repo, ever"), Minsky runs a deterministic credential-shape scanner on every tracked file at pre-commit time and again at CI time. This doc consolidates the threat model, the pattern set, the operator-side knobs (allow-annotations, excluded suffixes), and the verification commands. Anchors: NIST SP 800-218 SSDF PW.4 (manage third-party software security, 2022); OWASP ASVS 14.3 (secret management); the empirical case for the gate is gitleaks (Tabriz et al. 2017) and TruffleHog v3 — both observed real PATs / API keys committed to `main` of public repos within hours of issuance.

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003. The empirical precedent: every quarter GitHub publishes a "tokens revoked because they were committed to a public repo" count in the millions; the supervisor edits arbitrary tracked files on every iteration, so a regression that writes `OPENAI_API_KEY=…` into a config file on disk lands as a tracked-file diff the moment the next commit fires.

- **Untrusted inputs**: every staged file at `git commit` time; every tracked file at CI time; every diff that the supervisor or an operator authors. The supervisor's own iterations are explicitly in scope — Minsky-on-Minsky is not exempt.
- **Trusted state**: the in-tree pattern set in [`scripts/scan-secrets.mjs`](../../scripts/scan-secrets.mjs) (regex calibrated to issuer-documented formats, not entropy heuristics); the `@scan-secrets-allowed: <reason>` annotation seam (the targeted relief valve, not regex relaxation); the `.test.mjs` / `.test.ts` / `.spec.*` suffix exclusion (test fixtures are allowed to carry shape-shaped strings).
- **Trust boundary**: the lefthook `pre-commit::scan-secrets` hook rejects the staged set before the commit object is created; the CI `secret-scan` job re-runs over every tracked file on push + PR. Past those two boundaries the bytes are trusted to have been reviewed.
- **STRIDE focus**:
  - **S**poofing — out of scope; secret scanning addresses leak prevention, not authentication. Compromised credentials that pre-date the gate are rotated separately.
  - **T**ampering — `scripts/scan-secrets.mjs` rejects any file whose content matches a documented credential shape. The pre-commit hook prevents the commit; the CI gate prevents the merge. Both run; neither is sufficient alone (the daemon may bypass the local hook on a different machine, and the operator may direct-push to a branch).
  - **R**epudiation — every gate failure is logged with the file path, line number, pattern tag, and a 4-character snippet of the surrounding context (never the full match — Saltzer & Schroeder #4 "complete mediation" without enabling secondary leaks via the log itself).
  - **I**nformation disclosure — this *is* the gate against information disclosure for the secret-handling surface. Companion gates: `otel-no-pii-in-spans-lint` (rule #13.2) for runtime telemetry, `privacy-data-egress` (rule #13.7) for the documented egress allow-list.
  - **D**enial of service — the scanner runs in <2s on the current tree (≈70 KLOC); the per-file `MAX_FILE_BYTES = 1 MiB` skip prevents a pathological binary from stalling the gate. CI-side runners are ephemeral.
  - **E**levation of privilege — out of scope at the gate layer; a leaked PAT that was scanned and rejected never enters the tree, so no privilege is granted via tracked files. (The complementary defence — sandbox of the supervisor's runtime — is rule #13.3.)

## Layer 1: pre-commit hook (shipped)

[`lefthook.yml`](../../lefthook.yml)'s `pre-commit::scan-secrets` runs `node scripts/scan-secrets.mjs <staged files>` against the staged set before the commit object is created. The hook short-circuits when no scannable file is staged (the lefthook `glob:` filter), so the typical no-op cost is zero; on a non-empty set the cost is ≤500 ms because the scanner reads only what `git diff --cached` already names.

A failed hook prints the file path, the matched pattern's stable tag (`github-pat`, `anthropic-openai-key`, `slack-token`, `aws-access-key-id`, `google-api-key`, `pem-private-key`), and the line number. The remediation — annotate the line as `@scan-secrets-allowed: <reason ≥3 chars>` if the match is intentional (a fixture, a docs example, a literal that resembles a key but is not one), or remove / rotate the credential if it's real.

## Layer 2: CI gate (shipped)

The `secret-scan` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) re-runs `node scripts/scan-secrets.mjs` over every tracked file (no positional args = full-tree scan) on every push to `main` and every PR. Push-event coverage is deliberate: a leak that lands via direct push must still surface (and rotate) — a PR-only gate is not enough. The gate is wired into the `ci` aggregator's `needs:` list and the bash `mustSucceed` bucket, so a red `secret-scan` blocks the merge regardless of which branch protection rule is configured upstream.

## Layer 3: allow-annotation seam (shipped)

`@scan-secrets-allowed: <reason>` is the documented bypass for legitimate matches that resemble credentials but are not. The annotation captures any text up to end-of-line (or the closing `*/` of a block comment) and requires ≥3 characters of substantive reason. Two placement modes are supported:

- **Inline**: `EXPORT KEY=fake-but-shape-matches  # @scan-secrets-allowed: docs example` (shell, dotenv).
- **Preceding line**: `// @scan-secrets-allowed: fixture used by parser test` followed by the literal on the next line (JS / TS / TSX / Python / Go).

The "preceding line" form covers cases where the match is a long literal inside a string array or test fixture and an inline comment would not fit. Both forms share the same regex (`\B@scan-secrets-allowed:[ \t]*([^\r\n]*?)…`), and the annotation must specify a reason — the bare token (`@scan-secrets-allowed:` with empty reason) does not satisfy the gate.

Test files (`.test.mjs`, `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`) are excluded from scanning entirely so paired-test fixtures can construct shape-shaped strings inline without per-line annotations. The exclusion is documented in [`scripts/scan-secrets.mjs`](../../scripts/scan-secrets.mjs) `EXCLUDED_SUFFIXES`.

## Pattern set

Each pattern's tail length / shape is calibrated to the issuer's documented format rather than entropy heuristics, to keep the false-positive rate near zero on prose / fixtures (`sk-test`, `ghp_short`, etc. do NOT flag).

- **GitHub PAT / OAuth / server-server / user-server** — `gh[pousr]_[A-Za-z0-9]{36}` (GitHub's documented format).
- **Anthropic / OpenAI key** — `sk-…` ≥20 trailing chars (Anthropic's `sk-ant-…` is a common subset).
- **Slack token** — `xox[bpas]-…` ≥10 trailing chars.
- **AWS access key ID** — `AKIA[0-9A-Z]{16}` (AWS's documented format).
- **Google API key** — `AIza[0-9A-Za-z_-]{35}` (Google's documented format).
- **PEM private key header** — `-----BEGIN [...] PRIVATE KEY-----` (the header alone is enough; entropy of the body isn't checked because the header itself is a high-confidence signal).

## Performance-first carve-out

Per rule #13's relief valve: when security and performance compete, performance wins on a case-by-case basis with the security cost declared in writing. None declared at this layer — the pre-commit hook runs in ≤500 ms on staged sets, the CI scan runs in ≤2 s on the full tree (≈70 KLOC), and the regex engine's worst-case cost on a 1 MiB file is below the per-file skip threshold. No hot-path latency is on the line.

## Verification

- **Pre-commit gate (synthetic violation)**: `printf 'export GHP=ghp_%s\n' "$(printf 'a%.0s' {1..36})" > /tmp/leak.sh && git add /tmp/leak.sh && git commit -m wip` — the hook exits 1 with `github-pat` and the line number; the commit is not created.
- **CI gate (full-tree scan)**: `node scripts/scan-secrets.mjs` on a clean checkout exits 0; on a tree with a synthetic leak, exit 1 with the file/line/pattern triple.
- **Allow-annotation accepted**: `printf 'export GHP=ghp_%s  # @scan-secrets-allowed: docs example\n' "$(printf 'a%.0s' {1..36})" > /tmp/ok.sh && node scripts/scan-secrets.mjs /tmp/ok.sh` exits 0.
- **Allow-annotation reason missing**: same line with `# @scan-secrets-allowed:` (empty reason) exits 1 — the bare token does not satisfy the gate.
- **Test-file exclusion**: a `.test.mjs` containing a shape-shaped fixture string does not trip the scanner; `.spec.tsx` likewise.

Paired tests pin every CLI verdict path: [`scripts/scan-secrets.test.mjs`](../../scripts/scan-secrets.test.mjs).

## Sources

- gitleaks (Tabriz et al. 2017) and TruffleHog v3 — the empirical baseline for credential-shape scanners; this gate is in-tree per rule #2 (decision functions are pure; the binary is the swappable boundary) so the regex set can be vendored without taking a runtime dependency on either tool.
- NIST SP 800-218 (Secure Software Development Framework), 2022 — PW.4 (manage third-party software security), PW.7 (review and analyze human-readable code).
- OWASP ASVS 14.3 (secret management) — credentials are not committed to source control; rotation cadence is documented; the gate covers prevention, not rotation.
- GitHub's documented PAT / OAuth token formats (docs.github.com/en/rest/overview/authenticating-to-the-rest-api, 2024) — `ghp_`, `gho_`, `ghs_`, `ghu_` with 36-char tail.
- AWS access key format (docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html, 2024) — `AKIA[0-9A-Z]{16}`.
- Google API key format (cloud.google.com/docs/authentication/api-keys, 2024) — `AIza[0-9A-Za-z_-]{35}`.
- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — fail-safe defaults (the gate exits 1 on any match, never 0); complete mediation (every tracked file is scanned, no allow-list of "trusted directories").
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
