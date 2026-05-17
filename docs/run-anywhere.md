# Run-anywhere — permission-scoped writes

A run-anywhere conductor may walk many git repos under the operator's
tree. Least authority (Saltzer & Schroeder 1975; rule #13) requires that
code only ever lands in the **one** repo the run was invoked for.

## Classification (`classifyRepo`, rule #10 — pure, no model)

Every repo the run touches is exactly one of:

- **home** — the invoked folder's git repo (or its `origin`). Identity
  is the normalized `origin` URL (scp / https / `.git` / trailing-slash
  forms compare equal), with a root-path fallback for origin-less local
  clones.
- **foreign** — anything else. **Fail-safe default**: if identity is
  unprovable (no usable origin and no comparable root), the verdict is
  `foreign` — "don't know" never grants the code-push privilege.

## Write matrix (`assertWriteAllowed`, default-deny)

| repo class | `push` (code)        | `pr`                                         |
| ---------- | -------------------- | -------------------------------------------- |
| home       | ✅ full flow         | ✅ full flow                                 |
| foreign    | ❌ `foreign-push-refused` | ✅ **iff** every diff path is `TASKS.md`; else ❌ `foreign-pr-non-taskmd` / ❌ `foreign-pr-no-diff` |

A foreign repo's only permitted write is a `gh pr create` whose diff is
limited to its `TASKS.md` (scout-and-record across the fleet). Any
non-`TASKS.md` change or any code push to a foreign repo is refused and
logged with a typed reason.

## Verdict ledger

The conductor's only code write is the gated merge in
`scripts/local-gate-merge.mjs` (`gh pr merge --admin` onto `main` —
a `push`-class write). Each non-dry sweep appends to
`.minsky/runany-policy.jsonl`:

```text
{ts, event:"run-start",     runId}                     # window delimiter
{ts, event:"write-verdict", repoClass, action,         # one per attempt
 allowed, taskmdOnly, code}
{ts, event:"minsky-self-task-filed", taskId}           # scout-and-record
```

The gate refuses the merge (and skips the PR) unless the target repo is
provably **home**; if the gate module itself fails to load, the sweep
refuses **all** merges — no gate ⇒ no code write.

## Measurement (pre-registered)

```bash
node scripts/runany-policy-audit.mjs --window=run --json
# → {foreign_code_pushes:0, foreign_prs_nontaskmd:0,
#    minsky_self_tasks_filed:>=1, pass:true}
```

`--window=run` counts only records since the last `run-start`. An
*allowed* foreign code push or *allowed* non-`TASKS.md` foreign PR is an
**escape** (threshold 0); by construction `assertWriteAllowed` never
allows either, so the counters stay 0 unless a regression bypasses the
gate — which the metric then surfaces loudly rather than hides.
