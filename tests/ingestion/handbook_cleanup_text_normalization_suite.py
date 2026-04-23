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
