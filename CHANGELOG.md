<!-- pattern: not-applicable — auto-generated release notes managed by semantic-release per .releaserc.json (Keep a Changelog v1.1.0 format) -->

# Changelog

> Versioned release notes for Minsky. Managed by [semantic-release](https://semantic-release.gitbook.io/) — every push to `main` with a `feat:` / `fix:` / `perf:` / `BREAKING CHANGE:` commit triggers a release.

## What this file is

The canonical release-notes surface for Minsky, written entirely by `.github/workflows/release.yml` via [semantic-release](https://semantic-release.gitbook.io/). Format follows [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/) and semantic versioning per [MILESTONES.md](./MILESTONES.md) (M1 = v0.1.0, M2 = v0.2.0, M3 = v0.3.0, M4 = v1.0.0, M5 = v2.0.0).

Each release section is generated from the conventional commits merged into `main` since the previous tag. The bump kind is decided structurally:

| Commit type | Version bump |
|---|---|
| `feat:` | minor |
| `fix:` / `perf:` | patch |
| any commit footer `BREAKING CHANGE:` or `feat!:` / `fix!:` | major |
| `docs:` / `chore:` / `style:` / `refactor:` / `test:` / `build:` / `ci:` | no release |

The corresponding GitHub Release is available at <https://github.com/fyodoriv/minsky/releases>.

## What this file is not

- **Not hand-editable** — every entry below is authored by semantic-release. If you find a wrong entry, fix the source commit (or open a PR that adds a corrective `revert:` / `fix:`), don't edit this file directly. The git lefthook + a paired test verify no human commits touch CHANGELOG.md outside the `semantic-release-bot` identity.
- **Not the daily narrative** — see [`docs/CHANGELOG-narrative-history.md`](./docs/CHANGELOG-narrative-history.md) for the daily prose journal format used between 2026-05-05 and 2026-05-18.
- **Not the milestones doc** — see [MILESTONES.md](./MILESTONES.md) for the roadmap and exit criteria per milestone.

## How to influence a release

- **To bump minor**: prefix your commit subject with `feat:` (or `feat(<scope>):`).
- **To bump patch**: use `fix:` or `perf:`.
- **To bump major**: include a `BREAKING CHANGE:` footer in the commit body OR use `feat!:` / `fix!:`.
- **To skip release**: use `docs:`, `chore:`, `style:`, `refactor:`, `test:`, `build:`, or `ci:`. These commit types are mapped to *no version bump* in `.releaserc.json` → `commit-analyzer.releaseRules`.

The rule of thumb: if a reviewer would care to read about your change in a release note, your commit type is `feat` / `fix` / `perf`. Otherwise it's a non-release commit and won't appear here.

<!-- The semantic-release bot writes new release entries below this line. -->
