from __future__ import annotations

import unittest
import unittest.mock

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .internal_notice_scoped_rule_materialization_test_support import (
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    _canonical_markdown,
    _document_rows,
    _document_units,
    _FakeObjectStore,
    _inventory_entry,
    _ready_scoped_projection_entry,
    _record,
    _target_scoped_rule_record,
    scoped_materialization,
)


class InternalNoticeScopedRuleMaterializationMaterializeTest(unittest.TestCase):
    def test_materialize_scoped_rules_requires_configured_projection_store_when_not_injected(
        self,
    ) -> None:
        materialize = getattr(
            scoped_materialization,
            "materialize_scoped_rules_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        with (
            unittest.mock.patch(
                "campus_ingestion_core.internal_notice_scoped_rule_materialization_engine.build_notice_consumption_projection_store_from_env",
                side_effect=ValueError("projection store is required"),
            ),
            self.assertRaisesRegex(ValueError, "projection store is required"),
        ):
            materialize(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                },
                object_store=_FakeObjectStore(),
                registry=InMemoryDocumentRegistry(()),
                raw_asset_registry=InMemoryRawAssetRegistry(()),
            )

    def test_materialize_scoped_rules_from_internal_notice_scope(self) -> None:
        materialize = getattr(
            scoped_materialization,
            "materialize_scoped_rules_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        annual = _record(
            notice_id="351907",
            title_slug="recommendation-rule",
            content_hash="sha256:annual-351907",
            body_key="campus_notices/documents/internal_notice/351907/canonical.md",
            units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
            is_current=True,
        )
        seasonal_primary = _record(
            notice_id="191176",
            title_slug="summer-lab-rule",
            content_hash="sha256:seasonal-rule",
            body_key="campus_notices/documents/internal_notice/191176/canonical.md",
            units_key="campus_notices/documents/internal_notice/191176/document-units.jsonl",
            is_current=True,
        )
        seasonal_duplicate = _record(
            notice_id="191177",
            title_slug="summer-lab-rule-duplicate",
            content_hash="sha256:seasonal-rule-duplicate-source",
            body_key="campus_notices/documents/internal_notice/191177/canonical.md",
            units_key="campus_notices/documents/internal_notice/191177/document-units.jsonl",
        )

        registry = InMemoryDocumentRegistry((annual, seasonal_primary, seasonal_duplicate))
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="351907",
                    notice_title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                    published_date="2026-04-01",
                ),
                _inventory_entry(
                    notice_id="191176",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-01",
                ),
                _inventory_entry(
                    notice_id="191177",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", annual.canonical_markdown_object_key): _canonical_markdown(
                    "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 为规范推荐2026届本科生免试攻读研究生工作，制定本细则。\n第二条 本细则适用于新闻与传播学院相关学生。\n"
                ),
                (
                    "campus-rag-derived",
                    seasonal_primary.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n第一条 为加强暑假期间实验室安全管理，制定本规定。\n第二条 暑假期间所有实验室须执行值班制度。\n"
                ),
                (
                    "campus-rag-derived",
                    seasonal_duplicate.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n第一条 为加强暑假期间实验室安全管理，制定本规定。\n第二条 暑假期间所有实验室须执行值班制度。\n"
                ),
                ("campus-rag-derived", annual.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": annual.document_id,
                            "version_id": annual.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                            "source_url": annual.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", seasonal_primary.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": seasonal_primary.document_id,
                            "version_id": seasonal_primary.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                            "source_url": seasonal_primary.source_uri,
                            "page_start": 3,
                            "page_end": 4,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"
                            },
                        }
                    ]
                ),
                (
                    "campus-rag-derived",
                    seasonal_duplicate.document_units_object_key,
                ): _document_units(
                    [
                        {
                            "doc_id": seasonal_duplicate.document_id,
                            "version_id": seasonal_duplicate.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                            "source_url": seasonal_duplicate.source_uri,
                            "page_start": 5,
                            "page_end": 6,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"
                            },
                        }
                    ]
                ),
            }
        )
        consumption_projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _ready_scoped_projection_entry(
                    notice_id="351907",
                    primary_role=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
                ),
                _ready_scoped_projection_entry(
                    notice_id="191176",
                    primary_role=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
                ),
                _ready_scoped_projection_entry(
                    notice_id="191177",
                    primary_role=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
                ),
            )
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
            consumption_projection_store=consumption_projection_store,
        )

        self.assertEqual(report.scoped_rule_candidate_count, 3)
        self.assertEqual(report.materialized_document_count, 2)
        self.assertEqual(report.rag_release_candidate_created_count, 0)
        self.assertEqual(report.document_nature_counts["annual_cycle_rule"], 1)
        self.assertEqual(report.document_nature_counts["time_bound_operational_rule"], 2)
        self.assertTrue(
            report.raw_asset_id.startswith("asset:internal-notice-scoped-rules-materialization")
        )
        raw_record = raw_asset_registry.get(report.raw_asset_id, report.raw_version_id)
        self.assertIsNotNone(raw_record)
        if raw_record is None:
            return
        self.assertEqual(raw_record.collection, "scoped_rules")

        target_records = registry.list_by_scope("regulations", "scoped_rules")
        self.assertEqual(len(target_records), 2)
        uploads_by_key = {
            str(upload["key"]): upload
            for upload in object_store.uploads
            if str(upload["key"]).endswith(".jsonl")
        }

        scoped_rows_by_nature = {}
        for record in target_records:
            rows = _document_rows(uploads_by_key[record.document_units_object_key or ""])
            scoped_rows_by_nature[rows[0]["metadata"]["document_nature"]] = rows

        annual_rows = scoped_rows_by_nature["annual_cycle_rule"]
        annual_metadata = annual_rows[0]["metadata"]
        self.assertEqual(annual_metadata["cycle_year"], "2026")
        self.assertEqual(annual_metadata["school_unit_name"], "新闻与传播学院")

        seasonal_rows = scoped_rows_by_nature["time_bound_operational_rule"]
        seasonal_metadata = seasonal_rows[0]["metadata"]
        self.assertEqual(seasonal_metadata["document_nature"], "time_bound_operational_rule")
        self.assertEqual(seasonal_metadata["source_notice_ids"], ["191176", "191177"])
        self.assertEqual(seasonal_metadata["school_unit_name"], "生命与环境科学学院")

    def test_materialize_scoped_rules_uses_projection_truth_without_rebuilding_promotion_manifest(
        self,
    ) -> None:
        source_record = _record(
            notice_id="351907",
            title_slug="recommendation-rule",
            content_hash="sha256:annual-351907",
            body_key="campus_notices/documents/internal_notice/351907/canonical.md",
            units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
            is_current=True,
        )
        registry = InMemoryDocumentRegistry((source_record,))
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    source_record.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n第一条 为规范推荐2026届本科生免试攻读研究生工作，制定本细则。\n"
                ),
                ("campus-rag-derived", source_record.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": source_record.document_id,
                            "version_id": source_record.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                            "source_url": source_record.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则"
                            },
                        }
                    ]
                ),
            }
        )
        with unittest.mock.patch(
            "campus_ingestion_core.internal_notice_scoped_rule_materialization_engine.build_internal_notice_regulation_promotion_manifest",
            side_effect=AssertionError("must not rebuild promotion manifest"),
            create=True,
        ):
            report = scoped_materialization.materialize_scoped_rules_from_internal_notice_scope(
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
                        _ready_scoped_projection_entry(
                            notice_id="351907",
                            primary_role=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
                        ),
                    )
                ),
            )

        self.assertEqual(report.scoped_rule_candidate_count, 1)
        self.assertEqual(report.materialized_document_count, 1)

    def test_materialize_scoped_rules_refreshes_existing_target_artifacts_when_provenance_expands(
        self,
    ) -> None:
        materialize = getattr(
            scoped_materialization,
            "materialize_scoped_rules_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        seasonal_primary = _record(
            notice_id="191176",
            title_slug="summer-lab-rule",
            content_hash="sha256:seasonal-rule",
            body_key="campus_notices/documents/internal_notice/191176/canonical.md",
            units_key="campus_notices/documents/internal_notice/191176/document-units.jsonl",
            is_current=True,
        )
        seasonal_duplicate = _record(
            notice_id="191177",
            title_slug="summer-lab-rule-duplicate",
            content_hash="sha256:seasonal-rule-duplicate-source",
            body_key="campus_notices/documents/internal_notice/191177/canonical.md",
            units_key="campus_notices/documents/internal_notice/191177/document-units.jsonl",
        )
        registry = InMemoryDocumentRegistry((seasonal_primary,))
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="191176",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    seasonal_primary.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
                    "第一条 为加强暑假期间实验室安全管理，制定本规定。\n"
                    "第二条 暑假期间所有实验室须执行值班制度。\n"
                ),
                ("campus-rag-derived", seasonal_primary.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": seasonal_primary.document_id,
                            "version_id": seasonal_primary.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                            "source_url": seasonal_primary.source_uri,
                            "page_start": 3,
                            "page_end": 4,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"
                            },
                        }
                    ]
                ),
            }
        )
        consumption_projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _ready_scoped_projection_entry(
                    notice_id="191176",
                    primary_role=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
                ),
            )
        )
        env = {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            "EMBEDDING_PROVIDER": "mock",
            "EMBEDDING_MODEL": "mock-embedding-8d",
            "SPARSE_PROVIDER": "mock",
        }

        first_report = materialize(
            env=env,
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=consumption_projection_store,
        )
        self.assertEqual(first_report.materialized_document_count, 1)
        first_target_record = registry.list_by_scope("regulations", "scoped_rules")[0]
        first_target_rows = _document_rows(
            next(
                upload
                for upload in object_store.uploads
                if upload["key"] == first_target_record.document_units_object_key
            )
        )
        self.assertEqual(first_target_rows[0]["metadata"]["source_notice_ids"], ["191176"])

        registry.upsert(seasonal_duplicate)
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="191177",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-01",
                ),
            )
        )
        object_store.objects[
            ("campus-rag-derived", seasonal_duplicate.canonical_markdown_object_key)
        ] = _canonical_markdown(
            "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
            "第一条 为加强暑假期间实验室安全管理，制定本规定。\n"
            "第二条 暑假期间所有实验室须执行值班制度。\n"
        )
        object_store.objects[
            ("campus-rag-derived", seasonal_duplicate.document_units_object_key)
        ] = _document_units(
            [
                {
                    "doc_id": seasonal_duplicate.document_id,
                    "version_id": seasonal_duplicate.version_id,
                    "chunk_id": "row-0001",
                    "clean_text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    "source_url": seasonal_duplicate.source_uri,
                    "page_start": 5,
                    "page_end": 6,
                    "entitlement_groups": ["campus_members"],
                    "visibility_scope": "campus",
                    "visibility_level": "restricted",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                    "metadata": {"title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"},
                }
            ]
        )
        object_store.uploads.clear()
        consumption_projection_store.upsert_many(
            (
                _ready_scoped_projection_entry(
                    notice_id="191177",
                    primary_role=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
                ),
            )
        )

        second_report = materialize(
            env=env,
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=consumption_projection_store,
        )

        self.assertEqual(second_report.materialized_document_count, 1)
        refreshed_target_record = registry.list_by_scope("regulations", "scoped_rules")[0]
        refreshed_rows = _document_rows(
            next(
                upload
                for upload in object_store.uploads
                if upload["key"] == refreshed_target_record.document_units_object_key
            )
        )
        refreshed_metadata = refreshed_rows[0]["metadata"]
        self.assertEqual(refreshed_metadata["source_notice_ids"], ["191176", "191177"])
        self.assertEqual(
            refreshed_metadata["duplicate_source_document_ids"],
            ["notice:muc_internal_portal:191177"],
        )

    def test_selected_materialize_scoped_rules_removes_stale_target_record_when_projection_is_held(
        self,
    ) -> None:
        materialize = getattr(
            scoped_materialization,
            "materialize_scoped_rules_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        source_record = _record(
            notice_id="351907",
            title_slug="recommendation-rule",
            content_hash="sha256:annual-351907",
            body_key="campus_notices/documents/internal_notice/351907/canonical.md",
            units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
            is_current=True,
        )
        stale_target = _target_scoped_rule_record(
            document_id="institutional_regulation:muc:recommendation-rule:stale351907",
            document_units_key=(
                "regulations/documents/scoped_rules/recommendation-rule/"
                "source-faithful/2026/document-units.jsonl"
            ),
            canonical_key=(
                "regulations/documents/scoped_rules/recommendation-rule/"
                "source-faithful/2026/canonical.md"
            ),
        )
        unrelated_target = _target_scoped_rule_record(
            document_id="institutional_regulation:muc:summer-lab-rule:stable191176",
            document_units_key=(
                "regulations/documents/scoped_rules/summer-lab-rule/"
                "source-faithful/2021/document-units.jsonl"
            ),
            canonical_key=(
                "regulations/documents/scoped_rules/summer-lab-rule/"
                "source-faithful/2021/canonical.md"
            ),
        )
        registry = InMemoryDocumentRegistry((source_record, stale_target, unrelated_target))
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    source_record.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n"
                    "本通知仅说明推荐工作安排，正文不作为 scoped rule 直接入库。\n"
                ),
                ("campus-rag-derived", source_record.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": source_record.document_id,
                            "version_id": source_record.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                            "source_url": source_record.source_uri,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", stale_target.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": stale_target.document_id,
                            "version_id": stale_target.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                            "source_url": stale_target.source_uri,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                                "document_nature": "annual_cycle_rule",
                                "source_notice_ids": ["351907"],
                                "source_document_ids": [source_record.document_id],
                                "source_parent_document_ids": [source_record.document_id],
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", unrelated_target.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": unrelated_target.document_id,
                            "version_id": unrelated_target.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "生命与环境科学学院暑假实验室安全管理规定",
                            "source_url": unrelated_target.source_uri,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {
                                "title": "生命与环境科学学院暑假实验室安全管理规定",
                                "document_nature": "time_bound_operational_rule",
                                "source_notice_ids": ["191176"],
                                "source_document_ids": ["notice:muc_internal_portal:191176"],
                                "source_parent_document_ids": ["notice:muc_internal_portal:191176"],
                            },
                        }
                    ]
                ),
            }
        )
        held_projection_entry = NoticeConsumptionProjectionEntry(
            source_family="internal_notice_restricted",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id="351907",
            unit_id="notice_unit:muc_internal_portal:351907:annual_cycle_rule:held",
            primary_role=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
            semantic_owner="notice_body",
            default_agent="rag",
            target_surface="scoped_rules",
            temporal_policy="explicit_year_only",
            completeness_status="reference_only",
            answerability="reference_only",
            consumption_status="retained_for_notice_query",
            source_notice_document_id=source_record.document_id,
            source_document_id=source_record.document_id,
            role_metadata={"reasons": ("projection_gate_forced_hold",)},
        )

        report = materialize(
            request=scoped_materialization.InternalNoticeRegulationPromotionRequest(
                notice_ids=("351907",)
            ),
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
                (held_projection_entry,)
            ),
        )

        self.assertEqual(report.scoped_rule_candidate_count, 0)
        self.assertEqual(report.materialized_document_count, 0)
        target_document_ids = {
            record.document_id for record in registry.list_by_scope("regulations", "scoped_rules")
        }
        self.assertNotIn(stale_target.document_id, target_document_ids)
        self.assertIn(unrelated_target.document_id, target_document_ids)
