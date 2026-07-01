from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    build_internal_notice_consumption_projection_entries,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionDocumentReport,
    InternalNoticeRegulationPromotionManifestReport,
)
from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _FakeObjectStore,
    _inventory_entry,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry


def _env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-agent-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-agent-derived",
        "EMBEDDING_PROVIDER": "mock",
        "EMBEDDING_MODEL": "mock-embedding-8d",
        "SPARSE_PROVIDER": "mock",
    }


def _build_runtime(*, extra_notice_rows=()):
    institutional = _record(
        notice_id="187233",
        title_slug="procurement-rule",
        content_hash="sha256:institutional-187233",
        body_key="campus_notices/documents/internal_notice/187233/canonical.md",
        units_key="campus_notices/documents/internal_notice/187233/document-units.jsonl",
        is_current=True,
    )
    annual_ready = _record(
        notice_id="351907",
        title_slug="recommendation-rule",
        content_hash="sha256:annual-351907",
        body_key="campus_notices/documents/internal_notice/351907/canonical.md",
        units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
        is_current=True,
    )
    annual_pending = _record(
        notice_id="351908",
        title_slug="recommendation-rule-missing-owner",
        content_hash="sha256:annual-351908",
        body_key="campus_notices/documents/internal_notice/351908/canonical.md",
        units_key="campus_notices/documents/internal_notice/351908/document-units.jsonl",
        is_current=True,
    )
    registry = InMemoryDocumentRegistry(
        (institutional, annual_ready, annual_pending, *extra_notice_rows)
    )
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(
        (
            _inventory_entry(
                notice_id="187233",
                notice_title="关于修订《示例大学采购工作管理办法》的通知",
                published_date="2021-02-28 16:09",
            ),
            _inventory_entry(
                notice_id="351907",
                notice_title="示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则",
                published_date="2026-04-01 10:00",
            ),
            _inventory_entry(
                notice_id="351908",
                notice_title="示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则",
                published_date="2026-04-02 10:00",
            ),
        )
    )
    object_store = _FakeObjectStore(
        objects={
            (
                "campus-agent-derived",
                institutional.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 示例大学采购工作管理办法\n\n第一条 为规范学校采购工作，制定本办法。\n第二条 本办法自2021年3月1日起施行。\n"
            ),
            (
                "campus-agent-derived",
                annual_ready.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 为规范推荐2026届本科生免试攻读研究生工作，制定本细则。\n第二条 本细则适用于示例传媒学院相关学生。\n"
            ),
            (
                "campus-agent-derived",
                annual_pending.canonical_markdown_object_key,
            ): _canonical_markdown(
                "# 示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 本细则所涉具体选拔条件详见附件《示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则》。\n第二条 学生应按附件要求准备材料。\n附件：《示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则》\n"
            ),
            ("campus-agent-derived", institutional.document_units_object_key): _document_units([]),
            ("campus-agent-derived", annual_ready.document_units_object_key): _document_units([]),
            ("campus-agent-derived", annual_pending.document_units_object_key): _document_units([]),
            **{
                ("campus-agent-derived", record.canonical_markdown_object_key): _canonical_markdown(
                    f"# {record.document_id}\n\n{record.document_id}\n"
                )
                for record in extra_notice_rows
            },
            **{
                ("campus-agent-derived", record.document_units_object_key): _document_units([])
                for record in extra_notice_rows
            },
        }
    )
    return registry, inventory_store, object_store


def _notice_runtime_record(*, notice_id: str, title_slug: str, title: str):
    return _record(
        notice_id=notice_id,
        title_slug=title_slug,
        content_hash=f"sha256:{title_slug}",
        body_key=f"campus_notices/documents/internal_notice/{notice_id}/canonical.md",
        units_key=f"campus_notices/documents/internal_notice/{notice_id}/document-units.jsonl",
        is_current=True,
    )


def _attachment_runtime_record(*, notice_id: str, attachment_ref_id: str, title_slug: str):
    parent = _notice_runtime_record(
        notice_id=notice_id,
        title_slug=title_slug,
        title=f"附件 {attachment_ref_id}",
    )
    attachment_document_id = (
        f"notice_attachment:example_internal_portal:{notice_id}:{attachment_ref_id}"
    )
    return replace(
        parent,
        document_id=attachment_document_id,
        content_hash=f"sha256:{title_slug}",
        source_uri=f"https://portal.example.edu/notices/{notice_id}/attachments/{attachment_ref_id}",
        version_id=f"sha256:{notice_id}:{attachment_ref_id}:source-faithful",
        canonical_markdown_object_key=(
            f"campus_notices/documents/internal_notice/{notice_id}/{attachment_ref_id}/canonical.md"
        ),
        document_units_object_key=(
            "campus_notices/documents/internal_notice/"
            f"{notice_id}/{attachment_ref_id}/document-units.jsonl"
        ),
        processed_object_keys=(
            f"campus_notices/documents/internal_notice/{notice_id}/{attachment_ref_id}/canonical.md",
            "campus_notices/documents/internal_notice/"
            f"{notice_id}/{attachment_ref_id}/document-units.jsonl",
        ),
    )


def _inventory_entry_with_attachment_projection_plans(
    *,
    notice_id: str,
    notice_title: str,
    plans: tuple[dict[str, str], ...],
):
    entry = _inventory_entry(notice_id=notice_id, notice_title=notice_title)
    parent_snapshot = dict(entry.parent_snapshot)
    parent_snapshot["attachment_projection_plans"] = [dict(plan) for plan in plans]
    return replace(
        entry,
        attachment_document_count=sum(
            1
            for plan in plans
            if str(plan.get("materialization_policy") or "") == "required_document"
        ),
        attachment_ref_count=len(plans),
        text_extractable_count=sum(
            1 for plan in plans if str(plan.get("classification") or "") == "text_extractable"
        ),
        parent_snapshot=parent_snapshot,
    )


def _commute_inventory_entry(*, notice_id: str, notice_title: str):
    if notice_id not in {"354889", "355122"}:
        return _inventory_entry(
            notice_id=notice_id,
            notice_title=notice_title,
            published_date="2026-03-01 10:00",
        )
    return _inventory_entry_with_attachment_projection_plans(
        notice_id=notice_id,
        notice_title=notice_title,
        plans=(
            {
                "attachment_ref_id": "attachment-0001",
                "classification": "ocr_required",
                "document_id": f"notice_attachment:example_internal_portal:{notice_id}:attachment-0001",
                "materialization_policy": "required_document",
                "attachment_filename": "班次表.jpg",
            },
        ),
    )


def _inventory_entry_with_multimodal_inline_images(
    *,
    notice_id: str,
    notice_title: str,
    count: int,
):
    plans = tuple(
        {
            "attachment_ref_id": f"inline-image-{index + 1:04d}",
            "classification": "multimodal_processing_required",
            "content_kind": "inline_image",
            "materialization_policy": "multimodal_processing",
            "resource_role": "inline_image",
        }
        for index in range(count)
    )
    entry = _inventory_entry(notice_id=notice_id, notice_title=notice_title)
    parent_snapshot = dict(entry.parent_snapshot)
    parent_snapshot["attachment_projection_plans"] = [dict(plan) for plan in plans]
    parent_snapshot["multimodal_processing_required_count"] = count
    return replace(
        entry,
        attachment_ref_count=count,
        multimodal_processing_required_count=count,
        notice_risk_label="body_with_spatial_attachments",
        attachment_mix_score=count + 1,
        has_spatial_attachment=count > 0,
        parent_snapshot=parent_snapshot,
    )


def _projection_entry(notice_id: str):
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(
        (
            _inventory_entry(
                notice_id=notice_id,
                notice_title=f"测试通知 {notice_id}",
            ),
        )
    )
    return next(
        entry
        for entry in build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=InMemoryDocumentRegistry(()),
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(objects={}),
        )
        if entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW
    )


def _machine_processing_report(
    *,
    document_id: str,
    notice_id: str,
    document_nature: str,
    reasons: tuple[str, ...],
    source_title: str = "示例传媒学院推荐2026届本科生免试攻读研究生工作实施细则",
) -> InternalNoticeRegulationPromotionDocumentReport:
    return InternalNoticeRegulationPromotionDocumentReport(
        document_id=document_id,
        notice_id=notice_id,
        site_id="example_internal_portal",
        source_kind="parent_notice",
        source_title=source_title,
        input_lane="notice_body",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:source-faithful",
        action="requires_multimodal_processing",
        promotion_class="scoped_rule",
        document_nature=document_nature,
        semantic_owner_kind="notice_body",
        target_corpus="regulations",
        target_collection="scoped_rules",
        regulation_title_normalized=source_title,
        issuing_org="示例大学",
        effective_date=None,
        revision_signal=None,
        source_notice_release_time="2026-04-01 10:00",
        source_parent_document_id=document_id,
        source_attachment_ref_id=None,
        source_attachment_sha256=None,
        duplicate_group_key=None,
        duplicate_primary_document_id=None,
        quality_gates_passed=("canonical_text_available",),
        missing_required_metadata=(),
        reasons=reasons,
        artifact_key=None,
    )


def _promotion_report(
    *,
    document_id: str,
    notice_id: str,
    source_title: str,
    document_nature: str,
) -> InternalNoticeRegulationPromotionDocumentReport:
    return replace(
        _machine_processing_report(
            document_id=document_id,
            notice_id=notice_id,
            document_nature=document_nature,
            reasons=(),
            source_title=source_title,
        ),
        action="promote_candidate",
        promotion_class="scoped_rule",
    )


def _manifest_report(
    documents: tuple[InternalNoticeRegulationPromotionDocumentReport, ...],
) -> InternalNoticeRegulationPromotionManifestReport:
    return InternalNoticeRegulationPromotionManifestReport(
        corpus="campus_notices",
        collection="internal_notice",
        target_corpus="regulations",
        target_collection="institutional_rules",
        target_serving_stage="candidate",
        registry_record_count=len(documents),
        selected_record_count=len(documents),
        selected_notice_ids=tuple(sorted({document.notice_id for document in documents})),
        selected_document_ids=(),
        scanned_document_count=len(documents),
        candidate_count=0,
        hold_count=0,
        machine_processing_required_count=len(documents),
        promotion_class_counts={},
        action_counts={"requires_multimodal_processing": len(documents)},
        lane_counts={},
        documents=documents,
    )


_COMMUTE_NOTICE_TITLES = (
    ("355122", "关于两校区学生通勤班车增加班次的通知"),
    ("354889", "关于两校区教师通勤班车班次优化调整的通知"),
    ("354777", "关于近期丰台校区周末地铁接驳车运营安排的通知"),
    ("354578", "关于寒假期间两校区通勤班车班次调整的通知"),
    ("354533", "关于寒假期间两校区通勤班车运营安排的通知"),
    ("354505", "关于近期地铁接驳车运营安排的通知"),
)


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self._pages = list(pages)
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        if not self._pages:
            return []
        return self._pages.pop(0)


__all__ = [
    "_COMMUTE_NOTICE_TITLES",
    "_FakeConnectionContextManager",
    "_FakeObjectStore",
    "_PagedCursor",
    "_attachment_runtime_record",
    "_build_runtime",
    "_commute_inventory_entry",
    "_env",
    "_inventory_entry",
    "_inventory_entry_with_attachment_projection_plans",
    "_inventory_entry_with_multimodal_inline_images",
    "_machine_processing_report",
    "_manifest_report",
    "_notice_runtime_record",
    "_projection_entry",
    "_promotion_report",
]
