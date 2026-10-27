# Proof data

> How the README `## Proof` numbers are made, where they live, and what leaves your machine.

This page exists so a reader can check every number in the README Proof section, and so a user knows exactly what Minsky records and sends.

## What this file is

The how-to and privacy note for field recording (`scripts/usage-events.mjs`), opt-in telemetry (`scripts/telemetry.mjs`), and the Proof generator (`scripts/proof.mjs`).

## What this file is not

- Not the metrics catalogue: see [METRICS.md](../METRICS.md).
- Not the OpenTelemetry setup: see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Field recording (local, on by default)

- Each `minsky <command>` run appends one line to `~/.minsky/usage.jsonl`.
- A line holds only: the time, the command name (from a fixed list, else `other`), `ok` or `error`, the exit code, and the duration.
- Never arguments, paths, host names, user names, or task text.
- Off: `MINSKY_USAGE=off`. Tests (vitest) never record.

## Telemetry to PostHog EU (opt-in)

- Sends nothing until the owner stores a project key: env `MINSKY_POSTHOG_KEY`, or the macOS Keychain item service `minsky`, account `posthog_key`.
- Sends the allowlisted usage lines above, at most once a day in one batch, to `https://eu.i.posthog.com/batch/`, under a random install id.
- Person profiles and GeoIP are off (`$process_person_profile: false`, `$geoip_disable: true`).
- Commands: `minsky telemetry status`, `minsky telemetry off`, `minsky telemetry on`, `minsky telemetry send --dry-run` (prints the exact body, key hidden).
- `DO_NOT_TRACK=1` stops all sending. A first run prints one line that says this.
- Agents: ask the owner before `minsky telemetry send`.
- State (install id, cursor, on/off): `~/.minsky/telemetry.json`. Delete it to reset.

## The Proof generator

| Step | Command | Output |
|---|---|---|
| Collect | `node scripts/proof.mjs collect` | `docs/proof/metrics.json`: value, unit, date, data kind, command, machine count n, history per metric |
| Render | `node scripts/proof.mjs render` | the README block between `<!-- proof:start -->` and `<!-- proof:end -->` |
| Check | `node scripts/proof.mjs render --check` | exit 1 when the README is stale (also `scripts/proof.test.mjs`) |

- With `MINSKY_POSTHOG_PERSONAL_KEY` and `MINSKY_POSTHOG_PROJECT_ID` set, `collect` reads totals from PostHog's query API: data kind `real use`, n = distinct install ids.
- Without them, it reads this machine's `usage.jsonl`: data kind `local run, <date>, machine <hash>`. The hash is salted (`~/.minsky/machine-salt`), never a host or user name. Pass `--kind "real use"` only when the lines come from real work.
- The first numbers (2026-10-26) are 9 read-only commands (`daemon doctor`, `status`, `show`, `report`, and others) an agent ran on the owner's Mac. They prove the recorder works, not that Minsky does its job. Work rounds stay `not measured yet` until real rounds run.
