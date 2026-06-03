# Supervisor sandbox — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 3 ("Supervisor sandbox"), the Minsky tick-loop supervisor runs under a syscall + filesystem + network restriction profile narrower than the operator's full UID. The supervisor needs to read `~/.claude/projects/` (token-monitor JSONLs), read+write `<repo>/` (git operations), execute a fixed allow-list of binaries (`claude`, `node`, `git`, `pnpm`, `gh`), and bind a localhost port (the dashboard). Anything past that surface — `~/.ssh/`, `~/Documents/`, arbitrary network egress — is outside the supervisor's stated trust boundary, so a regression that reaches it should fail loudly with `EPERM` rather than silently exfiltrate. This doc consolidates the threat model, the resolver substrate that already ships, the staged-rollout ramp the task block prescribes, and the verification commands. Anchors: Saltzer & Schroeder, *Proceedings of the IEEE* 63(9), 1975 (least privilege; fail-safe defaults; economy of mechanism); McKusick & Watson's TrustedBSD MAC framework (the macOS `sandbox-exec` substrate); `systemd.exec(5)` hardening properties (`ProtectSystem`, `ProtectHome`, `PrivateTmp`, `RestrictAddressFamilies`, `SystemCallFilter`, `NoNewPrivileges`); NIST SP 800-218 SSDF PW.6 (configure software to have secure settings by default, 2022).

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003.

- **Untrusted inputs**: the prompt the supervisor feeds into `claude --print` (operator-controlled but large and concatenated from many sources); the `claude --print` output itself (an external code-generating service whose output lands on the operator's filesystem); task blocks the supervisor reads from `TASKS.md` (operator-authored but unsigned); the OTEL endpoint URL (operator-configured but reachable on the network); env vars inherited from `launchd` / `systemd-user`.
- **Trusted state**: the unit-file template the operator installed (read-only, version-controlled, reviewed); the resolver substrate at `novel/tick-loop/src/sandbox-mode.ts` (pure function, paired tests); the supervisor's own source under `<repo>/`.
- **Trust boundary**: the supervisor's process address space + the syscall surface it can invoke. Today the boundary is the operator's full UID — every file in `$HOME` is reachable, every network port is reachable, every binary on `$PATH` is executable. The sandbox slices ratchet that boundary inward: filesystem reach → repo + Claude session JSONLs only; network reach → loopback only (with `AF_INET` / `AF_INET6` / `AF_UNIX` allowed for the dashboard's own listen socket and the `claude --print` subprocess's HTTPS to Anthropic); syscall reach → systemd's `@system-service` set; binary exec → an allow-list at the wrapper-script boundary.
- **STRIDE focus**:
  - **S**poofing — out of scope for the sandbox itself; the wrapper script's `MINSKY_HOME` placeholder is set by `setup.sh` and the operator's user-shell, not by an external party.
  - **T**ampering — `ProtectSystem=strict` (Linux) and `(deny default) (allow file-read* (subpath ...))` (macOS) prevent the supervisor from writing outside the repo and a small set of operator-cache directories; `NoNewPrivileges=true` blocks `setuid` escalation paths.
  - **R**epudiation — supervisor-emitted spans already carry `iteration.id` per `record({...})` call; the sandbox's own decisions (mode resolved, profile path, EPERM events) will land in the same span when slice 5 wires the I/O boundary.
  - **I**nformation disclosure — `ProtectHome=read-only` (with `ReadWritePaths=<repo>` carving out the writable subset) prevents the supervisor from reading `~/.ssh/`, `~/Documents/`, or sibling-account home directories; `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` prevents raw / netlink / packet-socket egress; the macOS profile mirrors with `(deny network*)` modulo a `(allow network-outbound (remote ip))` carve-out for the Anthropic API and the local OpenObserve endpoint.
  - **D**enial of service — `SystemCallFilter=@system-service` blocks the supervisor from calling kernel-only or admin-only syscalls that could hang the box (`reboot`, `kexec_load`, `bpf` outside cBPF). `PrivateTmp=true` puts `/tmp` and `/var/tmp` in a per-unit namespace so a misbehaving subprocess cannot leave artefacts in the operator's `/tmp` long-term.
  - **E**levation of privilege — `NoNewPrivileges=true` is the load-bearing systemd property; on macOS, `(deny process-fork)` modulo the `claude` / `node` / `git` / `pnpm` / `gh` allow-list is the equivalent at the spawn boundary.

## The substrate that ships today

The resolver and the operator-visible env-var slot are already wired. **No actual syscall restriction is applied yet** — slices 1–3 are substrate-inert by design (rule #6 graceful-degrade: a regression in the resolver cannot break the running supervisor, because the spawn path doesn't yet consult it). The pre-PR lint stack pins this cohesion via `scripts/check-sandbox-env-declared.mjs`.

| Layer | What ships | Where |
| --- | --- | --- |
| Resolver | `resolveSandboxMode(env)` + `sandboxModeWarning(env)` + `sandboxModeStartupHint(env)` | `novel/tick-loop/src/sandbox-mode.ts` (PR #332) |
| Boot banner | `[tick-loop] sandbox mode: <mode> (...)` line at supervisor start | `bin/tick-loop.mjs` (PR #335) |
| Unit-file slot | Commented `MINSKY_SANDBOX=off` opt-in in both supervisor templates, citing `vision.md § 13.3` so the operator finds the spec without grep | `distribution/systemd/minsky-tick-loop.service` + `distribution/launchd/com.minsky.tick-loop.plist` (PR #336) |
| Drift gate | `sandbox-env-declared` lint pins resolver-source ↔ unit-file declarations against rename / drop | `scripts/check-sandbox-env-declared.mjs` |
| macOS profile | `(version 1) (deny default)` SBPL profile applied to the tick-loop supervisor + every child it spawns | `distribution/launchd/com.minsky.tick-loop.sb` (`supervisor-sandbox-syscall-restriction`) |
| macOS wrap | `ProgramArguments` → `/usr/bin/sandbox-exec -D MINSKY_HOME=… -D HOME=… -f <profile> /bin/bash run-tick-loop.sh` | `distribution/launchd/com.minsky.tick-loop.plist` |
| macOS drift gate | `supervisor-sandbox-hardening` lint asserts the `.sb` profile exists, opens with `(deny default)`, and is referenced by the plist | `scripts/check-supervisor-sandbox-hardening.mjs` (+ `.test.mjs`) |
| macOS chaos test | a read of `~/.ssh/known_hosts` under the profile returns `EPERM`; an allow-listed repo read succeeds | `scripts/chaos-sandbox-disallowed-read.mjs` (+ `.test.mjs`) |

`MINSKY_SANDBOX` accepts three modes; everything else falls back to `'off'` with a stderr warning (fail-safe defaults — Saltzer & Schroeder 1975):

| Mode | Resolver behaviour | Wrapper script (slice 4+, pending) |
| --- | --- | --- |
| unset / `""` / `'off'` | default | no profile applied — supervisor runs as today |
| `'warn-only'` | accepted | profile applied with logging but not blocking; `EPERM` events become stderr lines, not exits |
| `'enforce'` | accepted | profile applied with blocking; disallowed reads / connects fail with `EPERM` |
| any other value | falls back to `'off'`; `sandboxModeWarning` emits stderr WARNING | not consulted (mode is `'off'`) |

The substrate is deliberately a pure function of `process.env` so unit tests pin every transition without spawning a process; the I/O boundary (the wrapper script + the launchd `ProgramArguments` + the systemd `[Service]` block) lands in subsequent slices.

## macOS allow-list (`com.minsky.tick-loop.sb`)

The shipped SBPL profile opens with `(deny default)` — fail-safe defaults
(Saltzer & Schroeder 1975). It imports Apple's `bsd.sb` base profile (so dyld
and the system frameworks load) and then carves out exactly the surface the
supervisor needs. Anything not listed below fails with `EPERM`.

| Operation | Allowed | Why |
| --- | --- | --- |
| `process-fork` / `process-exec` / `signal` | yes | the supervisor spawns `claude --print` / `node` / `git` / `pnpm` / `gh` per iteration; the binary allow-list is enforced at the `run-tick-loop.sh` PATH boundary |
| `file-read*` system prefixes | `/usr`, `/bin`, `/sbin`, `/opt/homebrew`, `/Library`, `/System`, `/private/etc`, `/dev/null`, `/dev/urandom` | read tool binaries + their dylibs (none writable) |
| `file-read* file-write*` repo | `${MINSKY_HOME}` subtree | git operations, log writes, the agent's tracked-file edits |
| `file-read*` operator caches | `~/.claude` (token-monitor JSONLs), `~/.gitconfig`, `~/.config/git`, node version managers (`~/.local/share/fnm`, `~/.nvm`, `~/.asdf`) | resolve git/node config without false `EPERM` |
| `file-read* file-write*` state + temp | `~/.minsky`, `/private/tmp`, `/private/var/folders` (the per-user `TMPDIR`) | per-machine config + experiment store + PID file; subprocess scratch |
| `network-bind` / `network-inbound` | `localhost:*` only | the dashboard's loopback listen socket |
| `network-outbound` | yes | `claude --print` HTTPS to the Anthropic API + the local OTEL endpoint (the API host is not statically known; DNS resolution itself needs outbound) |
| `mach-lookup` | `notification_center`, `opendirectoryd.libinfo`, `configd`, `dnssd.service`, `cfprefsd.*` | DNS resolution + libuv prefs the runtime needs |

**Explicitly denied** (the trust boundary): `~/.ssh`, `~/.aws`, `~/.gnupg`,
`~/Documents`, `~/Desktop`, and every other `$HOME` path not listed above.
`~/.ssh` is denied by design — git over HTTPS uses `~/.minsky` creds; ssh-based
remotes are outside the supervisor's stated trust boundary. `scripts/chaos-sandbox-disallowed-read.mjs`
pins this denial (`~/.ssh/known_hosts` → `EPERM`).

**Extending the allow-list**: when an operator hits a legitimate `EPERM` (a new
tool dir the supervisor needs), add the narrowest `(allow file-read* (subpath …))`
line with a TASKS-id justification on the same PR. Pivot threshold (per the task
block): >3 false-positive `EPERM` per week sustained means the constraint set is
too tight — relax that specific path; never disable the sandbox.

### Escape hatch — `MINSKY_SANDBOX=off`

To disable the sandbox in ~30 seconds (e.g., debugging a false `EPERM`), revert
the plist's `ProgramArguments` to invoke `/bin/bash <run-tick-loop.sh>` directly
(dropping the `sandbox-exec -f …` wrap) and `launchctl bootout` + re-bootstrap.
`MINSKY_SANDBOX=off` is the documented operator intent (Beyer SRE 2016 Ch. 17 —
the escape hatch is part of postmortem-culture discipline; a downed supervisor
is worse than an un-sandboxed one for a short debugging window). The default —
the shipped plist with the `sandbox-exec` wrap — is `enforce`.

## Staged rollout (per the parent task block)

The task block's risk assessment is high — the path-allow-list is the most likely source of false positives. Ramp accordingly; each step is a separate PR, not a single big-bang change:

1. **Pre-merge dry-run** (7 days local). Operator runs the supervisor with `MINSKY_SANDBOX=warn-only` on their own laptop; reviews stderr / journalctl for `EPERM`-class log lines; widens the allow-list with TASKS-id-justified entries when a legitimate path trips it.
2. **Post-merge soak** (14 days). `MINSKY_SANDBOX=warn-only` is the dogfooded default; the supervisor logs every disallowed access but blocks nothing. Operator-visibility (rule #6 visible-not-silent) without operational risk.
3. **Enforcement** (production target). Flip the env to `'enforce'`. `EPERM` on disallowed reads / connects. The wrapper script's exit-on-`EPERM` policy is the safety net — the supervisor crashes loudly rather than silently degrading.

The escape hatch is `MINSKY_SANDBOX=off` (or unset). Documented per Beyer SRE Ch. 17 ("postmortem culture") — the operator can disable the sandbox in 30 seconds when the alternative is a downed supervisor.

## Pending slices

The macOS slices (5 + 6) have **shipped** (`supervisor-sandbox-syscall-restriction`); the Linux slice (4) and the formal extension protocol (7) remain. Each is a separate PR per the staged-rollout discipline:

- **Slice 4** (Linux, pending): extend `distribution/systemd/minsky-tick-loop.service` with `ProtectHome=read-only` (+ `ReadWritePaths=${MINSKY_HOME}` for the repo), `ProtectSystem=strict`, `PrivateTmp=true`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `SystemCallFilter=@system-service`, `NoNewPrivileges=true`. Gated by the resolver: when `MINSKY_SANDBOX=off`, the wrapper drops the hardening drop-in.
- **Slice 5** (macOS, **shipped**): `distribution/launchd/com.minsky.tick-loop.sb` is a TrustedBSD MAC profile — `(version 1) (deny default) (allow ...)` syntax — applied via the plist's `ProgramArguments` (`/usr/bin/sandbox-exec -D MINSKY_HOME=… -D HOME=… -f <profile> /bin/bash <run-tick-loop.sh>`). The allow-list is documented above; `scripts/check-supervisor-sandbox-hardening.mjs` pins the profile ↔ plist cohesion.
- **Slice 6** (chaos test, **shipped**): `scripts/chaos-sandbox-disallowed-read.mjs` runs a child under the profile that reads `~/.ssh/known_hosts` and asserts `EPERM` (nonzero exit), with an allow-listed repo read as the positive control. On non-macOS hosts (or when `sandbox-exec` / `~/.ssh` is absent) it reports `skipped:true` and exits 0 — graceful degrade (rule #7), never a silent skip. Matches the rule #7 chaos table — every disallowed path attempt is itself a chaos fixture.
- **Slice 7** (allow-list extension protocol, pending): formalise the TASKS-id-justified allow-list extension flow (the mechanism is documented in § "Extending the allow-list" above; slice 7 wires the deterministic check). Pivot threshold per the task block: >3 false-positive `EPERM` per week sustained means the constraint set is too tight; relax that specific path, do not disable the sandbox.

The macOS `sandbox-exec` API has been deprecated since macOS 14 — Apple still ships and supports it, but the pivot path is documented: when the API is removed, swap to a wrapper based on `seatbelt` (the underlying mechanism, still exposed via private API) or run the supervisor inside a container with `--security-opt=apparmor=...`. The Linux systemd config is unaffected by the macOS pivot.

## Performance-first carve-out

Per rule #13's relief valve: when security and performance compete, performance wins on a case-by-case basis with the security cost declared in writing. None declared yet for the supervisor sandbox — the candidate trade-off is `SystemCallFilter=@system-service` measurably slowing the supervisor's tick-cadence; the actual measurement happens in slice 4 when the property lands. If the wall-clock cost exceeds 5% of a typical iteration, the property is documented as a declared deviation here (per rule #11's "no flaky load-bearing claim" discipline applied to the security/performance axis) and a narrower filter is proposed.

`MINSKY_SANDBOX=off` (the substrate-inert default) imposes zero cost — the resolver is a pure function and the unit-file declaration is commented. The performance baseline is preserved until the operator opts in.

## Verification

While the substrate is inert (today):

- **Resolver unit tests**: `pnpm test --filter @minsky/tick-loop -- sandbox-mode.test.ts` — every transition is pinned (default, valid mode, typo fallback, warning shape, startup-hint shape).
- **Drift gate**: `node scripts/check-sandbox-env-declared.mjs` — passes when the resolver source declares `SANDBOX_MODE_ENV = "MINSKY_SANDBOX"` and both unit-file templates carry the env-var token + a `vision.md § 13.3` (or `rule #13.3`) citation.
- **Boot banner**: start the supervisor and `head -5 .minsky/tick-loop.out.log` — the first lines include `[tick-loop] sandbox mode: <resolved> (MINSKY_SANDBOX env, substrate-inert until profile wires in slice 3+)`. A typo (`MINSKY_SANDBOX=enforcde`) appends a `WARNING` line in the same banner.

macOS slice (shipped today) — these run green on a macOS host:

- **Profile denies the disallowed read, permits the allowed one** (the task block's Measurement):
  `sandbox-exec -D MINSKY_HOME="$PWD" -D HOME="$HOME" -f distribution/launchd/com.minsky.tick-loop.sb /bin/cat ~/.ssh/known_hosts; echo $?` returns non-zero, while the same invocation against `README.md` returns 0.
- **Chaos test**: `node scripts/chaos-sandbox-disallowed-read.mjs --json` prints `{"disallowed_read_denied":true,"allowed_read_permitted":true,"skipped":false,"ok":true}` on macOS (and `skipped:true, ok:true` on Linux). `pnpm exec vitest run scripts/chaos-sandbox-disallowed-read.test.mjs` exercises the pure decision core on every platform.
- **Drift gate**: `node scripts/check-supervisor-sandbox-hardening.mjs` asserts the `.sb` profile opens with `(deny default)` and is wired into the plist's `ProgramArguments`.

When the Linux slice (4) lands, the verification surface extends:

- `systemd-run --user --uid=$(id -u) --slice=minsky-test --property=ProtectHome=read-only /bin/cat /home/$(whoami)/.ssh/known_hosts` returns non-zero (Linux).
- `tail .minsky/tick-loop.out.log | grep -c '"iteration.status":"completed"'` ≥ 1 within 30 minutes after restart with `MINSKY_SANDBOX=enforce` (regression: existing dogfood iterations still complete).

## Sources

- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — least privilege; fail-safe defaults; economy of mechanism.
- McKusick & Watson, "TrustedBSD: Adding Trusted Operating System Features to FreeBSD", *USENIX ATC* 2001 — the MAC framework macOS `sandbox-exec` is built on.
- `systemd.exec(5)` man page — `ProtectSystem`, `ProtectHome`, `PrivateTmp`, `RestrictAddressFamilies`, `SystemCallFilter`, `NoNewPrivileges`. systemd's hardening guide is the canonical reference for each property.
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
- Apple, "App Sandbox Design Guide", developer.apple.com — the operator-visible side of the same TrustedBSD primitives `sandbox-exec` exposes.
- NIST SP 800-218 SSDF PW.6 (configure software to have secure settings by default), 2022.
- Beyer et al., *Site Reliability Engineering*, O'Reilly, 2016 — Ch. 17 (postmortem-culture escape-hatch discipline; the `MINSKY_SANDBOX=off` knob).
- vision.md rule #1 (don't reinvent — `sandbox-exec` + `systemd.exec(5)` are the industry primitives); rule #6 (visible-not-silent — typo on `MINSKY_SANDBOX` surfaces a WARNING line); rule #7 (graceful-degrade chaos table — slice 6 EPERM chaos fixture); rule #13.3 (this doc's parent constraint).
