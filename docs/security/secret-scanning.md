# Secret scanning

Minsky uses [gitleaks](https://github.com/gitleaks/gitleaks) to block secrets
from landing in the repository. The gate runs at two points:

| Gate | Trigger | Bypassable? |
|------|---------|------------|
| Pre-commit hook (lefthook) | Every `git commit` with staged changes | Yes — local only (`MINSKY_SKIP_SECRET_SCAN=1`) |
| CI job (`secret-scan`) | Every PR and push to `main` | **No** |

Anchor: rule #13 (vision.md § 13 — security & privacy — second priority after performance;
item 3 — secret scanning at commit and CI); Truffle Security "State of Secrets Sprawl 2023"
(median TTD for public GitHub secrets: hours); Beyer SRE 2016 Ch. 5 (defence in depth).

## Installing gitleaks locally

```bash
# macOS
brew install gitleaks

# Linux (latest release)
GITLEAKS_VERSION=8.18.4
curl -sSfL \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  | tar -xz -C ~/.local/bin gitleaks
```

After installing, `lefthook install` (or `pnpm dlx lefthook install`) wires the
pre-commit hook automatically.

## Emergency local bypass

If you need to commit without running the scan (e.g., the binary is broken
and you need to land a hotfix), set `MINSKY_SKIP_SECRET_SCAN=1`:

```bash
MINSKY_SKIP_SECRET_SCAN=1 git commit -m "hotfix: ..."
```

The CI `secret-scan` job is **not bypassable** — every PR must pass it before
the `ci` gate clears.

## Configuration (`.gitleaks.toml`)

The repo-root `.gitleaks.toml` extends the default gitleaks ruleset. When you
encounter a false positive, add an allowlist entry to `.gitleaks.toml` with:

1. A `description` naming the pattern and why it is safe.
2. A reference to the TASKS-id that introduced the pattern.

```toml
[[allowlists]]
description = "fake key in otel-pii test fixture (otel-no-pii-in-spans-lint)"
paths = ['''test/fixtures/otel-pii/''']
```

Never add a broad allow-list entry that covers real secrets. Each entry is
code-reviewed like any other change.

## Historical audit

To scan the full commit history locally:

```bash
gitleaks detect --log-opts="--all" --redact --no-banner --config .gitleaks.toml --exit-code 1
```

The CI `secret-scan` job runs this with `fetch-depth: 0` on every PR so
historical leaks surface before they reach `main`.

## What to do if a secret leaks

1. **Rotate immediately** — treat the secret as compromised regardless of
   visibility (Truffle Security 2023: median attacker dwell time is hours).
2. **Revoke the old credential** in the relevant service console.
3. **Remove the secret from git history** using `git filter-repo` or BFG.
4. **File a P0 task** for the rotation (a separate human-visible action per the
   no-cross-repo rule; the daemon cannot rotate credentials).
5. Add an allowlist entry or fix the root cause so the gate doesn't re-fire
   on the cleanup commit.

## Pivot threshold

If the default ruleset generates ≥ 3 false positives per month, switch to
[trufflehog](https://github.com/trufflesecurity/trufflehog) — more tunable
per-pattern entropy detection. The lefthook + CI integration is reversible;
only the scanner binary changes.
