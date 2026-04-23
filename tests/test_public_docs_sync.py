from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

from tests.public_docs_sync_course_map_suite import *  # noqa: F403
from tests.public_docs_sync_handbook_suite import *  # noqa: F403


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

    def test_clean_handbook_markdown_keeps_repeated_subsection_heading_text(self) -> None:
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

        self.assertEqual(cleaned.count("## (二) 注册志愿服务组织"), 2)
        self.assertNotIn("## (二) 注册志愿服务组织（续）", cleaned)

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

    def test_curriculum_markdown_merges_table_continuations_before_rendering(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"体育教育本科人才培养方案","heading_level":1}',
                (
                    '{"row_id":"table-1","row_type":"table",'
                    '"continuation_group_id":"table-1",'
                    '"html":"<table><tr><td>培养阶段</td><td>类别</td><td>学分</td></tr>'
                    '<tr><td>大类培养</td><td>通识教育</td><td>44</td></tr></table>",'
                    '"clean_text":"<table><tr><td>培养阶段</td><td>类别</td><td>学分</td></tr>'
                    '<tr><td>大类培养</td><td>通识教育</td><td>44</td></tr></table>"}'
                ),
                (
                    '{"row_id":"table-2","row_type":"table",'
                    '"relation_type":"table_continuation",'
                    '"owner_row_id":"table-1",'
                    '"continuation_group_id":"table-1",'
                    '"html":"<table><tr><td>实践环节</td><td>社会实践</td><td>2</td></tr>'
                    '<tr><td colspan=\\"2\\">总学分</td><td>152</td></tr></table>",'
                    '"clean_text":"<table><tr><td>实践环节</td><td>社会实践</td><td>2</td></tr>'
                    '<tr><td colspan=\\"2\\">总学分</td><td>152</td></tr></table>"}'
                ),
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="体育教育本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("|培养阶段|类别|学分|", markdown)
        self.assertIn("|大类培养|通识教育|44|", markdown)
        self.assertIn("|实践环节|社会实践|2|", markdown)
        self.assertEqual(markdown.count("|---|---|---|"), 1)
        self.assertNotIn("|实践环节|社会实践|2|\n|---|---|---|", markdown)

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

    def test_curriculum_markdown_compacts_global_competence_colspan_row(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"日语本科人才培养方案","heading_level":1}',
                (
                    '{"row_type":"table","html":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>'
                    '<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>'
                    '<tr><td>全球胜任力课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程</td>'
                    '<td>建议出国深造学生选修</td></tr></table>",'
                    '"clean_text":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>'
                    '<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>'
                    '<tr><td>全球胜任力课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程</td>'
                    '<td>建议出国深造学生选修</td></tr></table>"}'
                ),
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="日语本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("- 课程类：全球胜任力课程", markdown)
        self.assertIn("  - 课程名称：学校通开的全球胜任力培养课程", markdown)
        self.assertIn("  - 备注：建议出国深造学生选修", markdown)
        self.assertEqual(markdown.count("学校通开的全球胜任力培养课程"), 1)
        self.assertNotIn("  - 课程号：学校通开的全球胜任力培养课程", markdown)
        self.assertNotIn("  - 学分：学校通开的全球胜任力培养课程", markdown)

    def test_curriculum_markdown_strips_placeholder_trailing_slash_in_colspan_row(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"俄语-俄语-中亚语-本科人才培养方案","heading_level":1}',
                (
                    '{"row_type":"table","html":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>'
                    '<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>'
                    '<tr><td>全球胜任力培养课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程/</td>'
                    '<td>建议出国深造学生选修</td></tr></table>",'
                    '"clean_text":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>'
                    '<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>'
                    '<tr><td>全球胜任力培养课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程/</td>'
                    '<td>建议出国深造学生选修</td></tr></table>"}'
                ),
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="俄语-俄语-中亚语-本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("  - 课程名称：学校通开的全球胜任力培养课程", markdown)
        self.assertNotIn("学校通开的全球胜任力培养课程/", markdown)

    def test_curriculum_markdown_compacts_global_competence_colspan_row_without_remark(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"金融学本科人才培养方案","heading_level":1}',
                (
                    '{"row_type":"table","html":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>'
                    '<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>'
                    '<tr><td>全球胜任力培养课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程</td>'
                    '<td></td></tr></table>",'
                    '"clean_text":"<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>'
                    '<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>'
                    '<tr><td>全球胜任力培养课程</td><td colspan=\\"6\\">学校通开的全球胜任力培养课程</td>'
                    '<td></td></tr></table>"}'
                ),
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="金融学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("- 课程类：全球胜任力培养课程", markdown)
        self.assertIn("  - 课程名称：学校通开的全球胜任力培养课程", markdown)
        self.assertNotIn("  - 课程号：学校通开的全球胜任力培养课程", markdown)
        self.assertNotIn("  - 备注：", markdown)

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

    def test_curriculum_markdown_nests_numbered_heading_under_current_parent(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"生物科学类本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"二、毕业要求","heading_level":2}',
                '{"row_type":"heading","clean_text":"(二)知识要求","heading_level":3}',
                '{"row_type":"heading","clean_text":"1. 基础理论和基本方法","heading_level":4}',
                '{"row_type":"paragraph","clean_text":"掌握基础理论。"}',
                '{"row_type":"heading","clean_text":"2. 核心知识","heading_level":2}',
                '{"row_type":"paragraph","clean_text":"掌握核心知识。"}',
                '{"row_type":"heading","clean_text":"3. 研究方法","heading_level":2}',
                '{"row_type":"heading","clean_text":"4. 跨学科知识","heading_level":2}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="生物科学类本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n### (二)知识要求\n", markdown)
        self.assertIn("\n#### 1. 基础理论和基本方法\n", markdown)
        self.assertIn("\n#### 2. 核心知识\n", markdown)
        self.assertIn("\n#### 3. 研究方法\n", markdown)
        self.assertIn("\n#### 4. 跨学科知识\n", markdown)
        self.assertNotIn("\n## 4. 跨学科知识\n", markdown)
        self.assertNotIn("\n##### 2. 核心知识\n", markdown)
        self.assertNotIn("\n###### 4. 跨学科知识\n", markdown)

    def test_curriculum_markdown_keeps_parenthesized_heading_siblings_level(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"音乐与舞蹈学类（舞蹈类专业）本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"二、毕业要求","heading_level":2}',
                '{"row_type":"heading","clean_text":"(一)舞蹈表演","heading_level":3}',
                '{"row_type":"paragraph","clean_text":"舞蹈表演毕业要求。"}',
                '{"row_type":"heading","clean_text":"(二)舞蹈表演(民族英才班)","heading_level":2}',
                '{"row_type":"paragraph","clean_text":"民族英才班毕业要求。"}',
                '{"row_type":"heading","clean_text":"(三)舞蹈学","heading_level":3}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="音乐与舞蹈学类（舞蹈类专业）本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n### (一)舞蹈表演\n", markdown)
        self.assertIn("\n### (二)舞蹈表演(民族英才班)\n", markdown)
        self.assertIn("\n### (三)舞蹈学\n", markdown)
        self.assertNotIn("\n## (二)舞蹈表演(民族英才班)\n", markdown)

    def test_curriculum_markdown_keeps_module_caption_siblings_level(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"财政学本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"五、课程设置和修读建议","heading_level":2}',
                '{"row_type":"heading","clean_text":"(一)大类培养","heading_level":3}',
                '{"row_type":"heading","clean_text":"2. 学科基础教育","heading_level":4}',
                '{"row_type":"heading","clean_text":"(二)专业教育","heading_level":3}',
                '{"row_type":"heading","clean_text":"2. 专业选修课程","heading_level":4}',
                '{"row_type":"table_caption","clean_text":"模块一:财政类"}',
                '{"row_type":"table","html":"<table><tr><td>课程号</td><td>课程名称</td></tr><tr><td>1</td><td>国家治理财政学专题</td></tr></table>","clean_text":"<table><tr><td>课程号</td><td>课程名称</td></tr><tr><td>1</td><td>国家治理财政学专题</td></tr></table>"}',
                '{"row_type":"table_caption","clean_text":"模块二:税收类"}',
                '{"row_type":"table_caption","clean_text":"模块三:工具类"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="财政学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n### (二)专业教育\n", markdown)
        self.assertIn("\n#### 2. 专业选修课程\n", markdown)
        self.assertIn("\n##### 模块一:财政类\n", markdown)
        self.assertIn("\n##### 模块二:税收类\n", markdown)
        self.assertIn("\n##### 模块三:工具类\n", markdown)
        self.assertNotIn("\n##### (二)专业教育\n", markdown)
        self.assertNotIn("\n###### 2. 专业选修课程\n", markdown)
        self.assertNotIn("\n###### 模块二:税收类\n", markdown)

    def test_curriculum_markdown_demotes_course_requirement_sentence_heading(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"音乐与舞蹈学类（舞蹈类专业）本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"(二)专业教育","heading_level":3}',
                '{"row_type":"heading","clean_text":"1. 专业核心课程","heading_level":4}',
                '{"row_type":"heading","clean_text":"(4)舞蹈编导专业必修的专业核心课程54学分","heading_level":4}',
                '{"row_type":"table","html":"<table><tr><td>专业名称</td><td>课程名称</td></tr><tr><td>舞蹈编导</td><td>编舞技法</td></tr></table>","clean_text":"<table><tr><td>专业名称</td><td>课程名称</td></tr><tr><td>舞蹈编导</td><td>编舞技法</td></tr></table>"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="音乐与舞蹈学类（舞蹈类专业）本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("(4)舞蹈编导专业必修的专业核心课程54学分", markdown)
        self.assertNotIn("#### (4)舞蹈编导专业必修的专业核心课程54学分", markdown)

    def test_curriculum_markdown_preserves_ordered_list_lines_from_units(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"财政学本科人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"(三)能力要求","heading_level":3}',
                '{"row_type":"paragraph","clean_text":"1. 业务能力:胜任财税管理。\\n2.科研能力:分析财税问题。\\n3. 创新能力:开展科研训练。"}',
                '{"row_type":"paragraph","clean_text":"2.3 掌握文献检索。\\n2.4 提出有效解决方法。"}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="财政学本科人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n1. 业务能力:胜任财税管理。\n", markdown)
        self.assertIn("\n2. 科研能力:分析财税问题。\n", markdown)
        self.assertIn("\n3. 创新能力:开展科研训练。\n", markdown)
        self.assertIn("\n2\\.3 掌握文献检索。\n", markdown)
        self.assertIn("\n2\\.4 提出有效解决方法。\n", markdown)
        self.assertNotIn("。2.", markdown)

    def test_curriculum_markdown_demotes_version_note_heading(self) -> None:
        module = self.module
        jsonl_text = "\n".join(
            [
                '{"row_type":"heading","clean_text":"文物与博物馆学本科第二学士学位人才培养方案","heading_level":1}',
                '{"row_type":"heading","clean_text":"(2020版)","heading_level":1}',
                '{"row_type":"heading","clean_text":"一、培养目标","heading_level":2}',
            ]
        )

        markdown = module._build_curriculum_markdown(
            title="文物与博物馆学本科第二学士学位人才培养方案",
            jsonl_text=jsonl_text,
        )

        self.assertIn("\n(2020版)\n", markdown)
        self.assertIn("\n## 一、培养目标\n", markdown)
        self.assertNotIn("\n## (2020版)\n", markdown)

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

    def test_curriculum_markdown_keeps_repeated_heading_labels_visible_text(self) -> None:
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

        self.assertEqual(markdown.count("\n### 1. 工商管理\n"), 2)
        self.assertNotIn("1. 工商管理（续）", markdown)

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

if __name__ == "__main__":
    unittest.main()
