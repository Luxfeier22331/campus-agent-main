from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

_CONFIDENCE_RANK = {
    "low": 0,
    "medium": 1,
    "high": 2,
}

_ACTION_TARGET_SURFACE = {
    "retain_for_notice_query": "notice_level_query",
    "no_adoption": "unsupported",
    "needs_additional_processing": "multimodal_processing_candidate",
}


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalEvalReport:
    case_count: int
    passed_count: int
    failed_count: int
    failed_case_ids: tuple[str, ...]
    action_counts: dict[str, int]
    needs_additional_processing_count: int
    needs_additional_processing_rate: float
    accuracy: float
    min_accuracy: float
    max_needs_additional_processing_rate: float
    ok: bool


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalVisualEvalReport:
    case_count: int
    passed_count: int
    failed_count: int
    failed_case_ids: tuple[str, ...]
    failure_reasons: dict[str, tuple[str, ...]]
    action_counts: dict[str, int]
    required_text_span_count: int
    missing_required_text_span_count: int
    forbidden_claim_count: int
    forbidden_claim_hit_count: int
    pass_rate: float
    min_pass_rate: float
    ok: bool


def evaluate_internal_notice_multimodal_decisions_jsonl(
    payload: bytes | str,
    *,
    min_accuracy: float = 1.0,
    max_needs_additional_processing_rate: float = 0.0,
) -> InternalNoticeMultimodalEvalReport:
    text = payload.decode("utf-8") if isinstance(payload, bytes) else payload
    case_count = 0
    passed_count = 0
    failed_case_ids: list[str] = []
    action_counts: dict[str, int] = {}
    needs_additional_processing_count = 0
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        row = json.loads(stripped)
        if not isinstance(row, Mapping):
            raise ValueError(f"eval row {line_number} must be a JSON object")
        case_id = str(row.get("case_id") or f"line:{line_number}")
        expected_action = str(row.get("expected_action") or "").strip()
        decision = row.get("decision")
        decision_action = decision.get("action") if isinstance(decision, Mapping) else ""
        actual_action = str(row.get("actual_action") or decision_action or "").strip()
        if not expected_action:
            raise ValueError(f"eval row {case_id} missing expected_action")
        case_count += 1
        action_counts[actual_action] = action_counts.get(actual_action, 0) + 1
        if actual_action == "needs_additional_processing":
            needs_additional_processing_count += 1
        if actual_action == expected_action:
            passed_count += 1
        else:
            failed_case_ids.append(case_id)
    failed_count = case_count - passed_count
    accuracy = passed_count / case_count if case_count else 0.0
    needs_rate = needs_additional_processing_count / case_count if case_count else 0.0
    return InternalNoticeMultimodalEvalReport(
        case_count=case_count,
        passed_count=passed_count,
        failed_count=failed_count,
        failed_case_ids=tuple(failed_case_ids),
        action_counts=dict(sorted(action_counts.items())),
        needs_additional_processing_count=needs_additional_processing_count,
        needs_additional_processing_rate=needs_rate,
        accuracy=accuracy,
        min_accuracy=min_accuracy,
        max_needs_additional_processing_rate=max_needs_additional_processing_rate,
        ok=case_count > 0
        and accuracy >= min_accuracy
        and needs_rate <= max_needs_additional_processing_rate,
    )


def evaluate_internal_notice_multimodal_visual_jsonl(
    payload: bytes | str,
    *,
    min_pass_rate: float = 1.0,
) -> InternalNoticeMultimodalVisualEvalReport:
    text = payload.decode("utf-8") if isinstance(payload, bytes) else payload
    case_count = 0
    passed_count = 0
    failed_case_ids: list[str] = []
    failure_reasons: dict[str, tuple[str, ...]] = {}
    action_counts: dict[str, int] = {}
    required_text_span_count = 0
    missing_required_text_span_count = 0
    forbidden_claim_count = 0
    forbidden_claim_hit_count = 0
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        row = json.loads(stripped)
        if not isinstance(row, Mapping):
            raise ValueError(f"visual eval row {line_number} must be a JSON object")
        case_id = str(row.get("case_id") or f"line:{line_number}")
        expected_action = str(row.get("expected_action") or "").strip()
        if not expected_action:
            raise ValueError(f"visual eval row {case_id} missing expected_action")
        decision = row.get("decision")
        if not isinstance(decision, Mapping):
            raise ValueError(f"visual eval row {case_id} missing decision object")
        actual_action = str(row.get("actual_action") or decision.get("action") or "").strip()
        action_counts[actual_action] = action_counts.get(actual_action, 0) + 1
        case_count += 1
        case_failures: list[str] = []
        if actual_action != expected_action:
            case_failures.append(
                f"expected action {expected_action}, got {actual_action or '<empty>'}"
            )
        expected_target_surface = str(row.get("expected_target_surface") or "").strip()
        actual_target_surface = str(
            row.get("actual_target_surface")
            or decision.get("target_surface")
            or _ACTION_TARGET_SURFACE.get(actual_action, "")
        ).strip()
        if (
            expected_target_surface
            and actual_target_surface
            and actual_target_surface != expected_target_surface
        ):
            case_failures.append(
                f"expected target_surface {expected_target_surface}, got {actual_target_surface}"
            )
        summary = str(decision.get("summary") or "").strip()
        extracted_text = str(decision.get("extracted_text") or "").strip()
        combined_text = "\n".join(item for item in (summary, extracted_text) if item)
        reasons = tuple(
            str(item).strip() for item in (decision.get("reasons") or ()) if str(item).strip()
        )
        confidence = str(decision.get("confidence") or "low").strip() or "low"
        min_confidence = str(row.get("min_confidence") or "").strip()
        if not min_confidence and actual_action == "retain_for_notice_query":
            min_confidence = "medium"
        if min_confidence and _confidence_below(confidence, min_confidence):
            case_failures.append(f"confidence {confidence} below minimum {min_confidence}")
        if actual_action == "retain_for_notice_query" and not combined_text:
            case_failures.append("retain_for_notice_query requires summary or extracted_text")
        if actual_action == "no_adoption" and extracted_text:
            case_failures.append("no_adoption must not include extracted_text")
        required_spans = _string_sequence(row.get("required_text_spans") or ())
        forbidden_claims = _string_sequence(row.get("forbidden_claims") or ())
        required_reasons = _string_sequence(row.get("required_reasons") or ())
        required_text_span_count += len(required_spans)
        forbidden_claim_count += len(forbidden_claims)
        for span in required_spans:
            if not _contains_text(combined_text, span):
                missing_required_text_span_count += 1
                case_failures.append(f"missing required text span: {span}")
        for claim in forbidden_claims:
            if _contains_text(combined_text, claim):
                forbidden_claim_hit_count += 1
                case_failures.append(f"forbidden claim present: {claim}")
        reason_set = set(reasons)
        for reason in required_reasons:
            if reason not in reason_set:
                case_failures.append(f"missing required reason: {reason}")
        if case_failures:
            failed_case_ids.append(case_id)
            failure_reasons[case_id] = tuple(case_failures)
        else:
            passed_count += 1
    failed_count = case_count - passed_count
    pass_rate = passed_count / case_count if case_count else 0.0
    return InternalNoticeMultimodalVisualEvalReport(
        case_count=case_count,
        passed_count=passed_count,
        failed_count=failed_count,
        failed_case_ids=tuple(failed_case_ids),
        failure_reasons=failure_reasons,
        action_counts=dict(sorted(action_counts.items())),
        required_text_span_count=required_text_span_count,
        missing_required_text_span_count=missing_required_text_span_count,
        forbidden_claim_count=forbidden_claim_count,
        forbidden_claim_hit_count=forbidden_claim_hit_count,
        pass_rate=pass_rate,
        min_pass_rate=min_pass_rate,
        ok=case_count > 0 and pass_rate >= min_pass_rate,
    )


def _string_sequence(value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(str(item).strip() for item in value if str(item).strip())


def _contains_text(text: str, needle: str) -> bool:
    return _normalize_text(needle) in _normalize_text(text)


def _normalize_text(value: str) -> str:
    return "".join(value.casefold().split())


def _confidence_below(actual: str, minimum: str) -> bool:
    return _CONFIDENCE_RANK.get(actual, -1) < _CONFIDENCE_RANK.get(minimum, 0)


__all__ = [
    "InternalNoticeMultimodalEvalReport",
    "InternalNoticeMultimodalVisualEvalReport",
    "evaluate_internal_notice_multimodal_decisions_jsonl",
    "evaluate_internal_notice_multimodal_visual_jsonl",
]
