from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *  # noqa: F401,F403


class HandbookCleanupInlineHeadingTest(unittest.TestCase):
    def test_cleanup_preserves_nested_section_path_for_article_units(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    36,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    36,
                    "heading",
                    "第二章 入学与注册",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    36,
                    "heading",
                    "第一节 新生报到",
                    block_role="heading",
                    title_candidate_score=0.7,
                ),
                _source_row(36, "paragraph", "第五条 按国家招生规定录取的新生。"),
            ],
            manifest_document=_manifest_document(
                36,
                36,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 1)
        self.assertEqual(
            article_units[0]["anchor"]["section_path"],
            ["第二章 入学与注册", "第一节 新生报到"],
        )
        self.assertIn("## 第二章 入学与注册", result.canonical_markdown)
        self.assertIn("## 第一节 新生报到", result.canonical_markdown)

    def test_cleanup_recovers_article_when_ocr_splits_spaces_inside_article_label(self) -> None:
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
                    "第二章 入学与注册",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(40, "paragraph", "第 五 条"),
                _source_row(40, "paragraph", "按国家招生规定录取的新生，须按期报到。"),
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
        self.assertEqual(article_units[0]["anchor"]["article_label"], "第五条")
        self.assertIn("按国家招生规定录取的新生", article_units[0]["clean_text"])

    def test_cleanup_splits_short_structural_heading_from_body_sentence(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    41,
                    "heading",
                    "中央民族大学十佳大学生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(41, "paragraph", "第八条 十佳大学生评选程序"),
                _source_row(
                    41,
                    "paragraph",
                    "3. 候选人公示中央民族大学十佳大学生候选人在学生工作部网站公示一周,接受监督。",
                ),
            ],
            manifest_document=_manifest_document(
                41,
                41,
                title="中央民族大学十佳大学生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "3. 候选人公示\n中央民族大学十佳大学生候选人在学生工作部网站公示一周,接受监督。",
            article_unit["clean_text"],
        )
        self.assertNotIn("候选人公示中央民族大学十佳大学生候选人", article_unit["clean_text"])

    def test_cleanup_deduplicates_boundary_overlap_after_short_heading_split(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    42,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(42, "paragraph", "第十一条 课程、学分与成绩认定"),
                _source_row(
                    42,
                    "paragraph",
                    "1. 学生申请学生需要提交境外学校提供的境外课程成绩单原件1份及复印件。",
                ),
            ],
            manifest_document=_manifest_document(
                42,
                42,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "1. 学生申请\n学生需要提交境外学校提供的境外课程成绩单原件1份及复印件。",
            article_unit["clean_text"],
        )
        self.assertNotIn("学生申请学生需要", article_unit["clean_text"])

    def test_cleanup_does_not_split_regular_sentence_after_enumerated_marker(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    43,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(43, "paragraph", "第十一条 课程、学分与成绩认定"),
                _source_row(
                    43,
                    "paragraph",
                    "1. 境外课程与其所学本科专业人才培养方案相近或相同的,可以认定为专业必修课或专业选修课。",
                ),
            ],
            manifest_document=_manifest_document(
                43,
                43,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "1. 境外课程与其所学本科专业人才培养方案相近或相同的,可以认定为专业必修课或专业选修课。",
            article_unit["clean_text"],
        )
        self.assertNotIn("1. 境外课程与\n", article_unit["clean_text"])

    def test_cleanup_does_not_split_inside_common_word_sequence(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    44,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(44, "paragraph", "第十一条 课程、学分与成绩认定"),
                _source_row(
                    44,
                    "paragraph",
                    "1. 成绩认定采用对应原则,境外课程的成绩以学校百分制成绩、成绩等级、学分绩点相对应的方式进行认定。",
                ),
            ],
            manifest_document=_manifest_document(
                44,
                44,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "1. 成绩认定采用对应原则,境外课程的成绩以学校百分制成绩、成绩等级、学分绩点相对应的方式进行认定。",
            article_unit["clean_text"],
        )
        self.assertNotIn("成绩认定采用对\n应原则", article_unit["clean_text"])

    def test_cleanup_splits_article_heading_from_body_sentence(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    45,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    45,
                    "paragraph",
                    "第十二条 毕业、结业与肄业参加留学项目学生返校后,必须按学校各项要求完成学习任务。",
                ),
            ],
            manifest_document=_manifest_document(
                45,
                45,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "毕业、结业与肄业\n参加留学项目学生返校后,必须按学校各项要求完成学习任务。",
            article_unit["clean_text"],
        )
        self.assertNotIn("毕业、结业与肄业参加留学项目学生返校后", article_unit["clean_text"])

    def test_cleanup_does_not_split_article_heading_inside_single_phrase(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    46,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(46, "paragraph", "第五条 申请参加境外留学项目学生的资格"),
                _source_row(46, "paragraph", "(一)热爱祖国,思想政治表现良好,遵纪守法。"),
            ],
            manifest_document=_manifest_document(
                46,
                46,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "申请参加境外留学项目学生的资格\n(一)热爱祖国,思想政治表现良好,遵纪守法。",
            article_unit["clean_text"],
        )
        self.assertNotIn("申请\n参加境外留学项目学生的资格", article_unit["clean_text"])

    def test_cleanup_splits_inline_enumerated_heading_from_body_sentence(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    47,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(47, "paragraph", "第七条 选拔程序与要求"),
                _source_row(
                    47,
                    "paragraph",
                    "(三)报名审核各院系负责审核并将符合项目选拔要求的申请学生材料统一报教务处。",
                ),
                _source_row(
                    47, "paragraph", "(八)公示学校将入围学生信息向全校公示,公示期不少于5个工作日。"
                ),
            ],
            manifest_document=_manifest_document(
                47,
                47,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn(
            "(三)报名审核\n各院系负责审核并将符合项目选拔要求的申请学生材料统一报教务处。",
            article_unit["clean_text"],
        )
        self.assertIn(
            "(八) 公示\n学校将入围学生信息向全校公示,公示期不少于5个工作日。",
            article_unit["clean_text"],
        )
        self.assertNotIn("(三)报名审核各院系负责", article_unit["clean_text"])
        self.assertNotIn("(八)公示学校将入围学生信息", article_unit["clean_text"])

    def test_cleanup_does_not_create_false_inline_heading_splits_for_soft_wrapped_article_lines(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    48,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(48, "paragraph", "第五条 申请参加境外留学项目学生的资格"),
                _source_row(48, "paragraph", "(三)须向"),
                _source_row(48, "paragraph", "学校足额缴纳学费及其他相关费用。"),
                _source_row(48, "paragraph", "(四)能较熟练掌握对方"),
                _source_row(48, "paragraph", "学校所在地区的语言,具备交流、沟通能力。"),
                _source_row(48, "paragraph", "1. 委托"),
                _source_row(48, "paragraph", "院系选拔方式,主要适用于只涉及1个学院的项目。"),
            ],
            manifest_document=_manifest_document(
                48,
                48,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_unit = next(
            row for row in result.document_units if row["unit_type"] == "article_body"
        )
        self.assertIn("(三)须向学校足额缴纳学费及其他相关费用。", article_unit["clean_text"])
        self.assertIn(
            "(四)能较熟练掌握对方学校所在地区的语言,具备交流、沟通能力。",
            article_unit["clean_text"],
        )
        self.assertIn(
            "1. 委托院系选拔方式,主要适用于只涉及1个学院的项目。", article_unit["clean_text"]
        )
        self.assertNotIn("(三)须向\n学校足额缴纳", article_unit["clean_text"])
        self.assertNotIn("(四)能较熟练掌握对方\n学校所在地区", article_unit["clean_text"])
        self.assertNotIn("1. 委托\n院系选拔方式", article_unit["clean_text"])

    def test_normalize_handbook_body_text_does_not_split_non_heading_prefix_before_student_or_school_subject(
        self,
    ) -> None:
        normalized = normalize_handbook_body_text(
            "\n".join(
                [
                    "2. 标准学制为四年的文科学生在校学习期间累计重修学分达 30 学分;",
                    "4. 非外语类本科专业学生未通过全国大学外语四级考试者;",
                    "(一)参加留学项目学生的学籍在外留学期间仍属于中央民族大学。",
                    "(四) 所评学年未被学校认定为家庭经济困难的;",
                ]
            )
        )

        self.assertIn("2. 标准学制为四年的文科学生在校学习期间累计重修学分达 30 学分;", normalized)
        self.assertIn("4. 非外语类本科专业学生未通过全国大学外语四级考试者;", normalized)
        self.assertIn("(一)参加留学项目学生的学籍在外留学期间仍属于中央民族大学。", normalized)
        self.assertIn("(四) 所评学年未被学校认定为家庭经济困难的;", normalized)
        self.assertNotIn("文科\n学生", normalized)
        self.assertNotIn("专业\n学生", normalized)
        self.assertNotIn("项目\n学生", normalized)
        self.assertNotIn("未被\n学校", normalized)
