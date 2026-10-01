#!/usr/bin/env python3
"""scripts/synth_experiment_yaml.py — Path A Phase 7 EXPERIMENT.yaml synthesiser.

Parity port of `novel/cross-repo-runner/src/experiment-synth.ts`
(`synthesiseExperimentYaml`). Closes user-story 006's Acceptance criterion
"$host/.minsky/experiments/<task-id>.yaml is materialised with all 5
rule-#9 fields populated from the task row" for the bash runner —
which was silently NOT writing the file (parity gap with the TS runner).

Pattern: pure function over a parsed task → YAML string (Martin 2017).
The CLI is the I/O boundary.

CLI:
    python3 scripts/synth_experiment_yaml.py <task-id> <host-dir>
        [--repo-yaml <path>]
        [--output <path>]

Default: writes the YAML to <host-dir>/.minsky/experiments/<task-id>.yaml
(matches TS runner's `experimentYamlPath`). Use `--output -` for stdout.

Exit codes:
    0 — YAML written
    1 — task not found in host's TASKS.md
    2 — bad CLI args
    3 — task missing rule-#9 fields (Hypothesis / Success / Pivot /
        Measurement / Anchor; rule #9 is iron)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow importing pick_task as a sibling module without installing the package.
sys.path.insert(0, str(Path(__file__).parent))

import pick_task  # noqa: E402  pylint: disable=wrong-import-position


def synthesise_experiment_yaml(
    task: pick_task.ParsedTask,
    *,
    host_repo: str | None = None,
) -> tuple[str, list[str]]:
    """Render a `ParsedTask` to YAML matching the experiment-record schema.

    Returns `(yaml, missing_fields)`. When any of the 5 rule-#9 fields
    is None, `yaml` is empty and `missing_fields` lists the names of
    the absent fields (rule #9 is iron — no exemption).

    Parity contract: matches `synthesiseExperimentYaml` in
    `novel/cross-repo-runner/src/experiment-synth.ts`. Output is
    byte-equivalent to the TS path for the same inputs.
    """
    missing: list[str] = []
    if task.hypothesis is None:
        missing.append("Hypothesis")
    if task.success is None:
        missing.append("Success")
    if task.pivot is None:
        missing.append("Pivot")
    if task.measurement is None:
        missing.append("Measurement")
    if task.anchor is None:
        missing.append("Anchor")
    if missing:
        return "", missing
    if task.id is None:
        return "", ["ID"]
    yaml = _render_experiment_yaml(
        task_id=task.id,
        host_repo=host_repo,
        hypothesis=task.hypothesis,
        success=task.success,
        pivot=task.pivot,
        measurement=task.measurement,
        anchor=task.anchor,
    )
    return yaml, []


def _render_experiment_yaml(
    *,
    task_id: str,
    host_repo: str | None,
    hypothesis: str,
    success: str,
    pivot: str,
    measurement: str,
    anchor: str,
) -> str:
    """Pure render — produces the YAML string. Hand-rendered (rule #1:
    don't pull a yaml dep for 7 lines of text)."""
    lines: list[str] = [f"id: {task_id}"]
    if host_repo:
        lines.append(f"host_repo: {_quote(host_repo)}")
    lines.append("hypothesis: |")
    lines.append(_indent(hypothesis, "  "))
    lines.append(f"success: {_quote(success)}")
    lines.append(f"pivot: {_quote(pivot)}")
    lines.append(f"measurement: {_quote(measurement)}")
    lines.append("anchor: |")
    lines.append(_indent(anchor, "  "))
    lines.append("")
    return "\n".join(lines)


def _indent(text: str, prefix: str) -> str:
    return "\n".join(f"{prefix}{line}" for line in text.split("\n"))


def _quote(s: str) -> str:
    """JSON-style quoting — matches the TS `JSON.stringify(s)` shape."""
    return json.dumps(s)


def _parse_host_repo_from_yaml(repo_yaml_content: str) -> str | None:
    """Read `host_repo` from a flat-shape repo.yaml. Pure, schema-narrow.

    Matches the subset `bin/minsky-bootstrap.sh` writes:
        host_repo: "owner/repo"
    """
    for line in repo_yaml_content.splitlines():
        m = line.strip()
        if not m.startswith("host_repo:"):
            continue
        value = m[len("host_repo:"):].strip()
        # Strip surrounding quotes (yaml may use double or single).
        if (
            len(value) >= 2
            and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'"))
        ):
            return value[1:-1]
        return value
    return None


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: synth_experiment_yaml.py <task-id> <host-dir> "
            "[--repo-yaml <path>] [--output <path>]",
            file=sys.stderr,
        )
        return 2
    task_id = argv[1]
    host_dir = Path(argv[2])
    repo_yaml_path: Path | None = None
    output_path: Path | None = None
    for arg in argv[3:]:
        if arg.startswith("--repo-yaml="):
            repo_yaml_path = Path(arg.split("=", 1)[1])
        elif arg.startswith("--output="):
            output_path = Path(arg.split("=", 1)[1])
        elif arg == "--repo-yaml":
            # Don't support split-flag style; --flag=value only
            print(f"--repo-yaml requires --repo-yaml=<path>", file=sys.stderr)
            return 2
        elif arg == "--output":
            print(f"--output requires --output=<path>", file=sys.stderr)
            return 2
        else:
            print(f"unknown flag: {arg}", file=sys.stderr)
            return 2

    tasks_md_path = host_dir / "TASKS.md"
    if not tasks_md_path.is_file():
        print(f"file not found: {tasks_md_path}", file=sys.stderr)
        return 1
    tasks_md_content = tasks_md_path.read_text(encoding="utf-8")
    find_result = pick_task.find_task(tasks_md_content, task_id)
    if not find_result.ok or find_result.task is None:
        print(find_result.reason or f"task '{task_id}' not found", file=sys.stderr)
        return 1

    # Optional host_repo from repo.yaml — defaults to `host_dir`'s actual
    # bootstrap marker (the same path the TS runner reads via
    # `loadHostConfig`). When the file is missing, host_repo stays None
    # → the YAML omits the field (matches the TS path).
    host_repo: str | None = None
    if repo_yaml_path is None:
        repo_yaml_path = host_dir / ".minsky" / "repo.yaml"
    if repo_yaml_path.is_file():
        host_repo = _parse_host_repo_from_yaml(
            repo_yaml_path.read_text(encoding="utf-8")
        )

    yaml, missing = synthesise_experiment_yaml(find_result.task, host_repo=host_repo)
    if missing:
        print(
            f"task '{task_id}' missing rule-#9 fields: {', '.join(missing)}",
            file=sys.stderr,
        )
        return 3

    if output_path is None:
        output_path = host_dir / ".minsky" / "experiments" / f"{task_id}.yaml"
    if str(output_path) == "-":
        sys.stdout.write(yaml)
        return 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(yaml, encoding="utf-8")
    print(str(output_path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
