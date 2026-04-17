from __future__ import annotations

import json
import unittest

import campus_ingestion_core.internal_notice_scoped_rule_materialization as scoped_materialization
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.uploads: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data


def _canonical_markdown(body: str) -> bytes:
    return body.encode("utf-8")


def _document_units(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _record(
    *,
    notice_id: str,
    title_slug: str,
    content_hash: str,
    body_key: str,
    units_key: str,
    is_current: bool = False,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=f"notice:muc_internal_portal:{notice_id}",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:source-faithful",
        source_uri=f"https://portal.example.edu/notices/{notice_id}",
        content_hash=content_hash,
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-10T00:00:00+00:00",
        parser_version="authenticated_notice_source_projection_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=is_current,
        document_units_object_key=units_key,
        canonical_markdown_object_key=body_key,
        processed_object_keys=(body_key, units_key),
        import_source="authenticated_notice_source_projection",
        published_date="2026-04-10",
    )


def _inventory_entry(
    *,
    notice_id: str,
    notice_title: str,
    published_date: str = "2026-04-10",
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    parent_document_id = f"notice:muc_internal_portal:{notice_id}"
    parent_snapshot = {
        "notice_id": notice_id,
        "site_id": "muc_internal_portal",
        "document_id": parent_document_id,
        "notice_title": notice_title,
        "notice_release_time": published_date,
        "attachment_projection_plans": [],
        "record": {
            "document_id": parent_document_id,
            "published_date": published_date,
        },
    }
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus="campus_notices",
        collection="internal_notice",
        notice_id=notice_id,
        site_id="muc_internal_portal",
        document_id=parent_document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:inventory",
        raw_asset_id=f"raw:{notice_id}",
        raw_version_id=f"sha256:{notice_id}:raw",
        source_home_url="https://portal.example.edu",
        embedding_model="Qwen3-Embedding-4B",
        notice_manifest_key=f"source/{notice_id}/notice-manifest.json",
        content_blocks_key=f"source/{notice_id}/content-blocks.jsonl",
        attachment_refs_key=f"source/{notice_id}/attachment-refs.jsonl",
        attachment_document_count=0,
        attachment_ref_count=0,
        text_extractable_count=0,
        ocr_required_count=0,
        reference_only_count=0,
        manual_review_required_count=0,
        notice_risk_label="body_only",
        attachment_mix_score=0,
        has_text_table_attachment=False,
        has_spatial_attachment=False,
        has_reference_only_attachment=False,
        planning_weight=1,
        parent_snapshot=parent_snapshot,
    )


def _document_rows(upload: dict[str, object]) -> list[dict[str, object]]:
    payload = upload["data"]
    assert isinstance(payload, bytes)
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


class InternalNoticeScopedRuleMaterializationTest(unittest.TestCase):
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
                ("campus-rag-derived", seasonal_primary.canonical_markdown_object_key): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n第一条 为加强暑假期间实验室安全管理，制定本规定。\n第二条 暑假期间所有实验室须执行值班制度。\n"
                ),
                ("campus-rag-derived", seasonal_duplicate.canonical_markdown_object_key): _canonical_markdown(
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
                            "metadata": {"title": "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则"},
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
                            "metadata": {"title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"},
                        }
                    ]
                ),
                ("campus-rag-derived", seasonal_duplicate.document_units_object_key): _document_units(
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
            str(upload["key"]): upload for upload in object_store.uploads if str(upload["key"]).endswith(".jsonl")
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

    def test_materialize_scoped_rules_refreshes_existing_target_artifacts_when_provenance_expands(self) -> None:
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
                ("campus-rag-derived", seasonal_primary.canonical_markdown_object_key): _canonical_markdown(
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
                            "metadata": {"title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"},
                        }
                    ]
                ),
            }
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
        object_store.objects[("campus-rag-derived", seasonal_duplicate.canonical_markdown_object_key)] = (
            _canonical_markdown(
                "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
                "第一条 为加强暑假期间实验室安全管理，制定本规定。\n"
                "第二条 暑假期间所有实验室须执行值班制度。\n"
            )
        )
        object_store.objects[("campus-rag-derived", seasonal_duplicate.document_units_object_key)] = (
            _document_units(
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
        )
        object_store.uploads.clear()

        second_report = materialize(
            env=env,
            object_store=object_store,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
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

    def test_build_scoped_rule_candidate_prefers_source_title_for_annual_cycle_rule(self) -> None:
        source_record = _record(
            notice_id="187004",
            title_slug="history-rule",
            content_hash="sha256:history-rule",
            body_key="campus_notices/documents/internal_notice/187004/canonical.md",
            units_key="campus_notices/documents/internal_notice/187004/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", source_record.canonical_markdown_object_key or ""): _canonical_markdown(
                    "# 历史文化学院2021年硕博连读博士研究生 招生实施细则\n\n"
                    "根据教育部有关文件精神及《中央民族大学2021年硕博连读博士研究生招生工作》要求，"
                    "我院在2021年博士研究生招生中继续实行硕博连读招生。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="187004",
            site_id="muc_internal_portal",
            source_kind="parent_notice",
            source_title="历史文化学院2021年硕博连读博士研究生 招生实施细则",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="manual_review_required",
            promotion_class="scoped_rule",
            document_nature="annual_cycle_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="中央民族大学2021年硕博连读博士研究生招生工作",
            issuing_org="中央民族大学",
            effective_date="2021年1月8日",
            revision_signal=None,
            source_notice_release_time="2021-01-07 16:30",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("annual_cycle_or_program_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="187004",
                notice_title="历史文化学院2021年硕博连读博士研究生 招生实施细则",
                published_date="2021-01-07 16:30",
            ),
            object_store=object_store,
            bucket_derived="campus-rag-derived",
            document_nature="annual_cycle_rule",
        )

        self.assertEqual(
            candidate.title,
            "历史文化学院2021年硕博连读博士研究生 招生实施细则",
        )
        self.assertEqual(candidate.cycle_year, "2021")

    def test_build_scoped_rule_candidate_prefers_source_title_for_time_bound_rule(self) -> None:
        source_record = _record(
            notice_id="191705",
            title_slug="fengtai-rule",
            content_hash="sha256:fengtai-rule",
            body_key="campus_notices/documents/internal_notice/191705/canonical.md",
            units_key="campus_notices/documents/internal_notice/191705/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", source_record.canonical_markdown_object_key or ""): _canonical_markdown(
                    "# 中央民族大学丰台校区就医管理办法（暂行）\n\n"
                    "校医院正式运营前，由临时医疗点承担校区基础门诊服务。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="191705",
            site_id="muc_internal_portal",
            source_kind="parent_notice",
            source_title="重要通知--中央民族大学丰台校区就医管理办法（暂行）",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="manual_review_required",
            promotion_class="scoped_rule",
            document_nature="time_bound_operational_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="中央民族大学丰台校区医疗服务说明",
            issuing_org="中央民族大学",
            effective_date=None,
            revision_signal=None,
            source_notice_release_time="2021-06-30 10:00",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("time_bound_operational_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="191705",
                notice_title="重要通知--中央民族大学丰台校区就医管理办法（暂行）",
                published_date="2021-06-30 10:00",
            ),
            object_store=object_store,
            bucket_derived="campus-rag-derived",
            document_nature="time_bound_operational_rule",
        )

        self.assertEqual(
            candidate.title,
            "重要通知--中央民族大学丰台校区就医管理办法（暂行）",
        )
        self.assertEqual(candidate.campus_site, "中央民族大学丰台校区")


if __name__ == "__main__":
    unittest.main()
