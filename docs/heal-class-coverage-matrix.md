# Heal-Class Coverage Matrix

_Generated 2026-06-21 · window 168h · 11 classified failures · status: ok_

**heal-class coverage:** 0% of observed failure classes have a dispatch handler

| failure_class | observed_count | heal_handler | heal_exists |
|---|---|---|---|
| unknown | 11 | — | ❌ |
| ModuleNotFoundError | 0 | — | ❌ |
| command not found | 0 | — | ❌ |
| Killed | 0 | — | ❌ |
| signal 15 | 0 | — | ❌ |
| ENOENT | 0 | — | ❌ |
| Not logged in | 0 | — | ❌ |

## Uncovered observed classes

- **unknown** (11 occurrences) — no heal handler → file `heal-unknown` task

## Dispatchable heal catalog

_Source: `scripts/heal-dispatch.mjs` `buildPreWalkHeals` + `buildPreSpawnHeals`_
