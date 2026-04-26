from __future__ import annotations

import unittest

from .internal_notice_regulation_promotion_test_support import *


class InternalNoticeRegulationPromotionManifestTest(unittest.TestCase):
    def test_build_manifest_prefers_attachment_candidates_holds_wrappers_and_flags_duplicates(
        self,
    ) -> None:
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
        attachment_2 = _record(
            document_id="notice_attachment:muc_internal_portal:100002:attachment-0001",
            source_uri="https://portal.example.edu/files/100002.docx",
            canonical_key="campus_notices/documents/internal_notice/100002-attachment-1/canonical.md",
            units_key="campus_notices/documents/internal_notice/100002-attachment-1/document-units.jsonl",
            content_hash="sha256:attachment-guideline-copy",
        )
        parent_2 = _record(
            document_id="notice:muc_internal_portal:100002",
            source_uri="https://portal.example.edu/notices/100002",
            canonical_key="campus_notices/documents/internal_notice/100002/canonical.md",
            units_key="campus_notices/documents/internal_notice/100002/document-units.jsonl",
            content_hash="sha256:parent-100002",
        )
        parent_3 = _record(
            document_id="notice:muc_internal_portal:100003",
            source_uri="https://portal.example.edu/notices/100003",
            canonical_key="campus_notices/documents/internal_notice/100003/canonical.md",
            units_key="campus_notices/documents/internal_notice/100003/document-units.jsonl",
            content_hash="sha256:parent-100003",
        )

        registry = InMemoryDocumentRegistry(
            (parent_1, attachment_1, parent_2, attachment_2, parent_3)
        )
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
                (
                    "campus-rag-derived",
                    attachment_1.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n第一条 为规范学生使用人工智能，制定本指导意见。\n"
                ),
                ("campus-rag-derived", parent_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）\n\n请相关单位参照附件执行。\n"
                ),
                (
                    "campus-rag-derived",
                    attachment_2.canonical_markdown_object_key,
                ): _canonical_markdown(
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
                            "metadata": {
                                "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"
                            },
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
                            "metadata": {
                                "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知（转发）"
                            },
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
        self.assertEqual(report.machine_processing_required_count, 0)
        self.assertEqual(report.promotion_class_counts["formal_regulation"], 3)
        self.assertEqual(report.promotion_class_counts["wrapper_notice_only"], 2)

        reports_by_id = {item.document_id: item for item in report.documents}
        self.assertEqual(reports_by_id[parent_1.document_id].action, "hold_in_internal_notice")
        self.assertEqual(reports_by_id[parent_1.document_id].promotion_class, "wrapper_notice_only")

        primary_attachment = reports_by_id[attachment_1.document_id]
        self.assertEqual(primary_attachment.action, "promote_candidate")
        self.assertEqual(primary_attachment.promotion_class, "formal_regulation")
        self.assertEqual(primary_attachment.semantic_owner_kind, "attachment_document")
        self.assertEqual(primary_attachment.input_lane, "attachment_text_extractable")
        self.assertEqual(
            primary_attachment.regulation_title_normalized,
            "中央民族大学关于学生使用人工智能的指导意见（2026版）",
        )
        self.assertEqual(
            primary_attachment.regulation_work_title, "中央民族大学关于学生使用人工智能的指导意见"
        )
        self.assertEqual(primary_attachment.regulation_edition_label, "2026版")
        self.assertEqual(
            primary_attachment.regulation_display_title,
            "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
        )
        self.assertEqual(
            primary_attachment.source_title_literal,
            "中央民族大学关于学生使用人工智能的指导意见（2026版）",
        )
        self.assertIn("duplicate_check_passed", primary_attachment.quality_gates_passed)

        duplicate_attachment = reports_by_id[attachment_2.document_id]
        self.assertEqual(duplicate_attachment.action, "hold_in_internal_notice")
        self.assertEqual(
            duplicate_attachment.duplicate_primary_document_id, attachment_1.document_id
        )
        self.assertEqual(duplicate_attachment.source_attachment_sha256, "sha256-guideline")

        manual_parent = reports_by_id[parent_3.document_id]
        self.assertEqual(manual_parent.action, "promote_candidate")
        self.assertEqual(manual_parent.promotion_class, "formal_regulation")
        self.assertEqual(manual_parent.semantic_owner_kind, "notice_body")
        self.assertEqual(manual_parent.input_lane, "notice_body")
        self.assertNotIn("source_attachment_ref_id", manual_parent.missing_required_metadata)
        self.assertNotIn("source_attachment_sha256", manual_parent.missing_required_metadata)
        self.assertEqual(
            manual_parent.regulation_title_normalized,
            "中央民族大学实验室安全管理规定（2026年修订）",
        )
        self.assertEqual(manual_parent.regulation_work_title, "中央民族大学实验室安全管理规定")
        self.assertEqual(manual_parent.regulation_edition_label, "2026年修订")
        self.assertEqual(
            manual_parent.regulation_display_title, "中央民族大学实验室安全管理规定 / 2026年修订"
        )
        self.assertEqual(manual_parent.effective_date, "2026年2月1日")
        self.assertEqual(manual_parent.revision_signal, "修订")

    def test_build_manifest_demotes_notice_body_when_only_section_heading_looks_like_title(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:310001",
            source_uri="https://portal.example.edu/notices/310001",
            canonical_key="campus_notices/documents/internal_notice/310001/canonical.md",
            units_key="campus_notices/documents/internal_notice/310001/document-units.jsonl",
            content_hash="sha256:parent-310001",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="310001",
                    notice_title="关于2025-2026学年第一学期本科生网上选课的通知",
                    published_date="2025-09-01",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 关于2025-2026学年第一学期本科生网上选课的通知\n\n"
                    "各学院、各位同学：\n\n"
                    "为全面落实《中央民族大学本科专业人才培养方案（2022版）》和《中央民族大学关于全面加强通识教育课程建设的意见》等相关文件精神，现将2025-2026学年第一学期本科生网上选课有关事项通知如下。\n\n"
                    "一、选课范围\n\n"
                    "2023级、2024级本科生均可参加本轮选课。\n\n"
                    "二、选课时间\n\n"
                    "学生应在规定时段登录系统完成选课。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "关于2025-2026学年第一学期本科生网上选课的通知",
                            "metadata": {"title": "关于2025-2026学年第一学期本科生网上选课的通知"},
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
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "hold_in_internal_notice")
        self.assertEqual(document_report.promotion_class, "wrapper_notice_only")
        self.assertIsNone(document_report.regulation_title_normalized)

    def test_build_manifest_recovers_attachment_sha256_from_source_truth_when_plan_omits_it(
        self,
    ) -> None:
        attachment = _record(
            document_id="notice_attachment:muc_internal_portal:355282:attachment-0001",
            source_uri="https://portal.example.edu/files/355282.docx",
            canonical_key="campus_notices/documents/internal_notice/355282-attachment-1/canonical.md",
            units_key="campus_notices/documents/internal_notice/355282-attachment-1/document-units.jsonl",
            content_hash="sha256:attachment-guideline",
        )
        registry = InMemoryDocumentRegistry((attachment,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="355282",
                    notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                    attachment_projection_plans=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "text_extractable",
                            "document_id": attachment.document_id,
                            "materialization_policy": "required_document",
                        },
                    ),
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    attachment.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学关于学生使用人工智能的指导意见（2026版）\n\n"
                    "第一条 为规范学生使用人工智能，制定本指导意见。\n"
                ),
                ("campus-rag-derived", attachment.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "attachment_title",
                            "text": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                            "metadata": {"extraction_class": "text_extractable"},
                        }
                    ]
                ),
                ("campus-rag-source", "source/355282/attachment-refs.jsonl"): (
                    json.dumps(
                        {
                            "notice_id": "355282",
                            "attachment_ref_id": "attachment-0001",
                            "content_sha256": "sha256-guideline",
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
            }
        )

        report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(),
            registry=registry,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
        )

        self.assertEqual(report.candidate_count, 1)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "promote_candidate")
        self.assertEqual(document_report.source_attachment_sha256, "sha256-guideline")
        self.assertIn("provenance_complete", document_report.quality_gates_passed)
        self.assertNotIn("source_attachment_sha256", document_report.missing_required_metadata)
        self.assertNotIn("effective_date", document_report.missing_required_metadata)

    def test_build_manifest_deduplicates_parent_notice_semantic_body_even_when_source_hash_differs(
        self,
    ) -> None:
        parent_1 = _record(
            document_id="notice:muc_internal_portal:210001",
            source_uri="https://portal.example.edu/notices/210001",
            canonical_key="campus_notices/documents/internal_notice/210001/canonical.md",
            units_key="campus_notices/documents/internal_notice/210001/document-units.jsonl",
            content_hash="sha256:parent-210001",
        )
        parent_2 = _record(
            document_id="notice:muc_internal_portal:210002",
            source_uri="https://portal.example.edu/notices/210002",
            canonical_key="campus_notices/documents/internal_notice/210002/canonical.md",
            units_key="campus_notices/documents/internal_notice/210002/document-units.jsonl",
            content_hash="sha256:parent-210002",
        )
        registry = InMemoryDocumentRegistry((parent_1, parent_2))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="210001",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-12",
                ),
                _inventory_entry(
                    notice_id="210002",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-13",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent_1.canonical_markdown_object_key): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
                    "生环实发【2021】02号\n\n"
                    "根据学校近期关于加强暑假期间安全稳定的有关指示精神，现将2021年暑假期间实验室安全管理规定如下：\n\n"
                    "一、基本要求\n\n"
                    "1. 暑假期间实验须两人以上同时在场。\n\n"
                    "2. 假期期间严禁在实验室食宿。\n\n"
                    "二、安全责任\n\n"
                    "1. 实验室负责人应在放假前完成危险源排查并做好记录。\n\n"
                    "2. 值班教师应保持通讯畅通，发现异常情况立即上报。\n\n"
                    "生命与环境科学学院\n\n"
                    "2021年7月12日\n"
                ),
                ("campus-rag-derived", parent_2.canonical_markdown_object_key): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
                    "生环实发【2021】03号\n\n"
                    "根据学校近期关于加强暑假期间安全稳定的有关指示精神，现将2021年暑假期间实验室安全管理规定如下：\n\n"
                    "一、基本要求\n\n"
                    "1. 暑假期间实验须两人以上同时在场。\n\n"
                    "2. 假期期间严禁在实验室食宿。\n\n"
                    "二、安全责任\n\n"
                    "1. 实验室负责人应在放假前完成危险源排查并做好记录。\n\n"
                    "2. 值班教师应保持通讯畅通，发现异常情况立即上报。\n\n"
                    "生命与环境科学学院\n\n"
                    "2021年7月12日\n"
                ),
                ("campus-rag-derived", parent_1.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                            "metadata": {
                                "title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"
                            },
                        }
                    ]
                ),
                ("campus-rag-derived", parent_2.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                            "metadata": {
                                "title": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定"
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

        self.assertEqual(report.candidate_count, 1)
        self.assertEqual(report.hold_count, 1)
        self.assertEqual(report.machine_processing_required_count, 0)
        reports_by_id = {item.document_id: item for item in report.documents}

        primary_report = reports_by_id[parent_1.document_id]
        self.assertEqual(primary_report.action, "promote_candidate")
        self.assertEqual(primary_report.promotion_class, "formal_regulation")
        self.assertIn("duplicate_check_passed", primary_report.quality_gates_passed)
        self.assertTrue(primary_report.duplicate_group_key.startswith("semantic:"))

        duplicate_report = reports_by_id[parent_2.document_id]
        self.assertEqual(duplicate_report.action, "hold_in_internal_notice")
        self.assertEqual(duplicate_report.duplicate_primary_document_id, parent_1.document_id)
        self.assertEqual(duplicate_report.promotion_class, "formal_regulation")
        self.assertEqual(duplicate_report.duplicate_group_key, primary_report.duplicate_group_key)
        self.assertIn("duplicate_attachment_or_content", duplicate_report.reasons)

    def test_build_manifest_flags_incomplete_wrapper_notice_snapshot_when_attachment_docs_are_missing(
        self,
    ) -> None:
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
                            "metadata": {
                                "title": "关于发布《中央民族大学本科生综合测评办法》的通知"
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
        self.assertEqual(report.hold_count, 0)
        self.assertEqual(report.machine_processing_required_count, 1)
        document_report = report.documents[0]
        self.assertEqual(document_report.document_id, parent.document_id)
        self.assertEqual(document_report.action, "requires_multimodal_processing")
        self.assertEqual(document_report.promotion_class, "machine_processing_required")
        self.assertIn("input_incomplete_missing_attachment_docs", document_report.reasons)

    def test_build_manifest_keeps_wrapper_notice_summary_in_internal_notice_without_body_structure(
        self,
    ) -> None:
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
                            "metadata": {
                                "title": "关于印发实施《中央民族大学学生申诉管理办法》的通知"
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
        self.assertEqual(report.hold_count, 1)
        self.assertEqual(report.machine_processing_required_count, 0)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "hold_in_internal_notice")
        self.assertEqual(document_report.promotion_class, "wrapper_notice_only")
