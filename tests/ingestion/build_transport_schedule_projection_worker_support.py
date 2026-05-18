from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _write_consumer_manifest(path: Path) -> None:
    manifest = InternalNoticeConsumerAdmissionManifest(
        admission_run_id="transport-schedule-355122-test",
        source_channel="authenticated_notice_portal",
        corpus="campus_notices",
        collection="internal_notice",
        selection_source="explicit_notice_ids",
        selection_path="",
        selection_sha256=compute_consumer_admission_selection_sha256(("355122",)),
        scope_write_mode=CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
        selected_notice_ids=("355122",),
        decision_records=(
            ConsumerAdmissionDecisionRecord(
                notice_id="355122",
                source_notice_id="355122",
                site_id="muc_internal_portal",
                raw_asset_id="raw:notice:355122",
                raw_version_id="sha256:test",
                notice_family="transport_service_status",
                suggested_consumption_route="campus_services",
                target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                admission_reason_codes=("transport_schedule_candidate",),
                body_quality=CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
                attachment_ref_count=1,
                reference_only_attachment_ref_count=0,
                owner_expectation_count=0,
                pending_multimodal_attachment_count=0,
                attachment_document_count=1,
                unsupported_binary_count=0,
            ),
        ),
        created_at="2026-04-28T08:30:00Z",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)


def _write_transport_preview_gate(
    path: Path,
    *,
    selected_notice_ids: tuple[str, ...],
) -> None:
    _write_json(
        path,
        {
            "schema_version": "schedule_transport_preview_gate.v1",
            "validation_valid": True,
            "buckets": {
                "preview_passed": list(selected_notice_ids),
                "preview_failed": [],
            },
            "release_write_buckets": {
                "current_serving_write": list(selected_notice_ids),
                "historical_snapshot_only_write": [],
                "operational_exception_write": [],
                "preview_failed_skip": [],
            },
            "items": [
                {
                    "notice_id": notice_id,
                    "bucket": "preview_passed",
                    "release_write_bucket": "current_serving_write",
                    "reason_codes": [],
                    "warning_codes": [],
                }
                for notice_id in selected_notice_ids
            ],
        },
    )


def _notice_projection_runtime(
    object_store: object,
) -> tuple[InMemoryDocumentRegistry, NoticeConsumptionProjectionEntry]:
    parent = _record(
        notice_id="355122",
        title_slug="student-commute",
        content_hash="sha256:student-commute",
        body_key="campus_notices/documents/internal_notice/355122/canonical.md",
        units_key="campus_notices/documents/internal_notice/355122/document-units.jsonl",
        is_current=True,
    )
    attachment = _attachment_record(
        notice_id="355122",
        attachment_ref_id="attachment-0001",
        units_key=(
            "campus_notices/documents/internal_notice/355122/attachment-0001/document-units.jsonl"
        ),
    )
    object_store.objects[
        (
            "campus-rag-derived",
            parent.canonical_markdown_object_key,
        )
    ] = _canonical_markdown(
        "# 关于两校区学生通勤班车增加班次的通知\n\n"
        "新增班次自2026年3月20日起执行，具体见附件班次表。\n"
    )
    object_store.objects[
        (
            "campus-rag-derived",
            parent.document_units_object_key,
        )
    ] = _document_units([])
    object_store.objects[
        (
            "campus-rag-derived",
            attachment.document_units_object_key,
        )
    ] = _document_units(
        [
            {
                "unit_id": "table-1",
                "unit_type": "table_unit",
                "table_cells": [
                    ["适用日期", "运行方向", "发车时间", "乘车人员"],
                    ["工作日", "海淀校区至丰台校区", "19:30", "学生"],
                    ["", "丰台校区至海淀校区", "7:30", "学生"],
                ],
            }
        ]
    )
    projection_entry = NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="355122",
        unit_id="notice_unit:notice:muc_internal_portal:355122:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id="notice:muc_internal_portal:355122",
        source_document_id="notice:muc_internal_portal:355122",
        source_attachment_ref_ids=("attachment-0001",),
        source_notice_release_time="2026-03-18 10:00",
        role_metadata={
            "service_status_candidate_kind": "transport_schedule",
            "attachment_document_ids": (
                "notice_attachment:muc_internal_portal:355122:attachment-0001",
            ),
        },
    )
    return InMemoryDocumentRegistry((parent, attachment)), projection_entry


def _attachment_record(
    *,
    notice_id: str,
    attachment_ref_id: str,
    units_key: str,
) -> DocumentRegistryRecord:
    parent = _record(
        notice_id=notice_id,
        title_slug=f"{notice_id}-{attachment_ref_id}",
        content_hash=f"sha256:{notice_id}:{attachment_ref_id}",
        body_key=units_key.replace("document-units.jsonl", "canonical.md"),
        units_key=units_key,
        is_current=True,
    )
    attachment_document_id = (
        f"notice_attachment:muc_internal_portal:{notice_id}:{attachment_ref_id}"
    )
    return replace(
        parent,
        document_id=attachment_document_id,
        version_id=f"sha256:{notice_id}:{attachment_ref_id}:source-faithful",
        source_uri=f"https://portal.example.edu/notices/{notice_id}/attachments/{attachment_ref_id}",
    )
