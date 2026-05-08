# Supply-chain hardening — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 5 ("Supply-chain hardening — pnpm lockfile integrity + SBOM + SLSA provenance for releases"), Minsky layers three deterministic gates between the npm ecosystem and the supervisor binary the operator runs. This doc consolidates the threat model, the gates that have shipped, the gates still to ship, and the verification commands consumers will run once the cloud tier is published. Anchors: SLSA Specification 1.0 (slsa.dev/spec/v1.0/, 2025); CycloneDX 1.5 / 1.6 (cyclonedx.org/docs/1.5/json/); NIST SP 800-218 SSDF PW.4 (manage third-party software security, 2022); OWASP Top 10 A06:2021 (vulnerable & outdated components).

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003. The empirical precedent is the 2018 `event-stream` hijack, the 2021 `ua-parser-js` compromise, the 2022 `colors.js` self-sabotage, and the 2025 `chalk` / `debug` integrity-hash swap — every one a transitive dependency that arrived through `npm`/`pnpm install` and shipped to consumers before the maintainer noticed.

- **Untrusted inputs**: every `dependencies` / `devDependencies` entry in [`package.json`](../../package.json), every transitive resolved through [`pnpm-lock.yaml`](../../pnpm-lock.yaml), every release artefact downloaded from `npm` registries, every Dependabot-authored PR.
- **Trusted state**: the integrity hashes pinned in `pnpm-lock.yaml` at the moment a dependency entered the tree (the consumer-side fingerprint of "the bytes the maintainer signed at publish time"); the [CycloneDX](https://cyclonedx.org/docs/1.5/json/) shape that downstream tooling expects; the GH Action workflow identity that builds release artefacts (the SLSA "what built this" claim).
- **Trust boundary**: the lockfile diff against `origin/main` is the gate at PR time; the SBOM shape validator is the gate at release time; the SLSA attestation is the gate at consumer-install time. Past those three boundaries the bytes are trusted.
- **STRIDE focus**:
  - **S**poofing — addressed by SLSA provenance (consumer can verify the release artefact came from the expected GH Actions workflow, not a stolen-credential push). Not yet shipped (slice ≥7 of the SBOM/SLSA sub-track).
  - **T**ampering — `scripts/check-lockfile-integrity.mjs` rejects any PR that changes a same-`name@version` entry's integrity hash; that's the empirical fingerprint of the 2025 `chalk` / `debug` incident. The SBOM-shape validator catches generator-side regressions (missed `purl`, duplicated `bom-ref`, unsupported `specVersion`) before the artefact reaches the consumer.
  - **R**epudiation — out of scope at v0; the local CLI has no multi-tenant audit trail. Filed as `cloud-tier-external-security-audit-gate` follow-up for the cloud tier.
  - **I**nformation disclosure — supply-chain channel is not the leak vector at v0 (the dashboard / OTEL / scan-secrets gates cover the disclosure surfaces); SBOM publication is intentional disclosure of the dep graph to consumers, not a leak.
  - **D**enial of service — Dependabot's PR cadence is rate-limited at the source (5 open PRs max per ecosystem in `.github/dependabot.yml`); CI gates run in ephemeral runners with no persistent state to exhaust.
  - **E**levation of privilege — a hijacked transitive that lands in `pnpm-lock.yaml` runs at the same privilege as the supervisor (which is constrained separately by the systemd / launchd sandbox per rule #13.3). The lockfile-integrity gate is the first line of defence; the sandbox is the second.

## Layer 1: lockfile-integrity gate (shipped)

`scripts/check-lockfile-integrity.mjs` (slices 1–4 — PRs #263, #264, #265, #266) diffs `pnpm-lock.yaml` against `origin/main` and rejects every same-`name@version` entry whose integrity hash changed. The classifier (slice 1) is pure; the diff walker (slice 2) aggregates all violations; the YAML parser (slice 3) is a hand-written state machine because pnpm's lockfile dialect is not generic YAML; the CLI (slice 4) wires them into a runnable gate.

The CI job `lockfile-integrity` (in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) runs on every PR + every push to `main`. Push-event coverage is deliberate: a hijack that lands via direct push must still surface (and rotate) — a PR-only gate is not enough.

The empirical signal: when `chalk@5.3.0` or `debug@4.3.4` (or any other entry) appears in the diff with the same `name@version` but a changed `integrity:` hash, the gate fails with a `:` violation citing both hashes and the historical CVEs as the precedent. The remediation is to investigate whether the registry republished the package (rare, surfaces in maintainer's announcements) or whether the PR's `pnpm install` recomputed against a tampered cache (the 2025 incident's signature).

## Layer 2: SBOM-shape validator (shipped)

`scripts/check-sbom-shape.mjs` (slices 1–5 — PRs #269, #270, #285, #286, and the existing `sbom-shape` job in `ci.yml`) classifies an already-parsed CycloneDX 1.5 / 1.6 SBOM against the subset that downstream tooling depends on: `bomFormat === "CycloneDX"`, `specVersion ∈ {1.5, 1.6}`, `version` is a positive integer, every component carries a `type` from the spec enum + a non-empty `name`, every `library`-typed component carries a non-empty `version` + a `pkg:<type>/<name>@<version>` `purl`, and `bom-ref`s are unique within the document.

The CI job `sbom-shape` exits 0 when no `sbom.cdx.json` is on disk (fail-safe-defaults — Saltzer & Schroeder 1975): exit 0 = clean *or* nothing to scan; exit 1 = SBOM shape violation; exit 2 = cannot evaluate (read failure, JSON malformed). The gate validates the artefact before it is attached to the release by Layer 4.

## Layer 3: Dependabot allowlist (shipped via PR #291)

[`.github/dependabot.yml`](../../.github/dependabot.yml) configures Dependabot's `npm` updater (which reads `pnpm-lock.yaml` natively as of GitHub's 2024 update) with `allow: [{ dependency-type: direct }]` so transitive bumps don't create noisy churn against `pnpm`'s resolver. Dev-dependency minor / patch updates are grouped weekly; runtime patches are grouped weekly; security updates open immediate PRs independent of the schedule (Dependabot's documented behaviour for vulnerability alerts). The `github-actions` ecosystem is configured separately with the same weekly cadence so action-pin drift surfaces in a predictable PR queue rather than a once-a-year audit.

## Layer 4: SBOM generation workflow (shipped)

[`.github/workflows/sbom.yml`](../../.github/workflows/sbom.yml) triggers on every `release: created` event. It installs pnpm dependencies, runs `@cyclonedx/cyclonedx-npm` to emit `sbom.cdx.json` (CycloneDX 1.5 or 1.6), validates the shape with `node scripts/check-sbom-shape.mjs`, and attaches the file to the release via `gh release upload`. Pre-registered in `experiments/security-sbom-generation-2026-05-07.yaml`.

Pivot: if `@cyclonedx/cyclonedx-npm` emits a specVersion outside `{1.5, 1.6}` (i.e., `check-sbom-shape.mjs` exits 1 with `unsupported-specVersion`), pivot to `@cyclonedx/cdxgen` — same CycloneDX output, toolkit-agnostic generator. Do not widen `ALLOWED_SPEC_VERSIONS` until CycloneDX has published the new version and downstream tooling supports it.

## Layer 5: SLSA provenance (shipped)

[`.github/workflows/slsa.yml`](../../.github/workflows/slsa.yml) triggers on every `release: created` event. It packs `distribution/` and `setup.sh` into a versioned tarball, computes SHA-256 hashes, and passes them to the [`slsa-framework/slsa-github-generator`](https://github.com/slsa-framework/slsa-github-generator) reusable workflow (CNCF reference implementation), which produces a Sigstore-signed SLSA Build Level 3 provenance document attached to the release. Pre-registered in `experiments/security-slsa-provenance-2026-05-07.yaml`.

Consumer verification:

```sh
slsa-verifier verify-artifact minsky-dist-<tag>.tar.gz \
  --provenance-path minsky-dist-<tag>.tar.gz.intoto.jsonl \
  --source-uri github.com/<owner>/<repo>
```

## Follow-ups

- **Consumer-side verification doc on Releases page** — surface the `slsa-verifier` and `gh release download` commands in the GitHub Releases release notes for each tag. A follow-up for the cloud tier; SLSA provenance is already machine-verifiable without it.

## Performance-first carve-out

Per rule #13's relief valve: when security and performance compete, performance wins on a case-by-case basis with the security cost declared in writing. None declared at this layer — the lockfile-integrity gate runs in ≤2s on the current dep tree, the SBOM-shape validator is pure JSON walking on a ≤MB artefact, and both release workflows run in already-provisioned runners (no hot-path latency).

## Verification

- **Lockfile gate (synthetic violation)**: introduce a same-`name@version` entry with a flipped `integrity:` hash on a PR branch; run `node scripts/check-lockfile-integrity.mjs --diff-base=origin/main`; gate exits 1 with `:` violations naming both hashes.
- **Lockfile gate (clean PR)**: any PR that bumps a real version (e.g., `lodash@4.17.21 → 4.17.22`) is accepted because the entry's `name@version` differs — only same-version hash flips trip the gate.
- **SBOM gate (no SBOM committed)**: `node scripts/check-sbom-shape.mjs` exits 0 with `sbom-shape skipped: sbom.cdx.json not present.` (fail-safe defaults).
- **SBOM gate (synthetic CycloneDX)**: write a 1.5 SBOM with one `bomFormat: "WRONG"`; gate exits 1 with `wrong-bomFormat` and the remediation hint.
- **SBOM gate (malformed JSON)**: write a truncated `sbom.cdx.json`; gate exits 2 with `cannot parse … invalid-json` (cannot evaluate, distinguishable from shape-violation).
- **SBOM generation (release)**: `gh release view <tag> --json assets --jq '.assets[] | select(.name == "sbom.cdx.json") | .name'` returns `sbom.cdx.json` for every release after the workflow ships.
- **SLSA provenance (release)**: `gh release view <tag> --json assets --jq '.assets[] | select(.name | endswith(".intoto.jsonl")) | .name'` returns the provenance document for every release after the workflow ships.
- **Dependabot allowlist**: a transitive bump (`dependency-type: indirect`) does not produce a Dependabot PR; only `direct` deps and security advisories generate PRs. Verify by inspecting Dependabot's GitHub UI after the config has been live for one full schedule cycle.

Paired tests pin every CLI verdict path: [`scripts/check-lockfile-integrity.test.mjs`](../../scripts/check-lockfile-integrity.test.mjs), [`scripts/check-sbom-shape.test.mjs`](../../scripts/check-sbom-shape.test.mjs).

## Sources

- SLSA Specification 1.0, slsa.dev/spec/v1.0/, 2025 — provenance levels L1–L4, Sigstore as the canonical signer.
- CycloneDX 1.5 specification, cyclonedx.org/docs/1.5/json/, 2023; 1.6 specification, cyclonedx.org/docs/1.6/json/, 2024 — `bomFormat` / `specVersion` / `components[]` / the `Component.type` enum are normative.
- purl specification, github.com/package-url/purl-spec, 2024 — `pkg:<type>/<name>@<version>` is the canonical component identity for npm packages.
- NIST SP 800-218 (Secure Software Development Framework), 2022 — PW.4 (manage third-party software security), PW.7 (review and analyze human-readable code).
- OWASP Top 10 A06:2021 — vulnerable & outdated components; the empirical evidence supply-chain CVEs land in shipped software.
- CNCF Security TAG SBOM working group, 2024 — every release should ship a machine-verified SBOM.
- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — fail-safe defaults (the exit-code split between `1` "shape violation" and `2` "cannot evaluate"); economy of mechanism (one classifier, one walker, one parser, one CLI per layer).
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
- Historical CVEs: `event-stream` (2018), `ua-parser-js` (2021), `colors.js` (2022), `chalk` / `debug` (2025) — the empirical case for every gate above.
