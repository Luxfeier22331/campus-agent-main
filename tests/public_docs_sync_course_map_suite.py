from __future__ import annotations

import importlib.util
import io
import subprocess
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch


def _load_sync_module():
    module_path = (
        Path(__file__).resolve().parents[1]
        / "apps"
        / "public-docs"
        / "scripts"
        / "sync_real_docs.py"
    )
    spec = importlib.util.spec_from_file_location("public_docs_sync", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载模块: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class _FakeS3Client:
    def __init__(self, objects: dict[str, str]) -> None:
        self._objects = objects

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, io.BytesIO]:
        if Key not in self._objects:
            raise KeyError(Key)
        return {"Body": io.BytesIO(self._objects[Key].encode("utf-8"))}

    def list_objects_v2(
        self,
        *,
        Bucket: str,
        Prefix: str,
        ContinuationToken: str | None = None,
    ) -> dict[str, object]:
        del Bucket, ContinuationToken
        keys = sorted(key for key in self._objects if key.startswith(Prefix))
        return {
            "Contents": [{"Key": key} for key in keys],
            "IsTruncated": False,
        }


@dataclass(frozen=True)
class _FakeCourseMapNode:
    node_label: str
    stage_label: str
    category_label: str


@dataclass(frozen=True)
class _FakeCourseMapEdge:
    source_label: str
    target_label: str


class PublicDocsSyncCourseMapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = _load_sync_module()

    def test_curriculum_markdown_replaces_reviewed_course_map_section_with_structured_component(
        self,
    ) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"法学（民族实验班）本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"六、课程地图","heading_level":2,"section_hint":"section"}',
                '{"row_type":"heading","clean_text":"法学专业本科课程结构拓扑图","heading_level":2}',
                '{"row_type":"heading","clean_text":"七、其他说明","heading_level":2,"section_hint":"section"}',
                '{"row_type":"paragraph","clean_text":"允许国际学分转换。"}',
            ]
        )
        course_map_embed = module.CourseMapDocEmbed(
            component_import_path="../.components/CourseMapSection",
            data_import_path="../.generated/course-maps/law-ethnic-experimental-program.data",
            data_import_name="lawCourseMapData",
        )

        markdown = module._build_curriculum_markdown(
            slug="law-ethnic-experimental-program",
            title="法学（民族实验班）本科人才培养方案",
            jsonl_text=jsonl_text,
            course_map_embed=course_map_embed,
        )

        self.assertIn('import CourseMapSection from "../.components/CourseMapSection";', markdown)
        self.assertIn(
            'import lawCourseMapData from "../.generated/course-maps/law-ethnic-experimental-program.data";',
            markdown,
        )
        self.assertIn(
            "<CourseMapSection data={lawCourseMapData} />",
            markdown,
        )
        self.assertNotIn("## 法学专业本科课程结构拓扑图", markdown)
        self.assertIn("## 七、其他说明", markdown)

    def test_curriculum_markdown_replaces_non_six_course_map_heading_with_structured_component(
        self,
    ) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"光电信息科学与工程本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"七、课程地图","heading_level":2,"section_hint":"section"}',
                '{"row_type":"heading","clean_text":"光电信息科学与工程本科课程结构拓扑图","heading_level":2}',
                '{"row_type":"heading","clean_text":"八、其他说明","heading_level":2,"section_hint":"section"}',
                '{"row_type":"paragraph","clean_text":"允许国际学分转换。"}',
            ]
        )
        course_map_embed = module.CourseMapDocEmbed(
            component_import_path="../.components/CourseMapSection",
            data_import_path="../.generated/course-maps/mock.data",
            data_import_name="mockCourseMapData",
        )

        markdown = module._build_curriculum_markdown(
            slug="mock-doc",
            title="光电信息科学与工程本科人才培养方案",
            jsonl_text=jsonl_text,
            course_map_embed=course_map_embed,
        )

        self.assertIn("\n## 七、课程地图\n", markdown)
        self.assertIn("<CourseMapSection data={mockCourseMapData} />", markdown)
        self.assertNotIn("## 光电信息科学与工程本科课程结构拓扑图", markdown)
        self.assertIn("## 八、其他说明", markdown)

    def test_curriculum_markdown_omits_empty_course_map_section_without_published_surface(
        self,
    ) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"历史学（强基计划）本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2,"section_hint":"section"}',
                '{"row_type":"paragraph","clean_text":"课程清单如下。"}',
                '{"row_type":"heading","clean_text":"六、课程地图","heading_level":2,"section_hint":"section"}',
                '{"row_type":"heading","clean_text":"历史学强基计划本科课程结构拓扑图","heading_level":2}',
                '{"row_type":"heading","clean_text":"七、其他说明","heading_level":2,"section_hint":"section"}',
                '{"row_type":"paragraph","clean_text":"允许国际学分转换。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="历史学（强基计划）本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("## 五、课程设置和修读建议", markdown)
        self.assertIn("## 七、其他说明", markdown)
        self.assertNotIn("## 六、课程地图", markdown)
        self.assertNotIn("历史学强基计划本科课程结构拓扑图", markdown)

    def test_curriculum_markdown_omits_numbered_course_map_subheadings_without_published_surface(
        self,
    ) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"公共管理类本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"六、课程地图","heading_level":2,"section_hint":"section"}',
                '{"row_type":"heading","clean_text":"1.公共事业管理","heading_level":4}',
                '{"row_type":"heading","clean_text":"2.行政管理","heading_level":4}',
                '{"row_type":"heading","clean_text":"七、其他说明","heading_level":2,"section_hint":"section"}',
                '{"row_type":"paragraph","clean_text":"允许国际学分转换。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="公共管理类本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("## 七、其他说明", markdown)
        self.assertNotIn("## 六、课程地图", markdown)
        self.assertNotIn("#### 1. 公共事业管理", markdown)
        self.assertNotIn("#### 2. 行政管理", markdown)

    def test_curriculum_markdown_keeps_long_paragraphs_unbroken_for_rendered_accuracy(
        self,
    ) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"教育学本科人才培养方案","heading_level":1}',
                '{"row_type":"paragraph","clean_text":"本培养方案总学分(专业基础课+专业方向课+实践教学环节)/原2018版培养方案中的学分(学科基础课+专业基础课+专业方向课+其他实践教学环节)(百分比=55/112*100%=49.1%)。同时提交一份3000字左右与讲座有关的研究综述。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="教育学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("55/112*100%=49.1%", markdown)
        self.assertIn("3000字左右", markdown)
        self.assertNotIn("5\n5/112", markdown)
        self.assertNotIn("300\n0字", markdown)

    def test_curriculum_markdown_converts_wide_table_rows_to_record_blocks(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"教育学本科人才培养方案","heading_level":1}',
                '{"row_type":"table","html":"<table><tr><td>一级指标</td><td>二级指标</td><td>三级指标</td></tr><tr><td>1知识目标</td><td>1-1 教育科学基础知识和基本理论</td><td>1-1-1 掌握教育学学科发展历史和规律教育目的和功能课程与教学论等基础知识和理论形成教育学专业知识体系和框架。</td></tr></table>","clean_text":"<table><tr><td>一级指标</td><td>二级指标</td><td>三级指标</td></tr><tr><td>1知识目标</td><td>1-1 教育科学基础知识和基本理论</td><td>1-1-1 掌握教育学学科发展历史和规律教育目的和功能课程与教学论等基础知识和理论形成教育学专业知识体系和框架。</td></tr></table>"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="教育学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertNotIn("|一级指标|二级指标|三级指标|", markdown)
        self.assertIn("- 一级指标：1知识目标", markdown)
        self.assertIn("  - 二级指标：1-1 教育科学基础知识和基本理论", markdown)
        self.assertIn("  - 三级指标：1-1-1", markdown)
        self.assertIn("掌握教育学学科发展历史和规律", markdown)

    def test_curriculum_markdown_normalizes_broken_ordered_list_linebreaks(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"数字经济本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"二、毕业要求","heading_level":2}',
                '{"row_type":"paragraph","clean_text":"1.\\n政治素质:坚持以习近平新时代中国特色社会主义思想为指导,热爱祖国。"}',
                '{"row_type":"paragraph","clean_text":"10.3\\n对数字经济领域具备国际化视野,能够进行跨文化交流。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="数字经济本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn(
            "\n1. 政治素质:坚持以习近平新时代中国特色社会主义思想为指导,热爱祖国。\n", markdown
        )
        self.assertIn("\n10\\.3 对数字经济领域具备国际化视野,能够进行跨文化交流。\n", markdown)

    def test_curriculum_markdown_repairs_minority_preparatory_summary_artifacts(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"少数民族预科教育人才培养方案","heading_level":1}',
                '{"row_type":"paragraph","clean_text":"通识教育课:铸牢中华民族共同体意识教育专题、信息素养、形势与政策、大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语"}',
                '{"row_type":"paragraph","clean_text":"基础课程:理科班增设普通化学和大学物理"}',
                '{"row_type":"table","html":"<table><tr><td rowspan=\\"2\\" colspan=\\"2\\">类别</td><td rowspan=\\"2\\">学时</td><td colspan=\\"2\\">各学期周学时分配计划</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\\"2\\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan=\\"2\\">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\\"2\\">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\\"3\\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr><tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\\"2\\">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\\"2\\">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>","clean_text":"<table><tr><td rowspan=\\"2\\" colspan=\\"2\\">类别</td><td rowspan=\\"2\\">学时</td><td colspan=\\"2\\">各学期周学时分配计划</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\\"2\\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan=\\"2\\">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\\"2\\">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan=\\"3\\">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr><tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\\"2\\">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan=\\"2\\">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>"}',
                '{"row_type":"table","html":"<table><tr><td rowspan=\\"2\\">课程类别</td><td rowspan=\\"2\\">课程编号</td><td rowspan=\\"2\\">课程名称</td><td rowspan=\\"2\\">学分</td><td colspan=\\"2\\">学时</td><td colspan=\\"2\\">各学期周学时分配</td><td rowspan=\\"2\\">备注</td></tr><tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan=\\"2\\">基础课</td><td>1052030065</td><td>普通化学</td><td></td><td>72</td><td>18</td><td>4</td><td>/</td><td rowspan=\\"2\\">必修(实验18学时)</td></tr><tr><td>1052030066</td><td>大学物理</td><td></td><td>72</td><td>18</td><td>/</td><td>4</td></tr></table>","clean_text":"<table><tr><td rowspan=\\"2\\">课程类别</td><td rowspan=\\"2\\">课程编号</td><td rowspan=\\"2\\">课程名称</td><td rowspan=\\"2\\">学分</td><td colspan=\\"2\\">学时</td><td colspan=\\"2\\">各学期周学时分配</td><td rowspan=\\"2\\">备注</td></tr><tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan=\\"2\\">基础课</td><td>1052030065</td><td>普通化学</td><td></td><td>72</td><td>18</td><td>4</td><td>/</td><td rowspan=\\"2\\">必修(实验18学时)</td></tr><tr><td>1052030066</td><td>大学物理</td><td></td><td>72</td><td>18</td><td>/</td><td>4</td></tr></table>"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="少数民族预科教育人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。", markdown)
        self.assertIn("基础课程:理科班增设普通化学和大学物理。", markdown)
        self.assertIn("<td colspan=\"5\">文科班</td>", markdown)
        self.assertIn("<td colspan=\"5\">理科班</td>", markdown)
        self.assertIn("<td colspan=\"9\">理科班</td>", markdown)
        self.assertNotIn("大学体育、心理健康主干课程", markdown)
        self.assertEqual(markdown.count("<tr><td>第一学期</td><td>第二学期</td></tr>"), 2)

    def test_curriculum_markdown_repairs_ethnology_second_bachelor_table_artifacts(
        self,
    ) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"民族学本科第二学士学位人才培养方案","heading_level":1}',
                '{"row_type":"table","html":"<table><tr><td rowspan=\\"2\\" colspan=\\"2\\">课程类别</td><td rowspan=\\"2\\">课程编号</td><td rowspan=\\"2\\">课程名称</td><td rowspan=\\"2\\">学分</td><td colspan=\\"2\\">学时</td><td colspan=\\"4\\">各学期周学时分配</td></tr><tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr><tr><td rowspan=\\"13\\">专业教育</td><td rowspan=\\"13\\">专业必修课共30学分</td><td>1026030031</td><td>民族学导论</td><td>2</td><td>36</td><td></td><td>2</td><td></td><td></td><td></td></tr></table>","clean_text":"<table><tr><td rowspan=\\"2\\" colspan=\\"2\\">课程类别</td><td rowspan=\\"2\\">课程编号</td><td rowspan=\\"2\\">课程名称</td><td rowspan=\\"2\\">学分</td><td colspan=\\"2\\">学时</td><td colspan=\\"4\\">各学期周学时分配</td></tr><tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr><tr><td rowspan=\\"13\\">专业教育</td><td rowspan=\\"13\\">专业必修课共30学分</td><td>1026030031</td><td>民族学导论</td><td>2</td><td>36</td><td></td><td>2</td><td></td><td></td><td></td></tr></table>","relation_type":null,"owner_row_id":null,"continuation_group_id":"owner-1","row_id":"owner-1"}',
                '{"row_type":"table","html":"<table><tr><td>1026030062</td><td>经济人类学(全英文)</td><td>2</td><td>36</td><td></td><td></td><td>2</td><td></td><td></td></tr><tr><td rowspan=\\"20\\">专业选修课须修满12学分</td><td>1026040121</td><td>人类与发展研究专题</td><td>2</td><td>36</td><td></td><td></td><td></td><td>2</td><td></td></tr></table>","clean_text":"<table><tr><td>1026030062</td><td>经济人类学(全英文)</td><td>2</td><td>36</td><td></td><td></td><td>2</td><td></td><td></td></tr><tr><td rowspan=\\"20\\">专业选修课须修满12学分</td><td>1026040121</td><td>人类与发展研究专题</td><td>2</td><td>36</td><td></td><td></td><td></td><td>2</td><td></td></tr></table>","relation_type":"table_continuation","owner_row_id":"owner-1","continuation_group_id":"owner-1","row_id":"owner-2"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="民族学本科第二学士学位人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn('rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>', markdown)
        self.assertIn("经济人类学(全英文)", markdown)
        self.assertEqual(markdown.count("<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>"), 1)
        self.assertNotIn("<tr><td rowspan=\"3\">课程类别</td>", markdown)

    def test_discover_curriculum_docs_lists_all_document_units_and_preserves_known_slug(
        self,
    ) -> None:
        module = self.module
        objects = {
            (
                "curriculum/documents/curriculum_plan/"
                "法学-民族实验班-本科人才培养方案--法学-民族实验班-本科人才培养方案/"
                "source-faithful/2022/document-units.jsonl"
            ): "\n".join(
                [
                    '{"doc_id":"curriculum:法学（民族实验班）本科人才培养方案","row_type":"heading","clean_text":"法学（民族实验班）本科人才培养方案"}',
                    '{"row_type":"paragraph","clean_text":"正文"}',
                ]
            ),
            (
                "curriculum/documents/curriculum_plan/"
                "法学本科人才培养方案--法学本科人才培养方案/"
                "source-faithful/2022/document-units.jsonl"
            ): "\n".join(
                [
                    '{"doc_id":"curriculum:法学本科人才培养方案","row_type":"heading","clean_text":"法学本科人才培养方案"}',
                    '{"row_type":"paragraph","clean_text":"正文"}',
                ]
            ),
        }

        docs = module._discover_curriculum_docs(_FakeS3Client(objects))

        self.assertEqual(len(docs), 2)
        docs_by_title = {doc.title: doc for doc in docs}
        self.assertEqual(
            docs_by_title["法学（民族实验班）本科人才培养方案"].slug,
            "law-ethnic-experimental-program",
        )
        self.assertTrue(
            docs_by_title["法学本科人才培养方案"].slug.startswith("法学本科人才培养方案")
        )

    def test_resolve_curriculum_doc_title_falls_back_to_doc_id(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"doc_id":"curriculum:法学本科人才培养方案","row_type":"paragraph","clean_text":"正文"}',
            ]
        )

        title = module._resolve_curriculum_doc_title(
            jsonl_text,
            key="curriculum/documents/curriculum_plan/mock/source-faithful/2022/document-units.jsonl",
        )

        self.assertEqual(title, "法学本科人才培养方案")

    def test_infer_course_map_route_group_uses_fixed_keyword_priority(self) -> None:
        module = self.module

        self.assertEqual(module._infer_course_map_route_group("公共体育（二）"), "foundation")
        self.assertEqual(
            module._infer_course_map_route_group("程序设计基础课程设计"),
            "practice",
        )
        self.assertEqual(
            module._infer_course_map_route_group("专业选修课程"),
            "extension",
        )
        self.assertEqual(module._infer_course_map_route_group("数据结构"), "core")

    def test_build_course_map_import_name_uses_hash_fallback_for_non_ascii_slug(self) -> None:
        module = self.module

        import_name = module._build_course_map_data_import_name("法学本科人才培养方案")

        self.assertRegex(import_name, r"^courseMapData[0-9a-f]{8}$")

    def test_build_course_map_data_payload_adds_group_and_edge_counts(self) -> None:
        module = self.module

        surface = type(
            "Surface",
            (),
            {
                "generated_at": "2026-04-22T00:00:00+00:00",
                "document_title": "示例培养方案",
                "document_id": "curriculum:test",
                "raw_asset_id": "asset:test",
                "raw_version_id": "sha256:test",
                "blocks": (
                    type(
                        "Block",
                        (),
                        {
                            "block_id": "page-0001-row-1-map-01",
                            "title": "示例课程地图",
                            "status": "ready",
                            "title_confidence": "visible",
                            "page_number": 1,
                            "row_id": "page-0001-block-0001",
                            "map_index": 1,
                            "parent_heading_hint": "六、课程地图",
                            "display_stage_labels": ("一年级上学期", "一年级下学期"),
                            "extraction_notes": (),
                            "image_object_key": "curriculum/documents/example/reader-assets/course-maps/page-0001-row-1-map-01.png",
                            "nodes": (
                                _FakeCourseMapNode("公共体育（一）", "一年级上学期", ""),
                                _FakeCourseMapNode("程序设计基础课程设计", "一年级下学期", ""),
                                _FakeCourseMapNode("数据结构", "一年级下学期", ""),
                            ),
                            "edges": (
                                _FakeCourseMapEdge("公共体育（一）", "程序设计基础课程设计"),
                                _FakeCourseMapEdge("程序设计基础课程设计", "数据结构"),
                            ),
                        },
                    )(),
                ),
            },
        )()

        payload = module._build_course_map_data_payload(surface=surface, public_slug="mock-doc")

        self.assertEqual(payload["documentId"], "curriculum:test")
        self.assertEqual(len(payload["blocks"]), 1)
        self.assertEqual(
            payload["blocks"][0]["imageSrc"],
            "/course-maps/mock-doc/page-0001-row-1-map-01.png",
        )
        nodes = {item["node_label"]: item for item in payload["blocks"][0]["nodes"]}
        self.assertEqual(nodes["公共体育（一）"]["route_group"], "foundation")
        self.assertEqual(nodes["公共体育（一）"]["incoming_count"], 0)
        self.assertEqual(nodes["公共体育（一）"]["outgoing_count"], 1)
        self.assertEqual(nodes["程序设计基础课程设计"]["route_group"], "practice")
        self.assertEqual(nodes["程序设计基础课程设计"]["incoming_count"], 1)
        self.assertEqual(nodes["程序设计基础课程设计"]["outgoing_count"], 1)
        self.assertEqual(nodes["数据结构"]["route_group"], "core")
        self.assertEqual(nodes["数据结构"]["incoming_count"], 1)
        self.assertEqual(nodes["数据结构"]["outgoing_count"], 0)

    def test_format_json_content_uses_multiline_tab_indentation(self) -> None:
        module = self.module

        content = module._format_json_content(["index", "law-ethnic-experimental-program"])

        self.assertEqual(
            content,
            '[\n\t"index",\n\t"law-ethnic-experimental-program"\n]\n',
        )

    def test_build_course_map_data_module_formats_with_biome(self) -> None:
        module = self.module

        expected = "\n".join(
            [
                "const data = {",
                '\tgeneratedAt: "2026-04-22T00:00:00+00:00",',
                '\tblocks: [{ blockId: "page-0001-row-1-map-01", nodes: [{ node_label: "数据结构", stage_label: "一年级", category_label: "" }] }],',
                "} as const;",
                "",
                "export default data;",
                "",
            ]
        )

        with patch("_sync_real_docs.course_map.subprocess", create=True) as subprocess_mock:

            def _fake_run(
                argv: list[str],
                *,
                cwd: Path,
                input: str,
                text: bool,
                capture_output: bool,
                check: bool,
            ) -> subprocess.CompletedProcess[str]:
                self.assertEqual(
                    argv,
                    [
                        "pnpm",
                        "exec",
                        "biome",
                        "format",
                        "--stdin-file-path",
                        "apps/public-docs/docs/.generated/course-maps/mock.data.ts",
                    ],
                )
                self.assertEqual(cwd, module.REPO_ROOT)
                self.assertTrue(text)
                self.assertTrue(capture_output)
                self.assertFalse(check)
                self.assertIn("const data = {\n\tgeneratedAt:", input)
                self.assertIn(
                    '\n\tblocks: [\n\t\t{\n\t\t\tblockId: "page-0001-row-1-map-01",',
                    input,
                )
                self.assertIn(
                    '\n\t\t\t\t\tnode_label: "数据结构",\n\t\t\t\t\tstage_label: "一年级",\n\t\t\t\t\tcategory_label: ""\n',
                    input,
                )
                self.assertNotIn('"generatedAt":', input)
                self.assertNotIn('"blockId":', input)
                return subprocess.CompletedProcess(argv, 0, stdout=expected, stderr="")

            subprocess_mock.run.side_effect = _fake_run

            content = module._build_course_map_data_module(
                {
                    "generatedAt": "2026-04-22T00:00:00+00:00",
                    "blocks": [
                        {
                            "blockId": "page-0001-row-1-map-01",
                            "nodes": [
                                {
                                    "node_label": "数据结构",
                                    "stage_label": "一年级",
                                    "category_label": "",
                                }
                            ],
                        }
                    ],
                },
                biome_file_path="apps/public-docs/docs/.generated/course-maps/mock.data.ts",
            )

        self.assertEqual(content, expected)

    def test_build_course_map_data_module_raises_on_biome_failure(self) -> None:
        module = self.module

        with patch("_sync_real_docs.course_map.subprocess", create=True) as subprocess_mock:
            subprocess_mock.run.return_value = subprocess.CompletedProcess(
                args=["pnpm"],
                returncode=1,
                stdout="",
                stderr="formatter failed",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                "apps/public-docs/docs/.generated/course-maps/mock.data.ts",
            ):
                module._build_course_map_data_module(
                    {"generatedAt": "2026-04-22T00:00:00+00:00", "blocks": []},
                    biome_file_path="apps/public-docs/docs/.generated/course-maps/mock.data.ts",
                )

    def test_collection_index_pages_do_not_inline_document_titles(self) -> None:
        module = self.module

        handbook_index = module._build_handbook_index()
        curriculum_index = module._build_curriculum_plan_index()

        for doc in module._load_handbook_docs():
            self.assertNotIn(doc.title, handbook_index)
        self.assertNotIn("法学（民族实验班）本科人才培养方案", curriculum_index)
        self.assertNotIn("计算机科学与技术（民族实验班）本科人才培养方案", curriculum_index)

    def test_load_handbook_docs_reads_full_split_manifest_and_preserves_known_slugs(self) -> None:
        module = self.module

        docs = module._load_handbook_docs()

        self.assertGreater(len(docs), 30)
        docs_by_id = {doc.document_id: doc for doc in docs}
        self.assertEqual(
            docs_by_id["handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc"].slug,
            "student-attendance-management",
        )
        self.assertEqual(
            docs_by_id["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"].slug,
            "national-scholarship-evaluation",
        )


if __name__ == "__main__":
    unittest.main()
