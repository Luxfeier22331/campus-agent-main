from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *  # noqa: F401,F403


class HandbookCleanupAppendixSemanticsTest(unittest.TestCase):
    def test_cleanup_splits_appendix_heading_out_of_current_article_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    61,
                    "heading",
                    "中央民族大学推荐应届优秀高水平运动员免试攻读硕士学位研究生管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(61, "paragraph", "第八条 附则"),
                _source_row(61, "paragraph", "(一)本规定自公布之日起开始实行,原相关规定自行废止。"),
                _source_row(
                    61,
                    "paragraph",
                    "(二)本规定相关条款分别由教务处、体育学院负责解释,并适时提请修订。",
                ),
                _source_row(
                    61,
                    "paragraph",
                    "附件: 中央民族大学高水平运动员免试推荐硕士研究生运动成绩计算标准",
                ),
                _source_row(61, "paragraph", "附件:"),
                _source_row(61, "heading", "中央民族大学高水平运动员"),
                _source_row(62, "paragraph", "1. 网球队"),
                _source_row(62, "paragraph", "免试推荐硕士研究生运动成绩计算标准"),
                _source_row(
                    62,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["比赛项目", "评分标准"],
                        ["全国大学生运动会或单项比赛", "20分"],
                    ],
                ),
                _source_row(63, "heading", "2. 排球队"),
                _source_row(
                    63,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["比赛项目", "评分标准"],
                        ["全国大学生排球联赛", "20分"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                61,
                63,
                title="中央民族大学推荐应届优秀高水平运动员免试攻读硕士学位研究生管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]

        self.assertEqual(len(article_units), 1)
        self.assertEqual(article_units[0]["anchor"]["article_label"], "第八条")
        self.assertNotIn("附件:", article_units[0]["clean_text"])
        self.assertEqual(
            article_units[0]["clean_text"],
            "附则\n(一)本规定自公布之日起开始实行,原相关规定自行废止。\n(二)本规定相关条款分别由教务处、体育学院负责解释,并适时提请修订。",
        )
        self.assertEqual(len(policy_units), 0)
        table_units = [row for row in result.document_units if row["unit_type"] == "table_unit"]
        self.assertEqual(len(table_units), 2)
        self.assertEqual(table_units[0]["anchor"]["section_path"], ["中央民族大学高水平运动员"])
        self.assertEqual(
            table_units[0]["anchor"]["table_context"], "1. 网球队免试推荐硕士研究生运动成绩计算标准"
        )
        self.assertEqual(table_units[1]["anchor"]["section_path"], ["中央民族大学高水平运动员"])
        self.assertEqual(table_units[1]["anchor"]["table_context"], "2. 排球队")

    def test_cleanup_starts_new_appendix_section_after_marker_only_for_inline_form_template(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    249,
                    "heading",
                    "中央民族大学本科受资助学生参与公益服务活动实施办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(249, "paragraph", "民大学发[2013]7号"),
                _source_row(249, "paragraph", "四、其他"),
                _source_row(250, "paragraph", "1、本实施办法自公布之日起实施。"),
                _source_row(250, "paragraph", "2、本实施办法由中央民族大学助学服务中心负责解释。"),
                _source_row(250, "paragraph", "附件:"),
                _source_row(
                    251,
                    "heading",
                    "中央民族大学公益服务活动证明",
                    block_role="heading",
                    title_candidate_score=0.75,
                ),
                _source_row(
                    251,
                    "paragraph",
                    "兹证明,中央民族大学 ___ 学院(系)学生 ___ (学号 ___ )于 ___ 年 ___ 月 ___ 日至 ___ 月 ___ 日在本单位组织的公益服务活动(义务劳动中)进行服务。累计服务时间为 ___ 小时。",
                ),
                _source_row(251, "paragraph", "特此证明。"),
                _source_row(251, "paragraph", "证明人:___"),
                _source_row(251, "paragraph", "(签字盖章)时间:___ 年 ___ 月 ___ 日"),
                _source_row(251, "paragraph", "中央民族大学助学服务中心审核意见:"),
                _source_row(251, "paragraph", "审核人(签字盖章):"),
                _source_row(251, "paragraph", "时间:___ 年 ___ 月 ___ 日"),
            ],
            manifest_document=_manifest_document(
                249,
                251,
                title="中央民族大学本科受资助学生参与公益服务活动实施办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 2)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["四、其他"])
        self.assertEqual(
            policy_units[0]["clean_text"],
            "1、本实施办法自公布之日起实施。\n2、本实施办法由中央民族大学助学服务中心负责解释。",
        )
        self.assertEqual(
            policy_units[1]["anchor"]["section_path"], ["四、其他", "中央民族大学公益服务活动证明"]
        )
        self.assertNotIn("附件:", policy_units[1]["clean_text"])
        self.assertTrue(
            policy_units[1]["clean_text"].startswith("兹证明,中央民族大学 ___ 学院(系)学生")
        )
        self.assertIn("中央民族大学助学服务中心审核意见:", policy_units[1]["clean_text"])

    def test_cleanup_treats_navigation_leaf_as_section_not_policy_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    301,
                    "heading",
                    "中央民族大学公寓及公费医疗管理规定",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(301, "paragraph", "四、住宿中途申请办理退宿流程"),
                _source_row(301, "paragraph", "1、本科生特殊情况申请办理退宿手续"),
                _source_row(301, "paragraph", "学生须经学院审批后办理退宿。"),
            ],
            manifest_document=_manifest_document(
                301,
                301,
                title="中央民族大学公寓及公费医疗管理规定",
                handbook_section="中央民族大学公寓及公费医疗管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 1)
        self.assertEqual(
            policy_units[0]["anchor"]["section_path"],
            ["四、住宿中途申请办理退宿流程", "1、本科生特殊情况申请办理退宿手续"],
        )
        self.assertEqual(policy_units[0]["clean_text"], "学生须经学院审批后办理退宿。")
        self.assertIn("## 四、住宿中途申请办理退宿流程", result.canonical_markdown)
        self.assertIn("## 1、本科生特殊情况申请办理退宿手续", result.canonical_markdown)

    def test_cleanup_keeps_ascii_punctuated_policy_provisions_inside_policy_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    304,
                    "heading",
                    "中央民族大学本科生国家助学金评审办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(304, "paragraph", "民大校发[2013]155号"),
                _source_row(304, "paragraph", "二、申请条件"),
                _source_row(304, "paragraph", "(一)热爱社会主义祖国,拥护中国共产党的领导;"),
                _source_row(304, "paragraph", "(二)坚定维护祖国统一和民族团结;"),
                _source_row(304, "paragraph", "(三)遵守宪法、法律和"),
                _source_row(304, "paragraph", "学校规章制度;"),
                _source_row(304, "paragraph", "(四)诚实守信,道德品质优良;"),
                _source_row(304, "paragraph", "(五)刻苦努力,勤奋学习,积极上进;"),
                _source_row(
                    304,
                    "paragraph",
                    "(六)积极参加集体活动、校内外社会实践、志愿服务和社会公益活动;",
                ),
                _source_row(304, "paragraph", "(七)已通过家庭经济困难认定。"),
                _source_row(305, "paragraph", "四、评审要求与程序"),
                _source_row(305, "paragraph", "(三)具体评审程序如下:"),
                _source_row(
                    305,
                    "paragraph",
                    "1. 金额分配。每年9月,学校助学服务中心根据当年国家助学金金额,按照各院系困难学生实际情况分配金额。",
                ),
                _source_row(306, "paragraph", "六、助学金的中止"),
                _source_row(
                    306,
                    "paragraph",
                    "出现下列情形之一的,由院系核实并报学校助学服务中心备案,从当月起中止其助学金发放:",
                ),
                _source_row(306, "paragraph", "(一)休学的;"),
                _source_row(306, "paragraph", "(二)保留学籍的;"),
                _source_row(306, "paragraph", "(三)因违纪受到学校处分的;"),
                _source_row(306, "paragraph", "(四)有挥霍浪费、吸烟、酗酒等不良行为的;"),
                _source_row(306, "paragraph", "(五)家庭经济情况明显好转的;"),
                _source_row(306, "paragraph", "(六)休学、退学的;"),
                _source_row(306, "paragraph", "七、本办法由学校助学服务中心组织实施并负责解释。"),
                _source_row(
                    306,
                    "paragraph",
                    "八、本办法自发布之日起开始实施,《中央民族大学国家助学金评审办法(修订)》(民大校发【2011】208号)同时废止。",
                ),
            ],
            manifest_document=_manifest_document(
                304,
                306,
                title="中央民族大学本科生国家助学金评审办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        second_section_units = [
            row for row in policy_units if row["anchor"]["section_path"] == ["二、申请条件"]
        ]
        self.assertEqual(len(second_section_units), 1)
        self.assertIn("(二)坚定维护祖国统一和民族团结;", second_section_units[0]["clean_text"])
        self.assertIn("(三)遵守宪法、法律和学校规章制度;", second_section_units[0]["clean_text"])
        self.assertIn("(五)刻苦努力,勤奋学习,积极上进;", second_section_units[0]["clean_text"])
        self.assertIn(
            "(六)积极参加集体活动、校内外社会实践、志愿服务和社会公益活动;",
            second_section_units[0]["clean_text"],
        )
        self.assertIn("(七)已通过家庭经济困难认定。", second_section_units[0]["clean_text"])

        polluted_section_tails = {
            row["anchor"]["section_path"][-1]
            for row in policy_units
            if len(row["anchor"]["section_path"]) > 1
        }
        self.assertFalse(
            any(tail.startswith("(五)") and "刻苦努力" in tail for tail in polluted_section_tails)
        )
        self.assertFalse(
            any(tail.startswith("(六)") and "休学、退学" in tail for tail in polluted_section_tails)
        )

        process_unit = next(
            row
            for row in policy_units
            if row["anchor"]["section_path"] == ["四、评审要求与程序", "(三)具体评审程序如下:"]
        )
        self.assertIn("1. 金额分配。", process_unit["clean_text"])

        stop_section_text = "\n".join(
            row["clean_text"]
            for row in policy_units
            if row["anchor"]["section_path"] == ["六、助学金的中止"]
        )
        self.assertIn(
            "出现下列情形之一的,由院系核实并报学校助学服务中心备案,从当月起中止其助学金发放:",
            stop_section_text,
        )
        self.assertIn("(六)休学、退学的;", stop_section_text)

    def test_cleanup_splits_multiline_policy_page_row_before_terminal_provisions(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    188,
                    "heading",
                    "中央民族大学全日制本科学生学士学位授予规定",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(188, "paragraph", "民大校发[2009]90号"),
                _source_row(188, "paragraph", "三、学士学位授予程序"),
                _source_row(
                    188,
                    "paragraph",
                    "\n".join(
                        [
                            "1. 学生本人提出申请,填报学士学位申请表。",
                            "2. 院(系)学位委员会对提出申请授予学士学位的学生进行审核,提出建议授予学士学位名单和不授予学士学位名单。",
                            "3. 教务处审核全部学生材料并负责向校学位委员会提出召开学士学位评定委员会会议。",
                            "4. 校学位委员会审查通过获得学士学位的学生名单。",
                            "四、学士学位证书遗失不予补发。如遗失或者损坏,经本人申请,学校核实后出具相应的证明书。证明书与原证书具有同等效力。",
                            "五、本规定自2009年3月17日起实施。",
                        ]
                    ),
                ),
                _source_row(188, "paragraph", "六、本规定由教务处负责解释。"),
            ],
            manifest_document=_manifest_document(
                188,
                188,
                title="中央民族大学全日制本科学生学士学位授予规定",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 4)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["三、学士学位授予程序"])
        self.assertNotIn("四、学士学位证书遗失不予补发", policy_units[0]["clean_text"])
        self.assertEqual(policy_units[1]["anchor"]["section_path"], [])
        self.assertEqual(policy_units[1]["anchor"]["provision_label"], "四")
        self.assertEqual(
            policy_units[1]["clean_text"],
            "四、学士学位证书遗失不予补发。如遗失或者损坏,经本人申请,学校核实后出具相应的证明书。证明书与原证书具有同等效力。",
        )
        self.assertEqual(policy_units[2]["anchor"]["section_path"], [])
        self.assertEqual(policy_units[2]["anchor"]["provision_label"], "五")
        self.assertEqual(policy_units[3]["anchor"]["section_path"], [])
        self.assertEqual(policy_units[3]["anchor"]["provision_label"], "六")

    def test_cleanup_does_not_emit_policy_page_for_appendix_form_title_only(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    302,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(302, "paragraph", "附件:"),
                _source_row(302, "paragraph", "《中央民族大学本科生家庭经济困难学生认定申请表》"),
                _source_row(
                    302,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["姓名", "学院"],
                        ["张三", "文学院"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                302,
                302,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(policy_units, [])
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["中央民族大学本科生家庭经济困难学生认定申请表"],
        )
        self.assertIsNone(table_unit["anchor"].get("table_context"))

    def test_cleanup_replaces_numeric_appendix_leaf_with_attachment_title(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    302,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(302, "paragraph", "第五章 附则"),
                _source_row(302, "paragraph", "附件:"),
                _source_row(302, "paragraph", "二:"),
                _source_row(302, "paragraph", "《中央民族大学本科学生家庭经济情况调查表》"),
                _source_row(
                    302,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["姓名", "学院"],
                        ["张三", "文学院"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                302,
                302,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["第五章 附则", "中央民族大学本科学生家庭经济情况调查表"],
        )

    def test_cleanup_does_not_emit_policy_page_for_ancillary_note_line(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    303,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(303, "paragraph", "附件:"),
                _source_row(303, "paragraph", "1:"),
                _source_row(303, "paragraph", "党委学生工作部、学生处制表"),
                _source_row(
                    303,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["学院", "人数"],
                        ["文学院", "120"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                303,
                303,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(policy_units, [])
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(table_unit["anchor"]["section_path"], [])
        self.assertIsNone(table_unit["anchor"].get("table_context"))

    def test_cleanup_skips_form_legend_policy_page_after_form_table(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    303,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(303, "paragraph", "第五章 附则"),
                _source_row(303, "paragraph", "附件:"),
                _source_row(303, "paragraph", "三:"),
                _source_row(
                    303,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["院系盖章:", "评议小组组长签字:", "院系领导签字:", "报送日期:"],
                        [
                            "序号",
                            "姓名",
                            "认定结果",
                            "户口类型",
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                        ],
                        ["", "", "", "", "", ""],
                    ],
                ),
                _source_row(303, "paragraph", "认定结果为:特别困难、困难;户口类型为:农村、城镇。"),
            ],
            manifest_document=_manifest_document(
                303,
                303,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(policy_units, [])
        raw_table = next(row for row in result.document_units if row["unit_type"] == "table")
        self.assertEqual(raw_table["anchor"]["section_path"], ["第五章 附则"])

    def test_cleanup_keeps_chapter_intro_inline_enumerated_sentences_inside_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    55,
                    "heading",
                    "中央民族大学学生志愿服务管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    55, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(
                    55,
                    "paragraph",
                    "一、为进一步规范中央民族大学学生志愿服务管理工作,特制定本办法。",
                ),
                _source_row(
                    55,
                    "paragraph",
                    "二、志愿者(Volunteer)是指不以物质报酬为目的,自愿为社会和他人提供服务和帮助的人。",
                ),
                _source_row(
                    55, "heading", "第二章 分则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(55, "paragraph", "第一部分 注册"),
                _source_row(55, "paragraph", "中央民族大学注册志愿者应按照规定完成注册。"),
            ],
            manifest_document=_manifest_document(
                55,
                55,
                title="中央民族大学学生志愿服务管理办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["第一章 总则"])
        self.assertNotIn("provision_label", policy_units[0]["anchor"])
        self.assertEqual(
            policy_units[0]["clean_text"],
            (
                "一、为进一步规范中央民族大学学生志愿服务管理工作,特制定本办法。\n"
                "二、志愿者(Volunteer)是指不以物质报酬为目的,自愿为社会和他人提供服务和帮助的人。"
            ),
        )

    def test_cleanup_merges_broken_sentence_lines_without_crossing_structure_boundaries(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    56,
                    "heading",
                    "中央民族大学优秀本科毕业生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    56,
                    "heading",
                    "第三章 评选条件",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(56, "paragraph", "第七条 市级优秀本科毕业生从校级优秀本科毕业生中择"),
                _source_row(56, "paragraph", "优推荐产生。须满足以下条件之一:"),
                _source_row(56, "paragraph", "(一)在校期间获得校级及以上荣誉。"),
            ],
            manifest_document=_manifest_document(
                56,
                56,
                title="中央民族大学优秀本科毕业生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 1)
        self.assertIn("择优推荐产生。须满足以下条件之一:", article_units[0]["clean_text"])
        self.assertIn("(一)在校期间获得校级及以上荣誉。", article_units[0]["clean_text"])
