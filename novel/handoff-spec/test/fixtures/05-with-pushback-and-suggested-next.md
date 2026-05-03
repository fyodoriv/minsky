# Handoff: budget threshold disagreement

- **From**: code-reviewer
- **To**: executor
- **Status**: needs-rework
- **Summary**: The 70% / 85% thresholds are right but the proposed implementation hardcodes them in code. Per ARCHITECTURE.md they must be configurable via config/budget-guard.json. Asking for a config-loader before merge.
- **Artifacts**:
  - novel/budget-guard/src/index.ts
  - ARCHITECTURE.md
- **Pushback**:
  - thresholds must be runtime config, not constants in code
  - mocking thresholds in tests stays valid (DI), but defaults come from config
- **Suggested next**:
  - executor
  - architect
- **Created-at**: 2026-05-03T19:30:00Z
