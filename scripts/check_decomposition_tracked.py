from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.check_lint_coverage_tracked import tracked_handwritten_code_paths

DEFAULT_THRESHOLD = 800
_BASELINE_PATH = Path("configs/lint/decomposition-baseline.json")


@dataclass(frozen=True)
class DecompositionBaseline:
    threshold: int
    admitted: dict[str, int]


@dataclass(frozen=True)
class DecompositionFinding:
    path: str
    reason: str
    lines: int | None
    max_lines: int | None


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def baseline_file_path(*, root: Path | None = None) -> Path:
    return (root or repo_root()) / _BASELINE_PATH


def tracked_decomposition_paths(*, root: Path | None = None) -> tuple[str, ...]:
    return tracked_handwritten_code_paths(root=root)


def load_decomposition_baseline(
    *, root: Path | None = None, path: Path | None = None
) -> DecompositionBaseline:
    baseline_path = path or baseline_file_path(root=root)
    payload = json.loads(baseline_path.read_text(encoding="utf-8"))
    threshold = payload.get("threshold")
    if not isinstance(threshold, int) or threshold <= 0:
        raise ValueError("decomposition baseline threshold must be a positive integer")
    admitted_payload = payload.get("admitted")
    if not isinstance(admitted_payload, dict):
        raise ValueError("decomposition baseline admitted entries must be an object")
    admitted: dict[str, int] = {}
    for relative_path, entry in admitted_payload.items():
        if not isinstance(relative_path, str) or not relative_path:
            raise ValueError("decomposition baseline entry paths must be non-empty strings")
        if not isinstance(entry, dict):
            raise ValueError(f"decomposition baseline entry for {relative_path} must be an object")
        max_lines = entry.get("max_lines")
        if not isinstance(max_lines, int) or max_lines <= threshold:
            raise ValueError(
                f"decomposition baseline entry for {relative_path} must set max_lines > threshold"
            )
        admitted[relative_path] = max_lines
    return DecompositionBaseline(threshold=threshold, admitted=admitted)


def count_file_lines(path: Path) -> int:
    with path.open("r", encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def audit_decomposition(
    *, root: Path | None = None, baseline_path: Path | None = None
) -> tuple[DecompositionFinding, ...]:
    base = root or repo_root()
    baseline = load_decomposition_baseline(root=base, path=baseline_path)
    tracked_paths = tracked_decomposition_paths(root=base)
    tracked_set = set(tracked_paths)
    findings: list[DecompositionFinding] = []

    for relative_path, max_lines in baseline.admitted.items():
        file_path = base / relative_path
        if not file_path.exists():
            findings.append(
                DecompositionFinding(
                    path=relative_path,
                    reason="baseline_missing",
                    lines=None,
                    max_lines=max_lines,
                )
            )
            continue
        if relative_path not in tracked_set:
            findings.append(
                DecompositionFinding(
                    path=relative_path,
                    reason="baseline_untracked",
                    lines=count_file_lines(file_path),
                    max_lines=max_lines,
                )
            )
            continue
        line_count = count_file_lines(file_path)
        if line_count <= baseline.threshold:
            findings.append(
                DecompositionFinding(
                    path=relative_path,
                    reason="baseline_resolved",
                    lines=line_count,
                    max_lines=max_lines,
                )
            )
        elif line_count > max_lines:
            findings.append(
                DecompositionFinding(
                    path=relative_path,
                    reason="baseline_grew",
                    lines=line_count,
                    max_lines=max_lines,
                )
            )

    for relative_path in tracked_paths:
        if relative_path in baseline.admitted:
            continue
        file_path = base / relative_path
        line_count = count_file_lines(file_path)
        if line_count > baseline.threshold:
            findings.append(
                DecompositionFinding(
                    path=relative_path,
                    reason="new_over_threshold",
                    lines=line_count,
                    max_lines=baseline.threshold,
                )
            )

    return tuple(sorted(findings, key=lambda finding: (finding.path, finding.reason)))


def format_finding(finding: DecompositionFinding) -> str:
    if finding.reason == "new_over_threshold":
        return (
            f"{finding.path}: tracked handwritten file exceeds threshold "
            f"({finding.lines} > {finding.max_lines}) without baseline admission"
        )
    if finding.reason == "baseline_grew":
        return (
            f"{finding.path}: admitted baseline file grew beyond frozen budget "
            f"({finding.lines} > {finding.max_lines})"
        )
    if finding.reason == "baseline_resolved":
        return (
            f"{finding.path}: admitted baseline file is now within threshold "
            f"({finding.lines} <= {DEFAULT_THRESHOLD}) and must leave the baseline"
        )
    if finding.reason == "baseline_missing":
        return f"{finding.path}: admitted baseline entry points to a missing file"
    if finding.reason == "baseline_untracked":
        return (
            f"{finding.path}: admitted baseline entry is not part of the tracked handwritten "
            "code inventory anymore"
        )
    return f"{finding.path}: unknown decomposition finding {finding.reason}"


def main() -> int:
    try:
        baseline = load_decomposition_baseline()
        findings = audit_decomposition()
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        print(f"Tracked decomposition audit failed to load baseline: {exc}", file=sys.stderr)
        return 1
    if findings:
        print("Tracked decomposition audit failed:", file=sys.stderr)
        for finding in findings:
            print(f"- {format_finding(finding)}", file=sys.stderr)
        return 1
    print(
        "Validated tracked decomposition budget for "
        f"{len(tracked_decomposition_paths())} handwritten code/test files "
        f"against {_BASELINE_PATH.as_posix()} at threshold {baseline.threshold}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
