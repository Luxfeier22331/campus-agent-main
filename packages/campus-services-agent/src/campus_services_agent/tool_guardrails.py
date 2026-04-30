from __future__ import annotations


def result_guardrail_outcome(outcome: str, source_ref_count: int) -> str:
    if outcome in {"resolved_current", "resolved_historical_reference"}:
        return "source_backed" if source_ref_count > 0 else "source_gap"
    if outcome == "clarification_required":
        return "clarification"
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "not_found":
        return "not_found"
    return "unclassified"


def failure_class_for_outcome(outcome: str) -> str:
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "clarification_required":
        return "clarification"
    if outcome == "not_found":
        return "not_found"
    return ""


__all__ = ["failure_class_for_outcome", "result_guardrail_outcome"]
