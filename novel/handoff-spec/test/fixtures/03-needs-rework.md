# Handoff: parser tests need rework

- **From**: qa-tester
- **To**: executor
- **Status**: needs-rework
- **Summary**: Reviewed the parser tests. Coverage is 100 % statement-wise but several edge cases aren't exercised — specifically what happens on duplicate field labels and on a heading without any fields. Asking for these tests to be added before sign-off.
- **Pushback**:
  - duplicate-field handling is undefined behaviour today
  - empty-handoff handling is undefined behaviour today
- **Created-at**: 2026-05-03T18:30:00Z
