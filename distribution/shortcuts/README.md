# `distribution/shortcuts/` — Apple Shortcuts manifests for the Watch surface

> Pivot path: this directory ships **JSON config manifests**, not native iOS
> `.shortcut` binary plists. Apple's `.shortcut` format has been a signed
> binary plist since iOS 15 (per [iOS-Shortcuts-Reference][1]); hand-authoring
> the signed binary off-device is unsafe and unsupported by Apple. This
> v0 ships the configuration the operator needs to **build the Shortcuts
> on-device once**, then export them via iCloud / AirDrop. The build is
> manual; the config is machine-validated by `test/shortcuts-json.test.mjs`
> so the URL, port, dictionary key, and metric mapping cannot drift from
> `novel/dashboard-web/src/watch.ts`.

[1]: https://github.com/sebj/iOS-Shortcuts-Reference

## What is here

Five JSON config files — one per Shortcut:

| File | Kind | Endpoint | Surface |
|------|------|----------|---------|
| `tokens-remaining.shortcut.json` | fetch-and-show | `GET :8080/watch.json` | Watch |
| `last-task-status.shortcut.json` | fetch-and-show | `GET :8080/watch.json` | Watch |
| `constraint-of-the-week.shortcut.json` | fetch-and-show | `GET :8080/watch.json` | Watch |
| `pause.shortcut.json` | post-control | `POST :8080/control` body `{"paused": true}` | iPhone |
| `resume.shortcut.json` | post-control | `POST :8080/control` body `{"paused": false}` | iPhone |

Each file mirrors the iOS Shortcuts UI 1:1: the `endpoint` block is the
"Get Contents of URL" action, `extract` is "Get Dictionary Value", and
`display` is "Show Result". Smoke-test (`test/shortcuts-json.test.mjs`)
asserts JSON validity, schema fidelity, URL / port / path consistency,
and that every `extract.metric_id` maps to a `SuccessMetric.id` shipped
by `novel/dashboard-web/src/metrics.ts`.

## Operator runbook — build the Shortcuts on-device (one-time, ~5 min each)

Prerequisites:

1. iOS 17+ on iPhone; watchOS 10+ on Apple Watch.
2. Both devices on Tailscale; the dashboard host reachable at
   `http://<tailscale-host>:8080/watch.json` from the iPhone (verify in
   Mobile Safari first — you should see a JSON body with the four keys
   `tokens-remaining` / `last-task-status` / `constraint-of-the-week` /
   `paused`).
3. The `<tailscale-host>` substituted into each Shortcut's URL — the
   default placeholder is `minsky.tail-scale.ts.net`. Whatever you pick
   must match the host that `novel/dashboard-web` is listening on.

### A. Build a fetch-and-show Shortcut (steps 1–3 build all 3 Watch readings)

Repeat for each of `tokens-remaining`, `last-task-status`,
`constraint-of-the-week`:

1. **Open Shortcuts.app on iPhone → tap `+` (new Shortcut).**
2. **Add 3 actions, in order:**
   - **`Get Contents of URL`** → URL = the `endpoint.url` field from the
     matching `*.shortcut.json` (substitute `<tailscale-host>`). Method =
     `GET` (default). No headers, no body.
   - **`Get Dictionary Value`** → set the *Dictionary* input to the
     output of "Get Contents of URL". Set *Key* = the `extract.key`
     field from the JSON config (e.g., `tokens-remaining`).
   - **`Show Result`** → input = the output of "Get Dictionary Value".
3. **Set the Shortcut name** (top of the editor, must match the `name`
   field of the JSON config, including the dot — that name is what
   appears on the Watch face). **Toggle "Show on Apple Watch"** in the
   Shortcut's settings sheet (the share button → Details → Show on
   Apple Watch). Save.

### B. Build pause / resume (POST control)

Repeat for `pause` and `resume`:

1. **New Shortcut → 2 actions:**
   - **`Get Contents of URL`** → URL = `http://<tailscale-host>:8080/control`
     (or whatever the JSON config's `endpoint.url` says). Tap *Show More*
     → Method = `POST`. **Request Body** = JSON. Add a key `paused` of
     type Boolean = `true` (for `pause`) or `false` (for `resume`).
   - **`Show Result`** → input = "Paused" (literal text — see `display.format`).
2. Name it `Minsky · pause` / `Minsky · resume`. **No Watch toggle** for
   these (they live on the iPhone; running them from a wrist tap is
   noisy in user-story 002).

### C. Verify on-device

Tap each Shortcut in turn; you should see the field's value in <2 s p95
on Watch. The values come straight from `/watch.json` — the same JSON
the smoke test exercises. If you see `(stub)`, the dashboard's
`getValue` Strategy isn't wired to a live source yet; that's the
upstream `dashboard-web-otel-wiring` task, not a Shortcut bug.

If a Shortcut times out:

- **Connectivity** — open `http://<tailscale-host>:8080/watch.json` in
  Mobile Safari. If that fails, the Tailscale tunnel is down or the
  dashboard isn't running (`launchctl list | grep minsky` on macOS
  per `distribution/launchd/`).
- **Wrong host** — re-check the URL field of the offending Shortcut
  matches the JSON config's `endpoint.url` after host substitution.
- **Empty value** — open the JSON in Safari, confirm the `extract.key`
  is present in the body. The smoke test is supposed to catch this
  drift; if it didn't, that's a bug in `test/shortcuts-json.test.mjs`.

### D. Export (so the build is durable)

For each Shortcut: long-press → *Share* → *Save to Files* (iCloud
Drive). The exported `.shortcut` files are signed binary plists; commit
**only the JSON configs** to this repo, never the binary `.shortcut`
files (they're per-device-signed and would not be portable anyway).

If a Shortcut breaks after an iOS update, the rebuild path is
deterministic: open this README, follow steps A or B for the relevant
config file, verify with the same `/watch.json` body. The truth is the
JSON config; the on-device Shortcut is a derived artifact.

## Schema

The JSON config schema lives in `schema/minsky-shortcut.schema.json`
(JSON-Schema draft 2020-12). Fields are documented inline in the
schema. The smoke test (`test/shortcuts-json.test.mjs`) re-validates
every `*.shortcut.json` against that schema on every PR.

## Why this pivot

The brief's primary path was native `.shortcut.json` manifests Apple
Shortcuts can import directly. Research showed:

- iOS 15+ `.shortcut` files are **signed binary plists**, not JSON
  ([iOS-Shortcuts-Reference, "until iOS 15"][1]).
- Hand-authoring or script-generating signed binary plists off-device
  has no documented path; reverse-engineering Apple's signing format
  would be both fragile and out of scope for this v0.
- The brief explicitly authorised this pivot ("IF the research reveals
  the format is too proprietary/binary to safely author by hand, PIVOT:
  ship a `distribution/shortcuts/README.md` with a step-by-step 'build
  these in Shortcuts.app' runbook + JSON-schema-validatable config
  files"). This is exactly that path.

The v0 is autonomously verifiable for everything **upstream** of the
on-device build (URL correctness, schema consistency, metric mapping
to vision.md success rows, dashboard route returning the right shape);
the on-device verification is the **operator's** runbook above. The
unit-of-work split mirrors the existing `distribution/launchd/` and
`distribution/systemd/` precedent — the supervisor units are also
manifests the operator installs by hand once, then verified by lint
(`distribution/lint-units.sh`).

## Anchor

- Card, S. K., Mackinlay, J., Shneiderman, B., *Readings in Information
  Visualization*, Morgan Kaufmann, 1999 (glanceable three-number display).
- Weiser, M., Brown, J. S., "Designing Calm Technology", *PowerGrid Journal*
  1995 (calm tech; the wrist surface as ambient background).
- Beyer, B., Jones, C., Petoff, J., Murphy, N. R. (eds.), *Site Reliability
  Engineering*, O'Reilly, 2016, Ch. 17 (operator escape hatch / kill switch
  for the pause/resume Shortcuts).
- vision.md § "Pattern conformance index" — row added in the same PR.
- `user-stories/005-three-numbers-watch.md` (when extant) — the parent
  user story this directory operationalises; user-stories/002 (pause
  from iPhone) — the second user story the pause/resume Shortcuts close.

## Pivot — when this directory itself fires its rule-#9 pivot

If the rebuild rate exceeds 1 / month sustained 90 days (operator gives
up; the Watch surface is too brittle), pivot to a native watchOS app —
already filed as `native-watchos-app` in TASKS.md (the parent task's
documented pivot). The trigger is a higher-level signal than this v0
can self-measure: track manually for now, file a deterministic counter
once `dashboard-web-otel-wiring` lands.
