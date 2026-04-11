from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_candidate_artifact_manifest,
    build_internal_notice_regulation_promotion_manifest,
    export_internal_notice_regulation_candidate_artifacts,
    extract_internal_notice_parent_regulation_body_preview,
)


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


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
        is_current=True,
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


class InternalNoticeRegulationPromotionTest(unittest.TestCase):
    def test_extract_parent_notice_preview_strips_wrapper_boilerplate_for_procurement_notice(self) -> None:
        preview = extract_internal_notice_parent_regulation_body_preview(
            "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n"
            "学校各单位、各部门：\n\n"
            "为进一步规范采购与招标管理工作，优化资源配置，提升工作效率，提高采购质量，我校于2021年2月28日印发了《中央民族大学采购工作管理办法》（民大校发〔2021〕10号文），对原有采购管理办法进行了修订，现将有关事项通知如下：\n\n"
            "一、主要修订内容\n\n"
            "（一）、校内集中采购限额标准及范围调整\n\n"
            "工程、货物（不含进口货物）、服务校内集中采购限额标准，统一调整到20万元（含）以上。\n\n"
            "二、采购注意事项\n\n"
            "（一）采购意向公示要求\n\n"
            "1. 为进一步提高政府采购透明度，根据《关于开展政府采购意向公开工作的通知》要求，必须在项目采购活动开始前35日将采购意向公开文件发送至指定邮箱。\n\n"
            "特此通知。\n\n"
            "附件：采购意向公开参考文本\n\n"
            "资产管理处（招标采购中心）\n\n"
            "2021年2月28日\n",
            source_title="关于修订《中央民族大学采购工作管理办法》的通知",
        )

        self.assertEqual(preview.regulation_title_normalized, "中央民族大学采购工作管理办法")
        self.assertTrue(preview.wrapper_semantics_removed)
        self.assertTrue(preview.standalone_body_quality_passed)
        self.assertTrue(preview.regulation_structure_retained)
        self.assertTrue(preview.promotable_standalone_body)
        self.assertTrue(preview.cleaned_body.startswith("一、主要修订内容"))
        self.assertNotIn("学校各单位、各部门", preview.cleaned_body)
        self.assertNotIn("现将有关事项通知如下", preview.cleaned_body)
        self.assertNotIn("特此通知", preview.cleaned_body)
        self.assertNotIn("附件：采购意向公开参考文本", preview.cleaned_body)

    def test_extract_parent_notice_preview_keeps_summary_notice_non_promotable(self) -> None:
        preview = extract_internal_notice_parent_regulation_body_preview(
            "# 关于印发实施《中央民族大学学生申诉管理办法》的通知\n\n"
            "各学院：\n\n"
            "《中央民族大学学生申诉管理办法》已经于2019年12月25日经学校校长办公会议审议通过，自2020年1月1日起施行。本办法调整了学校学生申诉处理委员会成员构成，学生申诉处理委员会办公室设在校长办公室。\n\n"
            "特此通知，请遵照执行。\n\n"
            "党委学生工作部、学生处\n\n"
            "2020年1月7日\n",
            source_title="关于印发实施《中央民族大学学生申诉管理办法》的通知",
        )

        self.assertEqual(preview.regulation_title_normalized, "中央民族大学学生申诉管理办法")
        self.assertTrue(preview.wrapper_semantics_removed)
        self.assertFalse(preview.regulation_structure_retained)
        self.assertFalse(preview.promotable_standalone_body)
        self.assertIn("《中央民族大学学生申诉管理办法》已经于2019年12月25日", preview.cleaned_body)
        self.assertNotIn("各学院：", preview.cleaned_body)
        self.assertNotIn("特此通知", preview.cleaned_body)

    def test_build_manifest_prefers_attachment_candidates_holds_wrappers_and_flags_duplicates(self) -> None:
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
        )

        registry = InMemoryDocumentRegistry((parent_1, attachment_1, parent_2, attachment_2, parent_3))
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
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n"
                ),
                ("campus-rag-derived", parent_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）\n\n请相关单位参照附件执行。\n"
                ),
                ("campus-rag-derived", attachment_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n"
                ),
                ("campus-rag-derived", parent_3.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学实验室安全管理规定（2026年修订）\n\n2026年2月1日起施行。\n\n第一条 为加强实验室安全管理，制定本规定。\n第二条 实验室实行分级分类安全管理。\n第三条 各实验室应建立日常巡检制度。\n"
                ),
                ("campus-rag-derived", parent_1.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                            "metadata": {"title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"},
                        }
                    ]
                ),
                ("campus-rag-derived", attachment_1.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "attachment_title",
                            "text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "metadata": {"extraction_class": "text_extractable"},
                        }
                    ]
                ),
                ("campus-rag-derived", parent_2.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）",
                            "metadata": {"title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）"},
                        }
                    ]
                ),
                ("campus-rag-derived", attachment_2.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "attachment_title",
                            "text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "metadata": {"extraction_class": "text_extractable"},
                        }
                    ]
                ),
                ("campus-rag-derived", parent_3.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "中央民族大学实验室安全管理规定（2026年修订）",
                            "metadata": {"title": "中央民族大学实验室安全管理规定（2026年修订）"},
                        }
                    ]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(report.candidate_count, 2)
        self.assertEqual(report.hold_count, 3)
        self.assertEqual(report.manual_review_count, 0)
        self.assertEqual(report.promotion_class_counts["formal_regulation"], 3)
        self.assertEqual(report.promotion_class_counts["wrapper_notice_only"], 2)

        reports_by_id = {item.document_id: item for item in report.documents}
        self.assertEqual(reports_by_id[parent_1.document_id].action, "hold_in_internal_notice")
        self.assertEqual(reports_by_id[parent_1.document_id].promotion_class, "wrapper_notice_only")

        primary_attachment = reports_by_id[attachment_1.document_id]
        self.assertEqual(primary_attachment.action, "promote_candidate")
        self.assertEqual(primary_attachment.promotion_class, "formal_regulation")
        self.assertEqual(primary_attachment.input_lane, "attachment_text_extractable")
        self.assertEqual(
            primary_attachment.regulation_title_normalized,
            "中央民族大学关于学生使用人工智能的指导意见（2026版）",
        )
        self.assertIn("duplicate_check_passed", primary_attachment.quality_gates_passed)

        duplicate_attachment = reports_by_id[attachment_2.document_id]
        self.assertEqual(duplicate_attachment.action, "hold_in_internal_notice")
        self.assertEqual(duplicate_attachment.duplicate_primary_document_id, attachment_1.document_id)
        self.assertEqual(duplicate_attachment.source_attachment_sha256, "sha256-guideline")

        manual_parent = reports_by_id[parent_3.document_id]
        self.assertEqual(manual_parent.action, "promote_candidate")
        self.assertEqual(manual_parent.promotion_class, "formal_regulation")
        self.assertEqual(manual_parent.input_lane, "notice_body")
        self.assertNotIn("source_attachment_ref_id", manual_parent.missing_required_metadata)
        self.assertNotIn("source_attachment_sha256", manual_parent.missing_required_metadata)
        self.assertEqual(
            manual_parent.regulation_title_normalized,
            "中央民族大学实验室安全管理规定（2026年修订）",
        )
        self.assertEqual(manual_parent.effective_date, "2026年2月1日")
        self.assertEqual(manual_parent.revision_signal, "修订")

    def test_build_manifest_flags_incomplete_wrapper_notice_snapshot_when_attachment_docs_are_missing(self) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200001",
            source_uri="https://portal.example.edu/notices/200001",
            canonical_key="campus_notices/documents/internal_notice/200001/canonical.md",
            units_key="campus_notices/documents/internal_notice/200001/document-units.jsonl",
            content_hash="sha256:parent-200001",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200001",
                    notice_title="关于发布《中央民族大学本科生综合测评办法》的通知",
                    attachment_projection_plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": "notice_attachment:muc_internal_portal:200001:attachment-0001",
                            "materialization_policy": "required_document",
                            "attachment_content_sha256": "sha256-measure",
                        },
                    ),
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学本科生综合测评办法》的通知\n\n现将《中央民族大学本科生综合测评办法》予以发布，请遵照执行。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于发布《中央民族大学本科生综合测评办法》的通知",
                            "metadata": {"title": "关于发布《中央民族大学本科生综合测评办法》的通知"},
                        }
                    ]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(report.candidate_count, 0)
        self.assertEqual(report.hold_count, 0)
        self.assertEqual(report.manual_review_count, 1)
        document_report = report.documents[0]
        self.assertEqual(document_report.document_id, parent.document_id)
        self.assertEqual(document_report.action, "manual_review_required")
        self.assertEqual(document_report.promotion_class, "manual_promotion_review")
        self.assertIn("input_incomplete_missing_attachment_docs", document_report.reasons)

    def test_build_manifest_keeps_wrapper_notice_summary_in_internal_notice_without_body_structure(self) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200002",
            source_uri="https://portal.example.edu/notices/200002",
            canonical_key="campus_notices/documents/internal_notice/200002/canonical.md",
            units_key="campus_notices/documents/internal_notice/200002/document-units.jsonl",
            content_hash="sha256:parent-200002",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200002",
                    notice_title="关于印发实施《中央民族大学学生申诉管理办法》的通知",
                    published_date="2020-01-07",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于印发实施《中央民族大学学生申诉管理办法》的通知\n\n各学院：\n\n《中央民族大学学生申诉管理办法》已经审议通过，自2020年1月1日起施行。本办法调整了学校学生申诉处理委员会成员构成。\n\n特此通知，请遵照执行。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于印发实施《中央民族大学学生申诉管理办法》的通知",
                            "metadata": {"title": "关于印发实施《中央民族大学学生申诉管理办法》的通知"},
                        }
                    ]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(report.candidate_count, 0)
        self.assertEqual(report.hold_count, 1)
        self.assertEqual(report.manual_review_count, 0)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "hold_in_internal_notice")
        self.assertEqual(document_report.promotion_class, "wrapper_notice_only")

    def test_build_manifest_uses_wrapper_stripping_for_parent_notice_candidates(self) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200006",
            source_uri="https://portal.example.edu/notices/200006",
            canonical_key="campus_notices/documents/internal_notice/200006/canonical.md",
            units_key="campus_notices/documents/internal_notice/200006/document-units.jsonl",
            content_hash="sha256:parent-200006",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200006",
                    notice_title="关于修订《中央民族大学采购工作管理办法》的通知",
                    published_date="2021-02-28",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n"
                    "学校各单位、各部门：\n\n"
                    "为进一步规范采购与招标管理工作，我校于2021年2月28日印发了《中央民族大学采购工作管理办法》，现将有关事项通知如下：\n\n"
                    "一、主要修订内容\n\n"
                    "（一）校内集中采购限额标准及范围调整\n\n"
                    "工程、货物、服务校内集中采购限额标准统一调整到20万元（含）以上，校内集中采购范围还包括纳入政府集中采购目录的采购项目以及进口货物采购项目。\n\n"
                    "二、采购注意事项\n\n"
                    "（一）采购意向公示要求\n\n"
                    "1. 为进一步提高政府采购透明度，项目采购活动开始前35日必须提交采购意向公开文件。\n\n"
                    "特此通知。\n\n"
                    "附件：采购意向公开参考文本\n\n"
                    "资产管理处（招标采购中心）\n\n"
                    "2021年2月28日\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于修订《中央民族大学采购工作管理办法》的通知",
                            "metadata": {"title": "关于修订《中央民族大学采购工作管理办法》的通知"},
                        }
                    ]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        document_report = report.documents[0]
        self.assertEqual(document_report.action, "promote_candidate")
        self.assertEqual(document_report.promotion_class, "formal_regulation")
        self.assertIn("wrapper_semantics_removed", document_report.quality_gates_passed)
        self.assertIn("standalone_body_quality_passed", document_report.quality_gates_passed)
        self.assertNotIn("wrapper_semantics_still_present", document_report.reasons)

    def test_build_manifest_prefers_notice_release_time_from_inventory_snapshot(self) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200007",
            source_uri="https://portal.example.edu/notices/200007",
            canonical_key="campus_notices/documents/internal_notice/200007/canonical.md",
            units_key="campus_notices/documents/internal_notice/200007/document-units.jsonl",
            content_hash="sha256:parent-200007",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200007",
                    notice_title="中央民族大学实验室安全管理规定",
                    published_date="2021-02-28",
                    notice_release_time="2021-02-28 16:09",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学实验室安全管理规定\n\n第一条 为加强实验室安全管理，制定本规定。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "中央民族大学实验室安全管理规定",
                            "metadata": {"title": "中央民族大学实验室安全管理规定"},
                        }
                    ]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        document_report = report.documents[0]
        self.assertEqual(document_report.source_notice_release_time, "2021-02-28 16:09")
        self.assertNotIn("source_notice_release_time", document_report.missing_required_metadata)

    def test_build_manifest_keeps_time_bound_and_admission_regulations_in_manual_review_without_using_provisional_title_alone(self) -> None:
        temporary_parent = _record(
            document_id="notice:muc_internal_portal:200003",
            source_uri="https://portal.example.edu/notices/200003",
            canonical_key="campus_notices/documents/internal_notice/200003/canonical.md",
            units_key="campus_notices/documents/internal_notice/200003/document-units.jsonl",
            content_hash="sha256:parent-200003",
        )
        seasonal_parent = _record(
            document_id="notice:muc_internal_portal:200004",
            source_uri="https://portal.example.edu/notices/200004",
            canonical_key="campus_notices/documents/internal_notice/200004/canonical.md",
            units_key="campus_notices/documents/internal_notice/200004/document-units.jsonl",
            content_hash="sha256:parent-200004",
        )
        admission_parent = _record(
            document_id="notice:muc_internal_portal:200005",
            source_uri="https://portal.example.edu/notices/200005",
            canonical_key="campus_notices/documents/internal_notice/200005/canonical.md",
            units_key="campus_notices/documents/internal_notice/200005/document-units.jsonl",
            content_hash="sha256:parent-200005",
        )
        registry = InMemoryDocumentRegistry((temporary_parent, seasonal_parent, admission_parent))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200003",
                    notice_title="中央民族大学丰台校区就医管理办法（暂行）",
                ),
                _inventory_entry(
                    notice_id="200004",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                ),
                _inventory_entry(
                    notice_id="200005",
                    notice_title="中央民族大学2026年“英才计划”硕博连读研究生招生实施细则",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", temporary_parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学丰台校区就医管理办法（暂行）\n\n一、就医医院\n\n1. 增加合同医院。\n2. 临时医疗点负责首诊。\n"
                ),
                ("campus-rag-derived", seasonal_parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n一、基本要求\n\n1. 暑假期间实验须两人以上同时在场。\n2. 假期期间严禁在实验室食宿。\n"
                ),
                ("campus-rag-derived", admission_parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学2026年“英才计划”硕博连读研究生招生实施细则\n\n一、选拔对象\n\n1. 符合条件的硕士研究生。\n\n二、网上报名\n\n1. 报名时间：2025年12月10日至2026年1月10日。\n"
                ),
                ("campus-rag-derived", temporary_parent.document_units_object_key): _document_units(
                    [{"chunk_id": "title", "unit_type": "policy_page", "text": "中央民族大学丰台校区就医管理办法（暂行）", "metadata": {}}]
                ),
                ("campus-rag-derived", seasonal_parent.document_units_object_key): _document_units(
                    [{"chunk_id": "title", "unit_type": "policy_page", "text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定", "metadata": {}}]
                ),
                ("campus-rag-derived", admission_parent.document_units_object_key): _document_units(
                    [{"chunk_id": "title", "unit_type": "policy_page", "text": "中央民族大学2026年“英才计划”硕博连读研究生招生实施细则", "metadata": {}}]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(report.candidate_count, 0)
        self.assertEqual(report.hold_count, 0)
        self.assertEqual(report.manual_review_count, 3)
        reports_by_id = {item.document_id: item for item in report.documents}
        temporary_report = reports_by_id[temporary_parent.document_id]
        self.assertEqual(temporary_report.action, "manual_review_required")
        self.assertEqual(temporary_report.promotion_class, "manual_promotion_review")
        self.assertIn("time_bound_operational_rule_detected", temporary_report.reasons)
        self.assertNotIn("draft_signal_detected", temporary_report.reasons)

        seasonal_report = reports_by_id[seasonal_parent.document_id]
        self.assertEqual(seasonal_report.action, "manual_review_required")
        self.assertEqual(seasonal_report.promotion_class, "manual_promotion_review")
        self.assertIn("time_bound_operational_rule_detected", seasonal_report.reasons)

        admission_report = reports_by_id[admission_parent.document_id]
        self.assertEqual(admission_report.action, "manual_review_required")
        self.assertEqual(admission_report.promotion_class, "manual_promotion_review")
        self.assertIn("annual_cycle_or_program_rule_detected", admission_report.reasons)

    def test_build_manifest_allows_provisional_regulations_without_explicit_temporary_body_signals(self) -> None:
        provisional_parent = _record(
            document_id="notice:muc_internal_portal:200009",
            source_uri="https://portal.example.edu/notices/200009",
            canonical_key="campus_notices/documents/internal_notice/200009/canonical.md",
            units_key="campus_notices/documents/internal_notice/200009/document-units.jsonl",
            content_hash="sha256:parent-200009",
        )
        registry = InMemoryDocumentRegistry((provisional_parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200009",
                    notice_title="中央民族大学学生资助管理暂行办法",
                    published_date="2021-09-10",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", provisional_parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学学生资助管理暂行办法\n\n"
                    "第一条 为规范学生资助工作，制定本办法。\n"
                    "第二条 学校建立学生资助工作统筹机制。\n"
                    "第三条 各培养单位负责落实资助政策。\n"
                ),
                ("campus-rag-derived", provisional_parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "中央民族大学学生资助管理暂行办法",
                            "metadata": {"title": "中央民族大学学生资助管理暂行办法"},
                        }
                    ]
                ),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(report.candidate_count, 1)
        self.assertEqual(report.manual_review_count, 0)
        provisional_report = report.documents[0]
        self.assertEqual(provisional_report.action, "promote_candidate")
        self.assertEqual(provisional_report.promotion_class, "formal_regulation")
        self.assertEqual(provisional_report.regulation_title_normalized, "中央民族大学学生资助管理暂行办法")
        self.assertNotIn("time_bound_operational_rule_detected", provisional_report.reasons)

    def test_export_candidate_artifacts_writes_local_only_cleaned_markdown_for_parent_candidate(self) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200008",
            source_uri="https://portal.example.edu/notices/200008",
            canonical_key="campus_notices/documents/internal_notice/200008/canonical.md",
            units_key="campus_notices/documents/internal_notice/200008/document-units.jsonl",
            content_hash="sha256:parent-200008",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200008",
                    notice_title="关于修订《中央民族大学采购工作管理办法》的通知",
                    published_date="2021-02-28",
                    notice_release_time="2021-02-28 16:09",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于修订《中央民族大学采购工作管理办法》的通知\n\n"
                    "学校各单位、各部门：\n\n"
                    "为进一步规范采购与招标管理工作，我校于2021年2月28日印发了《中央民族大学采购工作管理办法》，现将有关事项通知如下：\n\n"
                    "一、主要修订内容\n\n"
                    "（一）校内集中采购限额标准及范围调整\n\n"
                    "工程、货物、服务校内集中采购限额标准统一调整到20万元（含）以上。\n\n"
                    "二、采购注意事项\n\n"
                    "（一）采购意向公示要求\n\n"
                    "1. 项目采购活动开始前35日必须提交采购意向公开文件。\n\n"
                    "特此通知。\n\n"
                    "附件：采购意向公开参考文本\n\n"
                    "资产管理处（招标采购中心）\n\n"
                    "2021年2月28日\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于修订《中央民族大学采购工作管理办法》的通知",
                            "metadata": {"title": "关于修订《中央民族大学采购工作管理办法》的通知"},
                        }
                    ]
                ),
            }
        )

        manifest, documents = build_internal_notice_regulation_candidate_artifact_manifest(
            request=InternalNoticeRegulationPromotionRequest(notice_ids=("200008",)),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(manifest.exported_candidate_count, 1)
        self.assertEqual(documents[0].source_notice_release_time, "2021-02-28 16:09")
        self.assertEqual(documents[0].entitlement_groups, ("campus_members",))
        self.assertEqual(documents[0].visibility_scope, "campus")
        self.assertEqual(documents[0].visibility_level, "restricted")
        self.assertEqual(documents[0].embedding_model, "Qwen3-Embedding-4B")
        self.assertTrue(documents[0].artifact_markdown_path.endswith("/canonical.md"))
        self.assertNotIn("学校各单位、各部门", documents[0].promotion_body)
        self.assertNotIn("特此通知", documents[0].promotion_body)
        self.assertIn("一、主要修订内容", documents[0].promotion_body)

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            manifest_path, documents_path = export_internal_notice_regulation_candidate_artifacts(
                output_dir=output_dir,
                manifest=manifest,
                documents=documents,
            )
            self.assertTrue(manifest_path.exists())
            self.assertTrue(documents_path.exists())
            markdown_path = output_dir / documents[0].artifact_markdown_path
            markdown = markdown_path.read_text(encoding="utf-8")
            self.assertIn("# 中央民族大学采购工作管理办法", markdown)
            self.assertIn("source_notice_release_time: 2021-02-28 16:09", markdown)
            self.assertIn("一、主要修订内容", markdown)
            self.assertNotIn("学校各单位、各部门", markdown)
            self.assertNotIn("特此通知", markdown)


if __name__ == "__main__":
    unittest.main()
