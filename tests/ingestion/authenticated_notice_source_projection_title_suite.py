from __future__ import annotations

import unittest

from .authenticated_notice_source_projection_test_support import *  # noqa: F401,F403


class AuthenticatedNoticeAttachmentTitleTest(unittest.TestCase):
    def test_build_attachment_title_prefers_short_anchor_text_without_parent_title(self) -> None:
        title = _build_attachment_title(
            notice_title="关于2025年度研究生课程建设与教改项目拔尖创新人才“证书项目”学生招募报名的通知",
            attachment_ref={
                "ref_order": 1,
                "anchor_text": "中央民族大学拔尖创新人才培养 “证书项目”报名表",
                "final_url": "https://grs.pku.edu.cn/docs/2024-09/20240902093935948023.docx",
            },
            filename="20240902093935948023.docx",
        )

        self.assertEqual(title, "附件 1 / 中央民族大学拔尖创新人才培养 “证书项目”报名表")

    def test_build_attachment_title_drops_url_and_uuid_like_filename(self) -> None:
        title = _build_attachment_title(
            notice_title="【更新】关于举办2025年北京市大学生人文知识竞赛中央民族大学校内选拔赛的通知",
            attachment_ref={
                "ref_order": 4,
                "final_url": (
                    "https://my.muc.edu.cn/comsys-portal-notice-web/upload/ueditor/202599/"
                    "8be77b50-361d-4386-bfd3-281e34f93a9e.png"
                ),
            },
            filename="8be77b50-361d-4386-bfd3-281e34f93a9e.png",
        )

        self.assertEqual(title, "附件 4")

    def test_build_attachment_title_strips_plain_attachment_prefix_without_numeric_suffix(
        self,
    ) -> None:
        title = _build_attachment_title(
            notice_title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
            attachment_ref={
                "ref_order": 1,
                "anchor_text": "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
                "final_url": (
                    "https://my.muc.edu.cn/comsys-portal-notice-web/download"
                    "?id=c46da95c-464c-4faf-8415-11974c33d3a4&notice_id=355282"
                ),
            },
            filename="中央民族大学关于学生使用人工智能的指导意见（2026版）.docx",
        )

        self.assertEqual(
            title, "附件 1 / 中央民族大学关于学生使用人工智能的指导意见（2026版）.docx"
        )
