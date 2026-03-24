from __future__ import annotations

from pathlib import Path
import unittest

from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document
from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result
from campus_ingestion_core.split_manifest import SplitManifestDocument

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_handbook"


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
    return {
        "schema_version": "student_handbook_layout_elements_v1",
        "corpus": "regulations",
        "collection": "student_handbook",
        "source_artifact_id": "asset:student-handbook",
        "source_pdf": "学生手册_2018.pdf",
        "page_start": page,
        "page_end": page,
        "row_id": f"page-{page:04d}-{row_type}",
        "row_index": page,
        "ocr_provider": "paddleocr_async",
        "ocr_model": "PaddleOCR-VL-1.5",
        "provider_page_id": page,
        "provider_block_id": f"block-{page:04d}",
        "provider_payload_ref": f"line:{page}",
        "confidence": 0.98,
        "row_type": row_type,
        "block_role": block_role or row_type,
        "heading_level": 1 if row_type == "heading" else None,
        "reading_order": 1,
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

    def test_cleanup_normalizes_table_rows_with_rowspan_from_html(self) -> None:
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

        table_row_units = [row for row in result.document_units if row["unit_type"] == "table_row"]
        self.assertEqual(
            [row["table_cells"][0] for row in table_row_units[:3]],
            [
                ["单位名称", "电话号码", "单位名称", "电话号码"],
                ["校园110", "68932220", "研究生院(学位办)", ""],
                ["校园110", "68932220", "办公室", "68932649"],
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

    def test_cleanup_pads_table_rows_to_header_width(self) -> None:
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

        table_row_units = [row for row in result.document_units if row["unit_type"] == "table_row"]
        self.assertEqual(table_row_units[1]["table_cells"][0], ["学生处(学生工作部)", "保卫武装部", "", ""])
        self.assertEqual(
            table_row_units[1]["clean_text"],
            "单位名称=学生处(学生工作部) | 电话号码=保卫武装部 | 单位名称_2= | 电话号码_2=",
        )

    def test_cleanup_uses_header_labels_for_table_row_clean_text_when_available(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(22, "heading", "中央民族大学校内常用电话", block_role="title", title_candidate_score=1.0),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(22, 22, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        table_row_units = [row for row in result.document_units if row["unit_type"] == "table_row"]
        self.assertEqual(
            table_row_units[1]["clean_text"],
            "单位名称=校园110 | 电话号码=68932220 | 单位名称_2=研究生院(学位办) | 电话号码_2=",
        )

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

    def test_cleanup_attaches_table_rows_to_current_article_context(self) -> None:
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

        table_row_units = [row for row in result.document_units if row["unit_type"] == "table_row"]
        self.assertGreaterEqual(len(table_row_units), 2)
        self.assertEqual(table_row_units[1]["anchor"]["article_label"], "第十六条")
        self.assertEqual(table_row_units[1]["anchor"]["table_context"], "(一)考核成绩与绩点的关系:")

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

    def test_cleanup_preserves_policy_doc_no_as_front_matter_policy_page(self) -> None:
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

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertGreaterEqual(len(policy_units), 1)
        self.assertEqual(policy_units[0]["clean_text"], "民大校发[2017]304号")
        self.assertEqual(policy_units[0]["anchor"]["section_path"], [])

    def test_cleanup_preserves_front_matter_lines_before_first_section_heading(self) -> None:
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

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertGreaterEqual(len(policy_units), 1)
        self.assertEqual(policy_units[0]["clean_text"], "2017年2月4日\n中华人民共和国教育部令第 41 号")
        self.assertIn("2017年2月4日", result.canonical_markdown)
        self.assertIn("中华人民共和国教育部令第 41 号", result.canonical_markdown)

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

    def test_cleanup_keeps_original_table_rows_when_projecting_phone_table_semantics(self) -> None:
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
        self.assertTrue(any(row["unit_type"] == "table_row" for row in result.document_units))


if __name__ == "__main__":
    unittest.main()
