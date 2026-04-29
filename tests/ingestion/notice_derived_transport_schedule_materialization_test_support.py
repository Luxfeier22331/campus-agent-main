from __future__ import annotations

import importlib
from dataclasses import replace

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

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _FakeObjectStore,
    _record,
)


def _load_module():
    try:
        return importlib.import_module(
            "campus_ingestion_core.notice_derived_transport_schedule_materialization"
        )
    except ModuleNotFoundError:
        return None


def _build_runtime(
    *,
    notice_id: str = "355122",
    table_cells: list[list[str]] | None = None,
    document_units: list[dict[str, object]] | None = None,
    parent_is_current: bool = True,
    attachment_is_current: bool = True,
    parent_markdown: str | None = None,
    release_time: str = "2026-03-18 10:00",
    attachment_document_ids: tuple[str, ...] = (
        "notice_attachment:muc_internal_portal:355122:attachment-0001",
    ),
):
    parent = _record(
        notice_id=notice_id,
        title_slug=f"{notice_id}-transport",
        content_hash=f"sha256:{notice_id}:transport",
        body_key=f"campus_notices/documents/internal_notice/{notice_id}/canonical.md",
        units_key=f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl",
        is_current=parent_is_current,
    )
    attachment = _attachment_record(
        notice_id=notice_id,
        attachment_ref_id="attachment-0001",
        units_key=(
            f"campus_notices/documents/internal_notice/{notice_id}/attachment-0001/"
            "document-units.jsonl"
        ),
        is_current=attachment_is_current,
    )
    registry = InMemoryDocumentRegistry((parent, attachment))
    object_store = _FakeObjectStore(
        objects={
            (
                "campus-rag-derived",
                parent.canonical_markdown_object_key,
            ): _canonical_markdown(
                parent_markdown
                or (
                    "# 关于两校区学生通勤班车增加班次的通知\n\n"
                    "新增班次自2026年3月20日起执行，具体见附件班次表。\n"
                )
            ),
            ("campus-rag-derived", parent.document_units_object_key): _document_units([]),
            (
                "campus-rag-derived",
                attachment.document_units_object_key,
            ): _document_units(
                document_units
                or [
                    {
                        "unit_id": "table-1",
                        "unit_type": "table_unit",
                        "clean_text": "表1 师生通勤班车班次表",
                        "table_cells": table_cells
                        or [
                            ["适用日期", "运行方向", "发车地点", "发车时间", "乘车人员", "备注"],
                            [
                                "工作日",
                                "海淀校区至丰台校区",
                                "海淀东门",
                                "19:30",
                                "学生",
                                "3月20日起执行",
                            ],
                            [
                                "",
                                "丰台校区至海淀校区",
                                "丰台南门",
                                "7:30",
                                "学生",
                                "",
                            ],
                        ],
                    }
                ]
            ),
        }
    )
    entry = NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:notice:muc_internal_portal:{notice_id}:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_attachment_ref_ids=tuple(
            document_id.split(":")[-1] for document_id in attachment_document_ids
        ),
        source_notice_release_time=release_time,
        role_metadata={
            "notice_title": "关于两校区学生通勤班车增加班次的通知",
            "notice_family": "transport_commute_status",
            "service_status_candidate_kind": "transport_schedule",
            "attachment_document_ids": attachment_document_ids,
        },
    )
    return registry, object_store, entry


def _attachment_record(
    *,
    notice_id: str,
    attachment_ref_id: str,
    units_key: str,
    is_current: bool = True,
) -> DocumentRegistryRecord:
    parent = _record(
        notice_id=notice_id,
        title_slug=f"{notice_id}-{attachment_ref_id}",
        content_hash=f"sha256:{notice_id}:{attachment_ref_id}",
        body_key=units_key.replace("document-units.jsonl", "canonical.md"),
        units_key=units_key,
        is_current=is_current,
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
