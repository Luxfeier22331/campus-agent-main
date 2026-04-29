from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *


class HandbookCleanupPhraseCompletionTest(unittest.TestCase):
    def test_cleanup_repairs_truncated_list_item_from_unique_global_clause_match(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    192,
                    "heading",
                    "中央民族大学本科学生专项奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    192,
                    "paragraph",
                    "第六条 所评学年有下列情况之一者,不得参评本科学生专项奖学金:",
                ),
                _source_row(
                    192,
                    "list_item",
                    "(一)所评学年休学或保留学籍的;\n(二)所评学年所修各门课程有不及格或体质测试评定不合",
                    block_role="list_item",
                ),
                _source_row(
                    160,
                    "heading",
                    "中央民族大学本科学生国家奖学金评审办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    160,
                    "list_item",
                    "(一)所评学年休学或保留学籍的;\n(二)所评学年所修各门课程有不及格或体质测试评定不合格的;",
                    block_role="list_item",
                ),
            ],
            manifest_document=_manifest_document(
                192,
                192,
                title="中央民族大学本科学生专项奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn(
            "(二)所评学年所修各门课程有不及格或体质测试评定不合格的;",
            result.canonical_markdown,
        )
        self.assertNotIn(
            "(二)所评学年所修各门课程有不及格或体质测试评定不合\n",
            result.canonical_markdown,
        )

    def test_cleanup_keeps_truncated_list_item_when_global_clause_match_is_ambiguous(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    192,
                    "heading",
                    "中央民族大学本科学生专项奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    192,
                    "paragraph",
                    "第六条 所评学年有下列情况之一者,不得参评本科学生专项奖学金:",
                ),
                _source_row(
                    192,
                    "list_item",
                    "(一)所评学年休学或保留学籍的;\n(二)所评学年所修各门课程有不及格或体质测试评定不合",
                    block_role="list_item",
                ),
                _source_row(
                    160,
                    "list_item",
                    "(二)所评学年所修各门课程有不及格或体质测试评定不合格的;",
                    block_role="list_item",
                ),
                _source_row(
                    161,
                    "list_item",
                    "(二)所评学年所修各门课程有不及格或体质测试评定不合要求的;",
                    block_role="list_item",
                ),
            ],
            manifest_document=_manifest_document(
                192,
                192,
                title="中央民族大学本科学生专项奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn(
            "(二)所评学年所修各门课程有不及格或体质测试评定不合",
            result.canonical_markdown,
        )
        self.assertNotIn("不合格的;", result.canonical_markdown)
        self.assertNotIn("不合要求的;", result.canonical_markdown)

    def test_cleanup_repairs_known_student_status_source_gap_from_official_policy(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    36,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(45, "heading", "第六章 退学"),
                _source_row(45, "paragraph", "第四十一条 学生有下列情形之一,给予退学处理:"),
                _source_row(46, "list_item", "(九)学生本人申请退学的。"),
                _source_row(
                    46,
                    "paragraph",
                    "第四十二条 学生退学处理由所在学院(系)提出处理意见,文件。",
                ),
                _source_row(
                    46,
                    "paragraph",
                    "第五十三条 学校执行高等教育学籍学历电子注册管理制度,按相关规定及时完成学生学籍学历电子注册。",
                ),
                _source_row(
                    46,
                    "paragraph",
                    "第五十四条 对完成本专业学业同时辅修其他专业并达到该专业辅修要求的学生,由学校发给辅修专业证书。",
                ),
                _source_row(
                    46,
                    "paragraph",
                    "第五十五条 对违反国家招生规定取得入学资格或者学籍的,学校取消其学籍,不得发给学历证书、学位证书;",
                ),
                _source_row(
                    47,
                    "paragraph",
                    "第五十六条 学历证书和学位证书遗失或者损坏,经本人申请,学校核实后出具相应的证明书。",
                ),
                _source_row(47, "heading", "第九章 附则"),
                _source_row(
                    47,
                    "paragraph",
                    "第五十七条 学校对接受高等学历教育的港澳台侨学生、留学生的管理,参照本规定执行。",
                ),
            ],
            manifest_document=_manifest_document(
                36,
                47,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn(
            "### 第四十二条\n学生退学处理由所在学院(系)提出处理意见,报学生处",
            result.canonical_markdown,
        )
        self.assertIn("### 第四十三条\n退学学生按下列规定办理:", result.canonical_markdown)
        self.assertIn("## 第七章 毕业与结业", result.canonical_markdown)
        self.assertIn(
            "### 第五十二条\n学校严格按照招生时确定的办学类型和学习形式", result.canonical_markdown
        )
        self.assertIn("## 第八章 学业证书管理", result.canonical_markdown)
        self.assertIn(
            "### 第五十三条\n学校执行高等教育学籍学历电子注册管理制度", result.canonical_markdown
        )
        self.assertNotIn(
            "第四十二条\n学生退学处理由所在学院(系)提出处理意见,文件", result.canonical_markdown
        )

        article_53 = next(
            row
            for row in result.document_units
            if row["anchor"].get("article_label") == "第五十三条"
        )
        self.assertEqual(article_53["anchor"]["section_path"], ["第八章 学业证书管理"])


if __name__ == "__main__":
    unittest.main()
