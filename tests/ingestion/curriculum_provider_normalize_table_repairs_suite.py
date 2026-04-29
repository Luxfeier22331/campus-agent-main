from __future__ import annotations

from .curriculum_provider_normalize_test_support import *


class CurriculumProviderNormalizeTableRepairsTest(CurriculumProviderNormalizeTestSupport):
    def test_normalize_curriculum_provider_result_repairs_summary_stage_table_artifacts(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-summary-stage-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td></tr>"
                                        "<tr><td>大类培养</td><td>通识教育</td><td>思政课</td></tr>"
                                        "<tr><td></td><td>学科基础教育</td><td>学科基础课</td></tr>"
                                        "<tr><td>专业</td><td>专业教育</td><td>专业核心课</td></tr>"
                                        "<tr><td>培养</td><td></td><td>专业选修课</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 43,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn(
            "<tr><td>大类培养</td><td>学科基础教育</td><td>学科基础课</td></tr>",
            html,
        )
        self.assertIn(
            "<tr><td>专业培养</td><td>专业教育</td><td>专业核心课</td></tr>",
            html,
        )
        self.assertIn(
            "<tr><td>专业培养</td><td>专业教育</td><td>专业选修课</td></tr>",
            html,
        )
        self.assertNotIn("<td>专业</td><td>专业教育</td>", html)
        self.assertNotIn("<td>培养</td><td></td>", html)

    def test_normalize_curriculum_provider_result_repairs_truncated_required_practice_sentence(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-truncated-required-practice-sentence-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "个性化培养阶段,主要开展个性化教育,合计14学分,均为选修学分。"
                                        "另外,实践环节合计14学分,为必"
                                    ),
                                    "block_id": 44,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertIn(
            "另外,实践环节合计14学分,为必修。",
            str(rows[0]["text_normalized"]),
        )
        self.assertNotIn("为必", str(rows[0]["text_normalized"]).removesuffix("为必修。"))

    def test_normalize_curriculum_provider_result_repairs_personalized_guidance_intro(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-personalized-guidance-intro-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "为充分对接学生未来发展、满足学生个性化选择,设置本硕贯通课程、跨学科交叉课程、"
                                        "全球胜任力培养课程和行业领域协同育人课程,学生可根据未来发展意向选择修读相关课程,"
                                        "此部分至少修读6学分。修读建议拟继续深造学生建议选择修读本硕贯通专业选修课程。"
                                        "免试推荐攻读本校研究生的本科生可提前学习研究生课程,并计入研究生学分。"
                                    ),
                                    "block_id": 431,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        paragraph = next(row for row in rows if row["row_type"] == "paragraph")
        text = str(paragraph["text_normalized"])
        self.assertIn(
            "此部分至少修读6学分。修读建议如下:拟继续深造学生建议选择修读本硕贯通专业选修课程。",
            text,
        )
        self.assertNotIn("修读建议拟继续深造学生建议", text)

    def test_normalize_curriculum_provider_result_repairs_design_summary_major_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-design-summary-major-split-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        '<table><tr><td>培养阶段</td><td>板块名称</td><td colspan="2">类别</td><td>学分设置</td><td>修读性质</td><td>总学时</td><td>理论学时</td><td>实践学时</td></tr>'
                                        '<tr><td rowspan="7">专业培养</td><td rowspan="7">专业教育</td><td rowspan="2">视觉传达设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1188</td><td>/</td><td>1188</td></tr>'
                                        "<tr><td>专业选修课</td><td>14</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">视觉传达设计(影像设计)</td><td>专业核心课</td><td>33</td><td>必修</td><td>1152</td><td>36</td><td>1116</td></tr>'
                                        "<tr><td>专业选修课</td><td>14</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">环境设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1152</td><td>36</td><td>1116</td></tr>'
                                        "<tr><td>专业选修课</td><td>7</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        "<tr><td>服装与服饰设</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>"
                                        "<tr><td></td><td></td><td>计</td><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 432,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn('<tr><td rowspan="8">专业培养</td><td rowspan="8">专业教育</td>', html)
        self.assertIn(
            '<tr><td rowspan="2">服装与服饰设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>',
            html,
        )
        self.assertIn(
            "<tr><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>",
            html,
        )
        self.assertNotIn("<tr><td>服装与服饰设</td>", html)
        self.assertNotIn("<td>计</td><td>专业选修课</td>", html)

    def test_normalize_curriculum_provider_result_repairs_global_competence_placeholder_row(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-placeholder-row-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        "<tr><td>全球胜任力课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>建议出国深造学生选修</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 44,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn(
            "<tr><td>全球胜任力课程</td><td></td><td>学校通开的全球胜任力培养课程</td><td></td><td></td><td></td><td></td><td>建议出国深造学生选修</td></tr>",
            html,
        )
        self.assertEqual(html.count("学校通开的全球胜任力培养课程"), 1)

    def test_normalize_curriculum_provider_result_removes_global_competence_placeholder_slash(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-placeholder-slash-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        '<tr><td>全球胜任力培养课程</td><td colspan="6">学校通开的全球胜任力培养课程/</td><td>建议出国深造学生选修</td></tr>'
                                        "</table>"
                                    ),
                                    "block_id": 44,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn(">学校通开的全球胜任力培养课程<", html)
        self.assertNotIn("学校通开的全球胜任力培养课程/", html)

    def test_normalize_curriculum_provider_result_repairs_cross_discipline_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-cross-discipline-label-split-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        "<tr><td>跨学科</td><td>新开课</td><td>经济统计分析实践</td><td>2</td><td>36</td><td>9</td><td>7</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">交叉课程</td><td></td><td>社会心理学</td><td>2</td><td>36</td><td>9</td><td>7</td><td rowspan="2"></td></tr>'
                                        "<tr><td>1034040253</td><td>区块链技术</td><td>2</td><td>36</td><td>9</td><td>7</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 45,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn(
            '<tr><td rowspan="3">跨学科交叉课程</td><td>新开课</td><td>经济统计分析实践</td>',
            html,
        )
        self.assertIn(
            "<tr><td></td><td>社会心理学</td><td>2</td><td>36</td><td>9</td><td>7</td>", html
        )
        self.assertNotIn("<td>跨学科</td>", html)
        self.assertNotIn(">交叉课程</td>", html)

    def test_normalize_curriculum_provider_result_repairs_industry_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-industry-label-split-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        "<tr><td>行业领域</td><td>新开课</td><td>社会工作实务</td><td>2</td><td>36</td><td>/</td><td>5</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">协同育人课程</td><td>新开课</td><td>选调生与基层治理</td><td>2</td><td>36</td><td>/</td><td>6</td><td>/</td></tr>'
                                        "<tr><td>新开课</td><td>公共政策虚拟仿真</td><td>2</td><td>36</td><td>/</td><td>7</td><td>/</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 45,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn(
            '<tr><td rowspan="3">行业领域协同育人课程</td><td>新开课</td><td>社会工作实务</td>',
            html,
        )
        self.assertIn(
            "<tr><td>新开课</td><td>选调生与基层治理</td><td>2</td><td>36</td><td>/</td><td>6</td><td>/</td></tr>",
            html,
        )
        self.assertNotIn("<td>行业领域</td>", html)
        self.assertNotIn(">协同育人课程</td>", html)

    def test_normalize_curriculum_provider_result_repairs_biology_cross_course_table(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-biology-table-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        '<tr><td rowspan="2">跨学科交叉课程</td><td>1043040223</td><td>民族生物资源与传统知识</td><td>2</td><td>36</td><td>/</td><td>7</td><td rowspan="2">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的</td></tr>'
                                        "<tr><td>1043040194</td><td>民族植物学</td><td>2</td><td>36</td><td>/</td><td>6</td></tr>"
                                        "<tr><td></td><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td><td>其他课程。此模块建议所有学生选修至少2学分</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 42,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn('<td rowspan="3">跨学科交叉课程</td>', html)
        self.assertIn(
            '<td rowspan="3">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的其他课程。此模块建议所有学生选修至少2学分</td>',
            html,
        )
        self.assertIn(
            "<tr><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td></tr>",
            html,
        )
        self.assertNotIn("其他专业的</td>", html)
        self.assertNotIn("<td></td><td>1043040603</td>", html)

    def test_normalize_curriculum_provider_result_repairs_global_competence_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-label-split",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程模块</td><td>课程编号</td><td>课程名称</td><td>学分</td><td>总学时</td><td>实践学时</td><td>开课学期</td><td>备注</td></tr>"
                                        '<tr><td rowspan="2">全球胜任力培</td><td>新开课</td><td>数学专业英语</td><td>2</td><td>36</td><td>/</td><td>6</td><td></td></tr>'
                                        "<tr><td>新开课</td><td>中西方文化</td><td>2</td><td>36</td><td>/</td><td>7</td><td></td></tr>"
                                        '<tr><td rowspan="2">养课程</td><td>新开课</td><td>科技前沿讲座</td><td>1</td><td>18</td><td>/</td><td>7</td><td></td></tr>'
                                        '<tr><td colspan="7">学校相关选修课</td></tr></table>'
                                    ),
                                    "block_id": 88,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn('<td rowspan="4">全球胜任力培养课程</td>', html)
        self.assertNotIn(">全球胜任力培<", html)
        self.assertNotIn(">养课程<", html)

    def test_normalize_curriculum_provider_result_merges_cross_page_bridge_row_into_next_paragraph(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-cross-page-bridge-row",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "五、课程设置和修读建议",
                                    "block_id": 1,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 260, 42],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "其他页面复现的页眉桥接词。",
                                    "block_id": 2,
                                    "block_order": 2,
                                    "block_bbox": [10, 44, 240, 72],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "为充分对接学生未来发展,此部分至少修读6学分。修读建议",
                                    "block_id": 3,
                                    "block_order": 1,
                                    "block_bbox": [10, 700, 560, 760],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "如下:",
                                    "block_id": 4,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 80, 42],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "拟继续深造学生建议选择修读本硕贯通专业选修课程。",
                                    "block_id": 5,
                                    "block_order": 2,
                                    "block_bbox": [10, 60, 420, 110],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "如下:",
                                    "block_id": 6,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 80, 42],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "本页正文独立结束。",
                                    "block_id": 7,
                                    "block_order": 2,
                                    "block_bbox": [10, 60, 220, 110],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        page2_row = next(row for row in rows if row["row_id"].endswith("block-3-0001"))
        bridge_row = next(row for row in rows if row["row_id"].endswith("block-4-0001"))
        merged_row = next(row for row in rows if row["row_id"].endswith("block-5-0002"))
        unrelated_page4_row = next(row for row in rows if row["row_id"].endswith("block-7-0002"))

        self.assertTrue(bridge_row["is_repeated_candidate"])
        self.assertTrue(page2_row["continues_to_next_page"])
        self.assertTrue(merged_row["continues_from_previous_page"])
        self.assertEqual(
            merged_row["text_normalized"],
            "如下:拟继续深造学生建议选择修读本硕贯通专业选修课程。",
        )
        self.assertEqual(unrelated_page4_row["text_normalized"], "本页正文独立结束。")

    def test_normalize_curriculum_provider_result_repairs_public_management_round8_artifacts(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-public-management-round8",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>一级指标</td><td>二级指标</td><td>三级指标</td></tr>"
                                        '<tr><td rowspan="8">素养目标</td><td>3-3职业素养</td>'
                                        "<td>3-3-1热忱对待公共管理事业,对国家与社会发展</td></tr>"
                                        '<tr><td rowspan="8"></td><td rowspan="2"></td><td>有责任心</td></tr>'
                                        "<tr><td>3-3-2 乐于、甘于投身祖国的公共管理事业</td></tr>"
                                        '<tr><td rowspan="3">2-4沟通与合作能够力</td>'
                                        "<td>2-4-3能够初步地进行专业领域的国际交流</td></tr>"
                                        '<tr><td rowspan="3">2-5批判性思维和创新能力</td>'
                                        "<td>2-5-3形成公共管理学专业所需的人文关怀和实践创新能力</td></tr>"
                                        '<tr><td rowspan="4">3-1政治素养</td>'
                                        "<td>3-1-4具有维护民族团结和祖国统一的使命感和中华民族共同体意识</td></tr>"
                                        '<tr><td rowspan="3">3-2公众素养</td>'
                                        "<td>3-2-3积极践行社会主义核心价值观</td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "选修列表中的所有课程,原则上两个专业学生均可选修。为区分专业"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "拟出国学生建议选择修读全球胜任力培养客户。",
                                    "block_id": 3,
                                    "block_order": 3,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table_row = next(row for row in rows if row["row_type"] == "table")
        self.assertIn("2-4沟通与合作能力", table_row["text_normalized"])
        self.assertNotIn("2-4沟通与合作能够力", table_row["text_normalized"])
        self.assertIn(
            "3-3-1 热忱对待公共管理事业,对国家与社会发展有责任心",
            table_row["text_normalized"],
        )
        self.assertNotIn("<td>有责任心</td></tr>", table_row["text_normalized"])
        self.assertIn('rowspan="2">3-3职业素养</td>', table_row["text_normalized"])
        self.assertIn("2-4-3 能够初步地进行专业领域的国际交流", table_row["text_normalized"])
        self.assertIn(
            "2-5-3 形成公共管理学专业所需的人文关怀和实践创新能力",
            table_row["text_normalized"],
        )
        self.assertIn(
            "3-1-4 具有维护民族团结和祖国统一的使命感和中华民族共同体意识",
            table_row["text_normalized"],
        )
        self.assertIn("3-2-3 积极践行社会主义核心价值观", table_row["text_normalized"])
        self.assertEqual(
            rows[1]["text_normalized"],
            "选修列表中的所有课程,原则上两个专业学生均可选修。",
        )
        self.assertEqual(
            rows[2]["text_normalized"],
            "拟出国学生建议选择修读全球胜任力培养课程。",
        )
