from __future__ import annotations

import unittest

from .internal_notice_regulation_promotion_test_support import *


class InternalNoticeRegulationPromotionManifestOwnerSourceTest(unittest.TestCase):
    def test_build_manifest_fail_closes_attachment_backed_wrapper_notice_without_recovered_attachment_source(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200010",
            source_uri="https://portal.example.edu/notices/200010",
            canonical_key="campus_notices/documents/internal_notice/200010/canonical.md",
            units_key="campus_notices/documents/internal_notice/200010/document-units.jsonl",
            content_hash="sha256:parent-200010",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200010",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                    published_date="2026-03-27",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知\n\n"
                    "各教学单位、各位同学：\n\n"
                    "为了规范学生使用人工智能辅助开展学术活动的行为，教务处和研究生院联合编制了《中央民族大学关于学生使用人工智能的指导意见（2026版）》。请各单位通知本单位学生遵照执行。\n\n"
                    "说明的具体格式参见《中央民族大学关于学生使用人工智能的指导意见（2026版）》附件。\n\n"
                    "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n"
                    "教务处、研究生院\n\n"
                    "2026年3月27日\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                            "metadata": {
                                "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"
                            },
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
        self.assertEqual(report.machine_processing_required_count, 1)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "requires_multimodal_processing")
        self.assertEqual(document_report.promotion_class, "machine_processing_required")
        self.assertIn("attachment_backed_regulation_body_missing", document_report.reasons)
        self.assertEqual(document_report.semantic_owner_kind, "attachment_document")
        self.assertEqual(
            document_report.owner_source_missing_reason,
            "attachment_backed_regulation_body_missing",
        )

    def test_build_manifest_prefers_explicit_owner_expectation_for_attachment_backed_wrapper_notice(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200012",
            source_uri="https://portal.example.edu/notices/200012",
            canonical_key="campus_notices/documents/internal_notice/200012/canonical.md",
            units_key="campus_notices/documents/internal_notice/200012/document-units.jsonl",
            content_hash="sha256:parent-200012",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200012",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                    owner_expectations=(
                        {
                            "owner_expectation_id": "owner-expectation-0001",
                            "owner_kind": "attachment_document",
                            "relation_type": "attachment_ref",
                            "evidence_reason": "attachment_anchor_detected",
                            "owner_title_hint": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "evidence_text": "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）",
                        },
                    ),
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知\n\n"
                    "各教学单位、各位同学：\n\n"
                    "现将《中央民族大学关于学生使用人工智能的指导意见（2026版）》予以发布，请遵照执行。\n\n"
                    "具体正文详见附件。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                            "metadata": {
                                "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"
                            },
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
        self.assertEqual(report.machine_processing_required_count, 1)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "requires_multimodal_processing")
        self.assertIn("attachment_backed_regulation_body_missing", document_report.reasons)
        self.assertEqual(document_report.semantic_owner_kind, "attachment_document")

    def test_build_manifest_fail_closes_file_release_backed_wrapper_notice_without_recovered_owner_document(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200011",
            source_uri="https://portal.example.edu/notices/200011",
            canonical_key="campus_notices/documents/internal_notice/200011/canonical.md",
            units_key="campus_notices/documents/internal_notice/200011/document-units.jsonl",
            content_hash="sha256:parent-200011",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200011",
                    notice_title="关于《中央民族大学差旅费管理办法》发布实施的通知",
                    published_date="2025-07-09",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于《中央民族大学差旅费管理办法》发布实施的通知\n\n"
                    "各单位、各部门：\n\n"
                    "为加强学校国内差旅费管理，学校对《中央民族大学差旅费管理办法》进行了修订，现已经审议通过，自2025年7月1日起实施。\n\n"
                    "修订后的文件见信息门户-文件发布，请各单位自行下载参照执行。\n\n"
                    "财务处\n\n"
                    "2025年7月9日\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于《中央民族大学差旅费管理办法》发布实施的通知",
                            "metadata": {
                                "title": "关于《中央民族大学差旅费管理办法》发布实施的通知"
                            },
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
        self.assertEqual(report.machine_processing_required_count, 1)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "requires_multimodal_processing")
        self.assertEqual(document_report.promotion_class, "machine_processing_required")
        self.assertIn("file_release_backed_regulation_body_missing", document_report.reasons)
        self.assertEqual(document_report.semantic_owner_kind, "file_release_document")
        self.assertEqual(
            document_report.owner_source_missing_reason,
            "file_release_backed_regulation_body_missing",
        )
