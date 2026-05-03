# Handoff: parser blocked on spec ambiguity

- **From**: executor
- **To**: architect
- **Status**: blocked
- **Summary**: While implementing the parser I hit a spec ambiguity around how to treat trailing whitespace on the Created-at field. spec.md doesn't specify whether to trim or preserve. Need clarification before proceeding.
- **Blockers**:
  - spec.md is silent on Created-at trimming
  - cannot ship until decision made
- **Created-at**: 2026-05-03T18:05:00Z
