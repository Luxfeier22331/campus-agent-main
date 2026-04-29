from __future__ import annotations

import os
from pathlib import Path

from campus_ingestion_worker.official_web_handoff_consumer_io import (
    coerce_non_negative_int,
    count_by_value,
    load_manifest_hosts,
    normalize_string_list,
    optional_text,
    require_object_list,
    require_text,
)
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    _PROMOTION_DISALLOWED_PAGE_FAMILIES,
    HttpOfficialWebExecutionStatusReporter,
    OfficialWebExecutionStatusReporter,
    OfficialWebHandoffConsumerSettings,
)


def build_stage_quality_report(
    *,
    settings: OfficialWebHandoffConsumerSettings,
    payload: dict[str, object],
    replay_input_dir: Path,
    replay_report: dict[str, object],
    chunk_audit_report: dict[str, object],
) -> dict[str, object]:
    seed_set = normalize_string_list(payload.get("seedSet"))
    expected_host_set = normalize_string_list(payload.get("hostSet"))
    actual_host_set = sorted(load_manifest_hosts(replay_input_dir))
    replay_counts = (
        replay_report.get("counts") if isinstance(replay_report.get("counts"), dict) else {}
    )
    pages_seen = coerce_non_negative_int(replay_counts.get("pages_seen"))
    emitted_documents = coerce_non_negative_int(replay_counts.get("emitted_documents"))
    manual_review_pages = coerce_non_negative_int(replay_counts.get("manual_review_pages"))
    chunk_audit_passed = bool(chunk_audit_report.get("passed"))
    replay_documents = require_object_list(replay_report.get("documents"), "documents")
    document_page_family_counts = count_by_value(
        require_text(document.get("page_family"), "page_family") for document in replay_documents
    )
    document_serving_intent_counts = count_by_value(
        require_text(document.get("serving_intent") or "unknown", "serving_intent")
        for document in replay_documents
    )
    manual_review_page_family_counts = count_by_value(
        require_text(page.get("page_family"), "page_family")
        for page in require_object_list(
            replay_report.get("manual_review_pages"), "manual_review_pages"
        )
    )
    seed_coverage_ratio = round(pages_seen / len(seed_set), 4) if seed_set else 1.0
    host_coverage_ratio = (
        round(len(actual_host_set) / len(expected_host_set), 4) if expected_host_set else 1.0
    )
    blocked_checks: list[dict[str, object]] = []
    checks: list[dict[str, object]] = []

    def record_check(
        *,
        code: str,
        passed: bool,
        message: str,
        actual: object,
        expected: object,
    ) -> None:
        check = {
            "code": code,
            "passed": passed,
            "message": message,
            "actual": actual,
            "expected": expected,
        }
        checks.append(check)
        if not passed:
            blocked_checks.append(check)

    record_check(
        code="minimum_promote_pages",
        passed=pages_seen >= settings.minimum_promote_pages,
        message="source-truth bundle must contain enough pages before promotion",
        actual=pages_seen,
        expected={"min": settings.minimum_promote_pages},
    )
    record_check(
        code="seed_coverage_ratio",
        passed=seed_coverage_ratio >= settings.minimum_seed_coverage_ratio,
        message="seed coverage ratio is below the promotion threshold",
        actual=seed_coverage_ratio,
        expected={"min": settings.minimum_seed_coverage_ratio},
    )
    record_check(
        code="host_coverage_ratio",
        passed=host_coverage_ratio >= settings.minimum_host_coverage_ratio,
        message="host coverage ratio is below the promotion threshold",
        actual=host_coverage_ratio,
        expected={"min": settings.minimum_host_coverage_ratio},
    )
    record_check(
        code="emitted_documents_present",
        passed=emitted_documents > 0,
        message="projection replay emitted no promotable documents",
        actual=emitted_documents,
        expected={"min": 1},
    )
    promotable_document_count = sum(
        1
        for document in replay_documents
        if require_text(document.get("serving_intent") or "unknown", "serving_intent")
        == "promotable"
    )
    record_check(
        code="promotable_documents_present",
        passed=promotable_document_count > 0,
        message="projection replay emitted no promotable documents after staged-only filtering",
        actual=promotable_document_count,
        expected={"min": 1},
    )
    record_check(
        code="chunk_audit_passed",
        passed=chunk_audit_passed,
        message="chunk audit reported quality issues",
        actual=chunk_audit_report.get("issue_counts") or {},
        expected={"passed": True},
    )
    disallowed_document_page_families = count_by_value(
        require_text(document.get("page_family"), "page_family")
        for document in replay_documents
        if require_text(document.get("serving_intent") or "unknown", "serving_intent")
        == "promotable"
        and require_text(document.get("page_family"), "page_family")
        in _PROMOTION_DISALLOWED_PAGE_FAMILIES
    )
    unknown_document_serving_intents = {
        serving_intent: count
        for serving_intent, count in document_serving_intent_counts.items()
        if serving_intent not in {"promotable", "audit_only"} and count > 0
    }
    record_check(
        code="promotable_page_families",
        passed=not disallowed_document_page_families,
        message="projection replay emitted promotable documents with page families that must stay staged-only",
        actual=disallowed_document_page_families,
        expected={"disallowed": sorted(_PROMOTION_DISALLOWED_PAGE_FAMILIES)},
    )
    record_check(
        code="recognized_serving_intent",
        passed=not unknown_document_serving_intents,
        message="projection replay emitted documents with unknown serving_intent values",
        actual=document_serving_intent_counts,
        expected={"allowed": ["promotable", "audit_only"]},
    )

    return {
        "passed": len(blocked_checks) == 0,
        "counts": {
            "expected_host_count": len(expected_host_set),
            "actual_host_count": len(actual_host_set),
            "seed_count": len(seed_set),
            "pages_seen": pages_seen,
            "emitted_documents": emitted_documents,
            "manual_review_pages": manual_review_pages,
        },
        "ratios": {
            "seed_coverage_ratio": seed_coverage_ratio,
            "host_coverage_ratio": host_coverage_ratio,
        },
        "actualHosts": actual_host_set,
        "documentPageFamilyCounts": document_page_family_counts,
        "documentServingIntentCounts": document_serving_intent_counts,
        "manualReviewPageFamilyCounts": manual_review_page_family_counts,
        "checks": checks,
        "blockedChecks": blocked_checks,
    }


def build_promotion_report(
    *,
    promote_import: bool,
    coverage_report: dict[str, object],
) -> dict[str, object]:
    blocked_checks = coverage_report.get("blockedChecks")
    if not isinstance(blocked_checks, list):
        blocked_checks = []
    if not promote_import:
        return {
            "mode": "stage",
            "eligible": bool(coverage_report.get("passed")),
            "decision": "staged",
            "blockedChecks": blocked_checks,
        }
    if blocked_checks:
        return {
            "mode": "promote",
            "eligible": False,
            "decision": "blocked",
            "blockedChecks": blocked_checks,
        }
    return {
        "mode": "promote",
        "eligible": True,
        "decision": "promoted",
        "blockedChecks": [],
    }


def build_status_reporter_from_env() -> OfficialWebExecutionStatusReporter | None:
    base_url = os.getenv("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = os.getenv("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not base_url or not shared_secret:
        return None
    return HttpOfficialWebExecutionStatusReporter(
        base_url=base_url,
        internal_shared_secret=shared_secret,
    )


def report_execution_status(
    *,
    reporter: OfficialWebExecutionStatusReporter | None,
    run_id: str,
    payload: dict[str, object],
    suppress_errors: bool = False,
) -> None:
    if reporter is None:
        return
    try:
        reporter.report(run_id=run_id, payload=payload)
    except Exception:
        if not suppress_errors:
            raise


def build_promotion_blocked_message(blocked_checks: object) -> str:
    if not isinstance(blocked_checks, list) or not blocked_checks:
        return "promotion blocked by quality gates"
    labels = [optional_text(item.get("code")) for item in blocked_checks if isinstance(item, dict)]
    normalized = [label for label in labels if label is not None]
    if not normalized:
        return "promotion blocked by quality gates"
    return "promotion blocked by quality gates: " + ", ".join(normalized)
