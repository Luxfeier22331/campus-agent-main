from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    InMemoryNoticeConsumptionProjectionStore,
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
    scoped_materialization,
)


class InternalNoticeScopedRuleMaterializationMaterializeTest(unittest.TestCase):
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
