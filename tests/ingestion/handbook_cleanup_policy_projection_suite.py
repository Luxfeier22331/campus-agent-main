from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *


class HandbookCleanupPolicyProjectionTest(unittest.TestCase):
    def test_cleanup_does_not_carry_transient_list_sections_into_following_article(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    49,
                    "heading",
                    "中央民族大学十佳大学生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    49,
                    "heading",
                    "第三章 评选程序",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(49, "paragraph", "第八条 十佳大学生评选程序"),
                _source_row(49, "paragraph", "1.院系推荐"),
                _source_row(
                    49,
                    "paragraph",
                    "各院系在组织本单位推优及十佳大学生评选工作的基础上向学生工作部报送候选人。",
                ),
                _source_row(49, "paragraph", "2.初选"),
                _source_row(49, "paragraph", "学生工作部组织相关部门人员共同组成评审小组。"),
                _source_row(49, "paragraph", "3.候选人公示"),
                _source_row(
                    49, "paragraph", "中央民族大学十佳大学生候选人在学生工作部网站公示一周。"
                ),
                _source_row(49, "paragraph", "4.评选"),
                _source_row(49, "paragraph", "(1)大力宣传。"),
                _source_row(49, "paragraph", "第九条 中央民族大学十佳大学生每学年评选一次。"),
            ],
            manifest_document=_manifest_document(
                49,
                49,
                title="中央民族大学十佳大学生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 2)
        self.assertIn(
            "十佳大学生评选程序\n1. 院系推荐\n各院系在组织本单位推优及十佳大学生评选工作的基础上向学生工作部报送候选人。",
            article_units[0]["clean_text"],
        )
        self.assertIn(
            "2. 初选\n学生工作部组织相关部门人员共同组成评审小组。", article_units[0]["clean_text"]
        )
        self.assertEqual(article_units[1]["anchor"]["section_path"], ["第三章 评选程序"])
        self.assertNotIn("1.院系推荐", article_units[1]["anchor"]["section_path"])
        self.assertNotIn("4.评选", article_units[1]["anchor"]["section_path"])

    def test_cleanup_preserves_formula_like_lines_as_separate_article_lines(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    40,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    40,
                    "heading",
                    "第三章 考核与成绩记载",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    40,
                    "paragraph",
                    "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。",
                ),
                _source_row(40, "paragraph", "（二）课程学分绩点、平均学分绩点的计算方法："),
                _source_row(40, "paragraph", "课程学分绩点=课程学分×课程绩点"),
                _source_row(
                    40, "paragraph", "平均学分绩= $ \\sum $(课程学分×课程的绩点)/ $ \\sum $课程学分"
                ),
            ],
            manifest_document=_manifest_document(
                40,
                40,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 1)
        self.assertEqual(
            article_units[0]["clean_text"],
            "\n".join(
                [
                    "为了反映学生学习的质和量,学校采用学分绩点的评定办法。",
                    "(二)课程学分绩点、平均学分绩点的计算方法:",
                    "课程学分绩点=课程学分×课程绩点",
                    "平均学分绩= $ \\sum $(课程学分×课程的绩点)/ $ \\sum $课程学分",
                ]
            ),
        )

    def test_cleanup_preserves_policy_doc_no_as_document_metadata_not_policy_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    36,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(36, "paragraph", "民大校发 [2017] 304号"),
                _source_row(
                    36, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(36, "paragraph", "第一条 为了维护学校正常的教育教学秩序。"),
            ],
            manifest_document=_manifest_document(
                36,
                36,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["policy_doc_no"], "民大校发[2017]304号")
        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertEqual(
            result.document_units[0]["metadata"]["policy_doc_no"], "民大校发[2017]304号"
        )
        self.assertNotIn("民大校发[2017]304号", result.document_units[0]["clean_text"])

    def test_cleanup_preserves_front_matter_lines_as_preface_metadata_before_first_section_heading(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    2,
                    "heading",
                    "普通高等学校学生管理规定",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(2, "paragraph", "2017年2月4日"),
                _source_row(2, "paragraph", "中华人民共和国教育部令第 41 号"),
                _source_row(
                    2, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(2, "paragraph", "第一条 为规范普通高等学校学生管理行为。"),
            ],
            manifest_document=_manifest_document(
                2,
                2,
                title="普通高等学校学生管理规定",
                handbook_section="国家高等教育管理有关规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertEqual(
            result.document_units[0]["metadata"]["preface_text"],
            "2017年2月4日\n中华人民共和国教育部令第 41 号",
        )
        self.assertIn("2017年2月4日", result.canonical_markdown)
        self.assertIn("中华人民共和国教育部令第 41 号", result.canonical_markdown)

    def test_cleanup_splits_structure_first_policy_document_by_part_and_subsection_headings(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    50,
                    "heading",
                    "中央民族大学学生志愿服务管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    50, "heading", "第二章 分则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(50, "paragraph", "五、义务职责"),
                _source_row(50, "paragraph", "志愿者应当遵守学校志愿服务管理要求。"),
                _source_row(50, "paragraph", "第二部分 认证"),
                _source_row(50, "paragraph", "一、认证时间"),
                _source_row(50, "paragraph", "志愿服务认证时间一般安排在每学期末。"),
                _source_row(50, "paragraph", "二、认证机构"),
                _source_row(50, "paragraph", "认证机构为校团委和院系团组织。"),
                _source_row(50, "paragraph", "第三部分 考核"),
                _source_row(50, "paragraph", "五、考核内容"),
                _source_row(50, "paragraph", "考核内容包括服务时长、服务质量和反馈情况。"),
                _source_row(50, "paragraph", "第四部分 评优"),
                _source_row(50, "paragraph", "评优工作根据年度志愿服务表现开展。"),
            ],
            manifest_document=_manifest_document(
                50,
                50,
                title="中央民族大学学生志愿服务管理办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(
            [row["anchor"]["section_path"] for row in policy_units],
            [
                ["第二章 分则", "五、义务职责"],
                ["第二章 分则", "第二部分 认证", "一、认证时间"],
                ["第二章 分则", "第二部分 认证", "二、认证机构"],
                ["第二章 分则", "第三部分 考核", "五、考核内容"],
                ["第二章 分则", "第四部分 评优"],
            ],
        )
        self.assertEqual(
            [row["clean_text"] for row in policy_units],
            [
                "志愿者应当遵守学校志愿服务管理要求。",
                "志愿服务认证时间一般安排在每学期末。",
                "认证机构为校团委和院系团组织。",
                "考核内容包括服务时长、服务质量和反馈情况。",
                "评优工作根据年度志愿服务表现开展。",
            ],
        )
        self.assertIn("## 第二部分 认证", result.canonical_markdown)
        self.assertIn("## 一、认证时间", result.canonical_markdown)
        self.assertIn("## 第三部分 考核", result.canonical_markdown)

    def test_cleanup_splits_policy_document_by_paragraph_level_section_headings(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    51,
                    "heading",
                    "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(51, "paragraph", "一、总则"),
                _source_row(51, "paragraph", "课堂教学应当坚持立德树人和良好学风。"),
                _source_row(51, "paragraph", "二、学生课堂行为规范"),
                _source_row(51, "paragraph", "学生应当遵守课堂纪律，不迟到、不早退。"),
                _source_row(51, "paragraph", "三、学生课堂秩序管理"),
                _source_row(51, "paragraph", "任课教师和学院共同维护课堂秩序。"),
            ],
            manifest_document=_manifest_document(
                51,
                51,
                title="中央民族大学学生课堂行为规范及课堂秩序管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(
            [row["anchor"]["section_path"] for row in policy_units],
            [
                ["一、总则"],
                ["二、学生课堂行为规范"],
                ["三、学生课堂秩序管理"],
            ],
        )
        self.assertEqual(
            [row["clean_text"] for row in policy_units],
            [
                "课堂教学应当坚持立德树人和良好学风。",
                "学生应当遵守课堂纪律,不迟到、不早退。",
                "任课教师和学院共同维护课堂秩序。",
            ],
        )
        self.assertIn("## 一、总则", result.canonical_markdown)
        self.assertIn("## 二、学生课堂行为规范", result.canonical_markdown)
        self.assertIn("## 三、学生课堂秩序管理", result.canonical_markdown)

    def test_cleanup_keeps_article_internal_parenthetical_items_inside_article_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    52,
                    "heading",
                    "中央民族大学优秀本科毕业生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    52,
                    "heading",
                    "第三章 评选条件",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(52, "paragraph", "第六条 校级优秀本科毕业生须具备以下基本条件:"),
                _source_row(52, "paragraph", "(一)思想政治表现良好;"),
                _source_row(52, "paragraph", "(二)遵守规章制度;"),
                _source_row(52, "paragraph", "(三)学习成绩良好;"),
                _source_row(52, "paragraph", "(四)积极参加体育锻炼,身心健康;"),
                _source_row(52, "paragraph", "(五)积极参加社会实践和志愿服务。"),
                _source_row(
                    52, "paragraph", "第七条 市级优秀本科毕业生从校级优秀本科毕业生中择优推荐产生。"
                ),
            ],
            manifest_document=_manifest_document(
                52,
                52,
                title="中央民族大学优秀本科毕业生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["article_body", "article_body"],
        )
        first_article = result.document_units[0]
        self.assertEqual(first_article["anchor"]["article_label"], "第六条")
        self.assertEqual(first_article["anchor"]["section_path"], ["第三章 评选条件"])
        self.assertIn("(四)积极参加体育锻炼,身心健康;", first_article["clean_text"])
        self.assertIn("(五)积极参加社会实践和志愿服务。", first_article["clean_text"])

    def test_cleanup_projects_terminal_inline_enumerated_provision_as_standalone_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    53,
                    "heading",
                    "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(53, "paragraph", "三、学生课堂秩序管理"),
                _source_row(53, "paragraph", "任课教师和学院共同维护课堂秩序。"),
                _source_row(53, "paragraph", "四、本办法由学生工作部(处)负责解释。"),
            ],
            manifest_document=_manifest_document(
                53,
                53,
                title="中央民族大学学生课堂行为规范及课堂秩序管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 2)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["三、学生课堂秩序管理"])
        self.assertEqual(policy_units[0]["clean_text"], "任课教师和学院共同维护课堂秩序。")
        self.assertEqual(policy_units[1]["anchor"]["section_path"], [])
        self.assertEqual(policy_units[1]["anchor"]["provision_label"], "四")
        self.assertEqual(policy_units[1]["clean_text"], "四、本办法由学生工作部(处)负责解释。")

    def test_cleanup_splits_glued_policy_section_heading_from_following_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    55,
                    "heading",
                    "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    55,
                    "paragraph",
                    "三、学生课堂秩序管理12、学生课堂行为规范和秩序的管理依照“全员参与、分级管理”的原则进行。",
                ),
                _source_row(55, "paragraph", "13、所有学生都必须积极、主动地服从管理。"),
            ],
            manifest_document=_manifest_document(
                55,
                55,
                title="中央民族大学学生课堂行为规范及课堂秩序管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 1)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["三、学生课堂秩序管理"])
        self.assertTrue(
            policy_units[0]["clean_text"].startswith("12、学生课堂行为规范和秩序的管理依照")
        )
        self.assertNotIn("三、学生课堂秩序管理 12、", policy_units[0]["clean_text"])
        self.assertIn("## 三、学生课堂秩序管理", result.canonical_markdown)

    def test_cleanup_projects_consecutive_inline_appendix_provisions_as_consistent_sibling_units(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    54,
                    "heading",
                    "中央民族大学学生志愿服务管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    54, "heading", "第三章 附则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(54, "paragraph", "一、本办法由共青团中央民族大学委员会负责解释。"),
                _source_row(54, "paragraph", "二、本办法自发布之日起实施。"),
            ],
            manifest_document=_manifest_document(
                54,
                54,
                title="中央民族大学学生志愿服务管理办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(
            [row["anchor"]["section_path"] for row in policy_units],
            [
                ["第三章 附则"],
                ["第三章 附则"],
            ],
        )
        self.assertEqual([row["anchor"]["provision_label"] for row in policy_units], ["一", "二"])
        self.assertEqual(
            [row["clean_text"] for row in policy_units],
            [
                "一、本办法由共青团中央民族大学委员会负责解释。",
                "二、本办法自发布之日起实施。",
            ],
        )
