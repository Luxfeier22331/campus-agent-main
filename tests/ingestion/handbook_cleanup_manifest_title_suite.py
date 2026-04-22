from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *  # noqa: F401,F403


class HandbookCleanupManifestTitleTest(unittest.TestCase):
    def test_cleanup_projects_manifest_range_without_cross_document_bleed(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    1, "heading", "前一篇制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(1, "paragraph", "不应进入本篇"),
                _source_row(
                    2, "heading", "当前制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(2, "paragraph", "第一条 当前制度正文"),
                _source_row(3, "paragraph", "第二条 当前制度续页"),
                _source_row(
                    4, "heading", "后一篇制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(4, "paragraph", "也不应进入本篇"),
            ],
            manifest_document=_manifest_document(2, 3, title="当前制度"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["page_start"], 2)
        self.assertEqual(result.metadata["page_end"], 3)
        self.assertEqual(result.title, "当前制度")
        self.assertNotIn("前一篇制度", result.canonical_markdown)
        self.assertNotIn("后一篇制度", result.canonical_markdown)
        self.assertTrue(all(row["anchor"]["page_start"] >= 2 for row in result.document_units))
        self.assertTrue(all(row["anchor"]["page_end"] <= 3 for row in result.document_units))

    def test_cleanup_keeps_single_page_document_independent(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    5, "heading", "单页制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(5, "paragraph", "第一条 单页制度正文"),
            ],
            manifest_document=_manifest_document(5, 5, title="单页制度"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["page_start"], 5)
        self.assertEqual(result.metadata["page_end"], 5)
        self.assertEqual(len(result.document_units), 1)
        self.assertEqual(result.document_units[0]["unit_type"], "article_body")

    def test_cleanup_extracts_title_from_first_page_heading_candidates(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(10, "header", "学生手册 2026"),
                _source_row(
                    10,
                    "heading",
                    "中央民族大学奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(10, "paragraph", "第一条 为做好奖学金评定工作"),
                _source_row(10, "footer", "10"),
            ],
            manifest_document=_manifest_document(
                10, 10, title="占位标题", handbook_section="中央民族大学学生奖励管理规定"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学奖学金评定办法")

    def test_cleanup_consumes_title_variant_and_metadata_preface_without_emitting_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    10,
                    "heading",
                    "中央民族大学优秀本科毕业生评选办法（试行）",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(10, "paragraph", "民大校发〔2018〕329号"),
                _source_row(10, "paragraph", "第一条 为全面做好优秀本科毕业生评选工作。"),
            ],
            manifest_document=_manifest_document(
                10,
                10,
                title="中央民族大学优秀本科毕业生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学优秀本科毕业生评选办法")
        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["article_body"],
        )
        self.assertEqual(
            result.document_units[0]["metadata"]["title"], "中央民族大学优秀本科毕业生评选办法"
        )
        self.assertEqual(
            result.document_units[0]["metadata"]["policy_doc_no"], "民大校发〔2018〕329号"
        )
        self.assertNotIn("优秀本科毕业生评选办法（试行）", result.document_units[0]["clean_text"])
        self.assertNotIn("民大校发〔2018〕329号", result.document_units[0]["clean_text"])

    def test_cleanup_discards_same_page_rows_before_title_anchor(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    67, "heading", "四、组织管理", block_role="heading", title_candidate_score=0.75
                ),
                _source_row(67, "paragraph", "校团委根据团中央、教育部和学校相关工作要求。"),
                _source_row(
                    68,
                    "heading",
                    "中央民族大学本科生专业调整实施办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(68, "paragraph", "(修订)"),
                _source_row(68, "paragraph", "第一条 本办法适用于学生专业调整。"),
                _source_row(68, "paragraph", "第二条 相关流程由学院执行。"),
            ],
            manifest_document=_manifest_document(
                67,
                68,
                title="中央民族大学本科生专业调整实施办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学本科生专业调整实施办法")
        self.assertNotIn("校团委根据团中央", result.canonical_markdown)
        self.assertNotIn("四、组织管理", result.canonical_markdown)
        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["article_body", "article_body"],
        )

    def test_cleanup_requires_first_page_title_anchor_for_manifest_title(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing title anchor"):
            cleanup_handbook_document(
                structured_rows=[
                    _source_row(
                        67,
                        "heading",
                        "四、组织管理",
                        block_role="heading",
                        title_candidate_score=0.75,
                    ),
                    _source_row(67, "paragraph", "本办法适用于学生专业调整。"),
                    _source_row(68, "paragraph", "第二条 相关流程由学院执行。"),
                ],
                manifest_document=_manifest_document(
                    67,
                    68,
                    title="中央民族大学本科生专业调整实施办法",
                    handbook_section="中央民族大学学生教学管理规定",
                ),
                source_doc="学生手册_2018.pdf",
            )

    def test_cleanup_consumes_multiline_title_anchor_on_later_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    67, "heading", "五、相关说明", block_role="heading", title_candidate_score=0.75
                ),
                _source_row(67, "paragraph", "上一份制度尾页。"),
                _source_row(
                    68,
                    "heading",
                    "中央民族大学本科生专业调整实施办法\n(修订)",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(68, "paragraph", "民大校发[2016]209号"),
                _source_row(68, "paragraph", "第一条 本办法适用于学生专业调整。"),
            ],
            manifest_document=_manifest_document(
                67,
                68,
                title="中央民族大学本科生专业调整实施办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertNotIn("上一份制度尾页", result.canonical_markdown)
        self.assertNotIn(
            "中央民族大学本科生专业调整实施办法\n(修订)", result.document_units[0]["clean_text"]
        )

    def test_cleanup_projects_list_like_sections_into_multiple_policy_pages(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    8,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(8, "paragraph", "校级办公与公共服务"),
                _source_row(8, "paragraph", "校园110 68932220"),
                _source_row(8, "paragraph", "就业工作处"),
                _source_row(8, "paragraph", "就业指导、就业派遣 68932410"),
            ],
            manifest_document=_manifest_document(8, 8, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 2)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["校级办公与公共服务"])
        self.assertEqual(policy_units[1]["anchor"]["section_path"], ["就业工作处"])
        self.assertIn("校园110 68932220", policy_units[0]["clean_text"])
        self.assertIn("就业指导、就业派遣 68932410", policy_units[1]["clean_text"])

    def test_cleanup_falls_back_to_single_policy_page_without_article_or_list_structure(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    8, "heading", "特别说明", block_role="title", title_candidate_score=1.0
                ),
                _source_row(8, "paragraph", "本说明适用于全体学生。"),
                _source_row(8, "paragraph", "请遵守学校统一安排。"),
            ],
            manifest_document=_manifest_document(8, 8, title="特别说明"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["policy_page"])
        self.assertIn("本说明适用于全体学生。", result.document_units[0]["clean_text"])

    def test_cleanup_fixture_update_keeps_document_id_but_changes_version_id(self) -> None:
        stable = cleanup_handbook_document(
            structured_rows=_load_fixture_rows("provider-result-stable.jsonl"),
            manifest_document=_manifest_document(
                1,
                1,
                title="中央民族大学奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )
        updated = cleanup_handbook_document(
            structured_rows=_load_fixture_rows("provider-result-updated.jsonl"),
            manifest_document=_manifest_document(
                1,
                1,
                title="中央民族大学奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(stable.doc_id, updated.doc_id)
        self.assertNotEqual(stable.version_id, updated.version_id)
