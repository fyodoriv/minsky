<!-- pattern: not-applicable — ephemeral PR description file, not a project artefact -->
# chore(tasks): close minsky-cross-machine-dotfile-checks — shipped

Removes the `minsky-cross-machine-dotfile-checks` P0 task from TASKS.md now that all slice 3 deliverables are merged and confirmed live in main.

## Bundled fix: `@opentelemetry/resources` v2.7.1 API change

`novel/adapters/observability/src/otel.ts` was using `new Resource({})` which was removed in `@opentelemetry/resources` 2.7.1 (bumped via an earlier dep-update PR). The constructor was replaced by `resourceFromAttributes()`. Changed one import and one call site — no behaviour change; `tsc -b` now exits 0.

## What shipped (pre-existing in main)

All acceptance criteria were met in earlier PRs:

- `novel/tick-loop/src/git-config-path-checks.ts` — pure `checkGitConfigPaths` helper with injection seams for `getGitConfigFn` / `existsSyncFn`
- `novel/tick-loop/src/git-config-path-checks.test.ts` — 9 paired tests covering all-unset, set+valid, set+missing (single + multi-key), scope→recovery mapping (global/local/system/unknown), PATH_CONFIG_KEYS export, `formatBrokenPathMessage` wording contract
- `novel/tick-loop/src/index.ts` — re-exports the four public types + helper + formatter
- `novel/tick-loop/bin/minsky.mjs` — `emitGitConfigSanityRows()` wired after substrate rows in `runDoctor`; `getGitConfigShowOrigin` (shells out to `git config --show-origin --get`); `existsSyncWithTildeExpansion` (expands `~/` before `existsSync`)
- `setup.sh` — `check_git_config_path` function + loop over `MINSKY_PATH_CONFIG_KEYS` in `--doctor` path
- `novel/tick-loop/README.md` — slice 3 section with output example and 4-item breakdown
- `docs/local-llm-fallback.md` — cross-link to slice 3 in the doctor-output prose (line 24)

`minsky doctor` now shows:

```text
  ✓ git config core.hooksPath
  ⚠ git config core.attributesfile  — /Users/dotfiles-user/.gitattributes (global) does not exist; recover with `git config --global --unset core.attributesfile`
  ✓ git config core.excludesfile
```

Measurement (from task Verification): `git config --local core.hooksPath /tmp/nonexistent-xyz123 && pnpm minsky doctor 2>&1 | grep -c "core.hooksPath"` returns ≥1. ✓

## Optimization

optimization: none-this-iteration — this PR is task closure only (TASKS.md removal); no runtime-path code.

## Hypothesis self-grade

- **Predicted**: post-fix, `minsky doctor` adds a "git config sanity" section with one row per of the 3 highest-impact keys; each row GREEN/✓ when unset or valid, YELLOW/⚠ when set + path missing, with a copy-paste-able recovery command; doctor banner stays YELLOW, not RED
- **Observed**: all deliverables confirmed present in main — `git-config-path-checks.ts` (130 LOC), 9 paired tests, `emitGitConfigSanityRows()` wired in `minsky.mjs`, `check_git_config_path` in `setup.sh`, README slice 3 section, `docs/local-llm-fallback.md` cross-link on line 24
- **Match**: yes
- **Lesson**: implementation landed across multiple earlier PRs without a matching TASKS.md closure commit; closing the loop here keeps the P0 board accurate and prevents daemon re-picking a completed task

<!-- rule-3: refactor-no-public-surface -->
<!-- security: not-applicable — TASKS.md removal only; no code surface added -->
