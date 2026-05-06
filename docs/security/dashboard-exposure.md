# Dashboard exposure — threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 4 ("Dashboard binds to 127.0.0.1 by default"), the [`@minsky/dashboard-web`](../../novel/dashboard-web/README.md) HTTP surface defaults to localhost-only. This doc consolidates the threat model, the override knobs, and the recommended remote-access patterns. Anchors: NIST SP 800-53 SC-7 boundary protection; Saltzer & Schroeder, *Proceedings of the IEEE* 63(9), 1975 (fail-safe defaults).

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003.

- **Untrusted inputs**: any HTTP request reaching the listening socket; metric labels / formulas that travel through the renderer; the LAN itself when the operator opts into `0.0.0.0` bind.
- **Trusted state**: server-rendered HTML carries zero third-party JS (rule #13.7); the renderer is pure (no I/O); the route table is constants in source; `escapeHtml` is the sole sanitiser before any user-influenced string reaches the wire; the `POST /control` token is per-process secret state never persisted to disk.
- **Trust boundary**: the loopback interface. `127.0.0.1` is enforced by `start.ts` per default; explicit `MINSKY_DASHBOARD_BIND=0.0.0.0` is the operator opt-in. Anything past the loopback is outside Minsky's control.
- **STRIDE focus**:
  - **S**poofing — addressed by the per-run `X-Minsky-Token` on `POST /control` (constant-time compare per OWASP ASVS 2.10 / NIST SP 800-63B).
  - **T**ampering — `escapeHtml` blocks XSS at the render boundary; `parseControlBody` rejects malformed payloads with `400` before the `setPaused` Strategy is called.
  - **R**epudiation — out of scope at v0 (single operator; no multi-user audit trail). Filed as `dashboard-multi-operator-audit-log` follow-up if/when the cloud tier ships.
  - **I**nformation disclosure — page payloads carry only USE/RED-shaped numbers + tick state, never raw `claude --print` output, session JSONL paths, or operator filesystem layout. Activity feed lines come from `.minsky/tick-loop.out.log` (already sanitised by the daemon's structured-span emitter).
  - **D**enial of service — bind-default limits the attack population to processes on the loopback; no rate-limit at v0 because the population is the operator. LAN bind without a reverse-proxy is an explicit deviation (see "Performance-first carve-out" below).
  - **E**levation of privilege — `/control` is the only state-mutating route; token gate is the only privilege boundary. There is no admin tier.

## Default: localhost-only

`@hono/node-server`'s `serve()` defaults to `0.0.0.0` (all interfaces) when `hostname` is not specified. A laptop on a coffee-shop WiFi would expose the dashboard — including the activity feed and the `POST /control` pause endpoint — to anyone on the LAN.

`src/start.ts` resolves the bind address through `resolveBind(process.env)` in `src/bind.ts`:

| `MINSKY_DASHBOARD_BIND` | Resolved hostname | Audience |
| --- | --- | --- |
| unset / `""` | `127.0.0.1` | loopback only — operator's own processes |
| `0.0.0.0` | `0.0.0.0` | every interface — loopback + LAN + any reachable network |

When the override fires, `start.ts` emits a stderr warning before the listen call:

```text
WARNING: dashboard now reachable from any LAN device. Consider running
behind a reverse proxy with auth, or use an SSH tunnel from the remote.
```

The warning is loud per rule #7 ("loud-on-misconfig"), not silent.

## `POST /control` — per-run token authentication

Even with the default loopback bind, any process on the same machine could pause the supervisor through `POST /control`. With LAN exposure, anyone on the WiFi could. The token gate closes both.

`src/control-auth.ts` ships three pure helpers, composed by `src/start.ts`:

- `resolveControlToken(env, generateRandom)` — reads `MINSKY_CONTROL_TOKEN` if set; falls back to `generateRandom()` (production: `crypto.randomBytes(32).toString("hex")`). Empty-string env is treated as unset (mirrors `bind.ts`).
- `validateControlAuth(headers, expectedToken)` — length-then-byte-XOR constant-time compare of the `X-Minsky-Token` header against the resolved token.
- `controlTokenStartupHint(resolved)` — formats the stderr line printed at boot. The env-source variant deliberately does NOT echo the secret (the operator already has it); the generated-source variant DOES echo it (the operator must be able to copy it into their curl scripts / Apple-Shortcuts bodies).

Wire-up:

| `MINSKY_CONTROL_TOKEN` | Token lifetime | Operator ergonomic |
| --- | --- | --- |
| unset / `""` | rotates on every supervisor restart | startup hint echoes the new token; saved curl scripts break across restarts (intentional defense-in-depth) |
| set to a value | pinned across restarts | startup hint confirms the env source; saved scripts and Shortcuts keep working |

Behaviour:

| Request | Status | Notes |
| --- | --- | --- |
| `POST /control` with correct `X-Minsky-Token` | 200 | `setPaused` Strategy called once with the body's `paused` value |
| `POST /control` with wrong/missing `X-Minsky-Token` | 401 | `setPaused` is *never* called (verified by call-counter assertions) |
| `POST /control` with correct token, malformed body | 400 | auth runs *before* body parse so 401 always wins over 400 on bad token |

The auth-then-body order is fail-fast on the dangerous axis: a bad token never leaks any signal about body-shape acceptance.

## Recommended remote-access patterns

The dashboard's stated default audience is "the operator on the same machine". For genuine remote access, prefer in this order:

1. **SSH local-forward** — `ssh -L 8181:localhost:8181 operator@laptop`. The dashboard never leaves loopback; SSH carries authentication, encryption, and integrity. This is the canonical pattern.
2. **Tailscale (or equivalent overlay) ACL** — when the operator runs Minsky on a fleet (e.g., a home server), bind `0.0.0.0` *only* on the Tailscale interface and use Tailscale ACLs to gate. Filed as `dashboard-tailscale-acl` follow-up.
3. **Reverse proxy with auth** — when the operator must expose the dashboard publicly (rare for v0), front it with Caddy / nginx + an auth layer (basic auth at minimum, OIDC ideal). Minsky does not bundle this — rule #1 (use existing infrastructure).

Do *not* use `MINSKY_DASHBOARD_BIND=0.0.0.0` on an open WiFi without one of the above in front. The default is loopback for a reason.

## Performance-first carve-out

Per rule #13's relief valve: when security and performance compete, performance wins on a case-by-case basis with the security cost declared in writing. None declared for the dashboard at v0 — SSR + zero-JS keeps Lighthouse Mobile in-budget *and* removes the entire client-side attack surface; security and performance reinforce here, they don't compete.

The token-validation hot path is constant-time-byte-compare on a ≤256-bit token — well under any latency budget that matters, even for very high request rates that the dashboard does not see.

## Verification

- **Default bind**: `lsof -nP -i:$PORT | grep -c '127.0.0.1'` returns 1 with `MINSKY_DASHBOARD_BIND` unset.
- **LAN-bind opt-in**: same command returns 0 (and `0.0.0.0` shows up instead) with `MINSKY_DASHBOARD_BIND=0.0.0.0`.
- **Control gate**: `curl -X POST http://localhost:$PORT/control -d '{"paused":true}'` returns 401; `curl -H "X-Minsky-Token: $TOKEN" -X POST http://localhost:$PORT/control -d '{"paused":true}'` returns 200.

Paired tests pin all three behaviours: `novel/dashboard-web/test/bind.test.ts` (bind resolver), `novel/dashboard-web/test/control-auth.test.ts` (token resolver + validator + startup hint), `novel/dashboard-web/test/server.test.ts` (route-level 401 / 200 / `setPaused`-never-called assertions).

## Sources

- NIST SP 800-53 Rev. 5, control SC-7 "Boundary Protection", 2020.
- NIST SP 800-63B, "Digital Identity Guidelines: Authentication and Lifecycle Management", §5.1.1.2 (memorized-secret comparison), 2017.
- OWASP ASVS 4.0.3, V2.10 "Service Authentication", 2021.
- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — fail-safe defaults; least privilege; psychological acceptability.
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
- vision.md rule #1 (don't reinvent — `crypto.randomBytes` + `crypto.timingSafeEqual` are the industry primitives); rule #7 (loud-on-misconfig); rule #13.4 (this doc's parent constraint).
