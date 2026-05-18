from __future__ import annotations

from campus_ingestion_core.regulation_rag_release_lane import (
    InMemoryRegulationRagReleaseCandidateStore,
)

from .internal_notice_regulation_materialization_test_support import *


class InternalNoticeRegulationMaterializationGateTest(unittest.TestCase):
    def test_materialize_from_internal_notice_scope_excludes_contextual_rules_routed_to_scoped_rules(
        self,
    ) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        annual_parent = _record(
            document_id="notice:muc_internal_portal:200005",
            source_uri="https://portal.example.edu/notices/200005",
            canonical_key="campus_notices/documents/internal_notice/200005/canonical.md",
            units_key="campus_notices/documents/internal_notice/200005/document-units.jsonl",
            content_hash="sha256:parent-200005",
            is_current=True,
        )
        temporary_parent = _record(
            document_id="notice:muc_internal_portal:200003",
            source_uri="https://portal.example.edu/notices/200003",
            canonical_key="campus_notices/documents/internal_notice/200003/canonical.md",
            units_key="campus_notices/documents/internal_notice/200003/document-units.jsonl",
            content_hash="sha256:parent-200003",
            is_current=True,
        )
        registry = InMemoryDocumentRegistry((annual_parent, temporary_parent))
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200005",
                    notice_title="中央民族大学2026年“英才计划”硕博连读研究生招生实施细则",
                    published_date="2025-12-16",
                ),
                _inventory_entry(
                    notice_id="200003",
                    notice_title="中央民族大学丰台校区就医管理办法（暂行）",
                    published_date="2021-09-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    annual_parent.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学2026年“英才计划”硕博连读研究生招生实施细则\n\n"
                    "第一条 为规范2026年“英才计划”硕博连读研究生招生工作，制定本细则。\n"
                    "第二条 报名时间为2025年12月10日至2026年1月10日。\n"
                ),
                (
                    "campus-rag-derived",
                    temporary_parent.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学丰台校区就医管理办法（暂行）\n\n"
                    "第一条 为规范丰台校区就医管理，制定本办法。\n"
                    "第二条 正式运营前由临时医疗点负责首诊，正式运营后取消本过渡安排。\n"
                ),
                ("campus-rag-derived", annual_parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": annual_parent.document_id,
                            "version_id": annual_parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学2026年“英才计划”硕博连读研究生招生实施细则",
                            "source_url": annual_parent.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "中央民族大学2026年“英才计划”硕博连读研究生招生实施细则"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", temporary_parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": temporary_parent.document_id,
                            "version_id": temporary_parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学丰台校区就医管理办法（暂行）",
                            "source_url": temporary_parent.source_uri,
                            "page_start": 3,
                            "page_end": 4,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "中央民族大学丰台校区就医管理办法（暂行）"},
                        }
                    ]
                ),
            }
        )

        report = materialize(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=InMemoryNoticeConsumptionProjectionStore(),
        )

        self.assertEqual(report.promotion_candidate_count, 0)
        self.assertEqual(report.materialized_document_count, 0)
        target_records = registry.list_by_scope("regulations", "institutional_rules")
        self.assertEqual(target_records, ())

    def test_materialize_from_internal_notice_scope_obeys_consumption_projection_ready_gate(
        self,
    ) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        parent = _record(
            document_id="notice:muc_internal_portal:300001",
            source_uri="https://portal.example.edu/notices/300001",
            canonical_key="campus_notices/documents/internal_notice/300001/canonical.md",
            units_key="campus_notices/documents/internal_notice/300001/document-units.jsonl",
            content_hash="sha256:parent-300001",
            is_current=True,
        )
        registry = InMemoryDocumentRegistry((parent,))
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="300001",
                    notice_title="中央民族大学实验室安全管理规定",
                    published_date="2026-04-20",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学实验室安全管理规定\n\n"
                    "第一条 为加强实验室安全管理，制定本规定。\n"
                    "第二条 实验室实行分级分类安全管理。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent.document_id,
                            "version_id": parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学实验室安全管理规定",
                            "source_url": parent.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "中央民族大学实验室安全管理规定"},
                        }
                    ]
                ),
            }
        )
        held_projection_entry = NoticeConsumptionProjectionEntry(
            source_family="internal_notice_restricted",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="300001",
            unit_id="notice_unit:muc_internal_portal:300001:attachment_rule_body:held",
            primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
            semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
            default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
            target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
            temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
            completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
            answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
            consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            source_notice_document_id=parent.document_id,
            source_document_id=parent.document_id,
            role_metadata={"reasons": ("projection_gate_forced_hold",)},
        )

        report = materialize(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=_ReadOnlyProjectionStore((held_projection_entry,)),
        )

        self.assertEqual(report.promotion_candidate_count, 0)
        self.assertEqual(report.materialized_document_count, 0)
        self.assertEqual(registry.list_by_scope("regulations", "institutional_rules"), ())

    def test_materialize_uses_projection_truth_without_rebuilding_promotion_manifest(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:300101",
            source_uri="https://portal.example.edu/notices/300101",
            canonical_key="campus_notices/documents/internal_notice/300101/canonical.md",
            units_key="campus_notices/documents/internal_notice/300101/document-units.jsonl",
            content_hash="sha256:parent-300101",
            is_current=True,
        )
        registry = InMemoryDocumentRegistry((parent,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学实验室安全管理规定\n\n第一条 为加强实验室安全管理，制定本规定。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent.document_id,
                            "version_id": parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学实验室安全管理规定",
                            "source_url": parent.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "中央民族大学实验室安全管理规定"},
                        }
                    ]
                ),
            }
        )
        ready_projection = _ready_institutional_projection_entry(
            notice_id="300101",
            source_document_id=parent.document_id,
        )
        candidate_store = InMemoryRegulationRagReleaseCandidateStore()

        with (
            unittest.mock.patch(
                "campus_ingestion_core.internal_notice_regulation_materialization.build_internal_notice_regulation_promotion_manifest",
                side_effect=AssertionError("must not rebuild promotion manifest"),
                create=True,
            ),
            unittest.mock.patch(
                "campus_ingestion_core.internal_notice_regulation_materialization.build_internal_notice_regulation_candidate_artifact_manifest",
                side_effect=AssertionError("must not rebuild candidate artifact manifest"),
                create=True,
            ),
        ):
            report = regulation_materialization.materialize_institutional_regulations_from_internal_notice_scope(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                object_store=object_store,
                registry=registry,
                raw_asset_registry=InMemoryRawAssetRegistry(()),
                source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
                consumption_projection_store=InMemoryNoticeConsumptionProjectionStore(
                    (ready_projection,)
                ),
                rag_release_candidate_store=candidate_store,
            )

        self.assertEqual(report.promotion_candidate_count, 1)
        self.assertEqual(report.materialized_document_count, 1)
        self.assertEqual(report.rag_release_candidate_created_count, 1)
        candidates = candidate_store.list_candidates()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].collection, "institutional_rules")
        self.assertEqual(candidates[0].status, "pending")
        self.assertTrue(candidates[0].query_enabled_by_default)

    def test_materialized_target_record_is_current_even_when_source_snapshot_is_not_current(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:300201",
            source_uri="https://portal.example.edu/notices/300201",
            canonical_key="campus_notices/documents/internal_notice/300201/canonical.md",
            units_key="campus_notices/documents/internal_notice/300201/document-units.jsonl",
            content_hash="sha256:parent-300201",
            is_current=False,
        )
        registry = InMemoryDocumentRegistry((parent,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学实验室安全管理规定\n\n第一条 为加强实验室安全管理，制定本规定。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent.document_id,
                            "version_id": parent.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学实验室安全管理规定",
                            "source_url": parent.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "中央民族大学实验室安全管理规定"},
                        }
                    ]
                ),
            }
        )

        report = regulation_materialization.materialize_institutional_regulations_from_internal_notice_scope(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "EMBEDDING_PROVIDER": "mock",
                "EMBEDDING_MODEL": "mock-embedding-8d",
                "SPARSE_PROVIDER": "mock",
            },
            object_store=object_store,
            registry=registry,
            raw_asset_registry=InMemoryRawAssetRegistry(()),
            source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
            consumption_projection_store=InMemoryNoticeConsumptionProjectionStore(
                (
                    _ready_institutional_projection_entry(
                        notice_id="300201",
                        source_document_id=parent.document_id,
                    ),
                )
            ),
        )

        self.assertEqual(report.materialized_document_count, 1)
        target_records = registry.list_by_scope("regulations", "institutional_rules")
        self.assertEqual(len(target_records), 1)
        self.assertTrue(target_records[0].is_current)
