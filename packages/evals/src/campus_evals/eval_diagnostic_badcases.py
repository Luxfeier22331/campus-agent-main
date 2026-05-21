from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from campus_evals.models import reject_forbidden_workflow_trace_keys

EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION = "eval_diagnostic_badcases.v1"
RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION = "ragas-diagnostic-combined-report.v1"

_ALLOWED_FAILURE_STAGES = (
    "retrieval",
    "rerank",
    "selection",
    "evidence_selection",
    "synthesis",
    "grounding",
    "diagnostic",
)
_LOCAL_ARTIFACT_KEY_TOKENS = (
    "artifactpath",
    "bucket",
    "localpath",
    "objectkey",
    "path",
    "rawanswer",
    "rawprompt",
    "transcript",
)


def build_eval_diagnostic_badcases_projection(
    combined_report: Mapping[str, object],
    *,
    generated_at: str,
    source_git_head: str,
) -> dict[str, object]:
    _assert_operator_safe_source(combined_report)
    schema_version = _required_string(combined_report.get("schema_version"), "schema_version")
    if schema_version != RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION:
        raise ValueError("schema_version must be ragas-diagnostic-combined-report.v1")
    report_id = _required_string(combined_report.get("report_id"), "report_id")
    generated_at_iso = _iso_timestamp(generated_at, "generated_at")
    normalized_source_git_head = _required_string(source_git_head, "source_git_head")
    summary = _mapping_field(combined_report.get("summary"), "summary")
    threshold = _required_score(summary.get("low_score_threshold"), "summary.low_score_threshold")

    badcases: list[dict[str, object]] = []
    for case_index, case in enumerate(_cases_for_report(combined_report)):
        case_scores = _mapping_field(case.get("scores"), f"cases[{case_index}].scores")
        for metric_name, raw_score in sorted(case_scores.items()):
            if not isinstance(raw_score, int | float):
                continue
            score = float(raw_score)
            if score >= threshold:
                continue
            failure_stage, metric_failure_reason = _failure_for_metric(
                case,
                metric_name=str(metric_name),
                field_prefix=f"cases[{case_index}]",
            )
            case_id = _required_string(case.get("case_id"), f"cases[{case_index}].case_id")
            surface_key = _required_string(
                case.get("surface_key"), f"cases[{case_index}].surface_key"
            )
            badcases.append(
                {
                    "badcaseId": f"ragas_diagnostic:{case_id}:{metric_name}",
                    "caseId": case_id,
                    "surfaceKey": surface_key,
                    "metricName": str(metric_name),
                    "score": score,
                    "threshold": threshold,
                    "failureStage": failure_stage,
                    "causeClass": _cause_class_for(
                        metric_name=str(metric_name),
                        failure_stage=failure_stage,
                    ),
                    "metricFailureReason": metric_failure_reason,
                    "queryPreview": _required_string(
                        case.get("query"), f"cases[{case_index}].query"
                    ),
                    "expectedDocIds": _string_list_field(
                        case.get("expected_doc_ids"),
                        f"cases[{case_index}].expected_doc_ids",
                    ),
                    "retrievedContextIds": _string_list_field(
                        case.get("retrieved_context_ids"),
                        f"cases[{case_index}].retrieved_context_ids",
                    ),
                    "retrievedDocIds": _string_list_field(
                        case.get("raw_retrieved_doc_ids") or [],
                        f"cases[{case_index}].raw_retrieved_doc_ids",
                    ),
                    "supportingDocIds": _string_list_field(
                        case.get("selected_support_doc_ids") or [],
                        f"cases[{case_index}].selected_support_doc_ids",
                    ),
                    "supportingChunkIds": _string_list_field(
                        case.get("selected_support_chunk_ids") or [],
                        f"cases[{case_index}].selected_support_chunk_ids",
                    ),
                    "answerShape": _optional_string(case.get("answer_shape")),
                    "presentationKind": _optional_string(case.get("presentation_kind")),
                }
            )

    return {
        "schemaVersion": EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION,
        "evalRunId": report_id,
        "snapshotId": f"eval_diagnostic_badcases:{_compact_timestamp(generated_at_iso)}",
        "generatedAt": generated_at_iso,
        "sourceGitHead": normalized_source_git_head,
        "sourceReportSchema": RAGAS_DIAGNOSTIC_COMBINED_REPORT_SCHEMA_VERSION,
        "badcases": sorted(
            badcases,
            key=lambda item: (
                str(item["surfaceKey"]),
                str(item["caseId"]),
                str(item["metricName"]),
            ),
        ),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Project RAGAS diagnostic low-score cases into operator-safe badcases."
    )
    parser.add_argument("--input", required=True, help="ragas-diagnostic.combined.json path.")
    parser.add_argument("--output", required=True, help="Projection JSON output path.")
    parser.add_argument("--generated-at", required=True, help="Projection generation timestamp.")
    parser.add_argument("--source-git-head", required=True, help="Source git head.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    input_path = Path(args.input)
    output_path = Path(args.output)
    report = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(report, dict):
        raise ValueError("input report must be a JSON object")
    projection = build_eval_diagnostic_badcases_projection(
        report,
        generated_at=args.generated_at,
        source_git_head=args.source_git_head,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(projection, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Eval diagnostic badcases projection: "
        f"badcases={len(projection['badcases'])} output={output_path}"
    )
    return 0


def _assert_operator_safe_source(value: object) -> None:
    reject_forbidden_workflow_trace_keys(value, "eval_diagnostic_badcases")
    _reject_local_artifact_keys(value, "eval_diagnostic_badcases")


def _reject_local_artifact_keys(value: object, path: str) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            normalized_key = _normalize_key_token(str(key))
            child_path = f"{path}.{key}"
            if any(token in normalized_key for token in _LOCAL_ARTIFACT_KEY_TOKENS):
                raise ValueError(
                    f"eval_diagnostic_badcases contains forbidden raw workflow trace key: {child_path}"
                )
            _reject_local_artifact_keys(nested, child_path)
    elif isinstance(value, list | tuple):
        for index, nested in enumerate(value):
            _reject_local_artifact_keys(nested, f"{path}[{index}]")


def _normalize_key_token(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def _cases_for_report(report: Mapping[str, object]) -> tuple[Mapping[str, object], ...]:
    cases = report.get("cases")
    if not isinstance(cases, list):
        raise ValueError("cases is required")
    result: list[Mapping[str, object]] = []
    for index, item in enumerate(cases):
        if not isinstance(item, Mapping):
            raise ValueError(f"cases[{index}] must be an object")
        result.append(item)
    return tuple(result)


def _failure_for_metric(
    case: Mapping[str, object],
    *,
    metric_name: str,
    field_prefix: str,
) -> tuple[str, str]:
    attribution_value = case.get("failure_attribution")
    if not isinstance(attribution_value, Mapping):
        raise ValueError(f"{field_prefix}.failure_attribution.primary_stage is required")
    attribution = attribution_value
    primary_stage = _required_string(
        attribution.get("primary_stage"),
        f"{field_prefix}.failure_attribution.primary_stage",
    )
    if primary_stage not in _ALLOWED_FAILURE_STAGES:
        raise ValueError(f"{field_prefix}.failure_attribution.primary_stage is unsupported")
    metric_failures = _mapping_field(
        attribution.get("metric_failures"),
        f"{field_prefix}.failure_attribution.metric_failures",
    )
    metric_failure_reason = _required_string(
        metric_failures.get(metric_name),
        f"{field_prefix}.failure_attribution.metric_failures.{metric_name}",
    )
    if metric_failure_reason not in _ALLOWED_FAILURE_STAGES:
        raise ValueError(
            f"{field_prefix}.failure_attribution.metric_failures.{metric_name} is unsupported"
        )
    return metric_failure_reason, metric_failure_reason


def _cause_class_for(*, metric_name: str, failure_stage: str) -> str:
    if failure_stage == "retrieval":
        return "retrieval_quality_low"
    if failure_stage in {"evidence_selection", "selection"}:
        return "evidence_selection_failed"
    if failure_stage == "rerank":
        return "retrieval_quality_low"
    if failure_stage == "grounding":
        return "synthesis_grounding_failed"
    if metric_name == "answer_relevancy":
        return "answer_relevancy_low"
    if failure_stage == "synthesis" and metric_name in {"faithfulness", "identity_grounding"}:
        return "synthesis_grounding_failed"
    if metric_name in {"context_precision", "context_recall"}:
        return "retrieval_quality_low"
    return "diagnostic_attention"


def _iso_timestamp(value: object, field_name: str) -> str:
    normalized = _required_string(value, field_name)
    parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    parsed = parsed.astimezone(UTC)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _compact_timestamp(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    return parsed.strftime("%Y-%m-%dT%H%M%SZ")


def _mapping_field(value: object, field_name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} is required")
    return value


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _string_list_field(value: object, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} is required")
    return [_required_string(item, f"{field_name}[{index}]") for index, item in enumerate(value)]


def _required_score(value: object, field_name: str) -> float:
    if not isinstance(value, int | float) or not 0 <= float(value) <= 1:
        raise ValueError(f"{field_name} must be a score between 0 and 1")
    return float(value)


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION",
    "build_eval_diagnostic_badcases_projection",
    "build_parser",
    "main",
]
