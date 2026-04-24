from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *


class HandbookCleanupTextNormalizationTest(unittest.TestCase):
    def test_cleanup_ignores_repeated_candidate_even_when_row_type_is_heading(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    18,
                    "heading",
                    "学生手册",
                    block_role="title",
                    title_candidate_score=1.0,
                    is_repeated_candidate=True,
                    classification_confidence=0.6,
                    classification_reason="repeat_cluster:top",
                ),
                _source_row(
                    18,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=0.92,
                    classification_confidence=0.98,
                    classification_reason="doc_title:first_page",
                ),
                _source_row(18, "paragraph", "第一条 为规范境外留学管理工作"),
            ],
            manifest_document=_manifest_document(18, 18, title="制度标题"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["title"], "中央民族大学本科生境外留学管理办法")

    def test_normalize_handbook_body_text_strips_inline_ocr_reference_markers(self) -> None:
        normalized = normalize_handbook_body_text(
            "根据教育部和上级主管部门当年度为学校核定的国家励志奖学金名额和[0]学校二年级以上(含)家庭经济困难在校生总人数,[0]先计算出学校国家励志奖学金名额分配系数。"
        )

        self.assertNotIn("[0]", normalized)
        self.assertIn("国家励志奖学金名额和学校二年级以上", normalized)
        self.assertIn("总人数,先计算出", normalized)

    def test_normalize_handbook_body_text_does_not_merge_heading_tail_with_following_note_line(
        self,
    ) -> None:
        normalized = normalize_handbook_body_text(
            "\n".join(
                [
                    "发表一般文章、专著奖励标准准",
                    "备注：学校官方微信即中央民族大学微信公众号",
                ]
            )
        )

        self.assertEqual(
            normalized,
            "发表一般文章、专著奖励标准\n备注:学校官方微信即中央民族大学微信公众号",
        )
        self.assertNotIn("准备注:", normalized)

    def test_normalize_handbook_article_body_text_recovers_title_tail_ocr_error_before_note_line(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "2. 发表一般文章奖励。学年内在各级媒体发表一般文章(非学术论文)、出版专著(非学术专著)的,按以下标准给予奖励;",
                    "发表一般文章、专著奖励标准准",
                    "备注：学校官方微信即中央民族大学微信公众号",
                    "(1)同一作品同时在多个媒体平台发表,按最高项加分;",
                ]
            )
        )

        self.assertIn("发表一般文章、专著奖励标准", normalized)
        self.assertIn("备注:学校官方微信即中央民族大学微信公众号", normalized)
        self.assertNotIn("发表一般文章、专著奖励标准准", normalized)
        self.assertNotIn("准备注:", normalized)

    def test_normalize_handbook_article_body_text_removes_slash_page_markers(self) -> None:
        normalized = normalize_handbook_article_body_text(
            "第三章 学籍管理\n"
            "/96\n"
            "第一节 入学与注册\n"
            "第六条 按国家招生规定录取的新生,须持录取通知书办理入学手续。"
        )

        self.assertIn("第三章 学籍管理", normalized)
        self.assertIn("第一节 入学与注册", normalized)
        self.assertNotIn("/96", normalized)

    def test_cleanup_handbook_document_removes_slash_page_marker_headings(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    96,
                    "heading",
                    "中央民族大学学生管理规定",
                    block_role="title",
                    title_candidate_score=0.98,
                    classification_confidence=0.98,
                    classification_reason="doc_title:first_page",
                ),
                _source_row(96, "heading", "第三章 学籍管理"),
                _source_row(96, "heading", "/96"),
                _source_row(96, "heading", "第一节 入学与注册"),
                _source_row(
                    96,
                    "paragraph",
                    "第六条 按国家招生规定录取的新生,须持录取通知书办理入学手续。",
                ),
            ],
            manifest_document=_manifest_document(96, 96, title="中央民族大学学生管理规定"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn("## 第三章 学籍管理", result.canonical_markdown)
        self.assertIn("## 第一节 入学与注册", result.canonical_markdown)
        self.assertNotIn("/96", result.canonical_markdown)

    def test_normalize_handbook_article_body_text_merges_soft_wrap_after_pause_punctuation(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "第十一条 在校园设置临时或者永久建筑物以及安装音响、",
                    "广播、电视设施,设置者、安装者应当报请学校有关机构审批,未经批准不得擅自设置、安装。",
                ]
            )
        )

        self.assertEqual(
            normalized,
            "第十一条 在校园设置临时或者永久建筑物以及安装音响、广播、电视设施,设置者、安装者应当报请学校有关机构审批,未经批准不得擅自设置、安装。",
        )
        self.assertNotIn("音响、\n广播", normalized)

    def test_normalize_handbook_article_body_text_splits_glued_review_headings(self) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "(二)学院(系)推荐学院(系)按照评选通知要求,严格审核学生申报资格以及相关材料的真实性。",
                    "(三)学校初审党委学生工作部、学生处根据学院(系)推荐名单进行初审,提出国家励志奖学金拟获奖学生初审名单。",
                    "(四)国家民族事务委员会复审国家民族事务委员会组织评审委员会召开评审会进行复审,无异议后,确定获奖名单。",
                ]
            )
        )

        self.assertIn(
            "(二)学院(系)推荐\n学院(系)按照评选通知要求,严格审核学生申报资格以及相关材料的真实性。",
            normalized,
        )
        self.assertIn(
            "(三)学校初审\n党委学生工作部、学生处根据学院(系)推荐名单进行初审,提出国家励志奖学金拟获奖学生初审名单。",
            normalized,
        )
        self.assertIn(
            "(四)国家民族事务委员会复审\n国家民族事务委员会组织评审委员会召开评审会进行复审,无异议后,确定获奖名单。",
            normalized,
        )

    def test_normalize_handbook_body_text_repairs_confirmed_ocr_phrase_errors(self) -> None:
        normalized = normalize_handbook_body_text(
            "\n".join(
                [
                    "宿舍内允许使用永恒的所有电器(包括接线板、充电器)必须是经3C(中国强制认证)认证的产品。",
                    "(一) 违规电器一律不准带入学生宿舍内, 私自将违规电器带入室内着, 一经查获, 由学生公寓部没收并报院系, 给予当事者通报批评。",
                    "造成严重后果者,一法追究法律责任。",
                    "(六)积极参加集体活动、校内外社会实践、志愿志愿服务和社会公益活动;",
                    "(三)学校助学服务中心中心于每年11月15日前将当年国家助学金政策落实情况进行认真总结,并报上级主管部门备案。",
                    "为了加强高等学校管理,维护正常的教学和生活程序,保障学生人身和财物的安全。",
                    "由当地劳动部门按国家关于残疾人劳动就业有关规定部分定安置。",
                    "由学校或有关单位参照国家关于事业职业死亡丧葬有关规定处理。",
                    "因本人直接责任造成财务被盗、火灾、事故等而产生临时性生活困难的。",
                    "(一)如实陈述和申辩本人本人违法、违规或违纪事实和回答主持人的提问;",
                    "(四)公正地履行主持听证的职责,保证当事人和调查人行使陈述权、申辩权。",
                ]
            )
        )

        self.assertIn("允许使用的所有电器", normalized)
        self.assertNotIn("允许使用永恒的所有电器", normalized)
        self.assertIn("私自将违规电器带入室内者", normalized)
        self.assertNotIn("私自将违规电器带入室内着", normalized)
        self.assertIn("依法追究法律责任", normalized)
        self.assertNotIn("一法追究法律责任", normalized)
        self.assertIn("志愿服务和社会公益活动", normalized)
        self.assertNotIn("志愿志愿服务", normalized)
        self.assertIn("学校助学服务中心于每年11月15日前", normalized)
        self.assertNotIn("助学服务中心中心", normalized)
        self.assertIn("维护正常的教学和生活秩序", normalized)
        self.assertNotIn("教学和生活程序", normalized)
        self.assertIn("残疾人劳动就业有关规定安置", normalized)
        self.assertNotIn("部分定安置", normalized)
        self.assertIn("事业职工死亡丧葬有关规定", normalized)
        self.assertNotIn("事业职业死亡丧葬", normalized)
        self.assertIn("造成财物被盗、火灾、事故", normalized)
        self.assertNotIn("财务被盗", normalized)
        self.assertIn("申辩本人违法、违规或违纪事实", normalized)
        self.assertNotIn("本人本人违法", normalized)
        self.assertIn("当事人和调查人员行使陈述权", normalized)
        self.assertNotIn("调查人行使", normalized)

    def test_normalize_handbook_article_body_text_merges_fragmented_hearing_subject(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "拟被处分或者处理",
                    "学生认为听证主持人与本事件有直接利害关系的,有权申请回避。",
                    "(二) 调查人员提出拟被处分或者处理",
                    "学生违法或违规违纪的事实、证据。",
                    "(六) 拟被处分或者处理",
                    "学生做最后陈述",
                    "(三)院系审核,提交材料",
                    "各院系根据转专业的原则和条件对申请",
                    "学生进行审核,并将合格的学生申请材料及汇总表统一报教务处。",
                ]
            )
        )

        self.assertIn("拟被处分或者处理学生认为听证主持人与本事件有直接利害关系", normalized)
        self.assertIn(
            "(二) 调查人员提出拟被处分或者处理学生违法或违规违纪的事实、证据。", normalized
        )
        self.assertIn("(六) 拟被处分或者处理学生做最后陈述", normalized)
        self.assertIn("各院系根据转专业的原则和条件对申请学生进行审核", normalized)
        self.assertNotIn("拟被处分或者处理\n学生", normalized)
        self.assertNotIn("对申请\n学生", normalized)

    def test_normalize_handbook_body_text_repairs_missing_closing_parenthesis_after_doc_no(
        self,
    ) -> None:
        normalized = normalize_handbook_body_text(
            "为认真贯彻中央《关于进一步加强和改进大学生思想政治教育的意见》(中发〔2004〕16号文件),"
            "深入落实《中央民族大学关于进一步加强和改进新时期大学生思想政治教育的实施意见》"
            "(民大党发〔2009〕41号的精神,引导学生共同进步。"
        )

        self.assertIn("(民大党发〔2009〕41号)的精神", normalized)
        self.assertNotIn("(民大党发〔2009〕41号的精神", normalized)

    def test_normalize_handbook_article_body_text_repairs_confirmed_soft_wraps(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "优秀本科毕业生包括北京市级优秀本科毕业生和校级优秀本科毕业生两个类别。其中,校级优秀本科毕业生总人数不超过应届毕业生总人数的 $10\\%$ ,北京市级优秀本科毕业生从",
                    "校级优秀本科毕业生中择优产生,总人数不超过应届毕业生总人数的 $5\\%$ 。",
                    "申诉学生本人有要求",
                    "学生申诉处理委员会相关成员回避的权利。",
                    "(三)分级审定拟定名单在全校范围内公示5个工作日。",
                ]
            )
        )

        self.assertIn("北京市级优秀本科毕业生从校级优秀本科毕业生中择优产生", normalized)
        self.assertIn("应届毕业生总人数的 10%,北京市级优秀本科毕业生从", normalized)
        self.assertIn("应届毕业生总人数的 5%。", normalized)
        self.assertIn("申诉学生本人有要求学生申诉处理委员会相关成员回避的权利", normalized)
        self.assertIn("(三) 分级审定\n拟定名单在全校范围内公示5个工作日。", normalized)
        self.assertNotIn("$10\\%$", normalized)
        self.assertNotIn("$5\\%$", normalized)
        self.assertNotIn("从\n校级优秀本科毕业生", normalized)
        self.assertNotIn("有要求\n学生申诉处理委员会", normalized)
        self.assertNotIn("分级审定拟定名单", normalized)

    def test_normalize_handbook_article_body_text_repairs_round9_soft_wraps_and_phrase_splits(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "第十二条 本科学生专项奖学金按以下程序",
                    "进行评选:",
                    "(七)临时困难补助学生在校学习期间因本人或家庭出现特殊情况,可申请补助。",
                    "(八)绿色通道学校在每学年新生入学时为家庭经济特别困难新生办理入学手续。",
                    "(二) 学生参加勤工助学的工作时间",
                    "原则上每周不超过10小时,每月不超过40小时。",
                    "家庭经济困难学生的勤工助学岗位聘用率,原则上应不低于 $70\\%$",
                    "做好对参加勤工助学",
                    "学生的考勤管理,并组织岗位培训。",
                ]
            )
        )

        self.assertIn("本科学生专项奖学金按以下程序进行评选:", normalized)
        self.assertIn("(七)临时困难补助\n学生在校学习期间因本人或家庭出现特殊情况,可申请补助。", normalized)
        self.assertIn(
            "(八)绿色通道\n学校在每学年新生入学时为家庭经济特别困难新生办理入学手续。",
            normalized,
        )
        self.assertIn("学生参加勤工助学的工作时间原则上每周不超过10小时", normalized)
        self.assertIn("家庭经济困难学生的勤工助学岗位聘用率,原则上应不低于 70%。", normalized)
        self.assertIn("做好对参加勤工助学学生的考勤管理,并组织岗位培训。", normalized)
        self.assertNotIn("按以下程序\n进行评选", normalized)
        self.assertNotIn("工作时间\n原则上每周", normalized)
        self.assertNotIn("做好对参加勤工助学\n学生的考勤管理", normalized)
        self.assertNotIn("$70\\%$", normalized)

    def test_normalize_handbook_article_body_text_normalizes_inline_math_artifacts(self) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "学院(系)学生干部评选比例不超过参评学生总数的 $3.5\\%$ ;校级学生组织学生干部评选比例不超过参评校级学生干部总数的 $20\\%$ 。",
                    "个人申请 $\\rightarrow$ 班级推荐 $\\rightarrow$ 学院初审。",
                ]
            )
        )

        self.assertIn("学院(系)学生干部评选比例不超过参评学生总数的 3.5%;", normalized)
        self.assertIn("参评校级学生干部总数的 20%。", normalized)
        self.assertIn("个人申请 → 班级推荐 → 学院初审。", normalized)
        self.assertNotIn("$3.5\\%$", normalized)
        self.assertNotIn("$20\\%$", normalized)
        self.assertNotIn("$\\rightarrow$", normalized)

    def test_normalize_handbook_article_body_text_splits_glued_short_heading_from_body(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "第十条 大类分专业的时间大类分专业一般在学生入校后 1–2 年后进行,根据各专业具体情况确定。"
        )

        self.assertIn(
            "第十条 大类分专业的时间\n大类分专业一般在学生入校后 1–2 年后进行,根据各专业具体情况确定。",
            normalized,
        )

    def test_normalize_handbook_article_body_text_splits_and_deduplicates_repeated_list_heading_from_body(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "第五条 资助方式",
                    "(一)奖学金奖学金用于奖励品学兼优、综合素质全面发展的在校学生。",
                    "(二) 助学金助学金用于资助家庭经济困难、品学兼优的在校学生。",
                    "(三)勤工助学学校提供一定数量的勤工助学岗位。",
                    "1、应征入伍服义务兵役学生学费及国家助学贷款代偿应征入伍服义务兵役的应届毕业生,在毕业入伍当年向学校申请,可获得学费资助。",
                    "2、赴基层单位就业学生的学费和国家助学贷款代偿自愿到中西部地区和艰苦边远地区基层单位就业、服务期达到3年以上(含3年)的应届毕业生,在毕业当年向学校申请,可获得相应的学费和国家助学贷款代偿。",
                    "(六)学费、住宿费减免无经济来源的烈士子女可申请减免学费、住宿费。",
                ]
            )
        )

        self.assertIn("(一) 奖学金\n用于奖励品学兼优、综合素质全面发展的在校学生。", normalized)
        self.assertIn("(二) 助学金\n用于资助家庭经济困难、品学兼优的在校学生。", normalized)
        self.assertIn("(三) 勤工助学\n学校提供一定数量的勤工助学岗位。", normalized)
        self.assertIn(
            "1、 应征入伍服义务兵役学生学费及国家助学贷款代偿\n应征入伍服义务兵役的应届毕业生,在毕业入伍当年向学校申请,可获得学费资助。",
            normalized,
        )
        self.assertIn(
            "2、 赴基层单位就业学生的学费和国家助学贷款代偿\n自愿到中西部地区和艰苦边远地区基层单位就业、服务期达到3年以上(含3年)的应届毕业生,在毕业当年向学校申请,可获得相应的学费和国家助学贷款代偿。",
            normalized,
        )
        self.assertIn(
            "(六) 学费、住宿费减免\n无经济来源的烈士子女可申请减免学费、住宿费。", normalized
        )
        self.assertNotIn("奖学金奖学金用于", normalized)
        self.assertNotIn("助学金助学金用于", normalized)
        self.assertNotIn("代偿应征入伍服义务兵役", normalized)
        self.assertNotIn("代偿自愿到中西部地区", normalized)

    def test_normalize_handbook_article_body_text_splits_professional_adjustment_inline_headings(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "(二)学生申请本科学生根据学校公布的转专业计划提出转专业申请。",
                    "(三)院系审核,提交材料各院系根据转专业的原则和条件对申请学生进行审核。",
                    "(四)公布参加转专业考试学生名单及考试具体安排教务处对所有转专业学生申请材料进行复核。",
                    "1. 考核方式考核形式由各院系确定,原则上考核包括笔试和面试。",
                    "1. 拟接收名单的确定院系按照笔试和面试总成绩从高到低排序。",
                    "(七)手续办理学校确定正式名单后,转专业学生凭教务处通知办理转专业手续。",
                ]
            )
        )

        self.assertIn("(二) 学生申请\n本科学生根据学校公布的转专业计划提出转专业申请。", normalized)
        self.assertIn(
            "(三) 院系审核,提交材料\n各院系根据转专业的原则和条件对申请学生进行审核。", normalized
        )
        self.assertIn(
            "(四) 公布参加转专业考试学生名单及考试具体安排\n教务处对所有转专业学生申请材料进行复核。",
            normalized,
        )
        self.assertIn("1. 考核方式\n考核形式由各院系确定,原则上考核包括笔试和面试。", normalized)
        self.assertIn("1. 拟接收名单的确定\n院系按照笔试和面试总成绩从高到低排序。", normalized)
        self.assertIn(
            "(七) 手续办理\n学校确定正式名单后,转专业学生凭教务处通知办理转专业手续。", normalized
        )
        self.assertNotIn("学生申请本科学生", normalized)
        self.assertNotIn("考核方式考核形式", normalized)

    def test_normalize_handbook_article_body_text_merges_professional_adjustment_clause_wraps(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "二、实行个人申请、选拔",
                    "确定的工作制度;",
                    "四、教务处对院系报送的分专业学生名单",
                    "进行审核汇总,报主管校领导审批后向全校公示。",
                ]
            )
        )

        self.assertIn("二、实行个人申请、选拔确定的工作制度;", normalized)
        self.assertIn(
            "四、教务处对院系报送的分专业学生名单进行审核汇总,报主管校领导审批后向全校公示。",
            normalized,
        )
        self.assertNotIn("选拔\n确定", normalized)
        self.assertNotIn("名单\n进行", normalized)

    def test_cleanup_places_table_after_its_following_intro_article(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    30,
                    "heading",
                    "中央民族大学本科学分制实施办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(30, "paragraph", "第一章 总 则"),
                _source_row(30, "paragraph", "第一条 总则正文。"),
                _source_row(30, "paragraph", "第二章 学制与学分"),
                _source_row(
                    30,
                    "table",
                    "<table><tr><td>专业类别</td><td>四年制</td></tr>"
                    "<tr><td>文史哲经管法教类</td><td>147学分</td></tr></table>",
                    html=(
                        "<table><tr><td>专业类别</td><td>四年制</td></tr>"
                        "<tr><td>文史哲经管法教类</td><td>147学分</td></tr></table>"
                    ),
                    table_cells=[
                        ["专业类别", "四年制"],
                        ["文史哲经管法教类", "147学分"],
                    ],
                ),
                _source_row(
                    30,
                    "paragraph",
                    "第二条 标准学制为4年的,学习年限为3-5年。",
                ),
                _source_row(30, "paragraph", "第三条 各专业学分要求如下:"),
                _source_row(30, "paragraph", "第四条 提前毕业规定。"),
            ],
            manifest_document=_manifest_document(
                30,
                30,
                title="中央民族大学本科学分制实施办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        markdown = result.canonical_markdown
        self.assertLess(markdown.index("### 第二条"), markdown.index("### 第三条"))
        self.assertLess(markdown.index("各专业学分要求如下:"), markdown.index("[表格]"))
        self.assertLess(markdown.index("[表格]"), markdown.index("### 第四条"))

    def test_cleanup_merges_broken_policy_doc_no_citation_lines(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    18,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(18, "paragraph", "第十一条 课程、学分与成绩认定"),
                _source_row(
                    18,
                    "paragraph",
                    "1. 成绩认定采用对应原则,百分制成绩、成绩等级及学分绩点的对应关系根据《中央民族大学本科学生学籍管理规定》(民大校发",
                ),
                _source_row(18, "paragraph", "[2009]89号)规定执行。"),
            ],
            manifest_document=_manifest_document(
                18,
                18,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 1)
        self.assertIn("(民大校发[2009]89号)规定执行。", article_units[0]["clean_text"])
        self.assertNotIn("(民大校发\n[2009]89号)", article_units[0]["clean_text"])

    def test_cleanup_repairs_missing_closing_parenthesis_after_doc_no_in_single_row(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    184,
                    "heading",
                    "中央民族大学十佳大学生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(184, "paragraph", "民大校发[2009]358号"),
                _source_row(184, "paragraph", "第一章 总 则"),
                _source_row(
                    184,
                    "paragraph",
                    "第一条 为认真贯彻中央《关于进一步加强和改进大学生思想政治教育的意见》(中发〔2004〕16号文件),"
                    "深入落实《中央民族大学关于进一步加强和改进新时期大学生思想政治教育的实施意见》"
                    "(民大党发〔2009〕41号的精神,引导学生德、智、体全面发展,特制定本办法。",
                ),
            ],
            manifest_document=_manifest_document(
                184,
                184,
                title="中央民族大学十佳大学生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 1)
        self.assertIn("(民大党发〔2009〕41号)的精神", article_units[0]["clean_text"])
        self.assertNotIn("(民大党发〔2009〕41号的精神", article_units[0]["clean_text"])

    def test_cleanup_merges_broken_structural_line_continuations(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    30,
                    "heading",
                    "中央民族大学本科学生专业奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    30, "paragraph", "第六条 所评学年有下列情况之一者,不得参评本科学生专业奖学金:"
                ),
                _source_row(30, "paragraph", "(二)所评学年所修各门课程有不及格或体质测试评定不合"),
                _source_row(30, "paragraph", "格的;"),
            ],
            manifest_document=_manifest_document(
                30,
                30,
                title="中央民族大学本科学生专业奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 1)
        self.assertIn("不合格的;", article_units[0]["clean_text"])
        self.assertNotIn("不合\n格的;", article_units[0]["clean_text"])

    def test_normalize_handbook_body_text_repairs_round8_phrase_errors(self) -> None:
        normalized = normalize_handbook_body_text(
            "\n".join(
                [
                    "开展争创先十佳大学生评选活动是我校德育教育的重要组成部分。",
                    "入围名单确定后,如有项目名额出现空缺,或有人围学生中途放弃时,教务处根据排名递补。",
                ]
            )
        )

        self.assertIn("开展争创十佳大学生评选活动", normalized)
        self.assertNotIn("开展争创先十佳大学生评选活动", normalized)
        self.assertIn("或有入围学生中途放弃时", normalized)
        self.assertNotIn("或有人围学生中途放弃时", normalized)

    def test_normalize_handbook_article_body_text_merges_fragmented_applicant_material_subject(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "第七条 选拔程序与要求",
                    "(三)报名审核",
                    "各院系负责审核并将符合项目选拔要求的申请",
                    "学生材料及相关材料统一报教务处。教务处复核后通知符合项目要求的申请学生参加具体选拔。",
                ]
            )
        )

        self.assertIn(
            "各院系负责审核并将符合项目选拔要求的申请学生材料及相关材料统一报教务处。",
            normalized,
        )
        self.assertNotIn("申请\n学生材料", normalized)

    def test_normalize_handbook_article_body_text_repairs_commissioned_selection_phrase(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "(二)发布选拔要求与通知",
                    "1. 委托院系选拔方式,主要适用于对于只涉及 1 个学院的项目,在学校统一公布项目要求后,教务处委托相关院系按照学校的标准要求组织选拔。",
                ]
            )
        )

        self.assertIn("主要适用于只涉及1个学院的项目", normalized)
        self.assertNotIn("主要适用于对于只涉及", normalized)

    def test_normalize_handbook_article_body_text_keeps_interview_assessment_sentence_inline(
        self,
    ) -> None:
        normalized = normalize_handbook_article_body_text(
            "\n".join(
                [
                    "(六)面试考核",
                    "1. 面试主要考核申请者的口语表达能力和综合素质。",
                ]
            )
        )

        self.assertIn("1. 面试主要考核申请者的口语表达能力和综合素质。", normalized)
        self.assertNotIn("1. 面试主要考核\n申请者的口语表达能力和综合素质。", normalized)

    def test_normalize_handbook_body_text_repairs_grade_conversion_table_headers(self) -> None:
        normalized = normalize_handbook_body_text(
            "\n".join(
                [
                    "境外等级 成绩",
                    "校内百分 制成绩",
                    "境外 5 分制",
                ]
            )
        )

        self.assertIn("境外等级成绩", normalized)
        self.assertIn("校内百分制成绩", normalized)
        self.assertIn("境外5分制", normalized)
        self.assertNotIn("境外等级 成绩", normalized)
        self.assertNotIn("校内百分 制成绩", normalized)
        self.assertNotIn("境外 5 分制", normalized)
