from __future__ import annotations

import unittest

from .internal_notice_regulation_promotion_test_support import *


class InternalNoticeRegulationPromotionManifestFollowupTest(unittest.TestCase):
    def test_build_manifest_holds_parent_notice_when_wrapper_stripping_leaves_amendment_summary(
        self,
    ) -> None:
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

        self.assertEqual(report.candidate_count, 0)
        self.assertEqual(report.hold_count, 1)
        self.assertEqual(report.machine_processing_required_count, 0)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "hold_in_internal_notice")
        self.assertEqual(document_report.promotion_class, "wrapper_notice_only")
        self.assertEqual(document_report.document_nature, "wrapper_notice")
        self.assertIn("wrapper_semantics_removed", document_report.quality_gates_passed)
        self.assertIn("standalone_body_quality_passed", document_report.quality_gates_passed)
        self.assertIn("parent_notice_body_not_full_regulation_text", document_report.reasons)
        self.assertNotIn("wrapper_semantics_still_present", document_report.reasons)

    def test_build_manifest_holds_parent_notice_when_amendment_summary_mentions_article_numbers(
        self,
    ) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200016",
            source_uri="https://portal.example.edu/notices/200016",
            canonical_key="campus_notices/documents/internal_notice/200016/canonical.md",
            units_key="campus_notices/documents/internal_notice/200016/document-units.jsonl",
            content_hash="sha256:parent-200016",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200016",
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
                    "为进一步规范采购与招标管理工作，现将《中央民族大学采购工作管理办法》主要修订内容通知如下：\n\n"
                    "一、主要修订内容\n\n"
                    "第一条中的校内集中采购限额标准调整为20万元（含）以上。\n\n"
                    "第二条新增采购意向公开要求，项目采购活动开始前35日应提交采购意向公开文件。\n\n"
                    "特此通知。\n\n"
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

        self.assertEqual(report.candidate_count, 0)
        self.assertEqual(report.hold_count, 1)
        self.assertEqual(report.machine_processing_required_count, 0)
        document_report = report.documents[0]
        self.assertEqual(document_report.action, "hold_in_internal_notice")
        self.assertEqual(document_report.promotion_class, "wrapper_notice_only")
        self.assertEqual(document_report.document_nature, "wrapper_notice")
        self.assertIn("parent_notice_body_not_full_regulation_text", document_report.reasons)

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

    def test_build_manifest_promotes_time_bound_and_admission_regulations_with_document_nature_metadata(
        self,
    ) -> None:
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
                    notice_id="200003", notice_title="中央民族大学丰台校区就医管理办法（暂行）"
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
                (
                    "campus-rag-derived",
                    temporary_parent.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学丰台校区就医管理办法（暂行）\n\n一、就医医院\n\n1. 增加合同医院。\n2. 临时医疗点负责首诊。\n"
                ),
                (
                    "campus-rag-derived",
                    seasonal_parent.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n一、基本要求\n\n1. 暑假期间实验须两人以上同时在场。\n2. 假期期间严禁在实验室食宿。\n"
                ),
                (
                    "campus-rag-derived",
                    admission_parent.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学2026年“英才计划”硕博连读研究生招生实施细则\n\n一、选拔对象\n\n1. 符合条件的硕士研究生。\n\n二、网上报名\n\n1. 报名时间：2025年12月10日至2026年1月10日。\n"
                ),
                ("campus-rag-derived", temporary_parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "中央民族大学丰台校区就医管理办法（暂行）",
                            "metadata": {},
                        }
                    ]
                ),
                ("campus-rag-derived", seasonal_parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                            "metadata": {},
                        }
                    ]
                ),
                ("campus-rag-derived", admission_parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "中央民族大学2026年“英才计划”硕博连读研究生招生实施细则",
                            "metadata": {},
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

        self.assertEqual(report.candidate_count, 3)
        self.assertEqual(report.hold_count, 0)
        self.assertEqual(report.machine_processing_required_count, 0)
        reports_by_id = {item.document_id: item for item in report.documents}
        temporary_report = reports_by_id[temporary_parent.document_id]
        self.assertEqual(temporary_report.action, "promote_candidate")
        self.assertEqual(temporary_report.promotion_class, "formal_regulation")
        self.assertEqual(temporary_report.document_nature, "time_bound_operational_rule")
        self.assertEqual(temporary_report.target_collection, "scoped_rules")
        self.assertIn("time_bound_operational_rule_detected", temporary_report.reasons)
        self.assertNotIn("draft_signal_detected", temporary_report.reasons)

        seasonal_report = reports_by_id[seasonal_parent.document_id]
        self.assertEqual(seasonal_report.action, "promote_candidate")
        self.assertEqual(seasonal_report.promotion_class, "formal_regulation")
        self.assertEqual(seasonal_report.document_nature, "time_bound_operational_rule")
        self.assertEqual(seasonal_report.target_collection, "scoped_rules")
        self.assertIn("time_bound_operational_rule_detected", seasonal_report.reasons)

        admission_report = reports_by_id[admission_parent.document_id]
        self.assertEqual(admission_report.action, "promote_candidate")
        self.assertEqual(admission_report.promotion_class, "formal_regulation")
        self.assertEqual(admission_report.document_nature, "annual_cycle_rule")
        self.assertEqual(admission_report.target_collection, "scoped_rules")
        self.assertIn("annual_cycle_or_program_rule_detected", admission_report.reasons)

    def test_build_manifest_prefers_standalone_source_title_over_body_reference_title(self) -> None:
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
                    notice_title="中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则",
                    published_date="2025-12-10",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则\n\n"
                    "根据《中央民族大学2026年博士研究生招生简章》和《关于开展2026年“英才计划”硕博连读研究生招生工作的通知》等文件要求，制定本实施细则。\n\n"
                    "一、选拔对象\n\n"
                    "1. 符合条件的硕士研究生。\n\n"
                    "二、申请条件\n\n"
                    "1. 身体健康状况符合《普通高等学校招生体检工作指导意见》的相关要求。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
                    [
                        {
                            "chunk_id": "title",
                            "unit_type": "policy_page",
                            "text": "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则",
                            "metadata": {
                                "title": "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则"
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

        document_report = report.documents[0]
        self.assertEqual(document_report.action, "promote_candidate")
        self.assertEqual(
            document_report.regulation_title_normalized,
            "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则",
        )
        self.assertEqual(document_report.document_nature, "annual_cycle_rule")

    def test_build_manifest_fail_closes_parent_notice_missing_required_quality_gate(self) -> None:
        parent = _record(
            document_id="notice:muc_internal_portal:200013",
            source_uri="https://portal.example.edu/notices/200013",
            canonical_key="campus_notices/documents/internal_notice/200013/canonical.md",
            units_key="campus_notices/documents/internal_notice/200013/document-units.jsonl",
            content_hash="sha256:parent-200013",
        )
        registry = InMemoryDocumentRegistry((parent,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry(
                    notice_id="200013",
                    notice_title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    published_date="2021-07-16",
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent.canonical_markdown_object_key): _canonical_markdown(
                    "# 生命与环境科学学院关于2021年暑假期间实验室安全管理规定\n\n"
                    "一、基本要求\n\n"
                    "1. 暑假期间实验须两人以上同时在场。\n\n"
                    "请遵照执行。\n"
                ),
                ("campus-rag-derived", parent.document_units_object_key): _document_units(
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

        document_report = report.documents[0]
        self.assertEqual(document_report.action, "requires_multimodal_processing")
        self.assertEqual(document_report.promotion_class, "machine_processing_required")
        self.assertIn("missing_quality_gate:wrapper_semantics_removed", document_report.reasons)

    def test_build_manifest_allows_provisional_regulations_without_explicit_temporary_body_signals(
        self,
    ) -> None:
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
                (
                    "campus-rag-derived",
                    provisional_parent.canonical_markdown_object_key,
                ): _canonical_markdown(
                    "# 中央民族大学学生资助管理暂行办法\n\n"
                    "第一条 为规范学生资助工作，制定本办法。\n"
                    "第二条 学校建立学生资助工作统筹机制。\n"
                    "第三条 各培养单位负责落实资助政策。\n"
                ),
                (
                    "campus-rag-derived",
                    provisional_parent.document_units_object_key,
                ): _document_units(
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
        self.assertEqual(report.machine_processing_required_count, 0)
        provisional_report = report.documents[0]
        self.assertEqual(provisional_report.action, "promote_candidate")
        self.assertEqual(provisional_report.promotion_class, "formal_regulation")
        self.assertEqual(
            provisional_report.regulation_title_normalized, "中央民族大学学生资助管理暂行办法"
        )
        self.assertEqual(
            provisional_report.regulation_work_title, "中央民族大学学生资助管理暂行办法"
        )
        self.assertIsNone(provisional_report.regulation_edition_label)
        self.assertEqual(
            provisional_report.regulation_display_title, "中央民族大学学生资助管理暂行办法"
        )
        self.assertNotIn("time_bound_operational_rule_detected", provisional_report.reasons)
