# Dashboard network exposure

Minsky's `dashboard-web` package binds to `127.0.0.1` (loopback only) by default.

## Why localhost-only matters

The dashboard surfaces:

- All ten vision.md success metrics and their live values
- The activity feed, which can include task IDs, iteration reasons, and internal context
- `POST /control` — the pause/resume escape hatch that directly changes supervisor behaviour

A dashboard exposed on `0.0.0.0` (all interfaces) on a laptop connected to shared WiFi is
reachable by anyone on the same network. This is the OWASP "Default Secure Configuration"
anti-pattern: a dangerous default is itself a vulnerability.

Anchor: rule #13 (vision.md § 13 — security & privacy — second priority after performance;
item 5 — dashboard binds localhost by default); OWASP WSTG-CONF-05 (default credentials and
unsafe defaults); rule #7 (loud-on-misconfig — LAN-bind warning is loud, not silent).

## Default behaviour

```bash
PORT=8181 pnpm dogfood:ui
# → binds 127.0.0.1:8181 only
# → prints control token to stdout (needed for POST /control)
```

`curl http://<lan-ip>:8181/` from another device → connection refused.

## Opting in to LAN exposure

Set `MINSKY_DASHBOARD_BIND` to a non-loopback address:

```bash
MINSKY_DASHBOARD_BIND=0.0.0.0 PORT=8181 pnpm dogfood:ui
```

The startup message warns:

```text
dashboard-web WARNING: binding to 0.0.0.0 — dashboard is reachable from any LAN device.
  Protect with a reverse proxy + auth. See docs/security/dashboard-exposure.md
```

**Recommended pattern for remote access**: SSH tunnel from your phone/tablet to the laptop
instead of LAN-binding the process directly:

```bash
ssh -L 8181:localhost:8181 you@laptop.local
# then open http://localhost:8181/ on the remote device
```

SSH tunnel gives you encryption + authentication without exposing the port on the LAN.

## POST /control token

`POST /control` accepts `{"paused": true|false}` and is used by Apple Shortcuts to pause/resume
the supervisor loop. Any process that can reach port 8181 could abuse it.

The server generates a random UUID per run (or reads `MINSKY_CONTROL_TOKEN` if set) and prints
it to stdout at startup:

```text
dashboard-web control token: 7f3a4b8c-...
```

Every `POST /control` request must include the token:

```http
X-Minsky-Token: 7f3a4b8c-...
```

Missing or wrong token → `401 {"error":"unauthorized"}`.

### Persistent token (Apple Shortcuts)

To avoid updating the Shortcut every restart, pin the token:

```bash
export MINSKY_CONTROL_TOKEN="$(uuidgen)"
# save this value in your Shortcut's header field
```

Or generate once and add to your shell profile:

```bash
echo "export MINSKY_CONTROL_TOKEN=$(uuidgen)" >> ~/.zshrc
```

## Pivot threshold

If the per-run random token causes too much Shortcut friction (≥ 1 manual token-update per
week), the documented fix is `MINSKY_CONTROL_TOKEN` in the shell profile — not relaxing the
auth requirement. The default-secure configuration stands.
