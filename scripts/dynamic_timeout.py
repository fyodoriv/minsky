#!/usr/bin/env python3
"""scripts/dynamic_timeout.py — Phase 7 dynamic spawn watchdog (port of dynamic-timeouts.ts).

Reads the host's recent iteration history from
`<host>/.minsky/experiment-store/cross-repo/*.jsonl` and prints the
recommended spawn timeout in WHOLE SECONDS to stdout (the unit GNU
`timeout(1)` expects).

Algorithm (mirrors `computeDynamicSettings` in dynamic-timeouts.ts):

1. Read every `*.jsonl` under the host's experiment-store.
2. Extract `(durationMs, verdict)` pairs by JSON-parsing each line and
   regex-extracting `(\\d+)ms` from the `notes` field.
3. Filter to "completed work" — verdict in {validated, scope-leak} AND
   duration > 10s (sub-10s spawn-failed are config errors, ≥10s are
   prior watchdog kills; exclude both).
4. If <5 samples: print the cold-start floor for the resolved model
   class (slow-remote > fast-remote > local=DEFAULT). With no model
   the floor is the conservative DEFAULT (1200 = 20 minutes).
5. Else: p95(durations) × 1.5, clamped to [120s, 2700s] (2min–45min)
   — model-agnostic, byte-identical to the pre-model behavior.

Why the thin-history floor is model-aware (worker-watchdog-scale-by-
pinned-model-latency): a freshly-pinned slow remote model (Opus) on a
host with <5 samples used to get the same flat 20-min default as a fast
local model, guaranteeing SIGKILL on its first heavy iterations before
history accrues. The floor is now the regime estimate (Astrom &
Wittenmark 1995, adaptive thresholding under non-stationary signals)
until the p95 path has enough data to engage. The ≥5-sample path is
unchanged — once real durations exist they dominate the prior.

CLI:
    python3 scripts/dynamic_timeout.py <host-dir> [--model <id>]

Exit codes:
    0  always (prints a number even when the input is empty/missing)

Plan doc: docs/plans/2026-05-24-path-a-aggressive-cut.md § Phase 7
Anchor:   rule #1 (port the TS algorithm 1:1; don't reinvent); rule #4
          (everything measurable — the timeout IS measured from real data,
          not guessed). Astrom & Wittenmark 1997 (adaptive threshold).
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Iterable

# --- Constants (must match dynamic-timeouts.ts) --------------------------

MIN_WATCHDOG_S = 120              # 2 min — never lower
MAX_WATCHDOG_S = 45 * 60          # 45 min — never higher
DEFAULT_WATCHDOG_S = 20 * 60      # 20 min — used when <5 samples
HEADROOM = 1.5                    # p95 × 1.5
MIN_SAMPLE_SIZE = 5
SUCCESS_VERDICTS = ("validated", "scope-leak")
MIN_SUCCESS_DURATION_MS = 10_000  # exclude sub-10s no-ops

# Cold-start floors per resolved model class (worker-watchdog-scale-by-
# pinned-model-latency). Used ONLY on the thin-history path (<5 samples)
# to give a slow remote model enough first-iteration runway to edit
# before history accrues. Strictly ordered slow-remote > fast-remote >
# local=DEFAULT, all within [MIN_WATCHDOG_S, MAX_WATCHDOG_S]. Once ≥5
# real samples exist the p95×1.5 path takes over and the floor is unused.
SLOW_REMOTE_COLD_START_S = 40 * 60   # 40 min — Opus-class remote
FAST_REMOTE_COLD_START_S = 30 * 60   # 30 min — Sonnet/Haiku-class remote
LOCAL_COLD_START_S = DEFAULT_WATCHDOG_S  # 20 min — local models = the legacy default

# `notes` lines look like: "openhands exited 0; 142000ms" — we capture
# the milliseconds via the same regex the TS uses.
DURATION_RE = re.compile(r"(\d+)ms")


# --- Pure helpers --------------------------------------------------------


def cold_start_floor_for_model(model: str | None) -> int:
    """Select the thin-history cold-start floor for a resolved model id.

    worker-watchdog-scale-by-pinned-model-latency. Classifies the model
    string into slow-remote / fast-remote / local and returns that
    class's floor. A None/empty/unrecognized remote model falls back to
    DEFAULT_WATCHDOG_S so behavior is byte-identical to the pre-model
    path when no model is threaded in.

    Classification is substring-based and case-insensitive:
      - local      → any `ollama`, `lm_studio`/`lmstudio`, or an explicit
                     `local` marker (the local-LLM path's `ollama_chat/...`)
      - slow-remote→ remote `opus` (highest-latency cloud tier)
      - fast-remote→ any other remote (sonnet, haiku, gpt, etc.)
    """
    if not model:
        return DEFAULT_WATCHDOG_S
    m = model.lower()
    if "ollama" in m or "lm_studio" in m or "lmstudio" in m or "local" in m:
        return LOCAL_COLD_START_S
    if "opus" in m:
        return SLOW_REMOTE_COLD_START_S
    return FAST_REMOTE_COLD_START_S


def percentile(sorted_values: list[int], p: float) -> int:
    """Compute percentile from an ascending-sorted list. Mirrors TS."""
    if not sorted_values:
        return 0
    idx = math.ceil(p * len(sorted_values)) - 1
    return sorted_values[max(0, min(idx, len(sorted_values) - 1))]


def parse_timings_from_jsonl(content: str) -> list[tuple[int, str]]:
    """Return list of (durationMs, verdict) from a JSONL content string.

    Parity contract: matches `parseTimingsFromJsonl` in dynamic-timeouts.ts.
    Skips lines that don't parse, lines without a duration in notes, and
    lines whose verdict isn't in {validated, scope-leak, spawn-failed}.
    """
    out: list[tuple[int, str]] = []
    for line in content.splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        verdict = obj.get("verdict")
        if verdict not in ("validated", "scope-leak", "spawn-failed"):
            continue
        notes = obj.get("notes") or ""
        m = DURATION_RE.search(notes)
        if m is None:
            continue
        out.append((int(m.group(1)), verdict))
    return out


def compute_watchdog_seconds(
    timings: Iterable[tuple[int, str]], model: str | None = None
) -> int:
    """Compute the watchdog timeout in seconds from iteration history.

    Parity contract: the ≥5-sample p95×1.5 spawn timeout calculation
    matches `computeDynamicSettings` in dynamic-timeouts.ts and is
    byte-identical regardless of `model`. On the thin-history path
    (<MIN_SAMPLE_SIZE samples) the conservative floor is selected from
    the resolved model class (worker-watchdog-scale-by-pinned-model-
    latency) instead of the single flat DEFAULT_WATCHDOG_S — a slow
    remote model gets more first-iteration runway before history accrues.
    `model=None` reproduces the original flat-default behavior.
    Returns whole seconds (GNU `timeout` unit).
    """
    successful_ms = sorted(
        dur for dur, verdict in timings
        if verdict in SUCCESS_VERDICTS and dur > MIN_SUCCESS_DURATION_MS
    )
    if len(successful_ms) < MIN_SAMPLE_SIZE:
        return cold_start_floor_for_model(model)
    p95_ms = percentile(successful_ms, 0.95)
    raw_s = int(round(p95_ms * HEADROOM / 1000))
    return max(MIN_WATCHDOG_S, min(MAX_WATCHDOG_S, raw_s))


def watchdog_seconds_for_host(host: Path, model: str | None = None) -> int:
    """Compute the watchdog for a host by reading its experiment-store JSONL.

    Threads the resolved `model` (worker-watchdog-scale-by-pinned-model-
    latency) into the thin-history cold-start floor selection.
    """
    store_dir = host / ".minsky" / "experiment-store" / "cross-repo"
    if not store_dir.is_dir():
        return cold_start_floor_for_model(model)
    timings: list[tuple[int, str]] = []
    for jsonl in sorted(store_dir.glob("*.jsonl")):
        try:
            timings.extend(parse_timings_from_jsonl(jsonl.read_text(encoding="utf-8")))
        except OSError:
            continue
    return compute_watchdog_seconds(timings, model=model)


# --- CLI -----------------------------------------------------------------


def parse_cli_args(argv: list[str]) -> tuple[str | None, str | None]:
    """Parse `<host-dir> [--model <id>]` into (host, model).

    Returns (None, None) on a malformed argv so the caller can emit the
    safe default. `--model` is optional and may appear in either
    `--model X` or `--model=X` form; the host-dir is the sole positional.
    """
    host: str | None = None
    model: str | None = None
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == "--model":
            if i + 1 >= len(argv):
                return None, None
            model = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--model="):
            model = arg[len("--model="):]
            i += 1
            continue
        if arg.startswith("--"):
            return None, None  # unknown flag → malformed
        if host is not None:
            return None, None  # second positional → malformed
        host = arg
        i += 1
    if host is None:
        return None, None
    return host, model


def main(argv: list[str]) -> int:
    host, model = parse_cli_args(argv)
    if host is None:
        print("usage: dynamic_timeout.py <host-dir> [--model <id>]", file=sys.stderr)
        # Still emit the default so bash callers don't bork on bad argv.
        print(DEFAULT_WATCHDOG_S)
        return 0
    print(watchdog_seconds_for_host(Path(host), model=model))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
