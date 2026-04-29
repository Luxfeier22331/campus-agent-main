from __future__ import annotations

from .chunking_policy_test_support import *


class ChunkingPolicyContextTest(_ChunkingPolicyTestCase):
    def test_clean_structured_text_strips_parent_html_table_and_keeps_placeholder(self) -> None:
        cleaned = clean_structured_text(
            unit_type="article_body",
            text=(
                "Library opening hours are listed below.\n"
                "<table><tr><td>Mon</td><td>08:00-22:00</td></tr></table>\n"
                "The library remains open for regular student use."
            ),
        )

        self.assertNotIn("<table>", cleaned)
        self.assertIn(TABLE_PLACEHOLDER, cleaned)
        self.assertIn("library remains open", cleaned.lower())

    def test_assemble_chunk_text_prefers_compact_header_for_short_deeply_nested_text(self) -> None:
        context_plan = build_chunk_text_context(
            anchor={
                "section_path": [
                    "第二章 分则",
                    "第一部分 注册",
                    "四、权利",
                    "(二) 注册志愿服务组织",
                ],
            },
            metadata={
                "title": "中央民族大学学生志愿服务管理办法",
                "policy_doc_no": "民大团发〔2010〕14号",
            },
        )

        assembly = assemble_chunk_text(
            display_text="1. 组织开展符合组织宗旨的志愿服务活动的权利。",
            context_plan=context_plan,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertNotEqual(assembly.header_mode, "full_path")
        self.assertLess(assembly.header_token_count, 50)
        self.assertIn("注册志愿服务组织", assembly.text)

    def test_build_chunk_text_context_title_only_variant_keeps_title_when_section_path_exists(
        self,
    ) -> None:
        context_plan = build_chunk_text_context(
            anchor={
                "section_path": ["第五章 奖励分测评"],
                "article_label": "第十九条",
            },
            metadata={
                "title": "中央民族大学本科学生综合素质测评办法",
                "policy_doc_no": "民大校发[2018]323号",
            },
        )

        title_only = next(
            variant for variant in context_plan.preferred_variants if variant.mode == "title_only"
        )

        self.assertEqual(
            title_only.joined_text(),
            "中央民族大学本科学生综合素质测评办法\n文号：民大校发[2018]323号",
        )

    def test_chunking_context_module_keeps_compact_path_for_short_official_web_display(
        self,
    ) -> None:
        context_plan = build_chunk_text_context_from_context_module(
            anchor={
                "section_path": ["校园服务", "图书馆", "借阅须知"],
            },
            metadata={
                "title": "中央民族大学图书馆借阅须知",
                "policy_doc_no": "图规〔2026〕8号",
                "page_family": "generic_content_page",
                "serving_intent": "answer_ready",
            },
        )

        assembly = assemble_chunk_text_from_context_module(
            display_text="读者应在闭馆前完成借阅和自助设备归还。",
            context_plan=context_plan,
            chunk_profile=ChunkProfile(
                chunk_size=96,
                max_chunk_size=144,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=8,
            ),
        )

        self.assertEqual(assembly.header_mode, "compact_path")
        self.assertIn("中央民族大学图书馆借阅须知", assembly.text)
        self.assertIn("章节：借阅须知", assembly.text)
        self.assertNotIn("校园服务 > 图书馆 > 借阅须知", assembly.text)

    def test_normalize_article_body_structure_keeps_soft_wrap_recoveries_as_single_body_lines(
        self,
    ) -> None:
        normalized = normalize_article_body_structure(
            "\n".join(
                [
                    "(三)须向学校足额缴纳学费及其他相关费用。",
                    "(四)能较熟练掌握对方学校所在地区的语言,具备交流、沟通能力。",
                    "1. 委托院系选拔方式,主要适用于只涉及1个学院的项目。",
                ]
            )
        )

        self.assertIn("(三)须向学校足额缴纳学费及其他相关费用。", normalized)
        self.assertIn("(四)能较熟练掌握对方学校所在地区的语言,具备交流、沟通能力。", normalized)
        self.assertIn("1. 委托院系选拔方式,主要适用于只涉及1个学院的项目。", normalized)
        self.assertNotIn("(三)须向\n学校足额缴纳", normalized)
        self.assertNotIn("(四)能较熟练掌握对方\n学校所在地区", normalized)
        self.assertNotIn("1. 委托\n院系选拔方式", normalized)

    def test_normalize_article_body_structure_splits_long_clause_heading_from_body(self) -> None:
        normalized = normalize_article_body_structure(
            "\n".join(
                [
                    "(一)确定项目选拔条件与年度选拔计划国际合作处(港澳台事务办公室)确定各留学项目等相关事宜,包括名额、专业、学术或学业要求、留学期限及选拔时限等项目选拔条件与要求,函告教务处。",
                    "(二)发布选拔要求与通知教务处根据项目要求,发布具体选拔通知,视项目情况,可采取委托院系选拔或学校统一组织选拔两种方式。",
                    "(一)科研项目奖励(总分1.5分)参与科研项目且已在所评学年内结项的,按以下标准分别依次给予奖励加分,所评学年内未结项的不予加分;",
                ]
            )
        )

        self.assertIn(
            "(一)确定项目选拔条件与年度选拔计划\n国际合作处(港澳台事务办公室)确定各留学项目等相关事宜",
            normalized,
        )
        self.assertIn("(二)发布选拔要求与通知\n教务处根据项目要求,发布具体选拔通知", normalized)
        self.assertIn("(一)科研项目奖励(总分1.5分)\n参与科研项目且已在所评学年内结项", normalized)

    def test_normalize_article_body_structure_splits_title_note_glue(self) -> None:
        normalized = normalize_article_body_structure(
            "\n".join(
                [
                    "发表一般文章、专著奖励标准备注:学校官方微信即中央民族大学微信公众号",
                    "参加社会实践、主题活动奖励标准备注:志愿服务活动须经学校团委认定为准。",
                ]
            )
        )

        self.assertIn(
            "发表一般文章、专著奖励标准\n备注:学校官方微信即中央民族大学微信公众号", normalized
        )
        self.assertIn(
            "参加社会实践、主题活动奖励标准\n备注:志愿服务活动须经学校团委认定为准。", normalized
        )
