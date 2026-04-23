from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    InMemoryNoticeConsumptionProjectionStore,
    build_internal_notice_consumption_projection_entries,
    rebuild_internal_notice_consumption_projection,
    select_ready_target_document_ids,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _FakeObjectStore,
    _inventory_entry,
    _record,
)


class InternalNoticeConsumptionProjectionTest(unittest.TestCase):
    def test_build_entries_emits_notice_window_and_ready_target_units(self) -> None:
        registry, inventory_store, object_store = _build_runtime()

        entries = build_internal_notice_consumption_projection_entries(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(
            {entry.primary_role for entry in entries if entry.primary_role == NOTICE_PRIMARY_ROLE_NOTICE_WINDOW},
            {NOTICE_PRIMARY_ROLE_NOTICE_WINDOW},
        )
        ready_institutional = next(
            entry
            for entry in entries
            if entry.primary_role == NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY
        )
        self.assertEqual(ready_institutional.target_surface, NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES)
        self.assertEqual(ready_institutional.default_agent, NOTICE_DEFAULT_AGENT_RAG)
        self.assertEqual(ready_institutional.completeness_status, NOTICE_COMPLETENESS_COMPLETE)
        self.assertEqual(
            ready_institutional.consumption_status,
            NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        )

        ready_scoped = next(
            entry
            for entry in entries
            if entry.source_notice_id == "351907"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(ready_scoped.target_surface, NOTICE_TARGET_SURFACE_SCOPED_RULES)
        self.assertEqual(ready_scoped.default_agent, NOTICE_DEFAULT_AGENT_RAG)
        self.assertEqual(ready_scoped.role_metadata["school_unit_name"], "新闻与传播学院")

        pending_scoped = next(
            entry
            for entry in entries
            if entry.source_notice_id == "351908"
            and entry.primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        )
        self.assertEqual(pending_scoped.default_agent, NOTICE_DEFAULT_AGENT_NOTICE)
        self.assertEqual(
            pending_scoped.completeness_status,
            NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING,
        )
        self.assertEqual(
            pending_scoped.consumption_status,
            NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME,
        )

    def test_rebuild_projection_store_persists_entries_and_exposes_ready_document_ids(self) -> None:
        registry, inventory_store, object_store = _build_runtime()
        projection_store = InMemoryNoticeConsumptionProjectionStore()

        stored_entries = rebuild_internal_notice_consumption_projection(
            env=_env(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
            projection_store=projection_store,
        )

        self.assertEqual(
            projection_store.list_by_scope("campus_notices", "internal_notice"),
            stored_entries,
        )
        self.assertEqual(
            select_ready_target_document_ids(
                stored_entries,
                target_surface=NOTICE_TARGET_SURFACE_SCOPED_RULES,
                primary_roles=(NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,),
            ),
            ("notice:muc_internal_portal:351907",),
        )
        self.assertEqual(
            select_ready_target_document_ids(
                stored_entries,
                target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                primary_roles=(NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,),
            ),
            ("notice:muc_internal_portal:187233",),
        )


def _env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        "EMBEDDING_PROVIDER": "mock",
        "EMBEDDING_MODEL": "mock-embedding-8d",
        "SPARSE_PROVIDER": "mock",
    }


def _build_runtime():
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
    registry = InMemoryDocumentRegistry((institutional, annual_ready, annual_pending))
    inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
    inventory_store.upsert_many(
        (
            _inventory_entry(
                notice_id="187233",
                notice_title="关于修订《中央民族大学采购工作管理办法》的通知",
                published_date="2021-02-28 16:09",
            ),
            _inventory_entry(
                notice_id="351907",
                notice_title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                published_date="2026-04-01 10:00",
            ),
            _inventory_entry(
                notice_id="351908",
                notice_title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                published_date="2026-04-02 10:00",
            ),
        )
    )
    object_store = _FakeObjectStore(
        objects={
            ("campus-rag-derived", institutional.canonical_markdown_object_key): _canonical_markdown(
                "# 中央民族大学采购工作管理办法\n\n第一条 为规范学校采购工作，制定本办法。\n第二条 本办法自2021年3月1日起施行。\n"
            ),
            ("campus-rag-derived", annual_ready.canonical_markdown_object_key): _canonical_markdown(
                "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 为规范推荐2026届本科生免试攻读研究生工作，制定本细则。\n第二条 本细则适用于新闻与传播学院相关学生。\n"
            ),
            ("campus-rag-derived", annual_pending.canonical_markdown_object_key): _canonical_markdown(
                "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 本细则所涉具体选拔条件详见附件《新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则》。\n第二条 学生应按附件要求准备材料。\n附件：《新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则》\n"
            ),
            ("campus-rag-derived", institutional.document_units_object_key): _document_units([]),
            ("campus-rag-derived", annual_ready.document_units_object_key): _document_units([]),
            ("campus-rag-derived", annual_pending.document_units_object_key): _document_units([]),
        }
    )
    return registry, inventory_store, object_store
