from __future__ import annotations

import importlib.util
import io
import subprocess
import sys
import tempfile
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


class PublicDocsSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = _load_sync_module()

    def test_sync_handbook_docs_strips_standalone_handbook_noise(self) -> None:
        module = self.module
        fake_doc = module.HandbookDoc(
            slug="mock-handbook",
            title="示例手册条目",
            document_id="handbook:test-doc",
        )
        source_markdown = "\n".join(
            [
                "---",
                "title: 示例手册条目",
                "collection: student_handbook",
                "---",
                "",
                "## 第一条",
                "本条内容开始。",
                "学生手册",
                "继续正文。",
                "",
            ]
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            docs_root = Path(temp_dir)
            expected_key = (
                "regulations/documents/student_rules/"
                "示例手册条目--test-doc/source-faithful/2018/canonical.md"
            )
            legacy_key = (
                "regulations/documents/student_handbook/"
                "示例手册条目--test-doc/source-faithful/2018/canonical.md"
            )
            client = _FakeS3Client({expected_key: source_markdown})
            with (
                patch.object(module, "DOCS_ROOT", docs_root),
            ):
                module._sync_handbook_docs(client, handbook_docs=(fake_doc,))

            generated = (docs_root / "student-handbook" / f"{fake_doc.slug}.md").read_text(
                encoding="utf-8"
            )

        self.assertNotIn(legacy_key, client._objects)
        self.assertNotIn("\n学生手册\n", generated)
        self.assertIn("继续正文。", generated)
        self.assertIn("\ncollection: student_rules\n", generated)

    def test_sync_handbook_docs_uses_student_rules_object_key(self) -> None:
        module = self.module
        fake_doc = module.HandbookDoc(
            slug="mock-handbook",
            title="中央民族大学学生考勤管理办法",
            document_id="handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc",
        )
        source_markdown = "\n".join(
            [
                "---",
                "title: 中央民族大学学生考勤管理办法",
                "collection: student_handbook",
                "---",
                "",
                "## 第一条",
                "正文。",
                "",
            ]
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            docs_root = Path(temp_dir)
            student_rules_key = (
                "regulations/documents/student_rules/"
                "中央民族大学学生考勤管理办法--e53d05ae/source-faithful/2018/canonical.md"
            )
            client = _FakeS3Client({student_rules_key: source_markdown})
            with (
                patch.object(module, "DOCS_ROOT", docs_root),
            ):
                module._sync_handbook_docs(client, handbook_docs=(fake_doc,))

            generated = (docs_root / "student-handbook" / "mock-handbook.md").read_text(
                encoding="utf-8"
            )

        self.assertIn("中央民族大学学生考勤管理办法", generated)
        self.assertIn("\ncollection: student_rules\n", generated)

    def test_clean_handbook_markdown_normalizes_duplicate_title_heading_and_spacing(self) -> None:
        module = self.module

        cleaned = module._clean_handbook_markdown(
            "\n".join(
                [
                    "---",
                    "title: '高等学校校园秩序管理若干规定'",
                    "---",
                    "",
                    "# 高等学校校园秩序管理若干规定",
                    "",
                    "1990年9月18日",
                    "中华人民共和国国家教育委员会令第13号",
                    "",
                    "### 第一条",
                    "为了优化育人环境,制定本规定。",
                    "",
                ]
            )
        )

        self.assertNotIn("\n# 高等学校校园秩序管理若干规定\n", cleaned)
        self.assertIn("\n## 第一条\n\n为了优化育人环境,制定本规定。\n", cleaned)
        self.assertIn("1990年9月18日", cleaned)

    def test_clean_handbook_markdown_adds_blank_lines_around_ordered_lists(self) -> None:
        module = self.module

        cleaned = module._clean_handbook_markdown(
            "\n".join(
                [
                    "---",
                    "title: '中央民族大学本科学生国家奖学金评审办法'",
                    "---",
                    "",
                    "## 第三章 评选条件",
                    "### 第九条",
                    "参评本科学生国家奖学金还须具备以下条件之一:",
                    "1. 第一项",
                    "2. 第二项",
                    "后续说明。",
                    "",
                ]
            )
        )

        self.assertIn(
            "### 第九条\n\n参评本科学生国家奖学金还须具备以下条件之一:\n\n1. 第一项", cleaned
        )
        self.assertIn("1. 第二项\n\n后续说明。", cleaned)

    def test_clean_handbook_markdown_normalizes_broken_list_prefixes(self) -> None:
        module = self.module

        cleaned = module._clean_handbook_markdown(
            "\n".join(
                [
                    "---",
                    "title: '中央民族大学学生公费医疗管理办法'",
                    "---",
                    "",
                    "10. 学生患慢性病不能利用假期在外地治疗,只能在京治疗并需经过校医院转诊、转院。",
                    "11.",
                    "凡住院者必须在出院结算后二周内持出院手续到校医院报销。",
                    "",
                ]
            )
        )

        self.assertIn(
            "\n1. 学生患慢性病不能利用假期在外地治疗,只能在京治疗并需经过校医院转诊、转院。\n",
            cleaned,
        )
        self.assertIn(
            "\n1. 凡住院者必须在出院结算后二周内持出院手续到校医院报销。\n",
            cleaned,
        )

    def test_clean_handbook_markdown_dedupes_repeated_subsection_headings(self) -> None:
        module = self.module

        cleaned = module._clean_handbook_markdown(
            "\n".join(
                [
                    "---",
                    "title: '中央民族大学学生志愿服务管理办法'",
                    "---",
                    "",
                    "## 第一部分 权利",
                    "## (二) 注册志愿服务组织",
                    "内容一。",
                    "## 第二部分 义务",
                    "## (二) 注册志愿服务组织",
                    "内容二。",
                    "",
                ]
            )
        )

        self.assertIn("## (二) 注册志愿服务组织", cleaned)
        self.assertIn("## (二) 注册志愿服务组织（续）", cleaned)

    def test_clean_handbook_markdown_converts_inline_html_tables(self) -> None:
        module = self.module

        cleaned = module._clean_handbook_markdown(
            "\n".join(
                [
                    "---",
                    "title: '中央民族大学本(预)科生基本情况周查月报表'",
                    "---",
                    "",
                    "## 1:《中央民族大学本(预)科生基本情况周查月报表》",
                    "",
                    "[表格]",
                    "<table><tr><td>类型</td><td>原因</td></tr><tr><td>考勤异常学生</td><td>本学期内累计旷课达16节</td></tr></table>",
                    "",
                ]
            )
        )

        self.assertNotIn("<table>", cleaned)
        self.assertIn("|类型|原因|", cleaned)
        self.assertIn("|考勤异常学生|本学期内累计旷课达16节|", cleaned)
        self.assertIn("## 1:《中央民族大学本(预)科生基本情况周查月报表》", cleaned)

    def test_clean_handbook_markdown_escapes_form_placeholder_underscores(self) -> None:
        module = self.module

        cleaned = module._clean_handbook_markdown(
            "\n".join(
                [
                    "---",
                    "title: '中央民族大学公益服务活动证明'",
                    "---",
                    "",
                    "兹证明,中央民族大学 ___ 学院(系)学生 ___ (学号 ___ )于 ___ 年 ___ 月 ___ 日。",
                    "",
                ]
            )
        )

        self.assertIn(r"中央民族大学 \_\_\_ 学院(系)学生 \_\_\_ (学号 \_\_\_ )", cleaned)

    def test_home_page_uses_unified_top_level_doc_paths(self) -> None:
        module = self.module

        home_page = module._build_home_page()

        self.assertIn("link: /student-handbook/", home_page)
        self.assertIn("link: /curriculum-plan/", home_page)
        self.assertNotIn("/regulations/student-handbook/", home_page)
        self.assertNotIn("/curriculum/curriculum-plan/", home_page)

    def test_curriculum_markdown_preserves_split_fields_and_searchable_table_text(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"法学（民族实验班）本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"三、学制、总学分和学位授予","heading_level":2}',
                '{"row_type":"paragraph","clean_text":"学制:4年"}',
                '{"row_type":"paragraph","clean_text":"学分:156 学分"}',
                '{"row_type":"heading","clean_text":"四、各教学环节学时学分","heading_level":2}',
                '{"row_type":"paragraph","clean_text":"学位授予:法学学士"}',
                '{"row_type":"paragraph","clean_text":"将本科修读阶段分为大类培养、专业培养和个性化培养三个阶段。"}',
                '{"row_type":"table","html":"<table><tr><td>课程名称</td><td>学分</td></tr><tr><td>法学论文写作(初阶)</td><td>2</td></tr></table>","clean_text":"<table><tr><td>课程名称</td><td>学分</td></tr><tr><td>法学论文写作(初阶)</td><td>2</td></tr></table>"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="法学（民族实验班）本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("学制:4年\n\n学分:156 学分", markdown)
        self.assertIn("学位授予:法学学士\n\n将本科修读阶段", markdown)
        self.assertNotIn("<table>", markdown)
        self.assertIn("|课程名称|学分|", markdown)
        self.assertIn("法学论文写作(初阶)", markdown)

    def test_curriculum_markdown_keeps_sectioned_table_headers(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"法学（民族实验班）本科人才培养方案","heading_level":1}',
                '{"row_type":"table","html":"<table><tr><td>专业方向</td><td>课程名称</td></tr><tr><td colspan=\\"2\\">模块一:理论法学</td></tr><tr><td>民族班</td><td>法学论文写作(初阶)</td></tr></table>","clean_text":"<table><tr><td>专业方向</td><td>课程名称</td></tr><tr><td colspan=\\"2\\">模块一:理论法学</td></tr><tr><td>民族班</td><td>法学论文写作(初阶)</td></tr></table>"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="法学（民族实验班）本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("### 模块一:理论法学", markdown)
        self.assertIn("|专业方向|课程名称|", markdown)
        self.assertIn("|民族班|法学论文写作(初阶)|", markdown)

    def test_curriculum_markdown_normalizes_multiple_h1_and_heading_jumps(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"中央民族大学通识课程综合素养课建设方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"四、考核和成绩评定方式","heading_level":2}',
                '{"row_type":"heading","clean_text":"中央民族大学大学生社会实践环节实施方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"1.1—4学期大学体育课程","heading_level":4}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="中央民族大学通识课程综合素养课建设方案",
            jsonl_text=jsonl_text,
        )

        self.assertNotIn("\n# 中央民族大学大学生社会实践环节实施方案\n", markdown)
        self.assertIn("\n## 中央民族大学大学生社会实践环节实施方案\n", markdown)
        self.assertIn("\n### 1.1—4学期大学体育课程\n", markdown)

    def test_curriculum_markdown_strips_trailing_heading_punctuation(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"中央民族大学通识课程“大学体育”课程教学计划","heading_level":1}',
                '{"row_type":"heading","clean_text":"2.5—7 学期第二课堂体育活动成绩:","heading_level":4}',
                '{"row_type":"table_caption","clean_text":"模块一:语言学类。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="中央民族大学通识课程“大学体育”课程教学计划",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n## 2.5—7 学期第二课堂体育活动成绩\n", markdown)
        self.assertNotIn("2.5—7 学期第二课堂体育活动成绩:", markdown)
        self.assertIn("\n### 模块一:语言学类\n", markdown)
        self.assertNotIn("### 模块一:语言学类。", markdown)

    def test_curriculum_markdown_treats_table_captions_as_heading_or_plain_text(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"中国少数民族语言文学本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
                '{"row_type":"table_caption","clean_text":"学术型课程群"}',
                '{"row_type":"table_caption","clean_text":"课程清单如下"}',
                '{"row_type":"table_caption","clean_text":"表1 大学英语课程列表"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="中国少数民族语言文学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n### 学术型课程群\n", markdown)
        self.assertIn("\n课程清单如下\n", markdown)
        self.assertIn("\n表1 大学英语课程列表\n", markdown)
        self.assertNotIn("### 课程清单如下", markdown)
        self.assertNotIn("**学术型课程群**", markdown)
        self.assertNotIn("**表1 大学英语课程列表**", markdown)

    def test_curriculum_markdown_dedupes_repeated_heading_labels(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"工商管理类本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"一、培养目标","heading_level":2}',
                '{"row_type":"heading","clean_text":"1. 工商管理","heading_level":4}',
                '{"row_type":"heading","clean_text":"六、课程地图","heading_level":2}',
                '{"row_type":"heading","clean_text":"1. 工商管理","heading_level":3}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="工商管理类本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n### 1. 工商管理\n", markdown)
        self.assertIn("\n### 1. 工商管理（续）\n", markdown)

    def test_curriculum_markdown_ignores_numeric_table_section_noise(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"历史学(强基计划)本科人才培养方案","heading_level":1}',
                '{"row_type":"table","html":"<table><tr><td>学期</td><td>修读学分</td></tr><tr><td colspan=\\"2\\">4</td></tr><tr><td>5</td><td>12</td></tr></table>","clean_text":"<table><tr><td>学期</td><td>修读学分</td></tr><tr><td colspan=\\"2\\">4</td></tr><tr><td>5</td><td>12</td></tr></table>"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="历史学(强基计划)本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertNotIn("\n4\n", markdown)
        self.assertNotIn("\n## 4\n", markdown)
        self.assertIn("|5|12|", markdown)

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

    def test_curriculum_markdown_wraps_long_paragraph_lines_to_lint_safe_width(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"教育学本科人才培养方案","heading_level":1}',
                '{"row_type":"paragraph","clean_text":"秉承立德启智知行合一文化融合国际视野的育人理念立足北京面向全国着眼国际主要培养政治素质过硬人文底蕴深厚国际视野宽广教育学理论基础扎实实践能力突出创新理念先进道德品质高尚具有强烈家国情怀热爱教育事业的教育学研究和应用的复合型人才。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="教育学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        content_lines = [
            line
            for line in markdown.splitlines()
            if line and not line.startswith(("---", "title: ", "## "))
        ]
        self.assertTrue(content_lines)
        self.assertTrue(all(len(line) <= 80 for line in content_lines), content_lines)

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
        self.assertTrue(
            all(len(line) <= 80 for line in markdown.splitlines() if line),
            markdown,
        )

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

        expected = '\n'.join(
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
