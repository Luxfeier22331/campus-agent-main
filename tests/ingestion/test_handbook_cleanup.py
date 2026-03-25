from __future__ import annotations

from itertools import count
from pathlib import Path
import unittest

from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document
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
) -> dict[str, object]:
    sequence = next(SOURCE_ROW_SEQUENCE)
    return {
        "schema_version": "student_handbook_layout_elements_v1",
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
        "is_repeated_candidate": row_type in {"header", "footer", "page_number"},
        "title_candidate_score": title_candidate_score,
        "section_hint": text if row_type == "heading" else None,
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
    def test_cleanup_merges_broken_structural_line_continuations(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(30, "heading", "中央民族大学本科学生专业奖学金评定办法", block_role="title", title_candidate_score=1.0),
                _source_row(30, "paragraph", "第六条 所评学年有下列情况之一者,不得参评本科学生专业奖学金:"),
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
                _source_row(1, "heading", "前一篇制度", block_role="title", title_candidate_score=1.0),
                _source_row(1, "paragraph", "不应进入本篇"),
                _source_row(2, "heading", "当前制度", block_role="title", title_candidate_score=1.0),
                _source_row(2, "paragraph", "第一条 当前制度正文"),
                _source_row(3, "paragraph", "第二条 当前制度续页"),
                _source_row(4, "heading", "后一篇制度", block_role="title", title_candidate_score=1.0),
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
                _source_row(5, "heading", "单页制度", block_role="title", title_candidate_score=1.0),
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
                _source_row(10, "heading", "中央民族大学奖学金评定办法", block_role="title", title_candidate_score=1.0),
                _source_row(10, "paragraph", "第一条 为做好奖学金评定工作"),
                _source_row(10, "footer", "10"),
            ],
            manifest_document=_manifest_document(10, 10, title="占位标题", handbook_section="中央民族大学学生奖励管理规定"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(result.title, "中央民族大学奖学金评定办法")

    def test_cleanup_consumes_title_variant_and_metadata_preface_without_emitting_policy_page(self) -> None:
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
        self.assertEqual(result.document_units[0]["metadata"]["title"], "中央民族大学优秀本科毕业生评选办法")
        self.assertEqual(result.document_units[0]["metadata"]["policy_doc_no"], "民大校发〔2018〕329号")
        self.assertNotIn("优秀本科毕业生评选办法（试行）", result.document_units[0]["clean_text"])
        self.assertNotIn("民大校发〔2018〕329号", result.document_units[0]["clean_text"])

    def test_cleanup_prefers_manifest_title_when_first_page_heading_is_not_document_title(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(67, "heading", "四、组织管理", block_role="heading", title_candidate_score=0.75),
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

        self.assertEqual(result.title, "中央民族大学本科生专业调整实施办法")

    def test_cleanup_projects_list_like_sections_into_multiple_policy_pages(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(8, "heading", "中央民族大学校内常用电话", block_role="title", title_candidate_score=1.0),
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

    def test_cleanup_falls_back_to_single_policy_page_without_article_or_list_structure(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(8, "heading", "特别说明", block_role="title", title_candidate_score=1.0),
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
                _source_row(12, "heading", "中央民族大学奖学金评定办法", block_role="title", title_candidate_score=1.0),
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
            manifest_document=_manifest_document(12, 12, title="中央民族大学奖学金评定办法", handbook_section="中央民族大学学生奖励管理规定"),
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
                _source_row(20, "heading", "中央民族大学校内常用电话", block_role="title", title_candidate_score=1.0),
                _source_row(
                    20,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html=(
                        "<table>"
                        "<tr><td>单位名称</td><td>电话号码</td><td>单位名称</td><td>电话号码</td></tr>"
                        "<tr><td rowspan=\"2\">校园110</td><td rowspan=\"2\">68932220</td><td>研究生院(学位办)</td><td></td></tr>"
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
                _source_row(21, "heading", "中央民族大学校内常用电话", block_role="title", title_candidate_score=1.0),
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
                _source_row(22, "heading", "中央民族大学本科学生综合素质测评办法", block_role="title", title_candidate_score=1.0),
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
            manifest_document=_manifest_document(22, 22, title="中央民族大学本科学生综合素质测评办法"),
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
                _source_row(22, "heading", "中央民族大学本科学生综合素质测评办法", block_role="title", title_candidate_score=1.0),
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
            manifest_document=_manifest_document(22, 22, title="中央民族大学本科学生综合素质测评办法"),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertTrue(table_unit["metadata"]["table_header_line"].startswith("项目 | "))
        self.assertNotIn("未命名列", table_unit["clean_text"])

    def test_cleanup_skips_form_like_attachment_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(22, "heading", "中央民族大学本科生国家助学金评审办法", block_role="title", title_candidate_score=1.0),
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
            manifest_document=_manifest_document(22, 22, title="中央民族大学本科生国家助学金评审办法"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_decorative_student_card_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(22, "heading", "中央民族大学本科(预科)学生证管理办法", block_role="title", title_candidate_score=1.0),
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
            manifest_document=_manifest_document(22, 22, title="中央民族大学本科(预科)学生证管理办法"),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_attaches_table_anchor_to_current_article_context(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(23, "heading", "中央民族大学本科学生学籍管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(23, "heading", "第三章 考核与成绩记载", block_role="heading", title_candidate_score=0.8),
                _source_row(23, "paragraph", "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。"),
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
                _source_row(24, "heading", "中央民族大学本科学生学籍管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(24, "heading", "第三章 考核与成绩记载", block_role="heading", title_candidate_score=0.8),
                _source_row(24, "paragraph", "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。"),
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

    def test_cleanup_preserves_nested_section_path_for_article_units(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(36, "heading", "中央民族大学本科学生学籍管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(36, "heading", "第二章 入学与注册", block_role="heading", title_candidate_score=0.8),
                _source_row(36, "heading", "第一节 新生报到", block_role="heading", title_candidate_score=0.7),
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
                _source_row(40, "heading", "中央民族大学本科学生学籍管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(40, "heading", "第二章 入学与注册", block_role="heading", title_candidate_score=0.8),
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

    def test_cleanup_preserves_formula_like_lines_as_separate_article_lines(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(40, "heading", "中央民族大学本科学生学籍管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(40, "heading", "第三章 考核与成绩记载", block_role="heading", title_candidate_score=0.8),
                _source_row(40, "paragraph", "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。"),
                _source_row(40, "paragraph", "（二）课程学分绩点、平均学分绩点的计算方法："),
                _source_row(40, "paragraph", "课程学分绩点=课程学分×课程绩点"),
                _source_row(40, "paragraph", "平均学分绩= $ \\sum $(课程学分×课程的绩点)/ $ \\sum $课程学分"),
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
                _source_row(36, "heading", "中央民族大学本科学生学籍管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(36, "paragraph", "民大校发 [2017] 304号"),
                _source_row(36, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8),
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
        self.assertEqual(result.document_units[0]["metadata"]["policy_doc_no"], "民大校发[2017]304号")
        self.assertNotIn("民大校发[2017]304号", result.document_units[0]["clean_text"])

    def test_cleanup_preserves_front_matter_lines_as_preface_metadata_before_first_section_heading(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(2, "heading", "普通高等学校学生管理规定", block_role="title", title_candidate_score=1.0),
                _source_row(2, "paragraph", "2017年2月4日"),
                _source_row(2, "paragraph", "中华人民共和国教育部令第 41 号"),
                _source_row(2, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8),
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

    def test_cleanup_splits_structure_first_policy_document_by_part_and_subsection_headings(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(50, "heading", "中央民族大学学生志愿服务管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(50, "heading", "第二章 分则", block_role="heading", title_candidate_score=0.8),
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
                _source_row(51, "heading", "中央民族大学学生课堂行为规范及课堂秩序管理办法", block_role="title", title_candidate_score=1.0),
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
                _source_row(52, "heading", "中央民族大学优秀本科毕业生评选办法", block_role="title", title_candidate_score=1.0),
                _source_row(52, "heading", "第三章 评选条件", block_role="heading", title_candidate_score=0.8),
                _source_row(52, "paragraph", "第六条 校级优秀本科毕业生须具备以下基本条件:"),
                _source_row(52, "paragraph", "(一)思想政治表现良好;"),
                _source_row(52, "paragraph", "(二)遵守规章制度;"),
                _source_row(52, "paragraph", "(三)学习成绩良好;"),
                _source_row(52, "paragraph", "(四)积极参加体育锻炼,身心健康;"),
                _source_row(52, "paragraph", "(五)积极参加社会实践和志愿服务。"),
                _source_row(52, "paragraph", "第七条 市级优秀本科毕业生从校级优秀本科毕业生中择优推荐产生。"),
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

    def test_cleanup_projects_terminal_inline_enumerated_provision_as_standalone_policy_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(53, "heading", "中央民族大学学生课堂行为规范及课堂秩序管理办法", block_role="title", title_candidate_score=1.0),
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
        self.assertEqual(policy_units[1]["anchor"]["section_path"], ["三、学生课堂秩序管理"])
        self.assertEqual(policy_units[1]["anchor"]["provision_label"], "四")
        self.assertEqual(policy_units[1]["clean_text"], "四、本办法由学生工作部(处)负责解释。")

    def test_cleanup_projects_consecutive_inline_appendix_provisions_as_consistent_sibling_units(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(54, "heading", "中央民族大学学生志愿服务管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(54, "heading", "第三章 附则", block_role="heading", title_candidate_score=0.8),
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

    def test_cleanup_keeps_chapter_intro_inline_enumerated_sentences_inside_policy_page(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(55, "heading", "中央民族大学学生志愿服务管理办法", block_role="title", title_candidate_score=1.0),
                _source_row(55, "heading", "第一章 总则", block_role="heading", title_candidate_score=0.8),
                _source_row(55, "paragraph", "一、为进一步规范中央民族大学学生志愿服务管理工作,特制定本办法。"),
                _source_row(55, "paragraph", "二、志愿者(Volunteer)是指不以物质报酬为目的,自愿为社会和他人提供服务和帮助的人。"),
                _source_row(55, "heading", "第二章 分则", block_role="heading", title_candidate_score=0.8),
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

    def test_cleanup_merges_broken_sentence_lines_without_crossing_structure_boundaries(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(56, "heading", "中央民族大学优秀本科毕业生评选办法", block_role="title", title_candidate_score=1.0),
                _source_row(56, "heading", "第三章 评选条件", block_role="heading", title_candidate_score=0.8),
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
                _source_row(261, "heading", "中央民族大学校内常用电话", block_role="title", title_candidate_score=1.0),
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
                _source_row(261, "heading", "中央民族大学校内常用电话", block_role="title", title_candidate_score=1.0),
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
