# Privacy by default — data egress threat model and operator guide

Per [vision.md § 13](../../vision.md#13-security--privacy--second-priority-after-performance) minimum-bar item 7 ("Privacy by default"), Minsky reads operator-private data — the host repo, the operator's `~/.claude/projects/**/*.jsonl` session files, environment variables, and CI logs — and is constrained to send that data only to (a) Anthropic (already required for `claude --print`) and (b) OpenObserve (operator-controlled, on-host or operator-chosen endpoint). The dashboard ships zero third-party JS — server-rendered HTML only. This doc consolidates the threat model, the egress allow-list, the per-destination opt-out matrix, and the verification commands. Anchors: GDPR Article 25 ("data protection by design and by default"); NIST SP 800-53 SC-7 boundary protection; OWASP LLM Top 10 (2025 ed.) LLM02 "Sensitive Information Disclosure"; Saltzer & Schroeder, *Proceedings of the IEEE* 63(9), 1975 (least privilege; psychological acceptability — the operator can answer "where does my data go" in one page).

## Threat model

STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, Microsoft Press, 2003.

- **Untrusted inputs**: any third-party endpoint that, if quietly added to the codebase, would silently exfiltrate operator data (analytics SDKs, telemetry beacons in transitive npm packages, CDN-hosted JS the dashboard might one day pull, "phone-home" defaults in OTEL exporters or SDK error reporters).
- **Trusted state**: the explicit egress allow-list below; the per-destination opt-out controls (env vars + config); the OTEL PII-scrubbing lint (rule #13.2 — `otel-no-pii-in-spans-lint`); the dashboard's zero-third-party-JS rule (rule #13.7 last clause — already shipped); the lockfile-integrity gate (rule #13.5) that blocks unreviewed dependency drift from inserting new exfiltration paths.
- **Trust boundary**: the operator's machine. Loopback + filesystem reads are inside the boundary; any outbound TCP/UDP to a non-loopback address crosses it. Every allowed crossing is enumerated below; every unenumerated crossing is a bug.
- **STRIDE focus**:
  - **S**poofing — Anthropic + GitHub + npm registry endpoints are pinned to their canonical hostnames; the lockfile-integrity gate (rule #13.5) prevents typo-squat package substitution at install time.
  - **T**ampering — outbound payloads are constructed in-process; no shell-quoted JSON pipelines that an attacker on the same machine could inject into. PR bodies and commit messages are operator-authored or daemon-authored from in-process strings, never from network-fetched templates.
  - **R**epudiation — out of scope at v0 (single operator per supervisor; no multi-tenant accountability surface). Filed as `cloud-tier-multi-operator-audit-log` follow-up if/when the cloud tier ships.
  - **I**nformation disclosure — the load-bearing STRIDE axis for this rule. Addressed by (a) the explicit allow-list below, (b) the OTEL no-PII lint (rule #13.2), (c) the dashboard's zero-third-party-JS guarantee (rule #13.7 last clause), and (d) the operator opt-out matrix.
  - **D**enial of service — out of scope; the egress paths are operator-initiated (LLM call, telemetry export, git push) and rate-limited by their own operators.
  - **E**levation of privilege — npm install runs in user-space; no setuid binaries are bundled. The supervisor sandbox (rule #13.3) is the orthogonal control.

## Egress allow-list

Every outbound TCP/UDP destination Minsky reaches by default. Anything not on this table is a bug — file an issue tagged `privacy-egress-violation`.

| Destination | Hostname(s) | Data sent | Why allowed | Operator opt-out |
| --- | --- | --- | --- | --- |
| Anthropic API | `api.anthropic.com` | The full `claude --print` request: operator's prompt (which includes brief, task block, recent commits), tool-call results, file contents Claude reads/edits during the session | Required for the LLM call that *is* Minsky's core loop. No LLM, no Minsky. | Stop running the supervisor (`pnpm dogfood:stop`); switch to a self-hosted model in a future tier (filed as `self-hosted-llm-tier` follow-up). No partial opt-out exists — the prompt and tool I/O *are* the call. |
| OpenObserve / OTLP collector | `OTEL_EXPORTER_OTLP_ENDPOINT` env (operator-set; defaults to none — exports are no-op until configured) | OTEL spans + metrics + logs. PII-scrubbed at the lint level by rule #13.2 (`otel-no-pii-in-spans-lint`). Span shapes: tick counts, latencies, claim/complete events, error classes. | Operator controls the endpoint — typically self-hosted OpenObserve on the same machine, or an operator-owned cloud instance. The `@opentelemetry/exporter-trace-otlp-http` package is the industry-standard transport. | Unset `OTEL_EXPORTER_OTLP_ENDPOINT` (default state); or set `OTEL_SDK_DISABLED=true`. With neither set, the exporters initialise but have nowhere to send. |
| GitHub API + git remote | `api.github.com`, `github.com` (or operator-configured GHE) | Git pushes (commits + branches + tags), PR bodies, PR comments, issue comments, workflow dispatch payloads. All operator-authored or daemon-authored from in-process strings — no third-party templates. | Operator's own remote; required for the daemon's "open PR per iteration" loop and for cross-repo CI. | Switch `git remote` to a self-hosted Forgejo / Gitea; or run the daemon with `MINSKY_NO_PR_OPEN=1` (substrate filed as `daemon-no-pr-mode` follow-up — until then, point `gh` at a self-hosted GHE). |
| npm registry | `registry.npmjs.org` (build-time only; never at runtime) | Package-name + version-range queries during `pnpm install`. No telemetry beyond what npm itself collects. | Required for dependency resolution; constrained by the lockfile-integrity gate (rule #13.5) so unreviewed registry drift cannot insert new packages. | Configure `npm_config_registry` to a self-hosted Verdaccio / npm Enterprise mirror. |
| ntfy.sh (optional notifier adapter) | `ntfy.sh` by default; operator-configurable via `serverBaseUrl` | Notification title + body for operator-facing alerts (PR opened, supervisor crashed, budget exhausted) | Operator opt-in adapter; not loaded unless the operator wires the notifier. | Don't load the notifier adapter; or set `serverBaseUrl` to a self-hosted ntfy instance. |
| Dependabot / GitHub Actions runners | GitHub-hosted IPs (per workflow) | CI workflow inputs — repo contents, secrets configured in GH settings | Runs in the operator's own GitHub org; subject to the operator's GH-Actions allow-list. | Self-host the runners; or disable Dependabot / Actions per workflow file. |

The dashboard's HTTP surface (`@minsky/dashboard-web`) sends *zero* outbound requests — it is server-rendered HTML with no third-party JS, no analytics beacon, no font CDN, no Google Tag Manager. This is the load-bearing guarantee of rule #13.7's last clause.

## Operator opt-out matrix

Per GDPR Article 25 ("by default") — the operator should be able to disable any non-required egress without editing source. Status today:

| Destination | Opt-out mechanism | State |
| --- | --- | --- |
| OpenObserve / OTLP | unset `OTEL_EXPORTER_OTLP_ENDPOINT` (default); or `OTEL_SDK_DISABLED=true` | shipped |
| GitHub remote | `git remote set-url origin <self-hosted-forgejo>` | operator action; no Minsky code change needed |
| npm registry | `npm_config_registry=<mirror>` | shipped (npm-native) |
| ntfy notifier | don't load the adapter | shipped (adapter is opt-in) |
| Anthropic API | switch supervisor off, or wait for self-hosted-llm tier | partial — no in-process toggle exists |

The Anthropic-API row is the only "no clean opt-out" entry. That is by design: the LLM call IS the supervisor's purpose. If the operator wants Minsky without Anthropic, the path is the `self-hosted-llm-tier` follow-up (Ollama / vLLM adapter behind the same `Strategy` interface that wraps `claude --print` today).

## Performance-first carve-out

Per rule #13's relief valve: when security/privacy and performance compete, performance wins on a case-by-case basis with the cost declared in writing. None declared for the egress allow-list at v0 — the LLM round-trip dominates wall time by 4-6 orders of magnitude over any allow-list check, and the OTEL exporter's batching mode (`BatchSpanProcessor`) is already the industry-standard low-overhead path. Privacy and performance reinforce here; they do not compete.

## Verification

- **Egress audit (live)** — while the supervisor is running, `lsof -i -nP -p $(pgrep -f tick-loop) | rg -v 'LISTEN|127\.0\.0\.1|::1'` should list only hostnames whose IPs resolve to entries in the allow-list above. Anything else is an exfiltration bug.
- **Egress audit (static)** — `rg -nF 'http://' -g 'novel/**/*.ts' -g 'scripts/**/*.mjs' -g '!**/*.test.*'` and the same for `https://` should surface only allow-list hostnames in production code paths. Test fixtures (`http://test.local`, GitHub URLs in test bodies) are exempt.
- **Dashboard zero-third-party-JS** — `rg -nF 'src=' novel/dashboard-web/src/render*.ts` returns zero `src=` attributes pointing off-origin. Server-rendered HTML carries inline styles + zero `<script>` tags.
- **OTEL PII-scrub** — `node scripts/check-otel-no-pii.mjs` (rule #13.2 gate) exits 0; the gate is wired into CI.
- **Lockfile-integrity** — `node scripts/check-lockfile-integrity.mjs` (rule #13.5 slice 4 gate) exits 0; ensures no unreviewed dependency drift can insert a new exfiltration path.

## Sources

- GDPR (Regulation (EU) 2016/679), Article 25 "Data protection by design and by default", 2016.
- NIST SP 800-53 Rev. 5, control SC-7 "Boundary Protection", 2020.
- OWASP LLM Top 10 (2025 ed.), LLM02 "Sensitive Information Disclosure", LLM06 "Excessive Agency".
- Saltzer & Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 — least privilege, psychological acceptability, fail-safe defaults.
- Howard & LeBlanc, *Writing Secure Code*, 2nd ed., Microsoft Press, 2003 — STRIDE.
- OpenTelemetry Specification, "Data classification", semantic-conventions/attributes-registry/general/, 2025.
- vision.md rule #1 (don't reinvent — Anthropic SDK + OpenTelemetry exporter are the industry primitives); rule #13.2 (OTEL no-PII lint, the orthogonal scrub); rule #13.5 (supply-chain hardening, the orthogonal "no new egress paths slip in"); rule #13.7 (this doc's parent constraint).
