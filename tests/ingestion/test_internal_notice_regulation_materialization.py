from __future__ import annotations

import json
import unittest

import campus_ingestion_core.internal_notice_regulation_materialization as regulation_materialization
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
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
    document_id: str,
    source_uri: str,
    canonical_key: str,
    units_key: str,
    content_hash: str,
    revision_track: str = "source-faithful",
    is_current: bool = False,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=f"sha256:{document_id.split(':')[-1]}:{revision_track}",
        source_uri=source_uri,
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
        canonical_markdown_object_key=canonical_key,
        processed_object_keys=(canonical_key, units_key),
        import_source="authenticated_notice_source_projection",
        published_date="2026-04-10",
    )


def _inventory_entry(
    *,
    notice_id: str,
    attachment_projection_plans: tuple[dict[str, object], ...] = (),
    notice_title: str,
    published_date: str = "2026-04-10",
    notice_release_time: str | None = None,
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    parent_document_id = f"notice:muc_internal_portal:{notice_id}"
    parent_snapshot = {
        "notice_id": notice_id,
        "site_id": "muc_internal_portal",
        "document_id": parent_document_id,
        "notice_title": notice_title,
        "notice_release_time": notice_release_time or published_date,
        "attachment_projection_plans": [dict(item) for item in attachment_projection_plans],
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
        attachment_document_count=len(attachment_projection_plans),
        attachment_ref_count=len(attachment_projection_plans),
        text_extractable_count=sum(
            1 for item in attachment_projection_plans if item.get("classification") == "text_extractable"
        ),
        ocr_required_count=sum(
            1 for item in attachment_projection_plans if item.get("classification") == "ocr_required"
        ),
        reference_only_count=0,
        manual_review_required_count=0,
        notice_risk_label="body_with_text_attachments" if attachment_projection_plans else "body_only",
        attachment_mix_score=len(attachment_projection_plans),
        has_text_table_attachment=bool(attachment_projection_plans),
        has_spatial_attachment=False,
        has_reference_only_attachment=False,
        planning_weight=1,
        parent_snapshot=parent_snapshot,
    )


def _regulation_record(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id="sha256:stale-regulation-v1",
        source_uri=f"campusrag://promotion/{document_id}",
        content_hash="stale-regulation-hash",
        corpus="regulations",
        collection="institutional_regulations",
        cleaning_policy_version="institutional_regulations_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-09T00:00:00+00:00",
        parser_version="internal_notice_regulation_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=False,
        document_units_object_key=(
            "regulations/documents/institutional_regulations/stale-regulation--stale1234/"
            "source-faithful/2026/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "regulations/documents/institutional_regulations/stale-regulation--stale1234/"
            "source-faithful/2026/canonical.md"
        ),
        processed_object_keys=(
            "regulations/documents/institutional_regulations/stale-regulation--stale1234/"
            "source-faithful/2026/document-units.jsonl",
            "regulations/documents/institutional_regulations/stale-regulation--stale1234/"
            "source-faithful/2026/canonical.md",
        ),
        import_source="internal_notice_regulation_materialization",
        published_date="2026-04-09",
    )


def _document_rows(upload: dict[str, object]) -> list[dict[str, object]]:
    payload = upload["data"]
    assert isinstance(payload, bytes)
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


class InternalNoticeRegulationMaterializationTest(unittest.TestCase):
    def test_materialize_from_internal_notice_scope_builds_target_documents_and_replaces_scope(self) -> None:
        materialize = getattr(
            regulation_materialization,
            "materialize_institutional_regulations_from_internal_notice_scope",
            None,
        )
        self.assertIsNotNone(materialize)
        if materialize is None:
            return

        parent_1 = _record(
            document_id="notice:muc_internal_portal:100001",
            source_uri="https://portal.example.edu/notices/100001",
            canonical_key="campus_notices/documents/internal_notice/100001/canonical.md",
            units_key="campus_notices/documents/internal_notice/100001/document-units.jsonl",
            content_hash="sha256:parent-100001",
        )
        attachment_1 = _record(
            document_id="notice_attachment:muc_internal_portal:100001:attachment-0001",
            source_uri="https://portal.example.edu/files/100001.docx",
            canonical_key="campus_notices/documents/internal_notice/100001-attachment-1/canonical.md",
            units_key="campus_notices/documents/internal_notice/100001-attachment-1/document-units.jsonl",
            content_hash="sha256:attachment-guideline",
            is_current=True,
        )
        parent_2 = _record(
            document_id="notice:muc_internal_portal:100002",
            source_uri="https://portal.example.edu/notices/100002",
            canonical_key="campus_notices/documents/internal_notice/100002/canonical.md",
            units_key="campus_notices/documents/internal_notice/100002/document-units.jsonl",
            content_hash="sha256:parent-100002",
        )
        attachment_2 = _record(
            document_id="notice_attachment:muc_internal_portal:100002:attachment-0001",
            source_uri="https://portal.example.edu/files/100002.docx",
            canonical_key="campus_notices/documents/internal_notice/100002-attachment-1/canonical.md",
            units_key="campus_notices/documents/internal_notice/100002-attachment-1/document-units.jsonl",
            content_hash="sha256:attachment-guideline-copy",
        )
        parent_3 = _record(
            document_id="notice:muc_internal_portal:100003",
            source_uri="https://portal.example.edu/notices/100003",
            canonical_key="campus_notices/documents/internal_notice/100003/canonical.md",
            units_key="campus_notices/documents/internal_notice/100003/document-units.jsonl",
            content_hash="sha256:parent-100003",
            is_current=True,
        )
        stale_target = _regulation_record(
            "institutional_regulation:muc:stale-regulation:stale1234"
        )

        registry = InMemoryDocumentRegistry(
            (parent_1, attachment_1, parent_2, attachment_2, parent_3, stale_target)
        )
        raw_asset_registry = InMemoryRawAssetRegistry(())
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="100001",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                    attachment_projection_plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": attachment_1.document_id,
                            "materialization_policy": "required_document",
                            "attachment_content_sha256": "sha256-guideline",
                        },
                    ),
                ),
                _inventory_entry(
                    notice_id="100002",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）",
                    attachment_projection_plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": attachment_2.document_id,
                            "materialization_policy": "required_document",
                            "attachment_content_sha256": "sha256-guideline",
                        },
                    ),
                ),
                _inventory_entry(
                    notice_id="100003",
                    notice_title="中央民族大学实验室安全管理规定（2026年修订）",
                    published_date="2026-02-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent_1.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知\n\n现将《中央民族大学关于学生使用人工智能的指导意见（2026版）》予以发布，请遵照执行。\n"
                ),
                ("campus-rag-derived", attachment_1.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n第二条 本指导意见适用于全体在校学生。\n"
                ),
                ("campus-rag-derived", parent_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）\n\n请相关单位参照附件执行。\n"
                ),
                ("campus-rag-derived", attachment_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n第二条 本指导意见适用于全体在校学生。\n"
                ),
                ("campus-rag-derived", parent_3.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《中央民族大学实验室安全管理规定》的通知\n\n学校各单位、各部门：\n\n为进一步加强实验室安全管理，现将有关事项通知如下：\n\n2026年2月1日起施行。\n\n第一条 为加强实验室安全管理，制定本规定。\n第二条 实验室实行分级分类安全管理。\n第三条 各实验室应建立日常巡检制度。\n\n特此通知。\n"
                ),
                ("campus-rag-derived", parent_1.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent_1.document_id,
                            "version_id": parent_1.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                            "source_url": parent_1.source_uri,
                            "page_start": 1,
                            "page_end": 1,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"},
                        }
                    ]
                ),
                ("campus-rag-derived", attachment_1.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": attachment_1.document_id,
                            "version_id": attachment_1.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "source_url": attachment_1.source_uri,
                            "page_start": 1,
                            "page_end": 2,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "中央民族大学关于学生使用人工智能的指导意见（2026版）"},
                        }
                    ]
                ),
                ("campus-rag-derived", parent_2.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent_2.document_id,
                            "version_id": parent_2.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）",
                            "source_url": parent_2.source_uri,
                            "page_start": 3,
                            "page_end": 3,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）"},
                        }
                    ]
                ),
                ("campus-rag-derived", attachment_2.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": attachment_2.document_id,
                            "version_id": attachment_2.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "source_url": attachment_2.source_uri,
                            "page_start": 3,
                            "page_end": 4,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "中央民族大学关于学生使用人工智能的指导意见（2026版）"},
                        }
                    ]
                ),
                ("campus-rag-derived", parent_3.document_units_object_key): _document_units(
                    [
                        {
                            "doc_id": parent_3.document_id,
                            "version_id": parent_3.version_id,
                            "chunk_id": "row-0001",
                            "clean_text": "关于修订《中央民族大学实验室安全管理规定》的通知",
                            "source_url": parent_3.source_uri,
                            "page_start": 5,
                            "page_end": 7,
                            "entitlement_groups": ["campus_members"],
                            "visibility_scope": "campus",
                            "visibility_level": "restricted",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                            "metadata": {"title": "关于修订《中央民族大学实验室安全管理规定》的通知"},
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

        self.assertEqual(report.promotion_candidate_count, 2)
        self.assertEqual(report.materialized_document_count, 2)
        self.assertEqual(len(report.created_document_ids), 2)
        self.assertEqual(report.updated_document_ids, ())
        self.assertTrue(report.raw_asset_id.startswith("asset:internal-notice-regulation-promotion"))
        raw_record = raw_asset_registry.get(report.raw_asset_id, report.raw_version_id)
        self.assertIsNotNone(raw_record)
        if raw_record is None:
            return
        self.assertEqual(raw_record.collection, "institutional_regulations")

        target_records = registry.list_by_scope("regulations", "institutional_regulations")
        self.assertEqual(len(target_records), 2)
        self.assertNotIn(stale_target.document_id, {record.document_id for record in target_records})
        self.assertTrue(all("100001" not in record.document_id for record in target_records))
        self.assertTrue(all("100003" not in record.document_id for record in target_records))

        uploads_by_key = {
            str(upload["key"]): upload for upload in object_store.uploads if str(upload["key"]).endswith(".jsonl")
        }
        guidance_record = next(
            record
            for record in target_records
            if "学生使用人工智能的指导意见" in (
                record.canonical_markdown_object_key or ""
            )
        )
        regulation_record = next(
            record
            for record in target_records
            if "实验室安全管理规定" in (record.canonical_markdown_object_key or "")
        )

        guidance_rows = _document_rows(uploads_by_key[guidance_record.document_units_object_key or ""])
        first_guidance_metadata = guidance_rows[0]["metadata"]
        self.assertEqual(
            first_guidance_metadata["source_notice_ids"],
            ["100001", "100002"],
        )
        self.assertEqual(
            first_guidance_metadata["source_document_ids"],
            [
                "notice_attachment:muc_internal_portal:100001:attachment-0001",
                "notice_attachment:muc_internal_portal:100002:attachment-0001",
            ],
        )
        self.assertEqual(first_guidance_metadata["promotion_source_collection"], "campus_notices/internal_notice")
        self.assertEqual(
            first_guidance_metadata["source_notice_document_id"],
            "notice:muc_internal_portal:100001",
        )
        self.assertEqual(
            first_guidance_metadata["source_notice_document_ids"],
            [
                "notice:muc_internal_portal:100001",
                "notice:muc_internal_portal:100002",
            ],
        )
        self.assertEqual(
            first_guidance_metadata["source_attachment_document_id"],
            "notice_attachment:muc_internal_portal:100001:attachment-0001",
        )
        self.assertEqual(
            first_guidance_metadata["semantic_owner_document_id"],
            "notice_attachment:muc_internal_portal:100001:attachment-0001",
        )
        self.assertEqual(first_guidance_metadata["source_attachment_ref_id"], "attachment-0001")
        self.assertEqual(first_guidance_metadata["source_attachment_ref_ids"], ["attachment-0001"])
        self.assertEqual(first_guidance_metadata["semantic_owner_kind"], "attachment_document")
        self.assertTrue(guidance_record.is_current)

        regulation_rows = _document_rows(uploads_by_key[regulation_record.document_units_object_key or ""])
        regulation_metadata = regulation_rows[0]["metadata"]
        self.assertEqual(regulation_metadata["source_notice_ids"], ["100003"])
        self.assertEqual(
            regulation_metadata["source_notice_document_id"],
            "notice:muc_internal_portal:100003",
        )
        self.assertEqual(
            regulation_metadata["source_parent_document_id"],
            "notice:muc_internal_portal:100003",
        )
        self.assertEqual(
            regulation_metadata["semantic_owner_document_id"],
            "notice:muc_internal_portal:100003",
        )
        self.assertEqual(regulation_metadata["semantic_owner_kind"], "notice_body")
        self.assertEqual(regulation_metadata["effective_date"], "2026年2月1日")
        self.assertEqual(regulation_metadata["revision_signal"], "修订")
        self.assertTrue(regulation_record.is_current)

        guidance_markdown = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=guidance_record.canonical_markdown_object_key or "",
        ).decode("utf-8")
        self.assertTrue(guidance_markdown.startswith("# 中央民族大学关于学生使用人工智能的指导意见（2026版）"))
        self.assertNotIn("关于发布", guidance_markdown)

        regulation_markdown = object_store.get_bytes(
            bucket="campus-rag-derived",
            key=regulation_record.canonical_markdown_object_key or "",
        ).decode("utf-8")
        self.assertTrue(regulation_markdown.startswith("# 中央民族大学实验室安全管理规定"))
        self.assertNotIn("特此通知", regulation_markdown)
        self.assertIn("第一条 为加强实验室安全管理", regulation_markdown)

    def test_materialize_from_internal_notice_scope_preserves_document_nature_for_contextual_regulations(self) -> None:
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
                ("campus-rag-derived", annual_parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学2026年“英才计划”硕博连读研究生招生实施细则\n\n"
                    "第一条 为规范2026年“英才计划”硕博连读研究生招生工作，制定本细则。\n"
                    "第二条 报名时间为2025年12月10日至2026年1月10日。\n"
                ),
                ("campus-rag-derived", temporary_parent.canonical_markdown_object_key): _canonical_markdown(
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
                            "metadata": {"title": "中央民族大学2026年“英才计划”硕博连读研究生招生实施细则"},
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
        )

        self.assertEqual(report.promotion_candidate_count, 2)
        self.assertEqual(report.materialized_document_count, 2)
        target_records = registry.list_by_scope("regulations", "institutional_regulations")
        self.assertEqual(len(target_records), 2)

        uploads_by_key = {
            str(upload["key"]): upload for upload in object_store.uploads if str(upload["key"]).endswith(".jsonl")
        }
        metadata_by_title = {}
        for record in target_records:
            rows = _document_rows(uploads_by_key[record.document_units_object_key or ""])
            metadata_by_title[rows[0]["metadata"]["title"]] = rows[0]["metadata"]

        annual_metadata = metadata_by_title["中央民族大学2026年“英才计划”硕博连读研究生招生实施细则"]
        self.assertEqual(annual_metadata["document_nature"], "annual_cycle_rule")
        self.assertEqual(annual_metadata["promotion_class"], "formal_regulation")
        self.assertEqual(annual_metadata["source_notice_ids"], ["200005"])

        temporary_metadata = metadata_by_title["中央民族大学丰台校区就医管理办法（暂行）"]
        self.assertEqual(temporary_metadata["document_nature"], "time_bound_operational_rule")
        self.assertEqual(temporary_metadata["promotion_class"], "formal_regulation")
        self.assertEqual(temporary_metadata["source_notice_ids"], ["200003"])


if __name__ == "__main__":
    unittest.main()
