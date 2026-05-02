from __future__ import annotations

import unittest

from campus_ingestion_core.regulation_chunk_quality import (
    contains_form_tail_marker,
    contains_publication_imprint,
    header_dominance_is_blocking_quality_gap,
    section_path_contains_body_text,
)


class RegulationChunkQualityTest(unittest.TestCase):
    def test_section_path_contains_body_text_flags_stale_list_item_even_when_display_differs(
        self,
    ) -> None:
        self.assertTrue(
            section_path_contains_body_text(
                section_path=[
                    "一、导师职责",
                    "（一）应遵守学校纪律要求；",
                ],
                display_text="导师应定期检查学生培养进展。",
            )
        )

    def test_section_path_contains_body_text_allows_legitimate_school_unit_heading(
        self,
    ) -> None:
        self.assertFalse(
            section_path_contains_body_text(
                section_path=[
                    "第二章 议事决策范围",
                    "（一）事关学院改革发展稳定的事项",
                ],
                display_text="学院发展规划、学科专业建设规划、年度工作计划等重要事项。",
            )
        )

    def test_section_path_contains_body_text_allows_legitimate_chapter_and_article_headings(
        self,
    ) -> None:
        for section_path in (
            ["第二章 教学事故的种类与适用"],
            ["第三章 评选条件", "第六条 优秀导师的评选条件"],
            ["第四条 奖励申请、审核及发放程序"],
        ):
            with self.subTest(section_path=section_path):
                self.assertFalse(
                    section_path_contains_body_text(
                        section_path=section_path,
                        display_text="正文内容由该章节或条款标题提供结构语义。",
                    )
                )

    def test_section_path_contains_body_text_flags_body_intro_colon_sentence(
        self,
    ) -> None:
        self.assertTrue(
            section_path_contains_body_text(
                section_path=[
                    "第四章 处理",
                    "（一）被认定为有违反立德树人规范行为的导师，给予下列处理：",
                ],
                display_text="1、暂停研究生指导和教学工作。",
            )
        )

    def test_header_dominance_allows_short_answer_fragment(self) -> None:
        self.assertFalse(
            header_dominance_is_blocking_quality_gap(
                metadata={
                    "display_text": "（一） 普通免试生；",
                    "header_token_count": 32,
                    "display_token_count": 9,
                    "final_token_count": 41,
                },
                threshold=0.75,
            )
        )

    def test_header_dominance_blocks_non_answer_attachment_marker(self) -> None:
        self.assertTrue(
            header_dominance_is_blocking_quality_gap(
                metadata={
                    "display_text": "附件",
                    "header_token_count": 12,
                    "display_token_count": 2,
                    "final_token_count": 14,
                },
                threshold=0.75,
            )
        )

    def test_header_dominance_allows_short_contextual_major_name(self) -> None:
        self.assertFalse(
            header_dominance_is_blocking_quality_gap(
                metadata={
                    "section_path": ["一、招生专业"],
                    "display_text": "新闻传播学",
                    "header_token_count": 34,
                    "display_token_count": 5,
                    "final_token_count": 39,
                },
                threshold=0.75,
            )
        )

    def test_contains_publication_imprint_allows_office_address_line(self) -> None:
        self.assertFalse(
            contains_publication_imprint(
                "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则 / "
                "九、其他事项 / （三）\n"
                "（三）办公地址：中央民族大学文华楼1335D办公室。"
            )
        )

    def test_contains_publication_imprint_flags_plain_issuer_line(self) -> None:
        self.assertTrue(
            contains_publication_imprint(
                "中央民族大学本科教学管理办法 / 附则\n"
                "中央民族大学校长办公室"
            )
        )

    def test_contains_form_tail_marker_flags_flattened_information_table_tail(self) -> None:
        self.assertTrue(
            contains_form_tail_marker(
                "附表 1\n"
                "新生学费库数据信息表\n"
                "姓名 | 学号 | 身份证号 | 学院 | 专业名称\n"
                "| | | | |"
            )
        )

    def test_contains_form_tail_marker_flags_supplementary_indicator_table_tail(self) -> None:
        self.assertTrue(
            contains_form_tail_marker(
                "第十八条 本办法由教务处负责解释。\n"
                "附件1\n"
                "专业评估指标体系\n"
                "一级指标 | 二级指标 | 评价内容 | 备注\n"
                "生源与条件保障 | 生源质量 | 近3年该专业的生源质量。 | 一流专业适用"
            )
        )

    def test_contains_form_tail_marker_flags_supplementary_template_tail(self) -> None:
        self.assertTrue(
            contains_form_tail_marker(
                "示例：[1] 作者.题名[M].北京：出版社，2024.\n"
                "附件4\n"
                "本科毕业论文（设计）使用授权书\n"
                "学院 | | 专业 |\n"
                "年级 | | 学号 |\n"
                "本人签名：日期："
            )
        )


if __name__ == "__main__":
    unittest.main()
