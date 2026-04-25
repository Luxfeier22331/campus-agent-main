from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

DEFAULT_INTENT_DRIFT_THRESHOLDS_PATH = (
    Path(__file__).resolve().parents[4] / "configs/runtime/intent-drift-thresholds.v1.json"
)


def load_intent_drift_thresholds(path: str | Path | None = None) -> dict[str, Any]:
    thresholds_path = Path(path) if path is not None else DEFAULT_INTENT_DRIFT_THRESHOLDS_PATH
    payload = json.loads(thresholds_path.read_text(encoding="utf-8"))
    _validate_thresholds(payload)
    return payload


def build_intent_drift_report(
    rows: Iterable[Mapping[str, object]],
    *,
    thresholds: Mapping[str, object] | None = None,
) -> dict[str, object]:
    resolved_thresholds = dict(thresholds or load_intent_drift_thresholds())
    _validate_thresholds(resolved_thresholds)
    records = tuple(dict(row) for row in rows)
    total = len(records)
    metrics = _drift_metrics(records)
    breaches: list[dict[str, object]] = []
    candidates: list[dict[str, object]] = []

    disallowed_classifier_rows = tuple(
        row
        for row in records
        if _optional_string(row.get("classifier_version"))
        not in set(_string_tuple(resolved_thresholds["allowed_classifier_versions"]))
    )
    if disallowed_classifier_rows:
        breaches.append(
            {
                "name": "disallowed_classifier_version",
                "count": len(disallowed_classifier_rows),
                "allowed": list(_string_tuple(resolved_thresholds["allowed_classifier_versions"])),
            }
        )
        candidates.extend(
            _candidate(row, "disallowed_classifier_version") for row in disallowed_classifier_rows
        )

    disallowed_schema_rows = tuple(
        row
        for row in records
        if _intent_schema_version(row)
        not in set(_string_tuple(resolved_thresholds["allowed_intent_schema_versions"]))
    )
    if disallowed_schema_rows:
        breaches.append(
            {
                "name": "disallowed_intent_schema_version",
                "count": len(disallowed_schema_rows),
                "allowed": list(
                    _string_tuple(resolved_thresholds["allowed_intent_schema_versions"])
                ),
            }
        )
        candidates.extend(
            _candidate(row, "disallowed_intent_schema_version") for row in disallowed_schema_rows
        )

    threshold_checks = (
        ("context_unresolved_rate", "max_context_unresolved_rate", _context_unresolved),
        ("low_confidence_rate", "max_low_confidence_rate", _low_confidence),
        ("ambiguity_rate", "max_ambiguity_rate", _ambiguous),
        (
            "structured_subtype_missing_rate",
            "max_structured_subtype_missing_rate",
            _structured_subtype_missing,
        ),
    )
    for metric_name, threshold_name, selector in threshold_checks:
        actual = float(metrics[metric_name])
        threshold = float(resolved_thresholds[threshold_name])
        if actual <= threshold:
            continue
        matching_rows = tuple(row for row in records if selector(row))
        breaches.append(
            {
                "name": metric_name,
                "actual": actual,
                "threshold": threshold,
                "count": len(matching_rows),
            }
        )
        candidates.extend(_candidate(row, metric_name) for row in matching_rows)

    deduped_candidates = _dedupe_candidates(candidates)
    return {
        "schema_version": 1,
        "thresholds_schema_version": resolved_thresholds["schema_version"],
        "total": total,
        "passed": not breaches,
        "metrics": metrics,
        "breaches": breaches,
        "candidates": deduped_candidates,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build intent drift report from sanitized rows.")
    parser.add_argument("--input", required=True, help="Sanitized observed intent JSONL path.")
    parser.add_argument("--output", required=True, help="Intent drift report JSON path.")
    parser.add_argument(
        "--candidates-output",
        help="Optional JSONL path for drift candidate rows.",
    )
    parser.add_argument(
        "--thresholds",
        default=str(DEFAULT_INTENT_DRIFT_THRESHOLDS_PATH),
        help="Intent drift thresholds JSON path.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = build_intent_drift_report(
        _load_jsonl(Path(args.input)),
        thresholds=load_intent_drift_thresholds(args.thresholds),
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if args.candidates_output:
        candidates_path = Path(args.candidates_output)
        candidates_path.parent.mkdir(parents=True, exist_ok=True)
        candidates_path.write_text(
            "".join(
                json.dumps(candidate, ensure_ascii=False) + "\n"
                for candidate in report["candidates"]
            ),
            encoding="utf-8",
        )
    print(
        "Intent drift: "
        f"{'PASS' if report['passed'] else 'FAIL'} "
        f"total={report['total']} breaches={len(report['breaches'])} "
        f"candidates={len(report['candidates'])} output={output_path}"
    )
    return 0 if report["passed"] else 1


def _drift_metrics(records: tuple[dict[str, object], ...]) -> dict[str, float]:
    total = len(records)
    return {
        "context_unresolved_rate": _rate(records, _context_unresolved, total),
        "low_confidence_rate": _rate(records, _low_confidence, total),
        "ambiguity_rate": _rate(records, _ambiguous, total),
        "structured_subtype_missing_rate": _rate(records, _structured_subtype_missing, total),
    }


def _rate(
    records: tuple[dict[str, object], ...],
    selector: object,
    total: int,
) -> float:
    if total == 0:
        return 0.0
    return sum(1 for row in records if selector(row)) / total  # type: ignore[operator]


def _context_unresolved(row: Mapping[str, object]) -> bool:
    return _optional_string(row.get("context_resolution_state")) in {
        "missing_context",
        "ambiguous",
    }


def _low_confidence(row: Mapping[str, object]) -> bool:
    return _optional_string(row.get("routing_confidence")) == "low"


def _ambiguous(row: Mapping[str, object]) -> bool:
    return (
        bool(_optional_string(row.get("ambiguity_signal")))
        or _optional_string(row.get("context_resolution_state")) == "ambiguous"
    )


def _structured_subtype_missing(row: Mapping[str, object]) -> bool:
    return _optional_string(row.get("scope_reason")) == "structured_subtype_missing"


def _intent_schema_version(row: Mapping[str, object]) -> str:
    return _optional_string(row.get("intent_schema_version")) or _optional_string(
        row.get("schema_version")
    )


def _candidate(row: Mapping[str, object], failure_class: str) -> dict[str, object]:
    case_id = _optional_string(row.get("case_id")) or _optional_string(row.get("request_id"))
    return {
        "case_id": case_id or "unknown-observed-intent",
        "observed_failure_class": failure_class,
        "source_request_id": _optional_string(row.get("source_request_id"))
        or _optional_string(row.get("request_id")),
        "trace_id": _optional_string(row.get("trace_id")),
        "sampled_at": _optional_string(row.get("sampled_at")),
        "source_surface": _optional_string(row.get("source_surface"))
        or _optional_string(row.get("surface")),
        "observed": dict(row),
    }


def _dedupe_candidates(candidates: Iterable[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[tuple[str, str], dict[str, object]] = {}
    for candidate in candidates:
        key = (
            _optional_string(candidate.get("case_id")),
            _optional_string(candidate.get("observed_failure_class")),
        )
        deduped.setdefault(key, candidate)
    return list(deduped.values())


def _load_jsonl(path: Path) -> tuple[Mapping[str, Any], ...]:
    rows: list[Mapping[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"intent drift JSONL line {line_number} must be an object")
        rows.append(payload)
    return tuple(rows)


def _validate_thresholds(payload: Mapping[str, object]) -> None:
    if payload.get("schema_version") != "intent-drift-thresholds-v1":
        raise ValueError(
            "intent drift thresholds schema_version must be intent-drift-thresholds-v1"
        )
    for field in ("allowed_classifier_versions", "allowed_intent_schema_versions"):
        if not _string_tuple(payload.get(field)):
            raise ValueError(f"intent drift thresholds {field} must be non-empty")
    for field in (
        "max_context_unresolved_rate",
        "max_low_confidence_rate",
        "max_ambiguity_rate",
        "max_structured_subtype_missing_rate",
    ):
        value = float(payload[field])
        if value < 0 or value > 1:
            raise ValueError(f"intent drift thresholds {field} must be between 0 and 1")


def _optional_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _string_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise ValueError("string list field must be a list")
    return tuple(str(item).strip() for item in value if str(item).strip())


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "DEFAULT_INTENT_DRIFT_THRESHOLDS_PATH",
    "build_intent_drift_report",
    "build_parser",
    "load_intent_drift_thresholds",
    "main",
]
