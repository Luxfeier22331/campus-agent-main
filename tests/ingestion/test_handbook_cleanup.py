from __future__ import annotations

import unittest
from itertools import count
from pathlib import Path

from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    normalize_handbook_article_body_text,
    normalize_handbook_body_text,
)
from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result
from campus_ingestion_core.split_manifest import SplitManifestDocument

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_handbook"
SOURCE_ROW_SEQUENCE = count(1)


def _manifest_document(
    page_start: int,
    page_end: int,
    *,
    title: str = "制度标题",
    handbook_section: str = "中央民族大学学生日常管理规定",
) -> SplitManifestDocument:
    return SplitManifestDocument(
        document_id="manifest:placeholder",
        title=title,
        page_start=page_start,
        page_end=page_end,
        source_uri="https://campus.example/student-handbook/policy",
        handbook_section=handbook_section,
    )


def _source_row(
    page: int,
    row_type: str,
    text: str,
    *,
    block_role: str | None = None,
    table_cells: list[list[str]] | None = None,
    html: str | None = None,
    title_candidate_score: float = 0.0,
    is_repeated_candidate: bool | None = None,
    classification_confidence: float = 0.9,
    classification_reason: str = "test_fixture",
) -> dict[str, object]:
    sequence = next(SOURCE_ROW_SEQUENCE)
    return {
        "schema_version": "student_handbook_layout_elements_v3",
        "corpus": "regulations",
        "collection": "student_handbook",
        "source_artifact_id": "asset:student-handbook",
        "source_pdf": "学生手册_2018.pdf",
        "page_start": page,
        "page_end": page,
        "row_id": f"page-{page:04d}-{sequence:04d}-{row_type}",
        "row_index": sequence,
        "ocr_provider": "paddleocr_async",
        "ocr_model": "PaddleOCR-VL-1.5",
        "provider_page_id": page,
        "provider_block_id": f"block-{page:04d}",
        "provider_payload_ref": f"line:{page}",
        "confidence": 0.98,
        "row_type": row_type,
        "block_role": block_role or row_type,
        "heading_level": 1 if row_type == "heading" else None,
        "reading_order": sequence,
        "bbox": [0.0, 0.0, 100.0, 20.0],
        "text_raw": text,
        "text_normalized": text,
        "html": html,
        "table_cells": table_cells,
        "is_blank": False,
        "is_repeated_candidate": (
            row_type in {"header", "footer", "page_number"}
            if is_repeated_candidate is None
            else is_repeated_candidate
        ),
        "title_candidate_score": title_candidate_score,
        "section_hint": text if row_type == "heading" else None,
        "classification_confidence": classification_confidence,
        "classification_reason": classification_reason,
        "repeat_cluster_id": None,
        "repeat_frequency": 0,
        "repeat_position_band": None,
        "parent_heading_hint": None,
        "list_level_hint": None,
        "continues_from_previous_page": False,
        "continues_to_next_page": False,
        "table_fragment_id": None,
        "table_header_rows": table_cells[:1] if table_cells else None,
        "table_row_count": len(table_cells) if table_cells else None,
        "table_column_count": len(table_cells[0]) if table_cells else None,
        "table_has_merged_cells": False if table_cells else None,
        "table_caption_hint": None,
    }


def _load_fixture_rows(fixture_name: str) -> list[dict[str, object]]:
    return normalize_handbook_provider_result(
        source_pdf="学生手册_2018.pdf",
        provider_jsonl_bytes=(FIXTURE_DIR / fixture_name).read_bytes(),
        ocr_provider="paddleocr_async",
        ocr_model="PaddleOCR-VL-1.5",
        source_artifact_id="asset:student-handbook-master-pdf",
    )


class HandbookCleanupTest(unittest.TestCase):
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

    def test_cleanup_projects_manifest_range_without_cross_document_bleed(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    1, "heading", "前一篇制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(1, "paragraph", "不应进入本篇"),
                _source_row(
                    2, "heading", "当前制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(2, "paragraph", "第一条 当前制度正文"),
                _source_row(3, "paragraph", "第二条 当前制度续页"),
                _source_row(
                    4, "heading", "后一篇制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(4, "paragraph", "也不应进入本篇"),
            ],
            manifest_document=_manifest_document(2, 3, title="当前制度"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["page_start"], 2)
        self.assertEqual(result.metadata["page_end"], 3)
        self.assertEqual(result.title, "当前制度")
        self.assertNotIn("前一篇制度", result.canonical_markdown)
        self.assertNotIn("后一篇制度", result.canonical_markdown)
        self.assertTrue(all(row["anchor"]["page_start"] >= 2 for row in result.document_units))
        self.assertTrue(all(row["anchor"]["page_end"] <= 3 for row in result.document_units))

    def test_cleanup_keeps_single_page_document_independent(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    5, "heading", "单页制度", block_role="title", title_candidate_score=1.0
                ),
                _source_row(5, "paragraph", "第一条 单页制度正文"),
            ],
            manifest_document=_manifest_document(5, 5, title="单页制度"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["page_start"], 5)
        self.assertEqual(result.metadata["page_end"], 5)
        self.assertEqual(len(result.document_units), 1)
        self.assertEqual(result.document_units[0]["unit_type"], "article_body")

    def test_cleanup_extracts_title_from_first_page_heading_candidates(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(10, "header", "学生手册 2026"),
                _source_row(
                    10,
                    "heading",
                    "中央民族大学奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(10, "paragraph", "第一条 为做好奖学金评定工作"),
                _source_row(10, "footer", "10"),
            ],
            manifest_document=_manifest_document(
                10, 10, title="占位标题", handbook_section="中央民族大学学生奖励管理规定"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学奖学金评定办法")

    def test_cleanup_consumes_title_variant_and_metadata_preface_without_emitting_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    10,
                    "heading",
                    "中央民族大学优秀本科毕业生评选办法（试行）",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(10, "paragraph", "民大校发〔2018〕329号"),
                _source_row(10, "paragraph", "第一条 为全面做好优秀本科毕业生评选工作。"),
            ],
            manifest_document=_manifest_document(
                10,
                10,
                title="中央民族大学优秀本科毕业生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学优秀本科毕业生评选办法")
        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["article_body"],
        )
        self.assertEqual(
            result.document_units[0]["metadata"]["title"], "中央民族大学优秀本科毕业生评选办法"
        )
        self.assertEqual(
            result.document_units[0]["metadata"]["policy_doc_no"], "民大校发〔2018〕329号"
        )
        self.assertNotIn("优秀本科毕业生评选办法（试行）", result.document_units[0]["clean_text"])
        self.assertNotIn("民大校发〔2018〕329号", result.document_units[0]["clean_text"])

    def test_cleanup_discards_same_page_rows_before_title_anchor(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    67, "heading", "四、组织管理", block_role="heading", title_candidate_score=0.75
                ),
                _source_row(67, "paragraph", "校团委根据团中央、教育部和学校相关工作要求。"),
                _source_row(
                    68,
                    "heading",
                    "中央民族大学本科生专业调整实施办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(68, "paragraph", "(修订)"),
                _source_row(68, "paragraph", "第一条 本办法适用于学生专业调整。"),
                _source_row(68, "paragraph", "第二条 相关流程由学院执行。"),
            ],
            manifest_document=_manifest_document(
                67,
                68,
                title="中央民族大学本科生专业调整实施办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学本科生专业调整实施办法")
        self.assertNotIn("校团委根据团中央", result.canonical_markdown)
        self.assertNotIn("四、组织管理", result.canonical_markdown)
        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["article_body", "article_body"],
        )

    def test_cleanup_requires_first_page_title_anchor_for_manifest_title(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing title anchor"):
            cleanup_handbook_document(
                structured_rows=[
                    _source_row(
                        67,
                        "heading",
                        "四、组织管理",
                        block_role="heading",
                        title_candidate_score=0.75,
                    ),
                    _source_row(67, "paragraph", "本办法适用于学生专业调整。"),
                    _source_row(68, "paragraph", "第二条 相关流程由学院执行。"),
                ],
                manifest_document=_manifest_document(
                    67,
                    68,
                    title="中央民族大学本科生专业调整实施办法",
                    handbook_section="中央民族大学学生教学管理规定",
                ),
                source_doc="学生手册_2018.pdf",
            )

    def test_cleanup_consumes_multiline_title_anchor_on_later_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    67, "heading", "五、相关说明", block_role="heading", title_candidate_score=0.75
                ),
                _source_row(67, "paragraph", "上一份制度尾页。"),
                _source_row(
                    68,
                    "heading",
                    "中央民族大学本科生专业调整实施办法\n(修订)",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(68, "paragraph", "民大校发[2016]209号"),
                _source_row(68, "paragraph", "第一条 本办法适用于学生专业调整。"),
            ],
            manifest_document=_manifest_document(
                67,
                68,
                title="中央民族大学本科生专业调整实施办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertNotIn("上一份制度尾页", result.canonical_markdown)
        self.assertNotIn(
            "中央民族大学本科生专业调整实施办法\n(修订)", result.document_units[0]["clean_text"]
        )

    def test_cleanup_projects_list_like_sections_into_multiple_policy_pages(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    8,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(8, "paragraph", "校级办公与公共服务"),
                _source_row(8, "paragraph", "校园110 68932220"),
                _source_row(8, "paragraph", "就业工作处"),
                _source_row(8, "paragraph", "就业指导、就业派遣 68932410"),
            ],
            manifest_document=_manifest_document(8, 8, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 2)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["校级办公与公共服务"])
        self.assertEqual(policy_units[1]["anchor"]["section_path"], ["就业工作处"])
        self.assertIn("校园110 68932220", policy_units[0]["clean_text"])
        self.assertIn("就业指导、就业派遣 68932410", policy_units[1]["clean_text"])

    def test_cleanup_falls_back_to_single_policy_page_without_article_or_list_structure(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    8, "heading", "特别说明", block_role="title", title_candidate_score=1.0
                ),
                _source_row(8, "paragraph", "本说明适用于全体学生。"),
                _source_row(8, "paragraph", "请遵守学校统一安排。"),
            ],
            manifest_document=_manifest_document(8, 8, title="特别说明"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["policy_page"])
        self.assertIn("本说明适用于全体学生。", result.document_units[0]["clean_text"])

    def test_cleanup_excludes_table_cells_from_body_clean_text(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    12,
                    "heading",
                    "中央民族大学奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(12, "paragraph", "第一条 奖学金评定坚持公开、公平、公正。"),
                _source_row(
                    12,
                    "table",
                    "项目 | 说明",
                    block_role="table",
                    table_cells=[["项目", "说明"], ["等级", "一等奖"]],
                    html="<table><tr><td>项目</td><td>说明</td></tr></table>",
                ),
            ],
            manifest_document=_manifest_document(
                12,
                12,
                title="中央民族大学奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        table_units = [row for row in result.document_units if row["unit_type"] == "table"]

        self.assertEqual(len(article_units), 1)
        self.assertEqual(len(table_units), 1)
        self.assertNotIn("等级", article_units[0]["clean_text"])
        self.assertEqual(table_units[0]["table_cells"], [["项目", "说明"], ["等级", "一等奖"]])

    def test_cleanup_builds_table_unit_from_rowspan_html(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    20,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    20,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html=(
                        "<table>"
                        "<tr><td>单位名称</td><td>电话号码</td><td>单位名称</td><td>电话号码</td></tr>"
                        '<tr><td rowspan="2">校园110</td><td rowspan="2">68932220</td><td>研究生院(学位办)</td><td></td></tr>'
                        "<tr><td>办公室</td><td>68932649</td></tr>"
                        "</table>"
                    ),
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)"],
                        ["办公室", "68932649"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(20, 20, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"],
            [
                "校园110 | 68932220 | 研究生院(学位办) | ",
                "校园110 | 68932220 | 办公室 | 68932649",
            ],
        )

    def test_cleanup_drops_running_header_only_policy_page_before_articles(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    244,
                    "heading",
                    "中央民族大学助学贷款管理暂行办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(244, "paragraph", "民大校发[2012]358号"),
                _source_row(244, "paragraph", "第五章 贷款还款"),
                _source_row(244, "paragraph", "学生手册"),
                _source_row(244, "paragraph", "第九条 贷款学生应严格按贷款合同履行还贷义务。"),
            ],
            manifest_document=_manifest_document(
                244,
                244,
                title="中央民族大学助学贷款管理暂行办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertNotIn("学生手册", result.document_units[0]["clean_text"])

    def test_cleanup_drops_running_header_line_inside_article_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    177,
                    "heading",
                    "中央民族大学本科学生国家奖学金评审办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(177, "paragraph", "第九条 参评本科学生国家奖学金还须具备以下条件之一:"),
                _source_row(
                    177,
                    "paragraph",
                    "(一)学习成绩优异,所评学年学习成绩排名与综合测评排名均位于前10%以内。",
                ),
                _source_row(177, "paragraph", "学生手册"),
                _source_row(
                    177, "paragraph", "(二) 学习成绩排名或综合测评排名超出前10%,但均位于前30%。"
                ),
            ],
            manifest_document=_manifest_document(
                177,
                177,
                title="中央民族大学本科学生国家奖学金评审办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertNotIn("学生手册", result.document_units[0]["clean_text"])
        self.assertIn(
            "(二) 学习成绩排名或综合测评排名超出前10%,但均位于前30%。",
            result.document_units[0]["clean_text"],
        )

    def test_cleanup_drops_appendix_header_only_policy_page_before_tables(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    214,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(214, "paragraph", "民大校发[2013]154号"),
                _source_row(214, "paragraph", "附件："),
                _source_row(214, "paragraph", "中央民族大学本科生家庭经济困难学生认定申请表"),
                _source_row(214, "paragraph", "中央民族大学本科学生及家庭情况调查表"),
                _source_row(214, "paragraph", "中央民族大学本科生家庭经济困难学生认定统计表"),
                _source_row(214, "paragraph", "学生手册"),
                _source_row(
                    214,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>姓名</td><td>院系</td></tr><tr><td>张三</td><td>文学院</td></tr></table>",
                    table_cells=[["姓名", "院系"], ["张三", "文学院"]],
                ),
            ],
            manifest_document=_manifest_document(
                214,
                214,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["table", "table_unit"],
        )

    def test_cleanup_attaches_form_cover_line_to_following_table_instead_of_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(162, "paragraph", "1:《中央民族大学本(预)科生基本情况周查月报表》"),
                _source_row(
                    162,
                    "paragraph",
                    "学生手册中央民族大学本(预)科生基本情况周查月报表报送时间:年 月 日",
                ),
                _source_row(
                    162,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>学院</td><td>班级</td></tr><tr><td>文学院</td><td>2022级1班</td></tr></table>",
                    table_cells=[["学院", "班级"], ["文学院", "2022级1班"]],
                ),
            ],
            manifest_document=_manifest_document(
                162,
                162,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            [row["unit_type"] for row in result.document_units], ["table", "table_unit"]
        )
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertIn("周查月报表报送时间", table_unit["anchor"]["table_context"])

    def test_cleanup_drops_running_header_prefix_when_form_cover_repeats_attachment_title(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "四、相关说明"),
                _source_row(162, "paragraph", "1:《中央民族大学本(预)科生基本情况周查月报表》"),
                _source_row(162, "paragraph", "学生手册中央民族大学本(预)科生基本情况周查月报表"),
                _source_row(
                    162,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>学院</td><td>班级</td></tr><tr><td>文学院</td><td>2022级1班</td></tr></table>",
                    table_cells=[["学院", "班级"], ["文学院", "2022级1班"]],
                ),
            ],
            manifest_document=_manifest_document(
                162,
                162,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertFalse(any(row["unit_type"] == "policy_page" for row in result.document_units))
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "1:《中央民族大学本(预)科生基本情况周查月报表》"],
        )
        self.assertNotIn(
            "学生手册中央民族大学本(预)科生基本情况周查月报表", result.canonical_markdown
        )

    def test_cleanup_merges_split_group_label_before_repeated_rowspan_block(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(
                    162, "paragraph", "中央民族大学本(预)科生基本情况周查月报表报送时间:年 月 日"
                ),
                _source_row(
                    162,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["类型", "原因", "学生基本信息(姓名、学号、起止时间)"],
                        ["有无日常", "本学期内未经请假擅自离校累计超过3天(含)", ""],
                        ["考勤异常学生", "请假逾期未归超过3天(含)", ""],
                        ["考勤异常学生", "本学期内累计旷课达16节", ""],
                        ["考勤异常学生", "其他需报告的重要情况", ""],
                        ["有无学籍状态异常学生", "休学期满逾期未办理复学手续", ""],
                        ["有无学籍状态异常学生", "开学两周后未注册且无正当理由", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                162, 162, title="中央民族大学学院(系)学生基本情况周查月报制度"
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"][0],
            "有无日常考勤异常学生 | 本学期内未经请假擅自离校累计超过3天(含) | ",
        )
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"][1:],
            [
                "考勤异常学生 | 请假逾期未归超过3天(含) | ",
                "考勤异常学生 | 本学期内累计旷课达16节 | ",
                "考勤异常学生 | 其他需报告的重要情况 | ",
                "有无学籍状态异常学生 | 休学期满逾期未办理复学手续 | ",
                "有无学籍状态异常学生 | 开学两周后未注册且无正当理由 | ",
            ],
        )

    def test_cleanup_fixture_update_keeps_document_id_but_changes_version_id(self) -> None:
        stable = cleanup_handbook_document(
            structured_rows=_load_fixture_rows("provider-result-stable.jsonl"),
            manifest_document=_manifest_document(
                1,
                1,
                title="中央民族大学奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )
        updated = cleanup_handbook_document(
            structured_rows=_load_fixture_rows("provider-result-updated.jsonl"),
            manifest_document=_manifest_document(
                1,
                1,
                title="中央民族大学奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(stable.doc_id, updated.doc_id)
        self.assertNotEqual(stable.version_id, updated.version_id)

    def test_cleanup_pads_table_unit_rows_to_header_width(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    21,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    21,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["学生处(学生工作部)", "保卫武装部"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(21, 21, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"],
            ["学生处(学生工作部) | 保卫武装部 |  | "],
        )

    def test_cleanup_builds_compound_header_line_for_table_unit_when_needed(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科学生综合素质测评办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["奖项级别", "国家级", "国家级", "省部级", "省部级"],
                        ["奖项级别", "个人", "集体", "个人", "集体"],
                        ["第一名(一等奖)", "1.7", "1.5", "1.1", "1.1"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科学生综合素质测评办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_header_line"],
            "奖项级别 | 国家级 / 个人 | 国家级 / 集体 | 省部级 / 个人 | 省部级 / 集体",
        )
        self.assertNotIn("列=", table_unit["clean_text"])

    def test_cleanup_infers_project_label_for_blank_first_table_header(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科学生综合素质测评办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["", "具体测评内容和分值", "学生民主互评", "测评小组评定"],
                        ["思想政治表现(30分)", "拥护党的领导", "", ""],
                        ["学习态度(20分)", "刻苦钻研", "", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科学生综合素质测评办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertTrue(table_unit["metadata"]["table_header_line"].startswith("项目 | "))
        self.assertNotIn("未命名列", table_unit["clean_text"])

    def test_cleanup_skips_form_like_attachment_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生国家助学金评审办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["本人情况", "姓名", "性别", "照片"],
                        ["本人情况", "学号", "院系", "照片"],
                        ["家庭经济情况", "家庭住址", "", "邮政编码"],
                        ["家庭经济情况", "", "", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生国家助学金评审办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_decorative_student_card_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科(预科)学生证管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["姓名 / 学号", "", "学院(系)领导签字 / 家庭所在地", "学院(系)领导签字"],
                        ["民族", "", "火车到站站名", ""],
                        ["学院(系)", "", "照片", "照片"],
                        ["专业", "", "照片", "照片"],
                        ["学制", "", "(请在照片背面加盖骑缝章)", "(请在照片背面加盖骑缝章)"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科(预科)学生证管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_checkbox_dense_family_difficulty_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(22, "paragraph", "附件一:"),
                _source_row(22, "paragraph", "中央民族大学本科生家庭经济困难学生认定申请表"),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        [
                            "学生本人基本情况",
                            "姓名 / 身份证号码",
                            "性别 / 政治面貌",
                            "性别 / 政治面貌",
                            "出生年月 / 政治面貌",
                            "出生年月 / 家庭人均年收入",
                            "民族 / 元",
                        ],
                        ["学生本人基本情况", "学院", "系", "系", "系", "专业", ""],
                        [
                            "学生本人基本情况",
                            "年级",
                            "班",
                            "在校联系电话",
                            "在校联系电话",
                            "在校联系电话",
                            "在校联系电话",
                        ],
                        [
                            "学生陈述申请认定理由",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                        ],
                        [
                            "民主评议",
                            "推荐档次",
                            "A.家庭经济特别困难 ☐",
                            "A.家庭经济特别困难 ☐",
                            "",
                            "",
                            "",
                        ],
                        [
                            "民主评议",
                            "推荐档次",
                            "B.家庭经济困难 ☐",
                            "B.家庭经济困难 ☐",
                            "陈述理由",
                            "",
                            "",
                        ],
                        [
                            "民主评议",
                            "推荐档次",
                            "C.家庭经济不困难 ☐",
                            "C.家庭经济不困难 ☐",
                            "班长签字:",
                            "年_月_日",
                            "年_月_日",
                        ],
                        [
                            "认定决定",
                            "经班级评议小组推荐、本院系认真审核后,☐同意评议小组意见。☐不同意评议小组意见。调整为☐意见, ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐",
                            "",
                            "",
                            "",
                            "",
                            "",
                        ],
                        [
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                        ],
                        [
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生家庭经济困难学生认定管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_repeated_contact_summary_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(22, "paragraph", "附件三:"),
                _source_row(22, "paragraph", "中央民族大学家庭经济困难学生认定统计表"),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        [
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                        ],
                        [
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生家庭经济困难学生认定管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_signature_header_statistics_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(22, "paragraph", "附件三:"),
                _source_row(22, "paragraph", "中央民族大学家庭经济困难学生认定统计表"),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["院系盖章:", "评议小组组长签字:", "院系领导签字:", "报送日期:"],
                        [
                            "序号",
                            "姓名",
                            "性别",
                            "民族",
                            "学号",
                            "院系",
                            "生源地",
                            "认定结果",
                            "户口类型",
                            "是否残疾",
                            "是否单亲",
                            "是否孤儿",
                            "是否低保户",
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生家庭经济困难学生认定管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_attaches_table_anchor_to_current_article_context(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    23,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    23,
                    "heading",
                    "第三章 考核与成绩记载",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    23,
                    "paragraph",
                    "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。",
                ),
                _source_row(23, "paragraph", "（一）考核成绩与绩点的关系："),
                _source_row(
                    23,
                    "table",
                    "等级 | 考核成绩 | 绩点数",
                    block_role="table",
                    table_cells=[
                        ["等级", "考核成绩", "绩点数"],
                        ["优", "90-100", "4.0-5.0"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                23,
                23,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_units = [row for row in result.document_units if row["unit_type"] == "table"]
        self.assertEqual(len(table_units), 1)
        self.assertEqual(table_units[0]["anchor"]["article_label"], "第十六条")
        self.assertEqual(table_units[0]["anchor"]["section_path"], ["第三章 考核与成绩记载"])
        self.assertEqual(table_units[0]["anchor"]["table_context"], "(一)考核成绩与绩点的关系:")

    def test_cleanup_attaches_table_unit_to_current_article_context(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    24,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    24,
                    "heading",
                    "第三章 考核与成绩记载",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    24,
                    "paragraph",
                    "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。",
                ),
                _source_row(24, "paragraph", "（一）考核成绩与绩点的关系："),
                _source_row(
                    24,
                    "table",
                    "等级 | 考核成绩 | 绩点数",
                    block_role="table",
                    table_cells=[
                        ["等级", "考核成绩", "绩点数"],
                        ["优", "90-100", "4.0-5.0"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                24,
                24,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(table_unit["anchor"]["article_label"], "第十六条")
        self.assertEqual(table_unit["anchor"]["table_context"], "(一)考核成绩与绩点的关系:")

    def test_cleanup_attaches_sentence_style_table_context_when_following_table(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    79,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    79,
                    "heading",
                    "第三章 学籍管理",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(79, "paragraph", "第十一条 课程、学分与成绩认定"),
                _source_row(
                    79, "heading", "(四)成绩认定", block_role="heading", title_candidate_score=0.7
                ),
                _source_row(
                    79,
                    "paragraph",
                    "1. 成绩认定采用对应原则,境外课程的成绩以学校百分制成绩、成绩等级、学分绩点相对应的方式进行认定。",
                ),
                _source_row(
                    80,
                    "paragraph",
                    "2. 境外课程以百分制记载的成绩,转换时仍按对方学校给出的百分制成绩认定。",
                ),
                _source_row(
                    80,
                    "paragraph",
                    "3. 境外课程以非百分制方式记载的成绩,按以下方式转换成我校百分制成绩予以认定。",
                ),
                _source_row(
                    80,
                    "table",
                    "等级 | 百分制",
                    block_role="table",
                    table_cells=[
                        ["等级", "百分制"],
                        ["A+", "95"],
                    ],
                ),
                _source_row(
                    80, "heading", "(五)认定程序", block_role="heading", title_candidate_score=0.7
                ),
            ],
            manifest_document=_manifest_document(
                79,
                80,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["table_context"],
            "3. 境外课程以非百分制方式记载的成绩,按以下方式转换成我校百分制成绩予以认定。",
        )
        self.assertEqual(
            table_unit["metadata"]["caption_lines"],
            ["3. 境外课程以非百分制方式记载的成绩,按以下方式转换成我校百分制成绩予以认定。"],
        )

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

    def test_cleanup_does_not_carry_transient_list_sections_into_following_article(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    49,
                    "heading",
                    "中央民族大学十佳大学生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    49,
                    "heading",
                    "第三章 评选程序",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(49, "paragraph", "第八条 十佳大学生评选程序"),
                _source_row(49, "paragraph", "1.院系推荐"),
                _source_row(
                    49,
                    "paragraph",
                    "各院系在组织本单位推优及十佳大学生评选工作的基础上向学生工作部报送候选人。",
                ),
                _source_row(49, "paragraph", "2.初选"),
                _source_row(49, "paragraph", "学生工作部组织相关部门人员共同组成评审小组。"),
                _source_row(49, "paragraph", "3.候选人公示"),
                _source_row(
                    49, "paragraph", "中央民族大学十佳大学生候选人在学生工作部网站公示一周。"
                ),
                _source_row(49, "paragraph", "4.评选"),
                _source_row(49, "paragraph", "(1)大力宣传。"),
                _source_row(49, "paragraph", "第九条 中央民族大学十佳大学生每学年评选一次。"),
            ],
            manifest_document=_manifest_document(
                49,
                49,
                title="中央民族大学十佳大学生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertEqual(len(article_units), 2)
        self.assertIn(
            "十佳大学生评选程序\n1. 院系推荐\n各院系在组织本单位推优及十佳大学生评选工作的基础上向学生工作部报送候选人。",
            article_units[0]["clean_text"],
        )
        self.assertIn(
            "2. 初选\n学生工作部组织相关部门人员共同组成评审小组。", article_units[0]["clean_text"]
        )
        self.assertEqual(article_units[1]["anchor"]["section_path"], ["第三章 评选程序"])
        self.assertNotIn("1.院系推荐", article_units[1]["anchor"]["section_path"])
        self.assertNotIn("4.评选", article_units[1]["anchor"]["section_path"])

    def test_cleanup_preserves_formula_like_lines_as_separate_article_lines(self) -> None:
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
                    "第三章 考核与成绩记载",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    40,
                    "paragraph",
                    "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。",
                ),
                _source_row(40, "paragraph", "（二）课程学分绩点、平均学分绩点的计算方法："),
                _source_row(40, "paragraph", "课程学分绩点=课程学分×课程绩点"),
                _source_row(
                    40, "paragraph", "平均学分绩= $ \\sum $(课程学分×课程的绩点)/ $ \\sum $课程学分"
                ),
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
        self.assertEqual(
            article_units[0]["clean_text"],
            "\n".join(
                [
                    "为了反映学生学习的质和量,学校采用学分绩点的评定办法。",
                    "(二)课程学分绩点、平均学分绩点的计算方法:",
                    "课程学分绩点=课程学分×课程绩点",
                    "平均学分绩= $ \\sum $(课程学分×课程的绩点)/ $ \\sum $课程学分",
                ]
            ),
        )

    def test_cleanup_preserves_policy_doc_no_as_document_metadata_not_policy_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    36,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(36, "paragraph", "民大校发 [2017] 304号"),
                _source_row(
                    36, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(36, "paragraph", "第一条 为了维护学校正常的教育教学秩序。"),
            ],
            manifest_document=_manifest_document(
                36,
                36,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.metadata["policy_doc_no"], "民大校发[2017]304号")
        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertEqual(
            result.document_units[0]["metadata"]["policy_doc_no"], "民大校发[2017]304号"
        )
        self.assertNotIn("民大校发[2017]304号", result.document_units[0]["clean_text"])

    def test_cleanup_preserves_front_matter_lines_as_preface_metadata_before_first_section_heading(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    2,
                    "heading",
                    "普通高等学校学生管理规定",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(2, "paragraph", "2017年2月4日"),
                _source_row(2, "paragraph", "中华人民共和国教育部令第 41 号"),
                _source_row(
                    2, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(2, "paragraph", "第一条 为规范普通高等学校学生管理行为。"),
            ],
            manifest_document=_manifest_document(
                2,
                2,
                title="普通高等学校学生管理规定",
                handbook_section="国家高等教育管理有关规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertEqual(
            result.document_units[0]["metadata"]["preface_text"],
            "2017年2月4日\n中华人民共和国教育部令第 41 号",
        )
        self.assertIn("2017年2月4日", result.canonical_markdown)
        self.assertIn("中华人民共和国教育部令第 41 号", result.canonical_markdown)

    def test_cleanup_splits_structure_first_policy_document_by_part_and_subsection_headings(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    50,
                    "heading",
                    "中央民族大学学生志愿服务管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    50, "heading", "第二章 分则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(50, "paragraph", "五、义务职责"),
                _source_row(50, "paragraph", "志愿者应当遵守学校志愿服务管理要求。"),
                _source_row(50, "paragraph", "第二部分 认证"),
                _source_row(50, "paragraph", "一、认证时间"),
                _source_row(50, "paragraph", "志愿服务认证时间一般安排在每学期末。"),
                _source_row(50, "paragraph", "二、认证机构"),
                _source_row(50, "paragraph", "认证机构为校团委和院系团组织。"),
                _source_row(50, "paragraph", "第三部分 考核"),
                _source_row(50, "paragraph", "五、考核内容"),
                _source_row(50, "paragraph", "考核内容包括服务时长、服务质量和反馈情况。"),
                _source_row(50, "paragraph", "第四部分 评优"),
                _source_row(50, "paragraph", "评优工作根据年度志愿服务表现开展。"),
            ],
            manifest_document=_manifest_document(
                50,
                50,
                title="中央民族大学学生志愿服务管理办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(
            [row["anchor"]["section_path"] for row in policy_units],
            [
                ["第二章 分则", "五、义务职责"],
                ["第二章 分则", "第二部分 认证", "一、认证时间"],
                ["第二章 分则", "第二部分 认证", "二、认证机构"],
                ["第二章 分则", "第三部分 考核", "五、考核内容"],
                ["第二章 分则", "第四部分 评优"],
            ],
        )
        self.assertEqual(
            [row["clean_text"] for row in policy_units],
            [
                "志愿者应当遵守学校志愿服务管理要求。",
                "志愿服务认证时间一般安排在每学期末。",
                "认证机构为校团委和院系团组织。",
                "考核内容包括服务时长、服务质量和反馈情况。",
                "评优工作根据年度志愿服务表现开展。",
            ],
        )
        self.assertIn("## 第二部分 认证", result.canonical_markdown)
        self.assertIn("## 一、认证时间", result.canonical_markdown)
        self.assertIn("## 第三部分 考核", result.canonical_markdown)

    def test_cleanup_splits_policy_document_by_paragraph_level_section_headings(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    51,
                    "heading",
                    "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(51, "paragraph", "一、总则"),
                _source_row(51, "paragraph", "课堂教学应当坚持立德树人和良好学风。"),
                _source_row(51, "paragraph", "二、学生课堂行为规范"),
                _source_row(51, "paragraph", "学生应当遵守课堂纪律，不迟到、不早退。"),
                _source_row(51, "paragraph", "三、学生课堂秩序管理"),
                _source_row(51, "paragraph", "任课教师和学院共同维护课堂秩序。"),
            ],
            manifest_document=_manifest_document(
                51,
                51,
                title="中央民族大学学生课堂行为规范及课堂秩序管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(
            [row["anchor"]["section_path"] for row in policy_units],
            [
                ["一、总则"],
                ["二、学生课堂行为规范"],
                ["三、学生课堂秩序管理"],
            ],
        )
        self.assertEqual(
            [row["clean_text"] for row in policy_units],
            [
                "课堂教学应当坚持立德树人和良好学风。",
                "学生应当遵守课堂纪律,不迟到、不早退。",
                "任课教师和学院共同维护课堂秩序。",
            ],
        )
        self.assertIn("## 一、总则", result.canonical_markdown)
        self.assertIn("## 二、学生课堂行为规范", result.canonical_markdown)
        self.assertIn("## 三、学生课堂秩序管理", result.canonical_markdown)

    def test_cleanup_keeps_article_internal_parenthetical_items_inside_article_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    52,
                    "heading",
                    "中央民族大学优秀本科毕业生评选办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    52,
                    "heading",
                    "第三章 评选条件",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(52, "paragraph", "第六条 校级优秀本科毕业生须具备以下基本条件:"),
                _source_row(52, "paragraph", "(一)思想政治表现良好;"),
                _source_row(52, "paragraph", "(二)遵守规章制度;"),
                _source_row(52, "paragraph", "(三)学习成绩良好;"),
                _source_row(52, "paragraph", "(四)积极参加体育锻炼,身心健康;"),
                _source_row(52, "paragraph", "(五)积极参加社会实践和志愿服务。"),
                _source_row(
                    52, "paragraph", "第七条 市级优秀本科毕业生从校级优秀本科毕业生中择优推荐产生。"
                ),
            ],
            manifest_document=_manifest_document(
                52,
                52,
                title="中央民族大学优秀本科毕业生评选办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["article_body", "article_body"],
        )
        first_article = result.document_units[0]
        self.assertEqual(first_article["anchor"]["article_label"], "第六条")
        self.assertEqual(first_article["anchor"]["section_path"], ["第三章 评选条件"])
        self.assertIn("(四)积极参加体育锻炼,身心健康;", first_article["clean_text"])
        self.assertIn("(五)积极参加社会实践和志愿服务。", first_article["clean_text"])

    def test_cleanup_projects_terminal_inline_enumerated_provision_as_standalone_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    53,
                    "heading",
                    "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(53, "paragraph", "三、学生课堂秩序管理"),
                _source_row(53, "paragraph", "任课教师和学院共同维护课堂秩序。"),
                _source_row(53, "paragraph", "四、本办法由学生工作部(处)负责解释。"),
            ],
            manifest_document=_manifest_document(
                53,
                53,
                title="中央民族大学学生课堂行为规范及课堂秩序管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 2)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["三、学生课堂秩序管理"])
        self.assertEqual(policy_units[0]["clean_text"], "任课教师和学院共同维护课堂秩序。")
        self.assertEqual(policy_units[1]["anchor"]["section_path"], [])
        self.assertEqual(policy_units[1]["anchor"]["provision_label"], "四")
        self.assertEqual(policy_units[1]["clean_text"], "四、本办法由学生工作部(处)负责解释。")

    def test_cleanup_splits_glued_policy_section_heading_from_following_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    55,
                    "heading",
                    "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    55,
                    "paragraph",
                    "三、学生课堂秩序管理12、学生课堂行为规范和秩序的管理依照“全员参与、分级管理”的原则进行。",
                ),
                _source_row(55, "paragraph", "13、所有学生都必须积极、主动地服从管理。"),
            ],
            manifest_document=_manifest_document(
                55,
                55,
                title="中央民族大学学生课堂行为规范及课堂秩序管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(len(policy_units), 1)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["三、学生课堂秩序管理"])
        self.assertTrue(
            policy_units[0]["clean_text"].startswith("12、学生课堂行为规范和秩序的管理依照")
        )
        self.assertNotIn("三、学生课堂秩序管理 12、", policy_units[0]["clean_text"])
        self.assertIn("## 三、学生课堂秩序管理", result.canonical_markdown)

    def test_cleanup_projects_consecutive_inline_appendix_provisions_as_consistent_sibling_units(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    54,
                    "heading",
                    "中央民族大学学生志愿服务管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    54, "heading", "第三章 附则", block_role="heading", title_candidate_score=0.8
                ),
                _source_row(54, "paragraph", "一、本办法由共青团中央民族大学委员会负责解释。"),
                _source_row(54, "paragraph", "二、本办法自发布之日起实施。"),
            ],
            manifest_document=_manifest_document(
                54,
                54,
                title="中央民族大学学生志愿服务管理办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertEqual(
            [row["anchor"]["section_path"] for row in policy_units],
            [
                ["第三章 附则"],
                ["第三章 附则"],
            ],
        )
        self.assertEqual([row["anchor"]["provision_label"] for row in policy_units], ["一", "二"])
        self.assertEqual(
            [row["clean_text"] for row in policy_units],
            [
                "一、本办法由共青团中央民族大学委员会负责解释。",
                "二、本办法自发布之日起实施。",
            ],
        )

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

    def test_cleanup_projects_phone_table_into_semantic_policy_pages(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    261,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    261,
                    "table",
                    "电话表",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)", ""],
                        ["", "", "办公室", "68932649"],
                        ["学生处(学生工作部)", "", "保卫武装部", ""],
                        ["办公室", "68932204", "办公室", "68932434"],
                        ["就业工作处", "", "公寓管理部", "68933547"],
                        ["就业指导、就业派遣", "68932410", "餐饮服务部", "68933180"],
                        ["就业信息管理", "68932640", "电工班", "68932331"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                261,
                261,
                title="中央民族大学校内常用电话",
                handbook_section="中央民族大学公寓及公费医疗管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertGreaterEqual(len(policy_units), 4)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["校级办公与公共服务"])
        self.assertIn("研究生院(学位办)办公室 68932649", policy_units[0]["clean_text"])
        self.assertEqual(policy_units[1]["anchor"]["section_path"], ["学生事务与安保服务"])
        self.assertIn("学生处(学生工作部)办公室 68932204", policy_units[1]["clean_text"])
        self.assertIn("保卫武装部办公室 68932434", policy_units[1]["clean_text"])
        self.assertEqual(policy_units[2]["anchor"]["section_path"], ["就业工作处"])
        self.assertIn("就业指导、就业派遣 68932410", policy_units[2]["clean_text"])
        self.assertEqual(policy_units[3]["anchor"]["section_path"], ["后勤产业集团"])
        self.assertIn("公寓管理部 68933547", policy_units[3]["clean_text"])

    def test_cleanup_keeps_original_table_unit_when_projecting_phone_table_semantics(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    261,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    261,
                    "table",
                    "电话表",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)", ""],
                        ["", "", "办公室", "68932649"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                261,
                261,
                title="中央民族大学校内常用电话",
                handbook_section="中央民族大学公寓及公费医疗管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertTrue(any(row["unit_type"] == "table_unit" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_row" for row in result.document_units))


if __name__ == "__main__":
    unittest.main()
