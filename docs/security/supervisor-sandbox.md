# Supervisor sandbox — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 3 ("Supervisor sandbox"), the supervisor's filesystem and network reach is constrained to the minimum it actually needs. Today the launchd / systemd-user units in `distribution/` run as the operator's full UID with no syscall restrictions — a regression that causes the supervisor to read `~/.ssh/` or write outside the repo should fail loudly, not silently exfiltrate. This doc consolidates the threat model, the per-platform allow-list, the operator escape hatch, and the verification commands. The implementation lands in slices under TASKS.md `supervisor-sandbox-syscall-restriction` (P0); this doc fixes the design contract so each slice ratchets against the same target. Anchors: McKusick & Watson, "TrustedBSD: Adding Trusted Operating System Features to FreeBSD", *USENIX ATC* 2001 (the `sandbox-exec` / Apple App Sandbox substrate); systemd `systemd.exec(5)` man page (every directive cited below is a documented security primitive); Saltzer & Schroeder, *Proceedings of the IEEE* 63(9), 1975 — least privilege; NIST SP 800-53 Rev. 5 control AC-6 ("Least Privilege"); GDPR Article 25 ("data protection by design and by default") — the supervisor's read scope is the operator's privacy boundary.

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003. The empirical precedent: long-running developer-tier supervisors are the canonical credential-leak surface — they spawn child processes that inherit the parent's UID and environment, they typically run unrestricted in the operator's home, and they outlive any single login session. A regression that adds a stray `fs.readFile("~/.ssh/id_rsa")` or `fetch("https://...")` from a transitive dependency would, today, silently succeed. The sandbox's job is to make that path return EPERM at the kernel boundary, where no application code can swallow the error.

- **Untrusted inputs**: every byte the supervisor reads from outside the repo and the JSONL session store — third-party npm packages loaded at install time, tool-call results returned by `claude --print` (which carry attacker-controlled content from the LLM context), git remote responses, environment variables inherited from the launching shell, and any future plugin / adapter the operator installs.
- **Trusted state**: the explicit allow-list below; the launchd plist + systemd unit-file directives that pin the kernel-enforced boundary; the operator's git checkout under `<MINSKY_HOME>/`; the JSONL session files under `~/.claude/projects/`; the per-platform escape hatch (`MINSKY_SANDBOX=off`) for emergencies; the chaos-test suite under `scripts/chaos/sandbox-attempts-*.mjs` that pins EPERM behaviour against drift.
- **Trust boundary**: the kernel's MAC / cgroup / seccomp surface. Filesystem reads inside the allow-list and outbound TCP to allow-listed hostnames are inside the boundary; everything else is outside. Crossings happen at `open(2)` / `connect(2)` / `execve(2)` — the kernel rejects them with EPERM and the supervisor's let-it-crash discipline (rule #6) surfaces the failure rather than masking it.
- **STRIDE focus**:
  - **S**poofing — the supervisor authenticates outbound calls via TLS pinning (Anthropic + GitHub canonical hostnames) and the lockfile-integrity gate (rule #13.5) against typo-squat package substitution at install time. The sandbox does not introduce new spoofing surfaces.
  - **T**ampering — write paths are restricted to `<MINSKY_HOME>/` and a private `/tmp` (systemd `PrivateTmp=true`); `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, system binaries, and other operator configuration directories are read-only or denied entirely. A bug or malicious dependency cannot rewrite the operator's identity files.
  - **R**epudiation — out of scope at v0 (single operator per supervisor; no multi-tenant accountability surface). Filed as `cloud-tier-multi-operator-audit-log` follow-up if/when the cloud tier ships.
  - **I**nformation disclosure — the load-bearing STRIDE axis for this rule. Read paths outside the allow-list (operator's documents, browser profile, password manager, SSH/GPG keys) are denied at the kernel; the supervisor's network reach is constrained to the egress allow-list pinned in [`docs/security/privacy-data-egress.md`](privacy-data-egress.md) (rule #13.7's orthogonal control).
  - **D**enial of service — the supervisor itself is the operator-controlled program; sandbox-induced EPERM on a legitimate path is a failure mode to be caught in pre-merge dry-run + post-merge `MINSKY_SANDBOX=warn-only` ramp, not a runtime concern.
  - **E**levation of privilege — `NoNewPrivileges=true` (Linux) and the launchd `com.apple.security.app-sandbox` entitlement (macOS) prevent setuid escalation and `posix_spawnattr_t` flag manipulation. Child processes (`claude`, `node`, `git`, `pnpm`, `gh`) inherit the same restricted profile.

## Per-platform allow-list

Every filesystem path and network family the supervisor reaches by default. Anything not on this table is a bug — file an issue tagged `supervisor-sandbox-violation`.

### macOS (Apple App Sandbox via `sandbox-exec`)

The launchd plist's `ProgramArguments` becomes `/usr/bin/sandbox-exec -f distribution/launchd/com.minsky.tick-loop.sb <run-tick-loop.sh>`. The `.sb` profile (TrustedBSD MAC; `(version 1) (deny default) (allow ...)` syntax) starts denied and explicitly allows:

| Resource | Allow-rule | Why allowed |
| --- | --- | --- |
| Repo checkout | `(allow file* (subpath "<MINSKY_HOME>"))` | Git operations; build artifacts under `node_modules/`; tick-loop log under `<MINSKY_HOME>/.minsky/`. |
| Claude session JSONLs | `(allow file-read* (subpath (string-append (param "HOME") "/.claude/projects")))` | Token-monitor reads operator's session usage to compute budget. Read-only — never written by the supervisor. |
| System binaries | `(allow process-exec (literal "/usr/bin/claude") (literal "/usr/bin/node") (literal "/usr/bin/git") (literal "/usr/local/bin/pnpm") (literal "/usr/bin/gh"))` plus `(allow file-read* (subpath "/usr/bin") (subpath "/usr/local/bin") (subpath "/System/Library"))` | Only the five binaries Minsky's tick-loop spawns are exec-allowed; their dyld dependencies require read access to system library paths. |
| Outbound network | `(allow network-outbound (remote ip "*:443") (remote unix-socket))` | TLS to Anthropic + GitHub + npm + ntfy.sh (operator-configurable); UNIX sockets for IPC with launchd's `Mach` services. Egress allow-list (rule #13.7) is the orthogonal hostname-level control. |
| Localhost bind | `(allow network-bind (local ip "localhost:*"))` | Dashboard binds to `127.0.0.1` (rule #13.4 — already shipped). LAN exposure (`0.0.0.0`) requires the operator's explicit `MINSKY_DASHBOARD_BIND` opt-in AND a separate launchd plist override. |

Denied by default (no allow-rule): `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, `~/Library/Application Support/Google/Chrome/`, `~/Library/Application Support/1Password/`, `~/Documents/`, `~/Downloads/`, `/Applications/` writes, `/var/db/sudo`, the keychain SQLite files. A regression that reads any of these returns EPERM at the kernel.

### Linux (systemd-user unit hardening)

`distribution/systemd/minsky-tick-loop.service` extends with the following directives. Each is documented in `systemd.exec(5)`; none are Minsky-invented.

| Directive | Value | Effect |
| --- | --- | --- |
| `ProtectSystem=` | `strict` | `/usr`, `/boot`, `/efi`, `/etc` mounted read-only for the unit. |
| `ProtectHome=` | `read-only` | `/home`, `/root`, `/run/user` mounted read-only. Combined with `ReadWritePaths=` for the writable subset. |
| `ReadWritePaths=` | `<MINSKY_HOME>` | Repo checkout (the only writable area under the otherwise read-only `$HOME`). |
| `PrivateTmp=` | `true` | Per-unit private `/tmp` namespace; the operator's `/tmp` is invisible. |
| `RestrictAddressFamilies=` | `AF_UNIX AF_INET AF_INET6` | Blocks `AF_NETLINK`, `AF_PACKET`, raw sockets, and esoteric families. |
| `SystemCallFilter=` | `@system-service` | Allow-list of "syscalls a system service legitimately uses"; denies `keyctl`, `add_key`, `kexec_load`, namespace creation, ptrace, and the rest of the kernel's privileged surface. |
| `NoNewPrivileges=` | `true` | Children cannot escalate via setuid binaries; equivalent to `prctl(PR_SET_NO_NEW_PRIVS, 1)`. |
| `RestrictNamespaces=` | `true` | Cannot create new mount/PID/user/network namespaces — blocks container-style escape attempts. |
| `LockPersonality=` | `true` | `personality(2)` is locked; blocks ABI-emulation tricks. |
| `MemoryDenyWriteExecute=` | `true` | W^X enforcement at the syscall layer — blocks JIT-spray exploitation paths. |
| `RestrictSUIDSGID=` | `true` | Cannot create setuid/setgid files. |
| `ProtectKernelTunables=` | `true` | `/proc/sys`, `/sys`, `/proc/sysrq-trigger` are read-only. |
| `ProtectKernelModules=` | `true` | `init_module`, `finit_module`, `delete_module` denied. |
| `ProtectControlGroups=` | `true` | `/sys/fs/cgroup` read-only. |
| `RestrictRealtime=` | `true` | `SCHED_FIFO`, `SCHED_RR` denied — blocks priority-inversion DoS. |

The systemd-analyze score (`systemd-analyze security minsky-tick-loop.service`) is the load-bearing CI artifact: target is ≤2.0 (industry "OK" threshold; under 1.0 is "good"; under 0.0 is "great"). The actual score will be recorded in the implementation slice's PR body alongside the dogfood-iteration smoke result.

## Operator escape hatch

Per Beyer SRE Ch. 17 ("Postmortem culture") and rule #2 (operator action stays the boss-key) — when the sandbox is wrong the operator is the appeals court. The escape hatch is a single env var read at supervisor start, with three modes:

- `MINSKY_SANDBOX=enforce` (default once shipped) — full sandbox; EPERM on any disallowed path. Production state.
- `MINSKY_SANDBOX=warn-only` — sandbox profile is loaded but disallowed accesses are *logged* (via systemd `SystemCallLog=` on Linux; via the App Sandbox audit trail on macOS) instead of denied. The 14-day post-merge ramp uses this mode to surface false positives before they break iterations. Logged events are aggregated into `<MINSKY_HOME>/.minsky/sandbox-audit.log` and an iteration that touches a previously-unobserved disallowed path opens a `sandbox-allow-list-extension` task instead of crashing.
- `MINSKY_SANDBOX=off` — sandbox is disabled; the supervisor runs as it does today (full UID, no restrictions). This is the emergency relief valve for the case where a critical iteration would otherwise be blocked by a sandbox false positive AND the operator does not have time to extend the allow-list. Setting this value emits a startup warning ("WARNING: supervisor sandbox is OFF — operator privacy boundary is unenforced for this run") to both the dashboard and the journal, and the surrounding iteration's PR body is required to carry a `<!-- security: sandbox-disabled — <reason> -->` annotation per the rule #13 carve-out discipline.

The default once shipped is `enforce`. The 14-day post-merge ramp from `warn-only` → `enforce` is itself an iteration of the supervisor-sandbox slice; it does not re-open this design contract.

## Performance-first carve-out

Per rule #13's relief valve: when security/privacy and performance compete, performance wins on a case-by-case basis with the cost declared in writing. Two known carve-outs for the sandbox surface, both small:

- **`SystemCallFilter=@system-service` overhead** — the seccomp-bpf filter adds ≈100 ns per syscall on Linux (LWN, "Seccomp filter performance", 2018). Tick-loop iterations are minutes long and dominated by the LLM round-trip (4-6 orders of magnitude over per-syscall overhead); the filter is invisible in wall-time. No carve-out declared.
- **macOS `sandbox-exec` startup cost** — loading the `.sb` profile adds ≈10 ms to each `claude --print` spawn. Iteration cadence is once-per-tick (≥30 s); the spawn cost is ≪1% of the tick. No carve-out declared.

The carve-out clause is preserved for future iterations where a per-syscall filter is shown empirically to dominate a hot path; until then the sandbox is performance-neutral and the security gain is monotone.

## Verification

- **EPERM on disallowed path (macOS)** — `sandbox-exec -f distribution/launchd/com.minsky.tick-loop.sb /bin/cat ~/.ssh/known_hosts; echo $?` returns non-zero. The chaos test `scripts/chaos/sandbox-attempts-disallowed-read.mjs` pins this against drift.
- **EPERM on disallowed path (Linux)** — `systemd-run --user --uid=$(id -u) --slice=minsky-test --property=ProtectHome=read-only /bin/cat /home/$(whoami)/.ssh/known_hosts` returns non-zero.
- **systemd-analyze security score** — `systemd-analyze --user security minsky-tick-loop.service` reports score ≤2.0 ("OK" or better). Recorded in the implementation slice's PR body.
- **Existing dogfood smoke** — after supervisor restart with sandbox on, `tail .minsky/tick-loop.out.log | grep -c '"iteration.status":"completed"'` ≥ 1 within 30 minutes. The sandbox introduces no observable regression for a normal tick.
- **Escape-hatch behaviour** — `MINSKY_SANDBOX=off pnpm dogfood` boots without the sandbox and emits the operator-facing warning to the journal; `MINSKY_SANDBOX=warn-only` boots with the sandbox in audit mode and writes events to `<MINSKY_HOME>/.minsky/sandbox-audit.log`.
- **Drift gate (planned, follow-up slice)** — `scripts/check-supervisor-sandbox-shape.mjs` will pin `distribution/launchd/com.minsky.tick-loop.sb` and `distribution/systemd/minsky-tick-loop.service` against unannotated allow-list expansion; same shape as `scripts/check-privacy-data-egress.mjs` (rule #13.7 slice 2). Filed under `supervisor-sandbox-syscall-restriction` once the substrate ships.

## Sources

- McKusick, M. K., Watson, R., "TrustedBSD: Adding Trusted Operating System Features to FreeBSD", *USENIX Annual Technical Conference*, 2001 — the MAC framework `sandbox-exec` is built on.
- systemd Project, `systemd.exec(5)` man page (2010-present) — every Linux hardening directive cited above.
- Apple, "App Sandbox Design Guide" (developer.apple.com/library/archive/documentation/Security/Conceptual/AppSandboxDesignGuide/, 2014, archived but still applicable for `sandbox-exec`).
- Saltzer, J. H., Schroeder, M. D., "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — least privilege, fail-safe defaults, complete mediation.
- NIST SP 800-53 Rev. 5, control AC-6 "Least Privilege", 2020.
- Howard, M., LeBlanc, D., *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
- GDPR (Regulation (EU) 2016/679), Article 25 "Data protection by design and by default", 2016.
- Beyer, B., Jones, C., Petoff, J., Murphy, N. R. (eds.), *Site Reliability Engineering*, O'Reilly, 2016, Ch. 17 — postmortem culture (escape-hatch discipline).
- LWN, "Seccomp filter performance", lwn.net/Articles/759707/, 2018 — the per-syscall overhead anchor.
- vision.md rule #1 (don't reinvent — Apple App Sandbox + systemd are the industry primitives); rule #13.4 (dashboard localhost-only — the orthogonal network-bind control); rule #13.7 (privacy by default — the orthogonal egress allow-list); rule #6 (let it crash — EPERM on a disallowed path surfaces, never silently swallowed).
