from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
    build_regulation_document_units,
    normalize_regulation_owner_text,
)


class CollectedNoticeRegulationTextNormalizationTests(unittest.TestCase):
    def test_quoted_wrapper_title_does_not_define_canonical_body(self) -> None:
        title = "中央民族大学毕业生就业奖励办法"
        owner_text = (
            "中央民族大学关于印发《中央民族大学毕业生就业奖励办法》的通知\n\n"
            "学校各单位、各部门：\n\n"
            "《中央民族大学毕业生就业奖励办法》已经学校校长办公会研究通过，"
            "现印发给你们，请遵照执行。\n\n"
            "中央民族大学\n\n"
            "2019年10月16日\n\n"
            "中央民族大学毕业生就业奖励办法\n\n"
            "第一章总则\n\n"
            "第一条 为贯彻落实有关文件精神，制定本奖励办法。\n\n"
            "-2-\n\n"
            "第二条 本办法适用于学校毕业生。"
        )

        result = normalize_regulation_owner_text(title=title, owner_text=owner_text)

        self.assertTrue(result.wrapper_removed)
        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("》的通知", result.canonical_body)
        self.assertNotIn("学校各单位", result.canonical_body)
        self.assertNotIn("现印发给你们，请遵照执行", result.canonical_body)
        self.assertNotIn("-2-", result.canonical_body)
        self.assertIn("第一章 总则", result.canonical_body)
        self.assertEqual(result.title_occurrence_count, 3)
        self.assertEqual(result.chapter_count, 1)
        self.assertEqual(result.article_count, 2)
        self.assertGreaterEqual(result.page_artifact_count, 1)

    def test_clean_scoped_rule_keeps_body_and_builds_article_units(self) -> None:
        title = "中央民族大学研究生学位论文评阅办法（试行）"
        owner_text = (
            "中央民族大学研究生学位论文评阅办法（试行）\n\n"
            "民大校发（2021）149号\n\n"
            "一、评阅原则、评阅范围及评阅方式\n\n"
            "（一）评阅原则\n\n"
            "学位论文的评阅须遵守国家宪法和法律。\n\n"
            "二、评阅程序\n\n"
            "（一）申请人提交材料。"
        )

        result = normalize_regulation_owner_text(title=title, owner_text=owner_text)
        units = build_regulation_document_units(
            target_document_id="institutional_regulation:muc:thesis-review",
            title=title,
            canonical_body=result.canonical_body,
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("民大校发", result.canonical_body)
        self.assertGreaterEqual(len(units), 2)
        self.assertEqual(units[0]["unit_type"], "article")
        self.assertEqual(
            units[0]["unit_id"], "institutional_regulation:muc:thesis-review#unit-0001"
        )
        self.assertIn("评阅原则", units[0]["text_preview"])

    def test_sparse_body_is_flagged_for_manual_review(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学某事项管理办法",
            owner_text="中央民族大学某事项管理办法\n\n本办法另行解释。",
        )

        self.assertEqual(result.quality_verdict, "flagged_manual_review")
        self.assertIn("insufficient_regulation_structure", result.reason_codes)

    def test_body_citation_to_notice_is_not_wrapper_residue(self) -> None:
        title = "中央民族大学某事项管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n第一章总则\n\n第一条 根据《关于做好相关工作的通知》要求，制定本办法。"
            ),
        )

        self.assertFalse(result.suspicious_prefix)
        self.assertEqual(result.quality_verdict, "passed")

    def test_title_stripped_regulation_preface_before_first_chapter_is_preserved(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学岗位设置与聘用管理暂行办法",
            owner_text=(
                "为切实做好学校岗位设置与聘用工作，根据《国家民委事业单位岗位设置管理实施意见》"
                "等文件精神和经国家民委批复的《中央民族大学岗位设置方案》的有关规定，"
                "制定本暂行办法。\n\n"
                "第一章 总 则\n\n"
                "一、岗位设置与聘用原则\n\n"
                "根据按需设岗、按岗聘用、竞争上岗、合同管理的要求，坚持按以下原则做好岗位设置与聘用工作。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertFalse(result.wrapper_removed)
        self.assertNotIn("wrapper_removed", result.reason_codes)
        self.assertTrue(result.canonical_body.startswith("为切实做好学校岗位设置与聘用工作"))
        self.assertIn("制定本暂行办法。", result.canonical_body)
        self.assertIn("第一章 总 则", result.canonical_body)

    def test_canonical_cleaning_repairs_ocr_soft_wrap_and_cjk_punctuation(self) -> None:
        title = "中央民族大学学生社团管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                "中央民族大学关于印发《中央民族大学学生社团管理办法》的通知\n\n"
                "现印发给你们，请遵照执行。\n\n"
                "中央民族大学学生社团管理办法\n\n"
                "第一章总则\n\n"
                "第一条 为进一步加强学生社团建设, 结合学校实际, 制定本办法。\n\n"
                "第二条 发起人基本情况包括思想政治、日常表现、学习\n\n"
                "成绩等材料。\n\n"
                "第三条 以铸牢中华民族共同体意识为主线, 团结凝聚广大学生, 丰富学生\n\n"
                "课余生活。\n\n"
                "第四条 学生社团指导教师的主要职责是:指导学生社团发展建设。\n\n"
                "(五) 其他不宜批准成立的。\n"
            ),
        )

        self.assertEqual(result.normalizer_version, REGULATION_CANONICAL_NORMALIZER_VERSION)
        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("soft_wrap_repaired", result.reason_codes)
        self.assertIn("readable_text_normalized", result.reason_codes)
        self.assertGreaterEqual(result.soft_wrap_repair_count, 2)
        self.assertGreaterEqual(result.readability_normalization_count, 1)
        self.assertIn("学习成绩", result.canonical_body)
        self.assertIn("学生课余生活", result.canonical_body)
        self.assertIn("建设，结合学校实际，制定本办法。", result.canonical_body)
        self.assertIn("主要职责是：指导学生社团发展建设。", result.canonical_body)
        self.assertIn("（五） 其他不宜批准成立的。", result.canonical_body)
        self.assertNotIn("学习\n\n成绩", result.canonical_body)
        self.assertNotIn("主线,", result.canonical_body)

    def test_canonical_cleaning_repairs_page_artifact_soft_wrap_with_repeated_blank_lines(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学毕业生就业奖励办法",
            owner_text=(
                "中央民族大学毕业生就业奖励办法\n\n"
                "第一章总则\n\n"
                "第一条 学校对到西部地区和基层单位就业的学生（以下简称“到西部\n\n"
                "-2-\n\n"
                "基层就业学生”）给予表彰和奖励。\n\n"
                "第二条 到四川、重庆、陕西、甘肃四省市以及恩施、湘西、\n\n"
                "-3-\n\n"
                "延边三州就业的，一次性奖励500元。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("page_artifacts_removed", result.reason_codes)
        self.assertIn("soft_wrap_repaired", result.reason_codes)
        self.assertGreaterEqual(result.soft_wrap_repair_count, 2)
        self.assertNotIn("到西部\n\n基层就业学生", result.canonical_body)
        self.assertNotIn("湘西、\n\n延边", result.canonical_body)
        self.assertIn("到西部基层就业学生", result.canonical_body)
        self.assertIn("湘西、延边三州", result.canonical_body)

    def test_canonical_cleaning_removes_publication_imprint_tail(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学毕业生就业奖励办法",
            owner_text=(
                "中央民族大学毕业生就业奖励办法\n\n"
                "第一章总则\n\n"
                "第一条 本办法适用于学校毕业生。\n\n"
                "第二条 本办法由招生就业工作处负责解释。\n\n"
                "中央民族大学校长办公室\n\n"
                "2019年10月23日印发"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)
        self.assertEqual(result.soft_wrap_residue_count, 0)
        self.assertIn("publication_imprint_removed", result.reason_codes)
        self.assertNotIn("中央民族大学校长办公室", result.canonical_body)
        self.assertNotIn("2019年10月23日印发", result.canonical_body)

    def test_canonical_cleaning_removes_publication_imprint_tail_with_middle_dot_page_marker(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学党建经费管理办法",
            owner_text=(
                "中央民族大学党建经费管理办法\n\n"
                "第一章总则\n\n"
                "第一条 为规范党建经费管理，制定本办法。\n\n"
                "第二条 本办法由党委办公室负责解释。\n\n"
                "中央民族大学党委办公室\n\n"
                "2021年5月20日印发\n\n"
                "-6·"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("page_artifacts_removed", result.reason_codes)
        self.assertIn("publication_imprint_removed", result.reason_codes)
        self.assertNotIn("中央民族大学党委办公室", result.canonical_body)
        self.assertNotIn("2021年5月20日印发", result.canonical_body)
        self.assertNotIn("-6·", result.canonical_body)

    def test_canonical_cleaning_removes_college_publication_signature_tail(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则",
            owner_text=(
                "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则\n\n"
                "一、招生专业\n\n"
                "新闻传播学\n\n"
                "二、其他事项\n\n"
                "本实施办法由新闻与传播学院负责解释。\n\n"
                "中央民族大学新闻与传播学院\n\n"
                "2025年12月14日"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("publication_imprint_removed", result.reason_codes)
        self.assertIn("本实施办法由新闻与传播学院负责解释。", result.canonical_body)
        self.assertNotIn("中央民族大学新闻与传播学院\n2025年12月14日", result.canonical_body)
        self.assertNotIn("2025年12月14日", result.canonical_body)

    def test_canonical_cleaning_removes_embedded_signature_suffix_without_dropping_content(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
            owner_text=(
                "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n"
                "一、推荐流程\n\n"
                "第一条 学院成立推荐免试研究生工作小组。\n\n"
                "四、学院推荐免试研究生工作小组\n\n"
                "组长：毛湛文、马娟\n\n"
                "成员：林焕祥、袁会、雷蕾、权姗姗、常赫投诉电话：010-68934746新闻与传播学院\n\n"
                "2025年9月5日"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("publication_imprint_removed", result.reason_codes)
        self.assertIn("投诉电话：010-68934746", result.canonical_body)
        self.assertNotIn("010-68934746新闻与传播学院", result.canonical_body)
        self.assertNotIn("2025年9月5日", result.canonical_body)

    def test_canonical_cleaning_removes_application_form_attachment_tail(
        self,
    ) -> None:
        title = "中央民族大学学生参加国际外语水平考试暨国际化培养项目奖励暂行办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                "第一条 为规范国际化培养项目奖励，制定本办法。\n\n"
                "第二条 本办法适用于符合条件的学生。\n\n"
                "第六条 本办法自印发之日起施行。\n\n"
                "附件：中央民族大学学生参加国际外语水平考试暨国际化培养项目奖励申请表\n\n"
                "中央民族大学学生参加国际外语水平考试暨国际化培养项目奖励申请表\n\n"
                "申请人基本信息\n\n"
                "姓名 | | 性别 | | 籍贯 |\n\n"
                "申请人承诺\n\n"
                "以上所填内容完全属实。\n\n"
                "学院意见 | 该生符合申请条件，同意申报奖励。\n\n"
                "中央民族大学国际合作处（港澳台事务办公室）制表"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertIn("第六条 本办法自印发之日起施行。", result.canonical_body)
        self.assertNotIn("奖励申请表", result.canonical_body)
        self.assertNotIn("申请人基本信息", result.canonical_body)
        self.assertNotIn("申请人承诺", result.canonical_body)
        self.assertNotIn("学院意见", result.canonical_body)

    def test_canonical_cleaning_removes_flattened_html_information_table_tail(
        self,
    ) -> None:
        title = "中央民族大学学费、住宿费收费管理规定"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                "第一条 为规范学费、住宿费收费管理，制定本规定。\n\n"
                "第二十二条 本办法自发布之日起施行。\n\n"
                "附表 1\n\n"
                "新生学费库数据信息表\n\n"
                "<table><tr>"
                "<td>姓名</td><td>学号</td><td>身份证号</td><td>学院</td>"
                "</tr><tr><td></td><td></td><td></td><td></td></tr></table>\n\n"
                "附表 2\n\n"
                "学生贷款信息表\n\n"
                "<table><tr><td>姓名</td><td>身份证号</td></tr></table>"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("html_markup_flattened", result.reason_codes)
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertIn("第二十二条 本办法自发布之日起施行。", result.canonical_body)
        self.assertNotIn("附表 1", result.canonical_body)
        self.assertNotIn("附表 2", result.canonical_body)
        self.assertNotIn("新生学费库数据信息表", result.canonical_body)
        self.assertNotIn("学生贷款信息表", result.canonical_body)
        self.assertNotIn("身份证号", result.canonical_body)

    def test_canonical_cleaning_removes_supplementary_indicator_table_tail(
        self,
    ) -> None:
        title = "中央民族大学本科教学质量监控管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                "第一章总则\n\n"
                "第一条 为健全本科教学质量监控体系，制定本办法。\n\n"
                "第四章附则\n\n"
                "第十八条 本办法由教务处负责解释。\n\n"
                "附件1\n\n"
                "专业评估指标体系\n\n"
                "一级指标 | 二级指标 | 评价内容 | 备注\n\n"
                "生源与条件保障 | 生源质量 | 近3年该专业的生源质量。 | 一流专业适用\n\n"
                "附件2\n\n"
                "评价指标 | 评价内容 | 备注\n\n"
                "课程目标 | 课程教学目标设置恰当、合理。 | 适用于所有课程"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertIn("第十八条 本办法由教务处负责解释。", result.canonical_body)
        self.assertNotIn("附件1", result.canonical_body)
        self.assertNotIn("附件2", result.canonical_body)
        self.assertNotIn("专业评估指标体系", result.canonical_body)
        self.assertNotIn("一级指标", result.canonical_body)
        self.assertNotIn("评价指标", result.canonical_body)

    def test_canonical_cleaning_removes_supplementary_template_tail_after_reference_section(
        self,
    ) -> None:
        title = "中央民族大学本科毕业论文（设计）工作管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                "第一章总则\n\n"
                "第一条 为规范本科毕业论文管理工作，制定本办法。\n\n"
                "三、毕业论文的书写格式\n\n"
                "（十四）参考文献著录格式示例\n\n"
                "示例：[1] 作者.题名[M].北京：出版社，2024.\n\n"
                "附件：1. 毕业论文封面\n\n"
                "2. 毕业论文任务书\n\n"
                "附件4\n\n"
                "本科毕业论文（设计）使用授权书\n\n"
                "学院 | | 专业 |\n\n"
                "年级 | | 学号 |\n\n"
                "姓名 | | 起止时间 |\n\n"
                "五、若在学校组织的毕业论文（设计）检查、评比中，被发现有抄袭、剽窃、弄虚作假等违反学术规范的行为，本人愿意接受学校按有关规定给予的处理。\n\n"
                "指导教师姓名 | | 职称 |\n\n"
                "本人签名：日期："
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertIn("参考文献著录格式示例", result.canonical_body)
        self.assertIn("示例：[1] 作者。题名", result.canonical_body)
        self.assertNotIn("附件：1.", result.canonical_body)
        self.assertNotIn("毕业论文封面", result.canonical_body)
        self.assertNotIn("本科毕业论文（设计）使用授权书", result.canonical_body)
        self.assertNotIn("学院 |", result.canonical_body)
        self.assertNotIn("若在学校组织的毕业论文", result.canonical_body)

    def test_canonical_cleaning_removes_trailing_bare_attachment_marker(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学本科教学事故认定与处理办法",
            owner_text=(
                "中央民族大学本科教学事故认定与处理办法\n\n"
                "一、教师教学事故\n\n"
                "（五）其他经过认定的重大教学事故。\n\n"
                "附件1"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertIn("（五）其他经过认定的重大教学事故。", result.canonical_body)
        self.assertNotIn("附件1", result.canonical_body)

    def test_canonical_cleaning_removes_supplementary_score_indicator_tail(
        self,
    ) -> None:
        title = "中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                "第六章附则\n\n"
                "第十九条 本办法未尽事宜由学校推免工作领导小组研究决定，由学校推免工作领导小组办公室负责解释。\n\n"
                "附件 中央民族大学推荐免试攻读硕士研究生奖励分评价指标体系（100分）\n\n"
                "一级指标 | 最高分 | 二级指标 | 最高分 | 等级或排名 | 分值 | 备注\n\n"
                "品行表现 | 40 | 思想政治素养 | 10 | 热爱祖国，拥护党的领导。 | 基础分8分 | 有下列情况之一者不得推荐\n\n"
                "科研创新 | 30 | 学术成果 | 20 | 论文、专利、竞赛等。 | 20 | 由学院审核"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertIn("第十九条 本办法未尽事宜", result.canonical_body)
        self.assertNotIn("奖励分评价指标体系", result.canonical_body)
        self.assertNotIn("一级指标", result.canonical_body)

    def test_unrepaired_soft_wrap_residue_is_flagged_for_manual_review(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学某事项管理办法",
            owner_text=(
                "中央民族大学某事项管理办法\n\n"
                "第一条 本办法适用于学生\n\n"
                "A1B2异常断裂文本。\n\n"
                "第二条 本办法由学校解释。"
            ),
        )

        self.assertEqual(result.quality_verdict, "flagged_manual_review")
        self.assertIn("soft_wrap_residue", result.reason_codes)

    def test_structured_regulation_with_repaired_soft_wrap_residue_can_pass(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学本科教学质量监控管理办法",
            owner_text=(
                "中央民族大学本科教学质量监控管理办法\n\n"
                "第一章总则\n\n"
                "第一条 教学质量监控是有效保障教学质量的重要手段。为健全本科教学质量\n\n"
                "监控体系，切实提高本科教学质量，制定本办法。\n\n"
                "第二条 本科教学质量监控坚持以学生中心、产出导向、持续改进理念。\n\n"
                "第二章组织实施\n\n"
                "第三条 定期开展专业建设评估。建立专业成长性评价体系。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("soft_wrap_repaired", result.reason_codes)
        self.assertNotIn("soft_wrap_residue", result.reason_codes)
        self.assertEqual(result.soft_wrap_residue_count, 0)

    def test_attachment_table_boundaries_do_not_count_as_soft_wrap_residue(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学本科课程考核管理办法",
            owner_text=(
                "中央民族大学本科课程考核管理办法\n\n"
                "第一章总则\n\n"
                "第一条 课程考核是教学活动的重要环节，制定本办法。\n\n"
                "第二条 本办法适用于全日制本科培养方案所规定的课程。\n\n"
                "附件：1. 中央民族大学学生考试规则\n\n"
                "2. 中央民族大学监考人员规则附件1中央民族大学学生考试规则\n\n"
                "<table><tr><td>一级指标</td><td>最高分</td></tr></table>\n\n"
                "<table><tr><td>评价指标</td><td>评价内容</td></tr></table>\n\n"
                "中央民族大学校长办公室"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)
        self.assertEqual(result.soft_wrap_residue_count, 0)

    def test_canonical_cleaning_flattens_html_table_markup_before_downstream_units(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学排课管理办法",
            owner_text=(
                "中央民族大学排课管理办法\n\n"
                "第一章总则\n\n"
                "第一条 为规范排课管理工作，制定本办法。\n\n"
                "附件1\n\n"
                "<table><tr><td>节次</td><td>上课时间</td></tr>"
                "<tr><td>第一节</td><td>8:00-8:45</td></tr></table>\n\n"
                "第二条 本办法由教务处负责解释。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotRegex(result.canonical_body, r"</?(?:table|tr|td)\\b")
        self.assertIn("节次", result.canonical_body)
        self.assertIn("第一节", result.canonical_body)
        self.assertIn("8:00-8:45", result.canonical_body)

    def test_parenthesized_foreign_abbreviation_explanation_is_not_soft_wrap_residue(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学本科毕业论文（设计）工作管理办法",
            owner_text=(
                "中央民族大学本科毕业论文（设计）工作管理办法\n\n"
                "第一章总则\n\n"
                "第一条 为规范本科毕业论文管理工作，制定本办法。\n\n"
                "第二条 使用外文缩写代替某一名词术语时，首次出现时应在括号内注明其含义，如：OECD\n\n"
                "（OrganisationforEconomicCo-operationandDevelopmen）代替经济合作发展组织。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)

    def test_standard_number_reference_is_not_mixed_ascii_cjk_artifact(self) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学本科毕业论文（设计）工作管理办法",
            owner_text=(
                "中央民族大学本科毕业论文（设计）工作管理办法\n\n"
                "第一章总则\n\n"
                "第一条 为规范本科毕业论文管理工作，制定本办法。\n\n"
                "第二条 书写格式应符合 GB/T7714-2005《文后参考文献著录规则》"
                "或其他本专业学术论文通行的参考文献著录格式。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)

    def test_contact_email_room_number_and_score_formula_are_not_mixed_ascii_cjk_artifacts(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
            owner_text=(
                "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则\n\n"
                "一、名额分配\n\n"
                "第一条 为规范推免工作，制定本细则。\n\n"
                "其中，综合成绩按百分制计算，由学业成绩和综合素质成绩两部分组成，计算公式为T=X*85%+（Z1+Z2+Z3）/3*15%。\n\n"
                "咨询邮箱：msyzhaosheng66@163.com\n\n"
                "办公地址：文华楼13层1318A室"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)

    def test_formula_variable_definition_lines_are_not_mixed_ascii_cjk_artifacts(
        self,
    ) -> None:
        result = normalize_regulation_owner_text(
            title="中央民族大学岗位设置与聘用管理暂行办法",
            owner_text=(
                "中央民族大学岗位设置与聘用管理暂行办法\n\n"
                "第一章 总 则\n\n"
                "一、岗位设置与聘用原则\n\n"
                "（一）教学辅助工作量按下列公式核定。\n\n"
                "Y1表示该门课程教学时数\n\n"
                "Y2表示应修该门课程的学生数\n\n"
                "Y3表示该门课程标准班学生数"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("soft_wrap_residue", result.reason_codes)

    def test_official_web_email_rule_keeps_legitimate_capacity_and_audience_lines_and_drops_terminal_office_tail(
        self,
    ) -> None:
        title = "中央民族大学电子邮件管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                f"{title}\n\n"
                "第一条 为了加强校园网电子邮件系统的管理，使电子邮件系统更加高效、安全地为教学、科研和管理服务，根据国家有关行政法规、规章的规定，制定本办法。\n"
                "第二条 校园网电子邮件由网络中心负责运行和维护。\n"
                "第三条 校园网电子邮箱的域名为：muc.edu.cn，邮箱的域后缀为@muc.edu.cn。\n"
                "第四条 校园网电子邮箱的服务对象包含以下几类：\n"
                "学校各单位（即公共邮箱）、全体教职工（包括在职、退休及各单位外聘人员）、全日制在校学生、2014级及之后的毕业生。\n"
                "邮箱容量为10G，个人网盘容量为2G，邮箱上传附件大小最大为2G。\n"
                "第五条 每人只允许有一个邮箱，与其工作证号或学生证号对应。\n"
                "第六条 新邮箱的申请方法：填写《E-MAIL申请表》（见附录一）并递交网络中心批准。\n"
                "第七条 用户信箱不得借于他人使用,不得私自进入他人信箱。\n"
                "第八条 任何单位和个人不得利用电子邮件传播违反国家法律法规的信息。违者网络中心有权停止其电子邮件的使用，并报学校有关部门处理，情节严重的将追究其法律责任。\n"
                "第九条 任何单位和个人不得利用电子邮件传播病毒，不得传播垃圾邮件。网络中心有权对带病毒邮件及垃圾邮件进行处理。\n"
                "第十条 网络中心不承担因线路中断、设备装置失误及网络故障等事故导致信件的延误或丢失的责任。\n"
                "第十一条 本办法由网络中心负责解释。\n"
                "网络中心"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertNotIn("suspicious_prefix", result.reason_codes)
        self.assertNotIn("soft_wrap_residue", result.reason_codes)
        self.assertIn("学校各单位（即公共邮箱）", result.canonical_body)
        self.assertIn("邮箱容量为10G，个人网盘容量为2G", result.canonical_body)
        self.assertIn("第十一条 本办法由网络中心负责解释。", result.canonical_body)
        self.assertFalse(result.canonical_body.endswith("网络中心"))

    def test_canonical_cleaning_removes_page_logo_and_form_placeholder_lines(self) -> None:
        title = "中央民族大学本科毕业论文（设计）工作管理办法"
        result = normalize_regulation_owner_text(
            title=title,
            owner_text=(
                f"{title}\n\n"
                "第一章总则\n\n"
                "第一条 为规范本科毕业论文管理工作，制定本办法。\n\n"
                "-4\n\n"
                "MINZU UNIVERSITY OF CHINA\n\n"
                "本科毕业论文（设计）\n\n"
                "——[副标题]\n\n"
                "姓名：\n\n"
                "学号：\n\n"
                "指导教师：\n\n"
                "年 月 日附件1\n\n"
                "第二条 本办法适用于本科毕业论文管理。"
            ),
        )

        self.assertEqual(result.quality_verdict, "passed")
        self.assertIn("page_artifacts_removed", result.reason_codes)
        self.assertIn("layout_artifacts_removed", result.reason_codes)
        self.assertNotIn("-4", result.canonical_body)
        self.assertNotIn("MINZU UNIVERSITY OF CHINA", result.canonical_body)
        self.assertNotIn("本科毕业论文（设计）\n", result.canonical_body)
        self.assertNotIn("——[副标题]", result.canonical_body)
        self.assertNotIn("姓名：", result.canonical_body)
        self.assertNotIn("学号：", result.canonical_body)
        self.assertNotIn("指导教师：", result.canonical_body)
        self.assertNotIn("年 月 日附件1", result.canonical_body)
        self.assertIn("第一条 为规范本科毕业论文管理工作", result.canonical_body)
        self.assertIn("第二条 本办法适用于本科毕业论文管理。", result.canonical_body)


if __name__ == "__main__":
    unittest.main()
