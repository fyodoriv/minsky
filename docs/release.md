<!-- pattern: see vision.md § "Pattern conformance index" rows tagged `rule #10` (deterministic enforcement) + Humble & Farley 2010 (continuous delivery via conventional commits) — this doc records the operator's release-mechanism decision so it stops being re-litigated on every CI-stabilization sweep. -->

# Release mechanism

> The canonical guide to how Minsky cuts releases: GitHub Releases driven by [semantic-release](https://semantic-release.gitbook.io/), reading the conventional-commit history of `main`. This doc records the durable choice the operator confirmed (GitHub Releases, no commit-back PAT) so it isn't re-decided every time someone notices `@semantic-release/git` is absent from `.releaserc.json`.

This file exists because the release path went through one false start and the residue confused later readers. PR #703 removed `@semantic-release/git` from `.releaserc.json` because the built-in `GITHUB_TOKEN` cannot bypass `main`'s branch protection to commit the bumped `CHANGELOG.md` back. The open question — *is GitHub-Releases-only the durable path, or should we provision a PAT to re-enable commit-back?* — was tracked as `release-pat-vs-github-releases-decision`. The operator's directive ("set up github releases for this") is the answer: **GitHub Releases is the user-facing release surface; no PAT is provisioned.** This doc is the durable record of that decision and what it implies.

## What this is

The decision and its consequences, in one place:

- **Mechanism**: every push to `main` runs `.github/workflows/release.yml`, which invokes `semantic-release`. The plugin chain in `.releaserc.json` is exactly three plugins:
  1. `@semantic-release/commit-analyzer` — decides the bump (`feat:` → minor, `fix:`/`perf:` → patch, `BREAKING CHANGE:` → major; `docs:`/`chore:`/`style:`/`refactor:`/`test:`/`build:`/`ci:` → no release).
  2. `@semantic-release/release-notes-generator` — renders the release-notes body from those commits.
  3. `@semantic-release/github` — creates the git tag and the [GitHub Release](https://github.com/fyodoriv/minsky/releases) carrying that body.
- **No commit-back**: there is no `@semantic-release/git` plugin and no `@semantic-release/changelog` plugin. semantic-release does **not** write to or commit `CHANGELOG.md` on `main`. The release notes live in the GitHub Release object, not in a file mutated on `main`. This is the deliberate consequence of dropping commit-back: nothing needs write access to a protected branch, so the built-in `GITHUB_TOKEN` (scoped to `contents: write` for the tag + release only) suffices.
- **No PAT**: provisioning a Personal Access Token with `admin:write_repo` to re-enable `@semantic-release/git` was explicitly declined. A PAT adds credential surface (a long-lived secret with branch-protection-bypass power) for the marginal benefit of an in-repo `CHANGELOG.md` mirror of notes that already exist in the GitHub Release. Not worth it.

The verification command set (from the task's `**Measurement**`):

```bash
jq '.plugins | length' .releaserc.json   # → 3 (commit-analyzer, release-notes-generator, github)
gh release list --limit 5                # → recent GitHub Releases
```

## What this is not

- **Not a mandate to keep `CHANGELOG.md` hand-current.** `CHANGELOG.md` survives as a developer-facing pointer/contract doc — it explains the conventional-commit → bump mapping and links to the GitHub Releases page. It is NOT auto-written by semantic-release (the commit-back plugin that would do so was removed). The `changelog-md-update` lint (`scripts/check-changelog-md-update.mjs`) accepts either a manual `CHANGELOG.md` edit **or** a conventional-commit subject — the latter is the normal path, because the GitHub Release is the real artifact.
- **Not the npm-publish contract.** The `npm-publish` job in `release.yml` is a separate, `NPM_TOKEN`-gated no-op until the operator reserves the package name. See that workflow's inline comment.
- **Not the daily-narrative changelog.** That format was frozen 2026-05-21 — see [`CHANGELOG-narrative-history.md`](./CHANGELOG-narrative-history.md).

## Pivot path (if the decision is ever revisited)

If a future operator wants the in-repo `CHANGELOG.md` mirror back, the path is: provision a PAT with branch-protection-bypass, store it as a repo secret, pass it to semantic-release as `GITHUB_TOKEN`, and re-add `@semantic-release/changelog` + `@semantic-release/git` to `.releaserc.json` (raising the plugin count from 3 to 5). Until then, this doc — and the absence of those two plugins — is the steady state.
