from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
)
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    AuthenticatedNoticeRoutingSample,
    build_authenticated_notice_routing_sample_report_from_inventory_entries,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingTaxonomyEvalCase:
    case_id: str
    notice_id: str
    title: str
    body: str
    notice_type_names: tuple[str, ...]
    attachment_ref_count: int
    attachment_document_count: int
    text_extractable_count: int
    ocr_required_count: int
    reference_only_count: int
    multimodal_processing_required_count: int
    expected_notice_family: str
    expected_consumption_route: str
    expected_machine_processing_policy: str
    expected_attachment_processing_policy: str
    reason: str = ""


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingTaxonomyEvalFailure:
    case_id: str
    notice_id: str
    notice_title: str
    mismatches: dict[str, dict[str, str]]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingTaxonomyEvalReport:
    case_count: int
    passed_count: int
    failed_count: int
    accuracy: float
    min_accuracy: float
    ok: bool
    failed_case_ids: tuple[str, ...]
    expected_notice_family_counts: dict[str, int]
    predicted_notice_family_counts: dict[str, int]
    expected_consumption_route_counts: dict[str, int]
    predicted_consumption_route_counts: dict[str, int]
    expected_machine_processing_policy_counts: dict[str, int]
    predicted_machine_processing_policy_counts: dict[str, int]
    expected_attachment_processing_policy_counts: dict[str, int]
    predicted_attachment_processing_policy_counts: dict[str, int]
    failures: tuple[AuthenticatedNoticeRoutingTaxonomyEvalFailure, ...]


def load_authenticated_notice_routing_taxonomy_eval_cases_jsonl(
    payload: str | bytes,
) -> tuple[AuthenticatedNoticeRoutingTaxonomyEvalCase, ...]:
    text = payload.decode("utf-8") if isinstance(payload, bytes) else str(payload)
    cases: list[AuthenticatedNoticeRoutingTaxonomyEvalCase] = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        cases.append(_eval_case_from_payload(json.loads(line), line_number=line_number))
    return tuple(cases)


def evaluate_authenticated_notice_routing_taxonomy_jsonl(
    payload: str | bytes,
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    min_accuracy: float = 1.0,
) -> AuthenticatedNoticeRoutingTaxonomyEvalReport:
    cases = load_authenticated_notice_routing_taxonomy_eval_cases_jsonl(payload)
    return evaluate_authenticated_notice_routing_taxonomy_cases(
        cases,
        config=config,
        min_accuracy=min_accuracy,
    )


def evaluate_authenticated_notice_routing_taxonomy_cases(
    cases: Sequence[AuthenticatedNoticeRoutingTaxonomyEvalCase],
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    min_accuracy: float = 1.0,
) -> AuthenticatedNoticeRoutingTaxonomyEvalReport:
    failures: list[AuthenticatedNoticeRoutingTaxonomyEvalFailure] = []
    expected_family_counter: Counter[str] = Counter()
    predicted_family_counter: Counter[str] = Counter()
    expected_route_counter: Counter[str] = Counter()
    predicted_route_counter: Counter[str] = Counter()
    expected_machine_counter: Counter[str] = Counter()
    predicted_machine_counter: Counter[str] = Counter()
    expected_attachment_processing_counter: Counter[str] = Counter()
    predicted_attachment_processing_counter: Counter[str] = Counter()

    for case in cases:
        sample = _sample_eval_case(case, config=config)
        expected_family_counter[case.expected_notice_family] += 1
        predicted_family_counter[sample.notice_family] += 1
        expected_route_counter[case.expected_consumption_route] += 1
        predicted_route_counter[sample.suggested_consumption_route] += 1
        expected_machine_counter[case.expected_machine_processing_policy] += 1
        predicted_machine_counter[sample.machine_processing_policy] += 1
        expected_attachment_processing_counter[case.expected_attachment_processing_policy] += 1
        predicted_attachment_processing_counter[sample.attachment_processing_policy] += 1
        mismatches = _compare_case(case, sample)
        if mismatches:
            failures.append(
                AuthenticatedNoticeRoutingTaxonomyEvalFailure(
                    case_id=case.case_id,
                    notice_id=case.notice_id,
                    notice_title=case.title,
                    mismatches=mismatches,
                )
            )

    case_count = len(cases)
    failed_count = len(failures)
    passed_count = case_count - failed_count
    accuracy = passed_count / case_count if case_count else 0.0
    ok = case_count > 0 and accuracy >= min_accuracy and failed_count == 0
    return AuthenticatedNoticeRoutingTaxonomyEvalReport(
        case_count=case_count,
        passed_count=passed_count,
        failed_count=failed_count,
        accuracy=accuracy,
        min_accuracy=float(min_accuracy),
        ok=ok,
        failed_case_ids=tuple(failure.case_id for failure in failures),
        expected_notice_family_counts=dict(sorted(expected_family_counter.items())),
        predicted_notice_family_counts=dict(sorted(predicted_family_counter.items())),
        expected_consumption_route_counts=dict(sorted(expected_route_counter.items())),
        predicted_consumption_route_counts=dict(sorted(predicted_route_counter.items())),
        expected_machine_processing_policy_counts=dict(sorted(expected_machine_counter.items())),
        predicted_machine_processing_policy_counts=dict(sorted(predicted_machine_counter.items())),
        expected_attachment_processing_policy_counts=dict(
            sorted(expected_attachment_processing_counter.items())
        ),
        predicted_attachment_processing_policy_counts=dict(
            sorted(predicted_attachment_processing_counter.items())
        ),
        failures=tuple(failures),
    )


def _sample_eval_case(
    case: AuthenticatedNoticeRoutingTaxonomyEvalCase,
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeRoutingSample:
    report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
        inventory_entries=(_inventory_entry_from_case(case, config=config),),
        config=config,
        sample_limit_per_group=1,
        boundary_sample_limit=1,
    )
    return report.samples[0]


def _compare_case(
    case: AuthenticatedNoticeRoutingTaxonomyEvalCase,
    sample: AuthenticatedNoticeRoutingSample,
) -> dict[str, dict[str, str]]:
    checks = {
        "notice_family": (case.expected_notice_family, sample.notice_family),
        "suggested_consumption_route": (
            case.expected_consumption_route,
            sample.suggested_consumption_route,
        ),
        "machine_processing_policy": (
            case.expected_machine_processing_policy,
            sample.machine_processing_policy,
        ),
        "attachment_processing_policy": (
            case.expected_attachment_processing_policy,
            sample.attachment_processing_policy,
        ),
    }
    return {
        field: {"expected": expected, "actual": actual}
        for field, (expected, actual) in checks.items()
        if expected != actual
    }


def _eval_case_from_payload(
    payload: Mapping[str, Any],
    *,
    line_number: int,
) -> AuthenticatedNoticeRoutingTaxonomyEvalCase:
    raw = dict(payload)
    case_id = _required_text(raw, "case_id", line_number=line_number)
    notice_id = _required_text(raw, "notice_id", line_number=line_number)
    title = _required_text(raw, "title", line_number=line_number)
    notice_type_names = _notice_type_names(raw)
    return AuthenticatedNoticeRoutingTaxonomyEvalCase(
        case_id=case_id,
        notice_id=notice_id,
        title=title,
        body=str(raw.get("body") or raw.get("notice_content") or ""),
        notice_type_names=notice_type_names,
        attachment_ref_count=_int_field(raw, "attachment_ref_count"),
        attachment_document_count=_int_field(raw, "attachment_document_count"),
        text_extractable_count=_int_field(raw, "text_extractable_count"),
        ocr_required_count=_int_field(raw, "ocr_required_count"),
        reference_only_count=_int_field(raw, "reference_only_count"),
        multimodal_processing_required_count=_int_field(
            raw,
            "multimodal_processing_required_count",
        ),
        expected_notice_family=_required_text(
            raw,
            "expected_notice_family",
            line_number=line_number,
        ),
        expected_consumption_route=_required_text(
            raw,
            "expected_consumption_route",
            line_number=line_number,
        ),
        expected_machine_processing_policy=_required_text(
            raw,
            "expected_machine_processing_policy",
            line_number=line_number,
        ),
        expected_attachment_processing_policy=_expected_attachment_processing_policy(
            raw,
            line_number=line_number,
        ),
        reason=str(raw.get("reason") or ""),
    )


def _expected_attachment_processing_policy(
    raw: Mapping[str, Any],
    *,
    line_number: int,
) -> str:
    explicit = str(raw.get("expected_attachment_processing_policy") or "").strip()
    if explicit:
        return explicit
    route = _required_text(raw, "expected_consumption_route", line_number=line_number)
    if route in {"defer", "no_adoption"}:
        return "metadata_only"
    attachment_ref_count = _int_field(raw, "attachment_ref_count")
    if attachment_ref_count <= 0:
        return "not_required"
    return "process"


def _inventory_entry_from_case(
    case: AuthenticatedNoticeRoutingTaxonomyEvalCase,
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    attachment_projection_plans = [
        {"attachment_id": f"{case.notice_id}:attachment:{index + 1}"}
        for index in range(case.attachment_ref_count)
    ]
    return AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(
        {
            "corpus": config.corpus,
            "collection": config.collection,
            "notice_id": case.notice_id,
            "site_id": "eval-fixture",
            "document_id": f"notice:{config.collection}:{case.notice_id}",
            "revision_track": "eval",
            "version_id": "eval",
            "raw_asset_id": f"eval:{case.notice_id}",
            "raw_version_id": "eval",
            "source_home_url": "",
            "embedding_model": "",
            "notice_manifest_key": "",
            "content_blocks_key": "",
            "attachment_refs_key": "",
            "attachment_ref_count": case.attachment_ref_count,
            "attachment_document_count": case.attachment_document_count,
            "text_extractable_count": case.text_extractable_count,
            "ocr_required_count": case.ocr_required_count,
            "reference_only_count": case.reference_only_count,
            "multimodal_processing_required_count": case.multimodal_processing_required_count,
            "notice_risk_label": "eval_fixture",
            "attachment_mix_score": 0,
            "has_text_table_attachment": case.text_extractable_count > 0,
            "has_spatial_attachment": case.ocr_required_count > 0
            or case.multimodal_processing_required_count > 0,
            "has_reference_only_attachment": case.reference_only_count > 0,
            "planning_weight": 1,
            "parent_snapshot": {
                "notice_title": case.title,
                "notice_content": case.body,
                "notice_type_names": case.notice_type_names,
                "attachment_projection_plans": attachment_projection_plans,
            },
        }
    )


def _notice_type_names(payload: Mapping[str, Any]) -> tuple[str, ...]:
    raw_names = payload.get("notice_type_names")
    if raw_names is None:
        raw_name = str(payload.get("notice_type_name") or "").strip()
        return (raw_name,) if raw_name else ()
    return tuple(str(item).strip() for item in list(raw_names or ()) if str(item).strip())


def _required_text(
    payload: Mapping[str, Any],
    field: str,
    *,
    line_number: int,
) -> str:
    value = str(payload.get(field) or "").strip()
    if not value:
        raise ValueError(f"routing taxonomy eval line {line_number} requires {field}")
    return value


def _int_field(payload: Mapping[str, Any], field: str) -> int:
    return int(payload.get(field) or 0)


__all__ = [
    "AuthenticatedNoticeRoutingTaxonomyEvalCase",
    "AuthenticatedNoticeRoutingTaxonomyEvalFailure",
    "AuthenticatedNoticeRoutingTaxonomyEvalReport",
    "evaluate_authenticated_notice_routing_taxonomy_cases",
    "evaluate_authenticated_notice_routing_taxonomy_jsonl",
    "load_authenticated_notice_routing_taxonomy_eval_cases_jsonl",
]
