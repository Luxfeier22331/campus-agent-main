from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _load_sync_module():
    module_path = (
        Path(__file__).resolve().parents[1]
        / "apps"
        / "public-docs-rspress"
        / "scripts"
        / "sync_real_docs.py"
    )
    spec = importlib.util.spec_from_file_location("public_docs_rspress_sync", module_path)
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


class PublicDocsRspressSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = _load_sync_module()

    def test_sync_handbook_docs_strips_standalone_handbook_noise(self) -> None:
        module = self.module
        fake_doc = module.HandbookDoc(
            slug="mock-handbook",
            title="示例手册条目",
            key="mock-handbook.md",
        )
        source_markdown = "\n".join(
            [
                "---",
                "title: 示例手册条目",
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
            client = _FakeS3Client({fake_doc.key: source_markdown})
            with (
                patch.object(module, "DOCS_ROOT", docs_root),
                patch.object(module, "HANDBOOK_DOCS", (fake_doc,)),
            ):
                module._sync_handbook_docs(client)

            generated = (docs_root / "student-handbook" / f"{fake_doc.slug}.md").read_text(
                encoding="utf-8"
            )

        self.assertNotIn("\n学生手册\n", generated)
        self.assertIn("继续正文。", generated)

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
        self.assertIn("| 课程名称 | 学分 |", markdown)
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

        self.assertIn("**模块一:理论法学**", markdown)
        self.assertIn("| 专业方向 | 课程名称 |", markdown)
        self.assertIn("| 民族班 | 法学论文写作(初阶) |", markdown)

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
            image_src="/course-maps/law-ethnic-experimental-program/map-01.png",
            digest_lines=(
                "本科一年级：法学导论、民法（一）",
                "本科二年级：民法（二）、刑事诉讼法",
            ),
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
            '<CourseMapSection data={lawCourseMapData} imageSrc="/course-maps/law-ethnic-experimental-program/map-01.png" />',
            markdown,
        )
        self.assertIn("### 课程地图文本摘要", markdown)
        self.assertIn("本科一年级：法学导论、民法（一）", markdown)
        self.assertNotIn("## 法学专业本科课程结构拓扑图", markdown)
        self.assertIn("## 七、其他说明", markdown)

    def test_collection_index_pages_do_not_inline_document_titles(self) -> None:
        module = self.module

        handbook_index = module._build_handbook_index()
        curriculum_index = module._build_curriculum_plan_index()

        for doc in module.HANDBOOK_DOCS:
            self.assertNotIn(doc.title, handbook_index)
        for doc in module.CURRICULUM_DOCS:
            self.assertNotIn(doc.title, curriculum_index)


if __name__ == "__main__":
    unittest.main()
