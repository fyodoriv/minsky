# `@minsky/ollama`

`Ollama` adapter — interface (Adapter pattern, Gamma 1994) over Ollama's
HTTP API, plus a `StubOllama` test fake (Meszaros 2007) and an
`HttpOllama` Strategy that talks to `/api/generate` + `/api/ps` on a
local Ollama daemon.

The daemon-side bash skeleton (`bin/minsky-run.sh`) uses this adapter
to warm the configured local model exactly once per daemon-start
(before the first iteration's openhands spawn pays a cold-start tax
mid-reasoning) and to unload it on graceful shutdown (so the operator
gets ~42 GB of wired RAM back the moment they stop iterating). Closes
[user-stories/020-ollama-jit-warm-unload.md](../../../user-stories/020-ollama-jit-warm-unload.md).

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index):

- **`Ollama` interface** — Adapter (structural) per Gamma, Helm,
  Johnson, Vlissides, *Design Patterns*, 1994. **Conformance: full.**
- **`StubOllama`** — test fake / spy hybrid per Meszaros, *xUnit Test
  Patterns*, 2007 — records every `warm` / `unload` / `ps` call in
  memory and returns a fixed `{ ok: true }`. **Conformance: full.**
- **`HttpOllama`** — Strategy (behavioral) per Gamma 1994 backed by
  Ollama's documented HTTP API
  ([github.com/ollama/ollama/blob/main/docs/api.md](https://github.com/ollama/ollama/blob/main/docs/api.md)).
  **Conformance: full** — empty `prompt` + `keep_alive: "30m"` warms,
  `keep_alive: 0` unloads, exactly as the Ollama docs prescribe.
- **`Ollama.selfTest`** — health probe re-uses `SelfTestResult` from
  `@minsky/adapter-types` (leaf package per Martin, *Clean
  Architecture*, 2017 — acyclic dependency principle).

## Usage

### From TypeScript (the adapter as a library)

```ts
import { HttpOllama } from "@minsky/ollama";

const ollama = new HttpOllama({ baseUrl: "http://localhost:11434" });
const warmResult = await ollama.warm("ollama_chat/qwen3-coder:30b");
// → { ok: true } or { ok: false, reason: "network: ECONNREFUSED ..." }
//   Never throws — graceful-degrade per rule #7.

// later, on daemon shutdown:
await ollama.unload("ollama_chat/qwen3-coder:30b");
```

### From bash (the CLI wrapper for `bin/minsky-run.sh`)

```bash
# Warm:
node novel/adapters/ollama/bin/cli.mjs warm ollama_chat/qwen3-coder:30b http://localhost:11434

# Unload:
node novel/adapters/ollama/bin/cli.mjs unload ollama_chat/qwen3-coder:30b http://localhost:11434

# Inspect (returns JSON list of loaded models):
node novel/adapters/ollama/bin/cli.mjs ps http://localhost:11434
```

Exit code 0 on success, 1 on transport failure, 2 on bad argv.

The bash skeleton invokes both via the `bin/minsky-ollama` PATH-exposed
wrapper that this package's `bin/cli.mjs` backs. See `bin/minsky-run.sh`
§ `walk_hosts` (warm-on-start) and § SIGTERM trap (unload-on-stop) for
the call sites.

## What it doesn't do

- It doesn't manage `ollama serve` itself. That's the launchd
  `com.dotfiles.ollama` plist's job; if `ollama serve` is down, this
  adapter returns `{ ok: false, reason: "network: ..." }` and the
  existing `heal-ollama-down` recipe kicks the daemon (see
  `novel/observer/heals/src/heal-ollama-down.ts`).
- It doesn't pull models. If the model id isn't present, Ollama's
  `/api/generate` returns a `404 model not found`; this adapter
  surfaces that as `{ ok: false, reason: "http 404" }` and the
  operator runs `ollama pull <model>` to fix it.
- It doesn't override LiteLLM's per-request `keep_alive`. LiteLLM does
  not currently set one, so each in-flight request falls back to
  Ollama's `OLLAMA_KEEP_ALIVE` env var (which the
  `com.dotfiles.ollama` plist sets to 10m, post-story-020). The
  daemon-stop unload is the deterministic eviction primitive; the env
  var is the safety net.

## Failure modes & chaos verification

Per [vision.md § rule #7](../../../vision.md) — every novel package's README enumerates failure modes, expected behavior, and a chaos test row. Full table also lives in [user-stories/020-ollama-jit-warm-unload.md](../../../user-stories/020-ollama-jit-warm-unload.md) § "Failure modes & chaos verification".

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Ollama unreachable at warm time | port 11434 refuses connection at daemon start | `graceful-degrade` — `warm()` returns `{ ok: false, reason: "network: ..." }`, the bash runner continues; the existing `heal-ollama-down` recipe kicks the daemon on the first iteration's spawn failure | `src/http.test.ts` § `returns ok: false with reason on network rejection — never throws` |
| Ollama returns non-2xx on unload | model already unloaded; ollama upgraded mid-session; auth changed | `graceful-degrade` — `unload()` returns `{ ok: false, reason: "http <code>" }`; the trap STILL `exit 0`s the runner cleanly; the 10 m env-var safety net catches residual hold | `src/http.test.ts` § `returns ok: false on non-2xx response` |
| Network partition mid-warm | fetch hangs forever | `circuit-break-and-notify` — `AbortController` per-call timeout (30 s default) aborts; the warm CLI exits non-zero; the runner continues; first iteration pays cold-start tax | `src/http.test.ts` § `aborts after the configured timeout and surfaces it as a network reason` |
| Malformed `/api/ps` payload | upstream Ollama upgrade changes the shape | `graceful-degrade` — `ps()` returns `{ ok: false, reason: "parse: ..." }` AND `{ ok: true, models: [] }` when the payload is just missing the `models` field; never throws | `src/http.test.ts` § `returns empty models when /api/ps payload has no models field` + `skips malformed model rows rather than crashing the parse` |

**Blast radius**: bounded to operators with `local_llm_enabled: true`. Cloud-path operators see zero behavior change.

**Operator escape hatch**: `MINSKY_OLLAMA_DISABLE_LIFECYCLE=1` in the daemon's env short-circuits BOTH `warm` and `unload` to no-op. Iterations still work; memory management reverts to the env-var safety net (`OLLAMA_KEEP_ALIVE=10m`).

## Anchors

- Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
  1994 (Adapter + Strategy).
- Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
- Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
  dependency principle — `@minsky/adapter-types` is the leaf).
- Ollama HTTP API docs (`/api/generate` § "Load a model"):
  <https://github.com/ollama/ollama/blob/main/docs/api.md>
- Hennessy & Patterson, *Computer Architecture: A Quantitative
  Approach*, 6th ed., 2017, § 2.2 — working-set management (the
  framing for why daemon-scoped unload is the right eviction
  primitive).
