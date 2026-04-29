from __future__ import annotations

from .curriculum_provider_normalize_test_support import *


class CurriculumProviderNormalizeMiscTest(CurriculumProviderNormalizeTestSupport):
    def test_normalize_curriculum_provider_result_repairs_basic_literacy_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-basic-literacy-split",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "通识教育板块应修学分49学分。",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>类别</td><td>课程号</td></tr>"
                                        "<tr><td>基本素</td><td>1042010079</td></tr>"
                                        '<tr><td rowspan="14">养课</td><td>1042010080</td></tr></table>'
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(rows[0]["text_normalized"], "通识教育板块应修49学分。")
        self.assertIn('rowspan="15">基本素养课</td>', rows[1]["text_normalized"])
        self.assertNotIn(">基本素</td>", rows[1]["text_normalized"])
        self.assertNotIn(">养课</td>", rows[1]["text_normalized"])

    def test_repair_minority_preparatory_program_artifacts_fixes_phrases_and_table_groups(
        self,
    ) -> None:
        summary_bad = (
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr>'
            '<tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>'
            '<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>'
        )
        summary_wenke_fragment_bad = (
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr></table>'
        )
        summary_like_fragment_bad = (
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            "<tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr><tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr>"
            '<tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>'
        )
        detail_bad = (
            '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
            '<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan="8">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan="8">必修</td></tr>'
            "<tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr><tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr>"
            "<tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
            "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr>"
            '<tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr><tr><td rowspan="7">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan="7">必修</td></tr>'
            "<tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
            "<tr><td>1052030031</td><td>高等数学(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td></tr><tr><td>1052030032</td><td>高等数学(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr>"
            '<tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr><tr><td rowspan="3">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr>'
            "<tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辨正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
            '<tr><td rowspan="3">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>'
            '<tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td rowspan="3">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan="3">选修:根据兴趣及需求选修,可多选</td></tr>'
            "<tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td></td><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
            "<tr><td></td><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
            "<tr><td></td><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr></table>"
        )
        detail_second_table_bad = (
            '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td>'
            '<td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td>'
            '<td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
            "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr>"
            '<tr><td rowspan="2">基础课</td><td>1052030065</td><td>普通化学</td><td></td>'
            '<td>72</td><td>18</td><td>4</td><td>/</td><td rowspan="2">必修(实验18学时)</td></tr>'
            "<tr><td>1052030066</td><td>大学物理</td><td></td><td>72</td><td>18</td><td>/</td><td>4</td></tr></table>"
        )

        repaired = _repair_minority_preparatory_program_artifacts(
            "\n".join(
                [
                    "融合课堂教学、自主学习、实践活动、指导帮扶、文化引领为一体、根据教学内容和学生特点",
                    "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语",
                    "基础课程:理科班增设普通化学和大学物理",
                    "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语基础课程:理科班增设普通化学和大学物理",
                    summary_bad,
                    detail_bad,
                    detail_second_table_bad,
                ]
            )
        )

        self.assertIn("文化引领为一体,根据教学内容和学生特点", repaired)
        self.assertIn(
            "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。基础课程:理科班增设普通化学和大学物理。",
            repaired,
        )
        self.assertIn(
            "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。", repaired
        )
        self.assertIn("基础课程:理科班增设普通化学和大学物理。", repaired)
        self.assertIn('<td colspan="5">文科班</td>', repaired)
        self.assertIn('<td colspan="5">理科班</td>', repaired)
        self.assertIn('<td colspan="9">文科班</td>', repaired)
        self.assertEqual(repaired.count('<td colspan="9">理科班</td>'), 1)
        self.assertNotIn("文化引领为一体、根据教学内容和学生特点", repaired)
        self.assertNotIn("大学体育、心理健康主干课程", repaired)

        split_repaired = _repair_minority_preparatory_program_artifacts(
            "\n".join([summary_wenke_fragment_bad, summary_like_fragment_bad])
        )
        self.assertEqual(split_repaired.count('<td colspan="5">文科班</td>'), 1)
        self.assertEqual(split_repaired.count('<td colspan="5">理科班</td>'), 1)

    def test_repair_ethnology_second_bachelor_table_artifact_fixes_rowspan_and_header_noise(
        self,
    ) -> None:
        owner_repaired = _repair_ethnology_second_bachelor_table_artifact(
            "<table>"
            '<tr><td rowspan="2" colspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="4">各学期周学时分配</td></tr>'
            "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>"
            '<tr><td rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td><td>民族学理论与方法</td></tr>'
            "</table>"
        )
        continuation_input = (
            "<table>"
            '<tr><td rowspan="3">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="4">各学期周学时分配</td></tr>'
            "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>"
            "<tr><td>1026030062</td><td>经济人类学(全英文)</td><td>2</td><td>36</td><td></td><td></td><td>2</td><td></td><td></td></tr>"
            "<tr><td>专业选修课须修满12学分</td><td>1026040121</td></tr>"
            "</table>"
        )
        continuation_repaired = _repair_ethnology_second_bachelor_table_artifact(continuation_input)

        self.assertIn(
            'rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>',
            owner_repaired,
        )
        self.assertNotIn(
            'rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td>',
            owner_repaired,
        )
        self.assertEqual(continuation_repaired, continuation_input)

    def test_repair_paleography_program_table_artifacts_fixes_bad_label_and_hours(
        self,
    ) -> None:
        repaired = _repair_paleography_program_table_artifacts(
            "<table>"
            "<tr><td>类别</td><td>说明</td></tr>"
            "<tr><td>全球胜任力培养</td><td>建议修读</td></tr>"
            "<tr><td>思政课</td><td>19</td><td>必修</td><td>370</td><td>350</td><td>120</td></tr>"
            "</table>"
        )

        self.assertIn(">全球胜任力培养课程<", repaired)
        self.assertIn(
            "<td>思政课</td><td>19</td><td>必修</td><td>370</td><td>250</td><td>120</td>", repaired
        )
        self.assertNotIn(">全球胜任力培养<", repaired)
        self.assertNotIn("<td>370</td><td>350</td><td>120</td>", repaired)

    def test_normalize_curriculum_provider_result_falls_back_to_markdown_when_block_list_missing(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-002",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {"text": "纯 markdown 回退文本", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_type"], "paragraph")
        self.assertEqual(rows[0]["text_normalized"], "纯 markdown 回退文本")
        self.assertEqual(rows[0]["provider_page_id"], 1)

    def test_normalize_curriculum_provider_result_keeps_unique_row_ids_when_provider_block_ids_repeat(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-003",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "目录",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "content",
                                    "block_content": "社会学类本科人才培养方案.....47",
                                    "block_id": 1,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "number",
                                    "block_content": "1",
                                    "block_id": 1,
                                    "block_order": None,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 3)
        self.assertEqual(len({row["row_id"] for row in rows}), 3)

    def test_normalize_curriculum_provider_result_demotes_terminal_motto_footer(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-terminal-motto",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "美美与共 知行合一",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(rows[0]["row_type"], "footer")
        self.assertEqual(rows[0]["block_role"], "motto_footer")
        self.assertEqual(rows[0]["text_normalized"], "美美与共 知行合一")

    def test_normalize_curriculum_provider_result_repairs_curriculum_layout_text_artifacts(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-layout-text-artifacts",
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
                                        "立足北京，面向全国，着眼国际，主要培养政治素质过硬、人文底蕴\n"
                                        "秉承“立德启智、知行合一、文化融合、国际视野”的育人理念，深厚、\n"
                                        "国际视野宽广、教育学理论基础扎实。"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "1. 专业能力：应具备基本的经济分析能力，掌握经济学理论发展脉络，\n"
                                        "具备经济学思维和使用经济学研究现实经济社会问题的能力，熟练使用前\n"
                                        "沿数字技术开展经济研究点能力。数字经济专业应，具备"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        texts = [
            str(row.get("text_normalized") or "") for row in self._normalize_rows(provider_payload)
        ]

        self.assertIn(
            (
                "立足北京,面向全国,着眼国际,秉承“立德启智、知行合一、文化融合、国际视野”的"
                "育人理念,主要培养政治素质过硬、人文底蕴深厚、国际视野宽广、教育学理论基础扎实。"
            ),
            texts,
        )
        self.assertIn(
            (
                "1. 专业能力:应具备基本的经济分析能力,掌握经济学理论发展脉络,具备经济学思维和使用"
                "经济学研究现实经济社会问题的能力,熟练使用前沿数字技术开展经济研究的能力。"
            ),
            texts,
        )

    def test_normalize_curriculum_provider_result_repairs_split_table_cell_continuation(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-split-table-cell",
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
                                        '<tr><td rowspan="5">2能力目标</td><td rowspan="3">2-2在教育行业'
                                        "创造性开展教育管理工作的能力</td><td>2-2-3具有建立良好的学习共同体"
                                        "秩序和活动规则的能力,能够营造良好的同伴关系和师生关系,形成尊</td></tr>"
                                        '<tr><td rowspan="10"></td><td></td><td>重、平等、积极向上的班级氛围,'
                                        "能够总结教育教学常规工作的规律和常见问题。</td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)
        html = str(rows[0]["text_normalized"])

        self.assertIn("形成尊重、平等、积极向上的班级氛围", html)
        self.assertNotIn("<td>重、平等、积极向上的班级氛围", html)
