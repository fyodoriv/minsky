# Cloud-tier external audit gate — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 6 ("External security audit gate before cloud tier"), no cloud-tier feature ships to a non-operator user until a third-party security firm audits the threat model + sample implementation, their report (or its executive summary) is public, and every critical finding is remediated and re-tested. This doc consolidates the threat model that motivates the gate, the gate's mechanical shape, the unblock criteria, and the verification commands. Anchors: SOC 2 Type II (AICPA Trust Services Criteria, 2017 ed.); CNCF Security TAG, "Cloud Native Security Whitepaper", v2 (2022); Saltzer & Schroeder, *Proceedings of the IEEE* 63(9), 1975 (open design, separation of privilege).

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003. The empirical precedent: every cloud-SaaS breach since 2020 (Codecov 2021, Okta 2022, MOVEit 2023, Snowflake 2024, etc.) was either caught by an *external* researcher or shipped under-audited; internal review consistently fails to surface multi-tenant isolation gaps because the team that built the boundary cannot also be the team that adversarially evaluates it. The local CLI's blast radius is the operator's own machine and is mitigated by the other 5 P0s under rule #13. The cloud tier's blast radius is *every* customer's repo, *every* customer's API tokens, and *every* customer's data flowing through the multi-tenant OTEL aggregator — a categorical step up that no per-PR lint or in-tree gate can adequately cover.

- **Untrusted inputs**: every customer-side `claude --print` payload arriving at the cloud supervisor; every cross-repo benchmark artefact uploaded to the shared invariant catalog; every OTEL span emitted by a customer agent into the multi-tenant aggregator; every GH App webhook payload claiming to be a customer event; every billing-side request originating from a paywall provider.
- **Trusted state**: the audit firm's signed report (or its public executive summary); the list of remediated findings checked in to the repo; the post-remediation re-test verdict per finding; the GH App's per-installation private key (rotated per audit cadence).
- **Trust boundary**: the gate sits at the `cloud-tier-can-ship?` decision point. Past the gate, cloud customers begin sending real payloads — every preceding bytes-on-disk gate (rule #13.1–#13.5, #13.7) is necessary but not sufficient because the multi-tenant separation-of-privilege property cannot be unit-tested from inside.
- **STRIDE focus**:
  - **S**poofing — out of scope at v0; addressed by the audit's evaluation of the GH App auth flow + per-installation key isolation. Findings against this surface convert directly into P0 sub-tasks of this gate.
  - **T**ampering — out of scope at v0; addressed by the audit's evaluation of the multi-tenant OTEL pipeline (can tenant A inject spans attributed to tenant B?) + the shared invariant catalog (can a poisoned invariant propagate to other tenants' supervisors?).
  - **R**epudiation — addressed by the audit's evaluation of the billing path's audit log + the GH App event log retention + the per-tenant span retention policy. Local CLI is exempt (single operator; no multi-user audit need); cloud tier is the surface where this matters.
  - **I**nformation disclosure — the *primary* concern. Every preceding rule-#13 bullet (no secrets, no PII in spans, privacy-by-default, no third-party JS) is necessary; the audit verifies that those bullets *compose* correctly when stretched across tenants. The 2024 Snowflake incident's signature was per-tenant credentials reused across tenants — the audit catches that class of mis-composition.
  - **D**enial of service — addressed by the audit's evaluation of per-tenant rate-limits + multi-tenant noisy-neighbour isolation; out of scope at v0 (no cloud customers to denial-of-service yet).
  - **E**levation of privilege — addressed by the audit's evaluation of the cross-tenant trust boundaries (operator → cloud supervisor → tenant repo) + the privilege escalation paths through the GH App's installation token surface.

## Layer 1: gate lint (shipped)

`scripts/check-cloud-audit-gate.mjs` scans every PR diff for paths under `novel/cloud-supervisor/`, `novel/cross-repo-benchmark/`, or `novel/shared-invariant-catalog/` (the three packages that constitute the cloud tier; none exist in the tree today). The lint exits 1 when any such path is touched and the gate's `**Blocked**:` line in `TASKS.md` still names `needs-user-approval`. The lint exits 0 when none of the cloud-tier packages are touched, *or* when the `**Blocked**:` line has been removed (operator-side action; out of scope for autonomous loops per `feedback_modify_only_minsky_repo.md`). Wired into `scripts/run-pre-pr-lint-stack.mjs` (the same gate humans run via `lefthook`'s `pre-push`) and into `.github/workflows/ci.yml` as a required check.

The gate is a CI lint, not a runtime guard, because the cloud tier doesn't run yet — there's nothing to gate at runtime. The PR-time block is the deterministic enforcement (rule #10) that keeps cloud-tier code from accruing in `main` ahead of its audit. Same shape as the dependabot allowlist (rule #13.5 layer 3): a gate that sits dormant until the artefact it guards begins to land.

## Layer 2: findings tracker (planned)

Each audit finding becomes a P0 sub-task of `cloud-tier-external-security-audit-gate` in `TASKS.md`, with the standard rule-#9 metadata (Hypothesis / Success / Pivot / Measurement / Anchor) and a citation back to the section of the audit report that named it. The gate clears only when every P0 sub-task ships *and* the audit firm re-tests the post-remediation surface and confirms the critical findings as resolved. Filed as a P0 sub-task because the gate's authority is exactly the set of findings — adding a new finding ratchets the bar; resolving one releases pressure.

## Layer 3: public report disclosure (planned)

Per the audit-gate's open-design principle (Saltzer & Schroeder #4): the report (or its executive summary) is public. Publication is the difference between *we hired an audit firm* (a marketing claim) and *here is the report and here is what they found* (a verifiable claim). The intermediate state — a private audit whose existence is asserted but not testable — is rejected because it is indistinguishable from no audit at all. Operators / customers correctly discount internal claims; a private-only audit fails the same evidentiary bar.

## Unblock criteria

The `**Blocked**:` line in the `cloud-tier-external-security-audit-gate` task block carries `needs-user-approval` because engaging an external audit firm is a human action (vendor selection, contract, payment) and is out of scope for autonomous loops per `feedback_modify_only_minsky_repo.md`. Removing the line requires:

1. **Vendor selected.** A specialist firm with a published track record on multi-tenant SaaS (Trail of Bits / NCC Group / Doyensec / a comparable specialist) is contracted. The vendor's selection is recorded in `research.md` § "Cloud-tier audit vendor" with the rationale.
2. **Scope agreed.** The audit's scope covers, at minimum: cloud-supervisor's GH App auth flow; multi-tenant data isolation in the OTEL pipeline; the cross-repo invariant catalog's poisoning surface; the billing path's audit log (when the paywall lands).
3. **Report received.** The audit firm delivers a written report. The executive summary is committed to `docs/security/audit-report-summary.md` (or, if the firm permits, the full report is committed to the same path).
4. **Findings tracked.** Every critical / high finding is filed as a P0 sub-task of this gate in `TASKS.md`.
5. **Findings remediated.** Every P0 sub-task ships, with the standard rule-#9 metadata and the audit-section citation in its anchor.
6. **Re-test passed.** The audit firm re-tests the post-remediation surface and confirms the critical findings as resolved. The re-test verdict is recorded in `docs/security/audit-report-summary.md`.

Only after step 6 lands may the operator remove the `**Blocked**:` line; the gate lint then accepts cloud-tier package paths.

## Performance-first carve-out

Per rule #13's relief valve: when security and performance compete, performance wins on a case-by-case basis with the security cost declared in writing. None declared at this layer — the gate lint runs at PR time only and reads `TASKS.md` (a small file) plus the diff (already loaded by other lints). No hot-path latency is on the line. The audit itself is wall-clock-bounded by the firm's calendar, not by Minsky's runtime; the gate's whole point is to absorb that latency *before* customers depend on the cloud tier rather than after.

## Verification

- **Gate (cloud-tier path touched, blocked)**: synthetic PR adds a file to `novel/cloud-supervisor/`; `node scripts/check-cloud-audit-gate.mjs` exits 1 with a `cloud-tier-blocked-on-audit` violation citing the offending path and the `**Blocked**:` line. Pinned by `scripts/check-cloud-audit-gate.test.mjs`.
- **Gate (no cloud-tier paths touched)**: any PR that doesn't touch the three packages exits 0 silently.
- **Gate (block line removed)**: same diff as the first case, but with the `**Blocked**:` line removed from the task block; lint exits 0. (Verifiable once the operator removes the line per the unblock criteria above — pre-pinned by the test fixture's "blocked-line absent" case.)
- **Findings round-trip**: introduce a synthetic finding to the tracker; the corresponding P0 sub-task carries the audit-section citation in its anchor; the rule-#13-sibling-anchors gate (`scripts/check-rule-13-sibling-anchors.mjs`) accepts the citation form. (Verifiable once the audit lands.)

## Sources

- AICPA Trust Services Criteria (2017 ed.) — SOC 2 Type II is the canonical audit framework for SaaS multi-tenancy; the audit firm chooses the framework but SOC 2's criteria (security, availability, processing integrity, confidentiality, privacy) are the floor.
- CNCF Security TAG, "Cloud Native Security Whitepaper", v2 (2022) — multi-tenant infrastructure ships with third-party audit + public attestation; the empirical case is the same as the SBOM disclosure case (rule #13.5).
- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — open design (the report is public; security does not depend on report secrecy); separation of privilege (the audit firm and the build team are separate principals); fail-safe defaults (the gate exits 1 by default until every unblock criterion is satisfied).
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
- Empirical record: Codecov (2021), Okta (2022), MOVEit (2023), Snowflake (2024) — every multi-tenant SaaS breach since 2020 was eventually caught by external researchers; internal review insufficient.
- rule #1 (don't reinvent — use the existing audit-firm market); rule #6 (stay alive — security failures kill systems faster than bugs); rule #9 (pre-registered HDD — every audit finding becomes a rule-#9-shaped sub-task); rule #10 (deterministic enforcement — the gate is a CI lint, not a hope); rule #13 (security & privacy as #2 priority after performance — this doc is the operator-facing operationalisation of minimum-bar item 6).
