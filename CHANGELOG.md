<!-- pattern: not-applicable — developer-facing pointer to the GitHub Releases surface; the release notes themselves live in GitHub Release objects, not in this file (see docs/release.md) -->

# Changelog

> The developer-facing contract for how Minsky cuts releases via [semantic-release](https://semantic-release.gitbook.io/) — every push to `main` with a `feat:` / `fix:` / `perf:` / `BREAKING CHANGE:` commit triggers a release. The release **notes** live on the [GitHub Releases page](https://github.com/fyodoriv/minsky/releases), not in this file.

## What this file is

The map between conventional-commit types and version bumps, plus a pointer to where the real release notes live. The notes are NOT written into this file: per the operator decision in [`docs/release.md`](./docs/release.md) (`release-pat-vs-github-releases-decision`), Minsky cuts **GitHub Releases only** — the `@semantic-release/git` + `@semantic-release/changelog` plugins that would commit notes back to `main` were removed in PR #703 (the built-in `GITHUB_TOKEN` can't bypass `main`'s branch protection, and no PAT is provisioned). Versioning follows [MILESTONES.md](./MILESTONES.md) (M1 = v0.1.0, M2 = v0.2.0, M3 = v0.3.0, M4 = v1.0.0, M5 = v2.0.0).

Each GitHub Release is generated from the conventional commits merged into `main` since the previous tag. The bump kind is decided structurally:

| Commit type | Version bump |
|---|---|
| `feat:` | minor |
| `fix:` / `perf:` | patch |
| any commit footer `BREAKING CHANGE:` or `feat!:` / `fix!:` | major |
| `docs:` / `chore:` / `style:` / `refactor:` / `test:` / `build:` / `ci:` | no release |

The corresponding GitHub Release is available at <https://github.com/fyodoriv/minsky/releases>.

## What this file is not

- **Not the release-notes archive** — the notes live in [GitHub Release objects](https://github.com/fyodoriv/minsky/releases), not below. semantic-release does not commit them here (no `@semantic-release/git` plugin). To correct a wrong release note, fix the source commit or add a corrective `revert:` / `fix:` so the next release reflects it.
- **Not the release-mechanism decision** — see [`docs/release.md`](./docs/release.md) for why Minsky cuts GitHub Releases only and provisions no commit-back PAT.
- **Not the daily narrative** — see [`docs/CHANGELOG-narrative-history.md`](./docs/CHANGELOG-narrative-history.md) for the daily prose journal format used between 2026-05-05 and 2026-05-18.
- **Not the milestones doc** — see [MILESTONES.md](./MILESTONES.md) for the roadmap and exit criteria per milestone.

## How to influence a release

- **To bump minor**: prefix your commit subject with `feat:` (or `feat(<scope>):`).
- **To bump patch**: use `fix:` or `perf:`.
- **To bump major**: include a `BREAKING CHANGE:` footer in the commit body OR use `feat!:` / `fix!:`.
- **To skip release**: use `docs:`, `chore:`, `style:`, `refactor:`, `test:`, `build:`, or `ci:`. These commit types are mapped to *no version bump* in `.releaserc.json` → `commit-analyzer.releaseRules`.

The rule of thumb: if a reviewer would care to read about your change in a release note, your commit type is `feat` / `fix` / `perf`. Otherwise it's a non-release commit and won't appear in the release notes.

The generated notes for each release are on the [GitHub Releases page](https://github.com/fyodoriv/minsky/releases) — semantic-release does not append them to this file (no `@semantic-release/git` plugin; see [`docs/release.md`](./docs/release.md)).
