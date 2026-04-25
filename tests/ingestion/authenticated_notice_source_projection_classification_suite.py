from __future__ import annotations

import unittest

from .authenticated_notice_source_projection_test_support import *


class AuthenticatedNoticeAttachmentClassificationTest(unittest.TestCase):
    def test_classify_attachment_ref_prefers_extension_bearing_fields_over_download_url_slug(
        self,
    ) -> None:
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        result = _classify_attachment_ref(
            attachment_ref={
                "attachment_ref_id": "attachment-0001",
                "final_url": (
                    "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                    "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                ),
                "source_url": (
                    "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                    "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                ),
                "normalized_source_url": (
                    "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                    "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                ),
                "anchor_text": "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
                "object_key": (
                    "attachments/1d/1df2ea505dc7e5db04474fa3de2c44726de158e6fb215b55ce86ed375b508735/"
                    "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx"
                ),
                "content_sha256": "1df2ea505dc7e5db04474fa3de2c44726de158e6fb215b55ce86ed375b508735",
                "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "byte_size": 331494,
            },
            config=config,
        )

        self.assertEqual(result.classification, "text_extractable")

    def test_classify_attachment_ref_routes_xlsx_to_text_extractable(self) -> None:
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        result = _classify_attachment_ref(
            attachment_ref={
                "attachment_ref_id": "attachment-0001",
                "final_url": "https://portal.example.edu/files/course-plan.xlsx",
                "source_url": "https://portal.example.edu/files/course-plan.xlsx",
                "normalized_source_url": "https://portal.example.edu/files/course-plan.xlsx",
                "anchor_text": "培养方案明细.xlsx",
                "object_key": ("attachments/aa/aabbccddeeff00112233445566778899/course-plan.xlsx"),
                "content_sha256": "aabbccddeeff00112233445566778899",
                "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "byte_size": 2048,
            },
            config=config,
        )

        self.assertEqual(result.classification, "text_extractable")

    def test_classify_attachment_ref_routes_xls_to_text_extractable(self) -> None:
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        result = _classify_attachment_ref(
            attachment_ref={
                "attachment_ref_id": "attachment-0001",
                "final_url": "https://portal.example.edu/files/course-plan.xls",
                "source_url": "https://portal.example.edu/files/course-plan.xls",
                "normalized_source_url": "https://portal.example.edu/files/course-plan.xls",
                "anchor_text": "培养方案明细.xls",
                "object_key": "attachments/bb/bbccddeeff00112233445566778899/course-plan.xls",
                "content_sha256": "bbccddeeff00112233445566778899",
                "mime_type": "application/vnd.ms-excel",
                "byte_size": 2048,
            },
            config=config,
        )

        self.assertEqual(result.classification, "text_extractable")

    def test_classify_attachment_ref_routes_doc_to_text_extractable(self) -> None:
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        result = _classify_attachment_ref(
            attachment_ref={
                "attachment_ref_id": "attachment-0001",
                "final_url": "https://portal.example.edu/files/legacy-rule.doc",
                "source_url": "https://portal.example.edu/files/legacy-rule.doc",
                "normalized_source_url": "https://portal.example.edu/files/legacy-rule.doc",
                "anchor_text": "历史制度正文.doc",
                "object_key": "attachments/cc/ccddeeff00112233445566778899aa/legacy-rule.doc",
                "content_sha256": "ccddeeff00112233445566778899aa",
                "mime_type": "application/msword",
                "byte_size": 8192,
            },
            config=config,
        )

        self.assertEqual(result.classification, "text_extractable")

    def test_attachment_projection_plan_carries_attachment_content_sha256(self) -> None:
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )
        plans = build_authenticated_notice_attachment_projection_plans(
            parent_document_id="notice:muc_internal_portal:355282",
            attachment_refs=(
                {
                    "attachment_ref_id": "attachment-0001",
                    "final_url": (
                        "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                        "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                    ),
                    "source_url": (
                        "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                        "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                    ),
                    "normalized_source_url": (
                        "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                        "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                    ),
                    "anchor_text": "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
                    "object_key": (
                        "attachments/1d/1df2ea505dc7e5db04474fa3de2c44726de158e6fb215b55ce86ed375b508735/"
                        "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx"
                    ),
                    "content_sha256": "1df2ea505dc7e5db04474fa3de2c44726de158e6fb215b55ce86ed375b508735",
                    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "byte_size": 331494,
                },
            ),
            config=config,
        )

        self.assertEqual(len(plans), 1)
        self.assertEqual(
            plans[0]["attachment_content_sha256"],
            "1df2ea505dc7e5db04474fa3de2c44726de158e6fb215b55ce86ed375b508735",
        )

    def test_attachment_projection_plan_accepts_downloaded_doc_with_legacy_office_extractor(
        self,
    ) -> None:
        config = load_authenticated_notice_source_projections_config(
            Path(__file__).resolve().parents[2]
            / "configs/ingestion/campus_notices/internal_notice/source-projections.v1.json"
        )

        plans = build_authenticated_notice_attachment_projection_plans(
            parent_document_id="notice:muc_internal_portal:355282",
            attachment_refs=(
                {
                    "attachment_ref_id": "attachment-0009",
                    "final_url": "https://portal.example.edu/files/legacy-rule.doc",
                    "source_url": "https://portal.example.edu/files/legacy-rule.doc",
                    "normalized_source_url": "https://portal.example.edu/files/legacy-rule.doc",
                    "anchor_text": "历史制度正文.doc",
                    "object_key": ("attachments/cc/ccddeeff00112233445566778899aa/legacy-rule.doc"),
                    "content_sha256": "ccddeeff00112233445566778899aa",
                    "mime_type": "application/msword",
                    "byte_size": 8192,
                },
            ),
            config=config,
        )

        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0]["classification"], "text_extractable")
        self.assertEqual(plans[0]["materialization_policy"], "required_document")
