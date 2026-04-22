from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable

import boto3
from campus_ingestion_core.curriculum_chunk_units import _looks_like_curriculum_structure_heading
from campus_ingestion_core.curriculum_course_map_docs_surface import (
    load_curriculum_course_map_docs_review_manifest,
    materialize_reviewed_curriculum_course_map_doc,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env

REPO_ROOT = Path(__file__).resolve().parents[3]
APP_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = APP_ROOT / "docs"
DERIVED_BUCKET = "campus-rag-derived"
HANDBOOK_NOISE_LINES = {"学生手册"}
COURSE_MAP_REVIEW_MANIFEST_PATH = (
    REPO_ROOT
    / "configs"
    / "ingestion"
    / "curriculum"
    / "curriculum_plan"
    / "course-map-docs-review.v1.json"
)
_COURSE_MAP_PRACTICE_KEYWORDS = (
    "实习",
    "论文",
    "课程设计",
    "实践",
    "训练",
    "毕业",
)
_COURSE_MAP_EXTENSION_KEYWORDS = (
    "选修",
    "本硕贯通",
    "跨学科",
    "行业协同",
    "行业领域",
    "全球胜任力",
    "专业选修",
)
_COURSE_MAP_FOUNDATION_KEYWORDS = (
    "思政",
    "英语",
    "体育",
    "高等数学",
    "高等工程数学",
    "线性代数",
    "概率论",
    "物理",
    "物理实验",
    "汉语",
    "中华文化",
    "国家安全",
    "心理健康",
    "信息素养",
    "基本素养",
    "综合素养",
    "公共",
)


@dataclass(frozen=True)
class HandbookDoc:
    slug: str
    title: str
    key: str


@dataclass(frozen=True)
class CurriculumDoc:
    slug: str
    title: str
    key: str


@dataclass(frozen=True)
class _TableCell:
    text: str
    rowspan: int = 1
    colspan: int = 1


@dataclass(frozen=True)
class CourseMapDocEmbed:
    component_import_path: str
    data_import_path: str
    data_import_name: str
    image_src: str
    digest_lines: tuple[str, ...] = ()


HANDBOOK_DOCS: tuple[HandbookDoc, ...] = (
    HandbookDoc(
        slug="student-attendance-management",
        title="中央民族大学学生考勤管理办法",
        key=(
            "regulations/documents/student_handbook/"
            "中央民族大学学生考勤管理办法--e53d05ae/source-faithful/2018/canonical.md"
        ),
    ),
    HandbookDoc(
        slug="national-scholarship-evaluation",
        title="中央民族大学本科学生国家奖学金评审办法",
        key=(
            "regulations/documents/student_handbook/"
            "中央民族大学本科学生国家奖学金评审办法--55f7a1b2/source-faithful/2018/canonical.md"
        ),
    ),
)


CURRICULUM_DOCS: tuple[CurriculumDoc, ...] = (
    CurriculumDoc(
        slug="law-ethnic-experimental-program",
        title="法学（民族实验班）本科人才培养方案",
        key=(
            "curriculum/documents/curriculum_plan/"
            "法学-民族实验班-本科人才培养方案--法学-民族实验班-本科人才培养方案/"
            "source-faithful/2022/document-units.jsonl"
        ),
    ),
    CurriculumDoc(
        slug="computer-science-ethnic-experimental-program",
        title="计算机科学与技术（民族实验班）本科人才培养方案",
        key=(
            "curriculum/documents/curriculum_plan/"
            "计算机科学与技术-民族实验班-本科人才培养方案--"
            "计算机科学与技术-民族实验班-本科人才培养方案/"
            "source-faithful/2022/document-units.jsonl"
        ),
    ),
)


def main() -> None:
    load_worker_env(repo_root=REPO_ROOT)
    client = _create_s3_client()

    _remove_legacy_section_dirs()
    _write_text(
        DOCS_ROOT / "_meta.json",
        json.dumps(
            [
                "index",
                {"type": "dir", "name": "student-handbook", "label": "学生手册"},
                {"type": "dir", "name": "curriculum-plan", "label": "培养方案"},
            ],
            ensure_ascii=False,
        ),
    )
    _write_text(DOCS_ROOT / "index.md", _build_home_page())
    _sync_handbook_docs(client)
    _sync_curriculum_docs(client)


def _create_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["OBJECT_STORE_ENDPOINT"],
        aws_access_key_id=os.environ["OBJECT_STORE_ACCESS_KEY"],
        aws_secret_access_key=os.environ["OBJECT_STORE_SECRET_KEY"],
    )


def _sync_handbook_docs(client) -> None:
    target_dir = DOCS_ROOT / "student-handbook"
    target_dir.mkdir(parents=True, exist_ok=True)

    _write_text(
        target_dir / "_meta.json",
        json.dumps(["index", *[doc.slug for doc in HANDBOOK_DOCS]], ensure_ascii=False),
    )
    _write_text(target_dir / "index.md", _build_handbook_index())

    for doc in HANDBOOK_DOCS:
        markdown = _clean_handbook_markdown(_read_text_object(client=client, key=doc.key))
        _write_text(target_dir / f"{doc.slug}.md", markdown)
    _remove_stale_generated_files(
        target_dir,
        expected_names={"_meta.json", "index.md", *[f"{doc.slug}.md" for doc in HANDBOOK_DOCS]},
    )


def _sync_curriculum_docs(client) -> None:
    target_dir = DOCS_ROOT / "curriculum-plan"
    target_dir.mkdir(parents=True, exist_ok=True)
    course_map_embeds = _sync_curriculum_course_map_artifacts(client)

    _write_text(
        target_dir / "_meta.json",
        json.dumps(["index", *[doc.slug for doc in CURRICULUM_DOCS]], ensure_ascii=False),
    )
    _write_text(target_dir / "index.md", _build_curriculum_plan_index())

    for doc in CURRICULUM_DOCS:
        markdown = _build_curriculum_markdown(
            slug=doc.slug,
            title=doc.title,
            jsonl_text=_read_text_object(client=client, key=doc.key),
            course_map_embed=course_map_embeds.get(doc.slug),
        )
        _write_text(target_dir / f"{doc.slug}.mdx", markdown)
    _remove_stale_generated_files(
        target_dir,
        expected_names={"_meta.json", "index.md", *[f"{doc.slug}.mdx" for doc in CURRICULUM_DOCS]},
    )


def _remove_stale_generated_files(target_dir: Path, *, expected_names: set[str]) -> None:
    for path in target_dir.iterdir():
        if path.is_file() and path.name not in expected_names:
            path.unlink()


def _remove_legacy_section_dirs() -> None:
    for legacy_dir in (DOCS_ROOT / "regulations", DOCS_ROOT / "curriculum"):
        if legacy_dir.exists():
            shutil.rmtree(legacy_dir)


def _read_text_object(*, client, key: str) -> str:
    return client.get_object(Bucket=DERIVED_BUCKET, Key=key)["Body"].read().decode("utf-8")


def _build_home_page() -> str:
    return """---
pageType: home

hero:
  name: Campus Agent 文档站
  text: Rspress 本地评估版
  tagline: 当前页面直接接入本机 object storage 中的真实公开文档产物，用于评估层级导航、阅读体验、中文搜索与信息架构。
  actions:
    - theme: brand
      text: 浏览学生手册
      link: /student-handbook/
    - theme: alt
      text: 浏览培养方案
      link: /curriculum-plan/
features:
  - title: 真实公开文档
    details: 当前接入内容来自本地 MinIO 的真实公开文档产物，不再使用手写测试样文。
    icon: 📚
  - title: 学生手册
    details: 展示制度类正文阅读、分章定位与长文搜索效果。
    icon: 📘
    link: /student-handbook/
  - title: 培养方案
    details: 展示专业培养方案在长段落、目录层级和表格段落下的阅读效果。
    icon: 🧭
    link: /curriculum-plan/
---
"""


def _build_handbook_index() -> str:
    return "\n".join(
        [
            "---",
            "title: 学生手册",
            "description: 来自本机 object storage 的真实 student_handbook 文档。",
            "---",
            "",
            "当前目录直接接入本机 `campus-rag-derived` 中的真实 `canonical.md`。",
            "",
            "当前文档站与培养方案共享同一套左侧导航；你可以直接在侧边栏切换到培养方案。",
            "",
        ]
    )


def _build_curriculum_plan_index() -> str:
    return "\n".join(
        [
            "---",
            "title: 培养方案目录",
            "description: 来自本机 object storage 的真实 curriculum_plan 文档。",
            "---",
            "",
            "当前目录直接由本机 `campus-rag-derived` 中的真实 `document-units.jsonl` 重组生成。",
            "",
            "当前文档站与学生手册共享同一套左侧导航；你可以直接在侧边栏切换到学生手册。",
            "",
        ]
    )


def _sync_curriculum_course_map_artifacts(client) -> dict[str, CourseMapDocEmbed]:
    class _S3ByteReader:
        def __init__(self, s3_client) -> None:
            self._client = s3_client

        def get_bytes(self, *, bucket: str, key: str) -> bytes:
            return self._client.get_object(Bucket=bucket, Key=key)["Body"].read()

    entries_by_slug = {
        entry.slug: entry
        for entry in load_curriculum_course_map_docs_review_manifest(
            COURSE_MAP_REVIEW_MANIFEST_PATH
        )
    }
    generated_dir = DOCS_ROOT / ".generated" / "course-maps"
    public_root = DOCS_ROOT / "public" / "course-maps"
    generated_dir.mkdir(parents=True, exist_ok=True)
    public_root.mkdir(parents=True, exist_ok=True)

    embeds: dict[str, CourseMapDocEmbed] = {}
    expected_data_files: set[str] = set()
    expected_public_dirs: set[str] = set()
    byte_reader = _S3ByteReader(client)

    for doc in CURRICULUM_DOCS:
        entry = entries_by_slug.get(doc.slug)
        if entry is None:
            continue
        artifact = materialize_reviewed_curriculum_course_map_doc(
            entry=entry,
            byte_reader=byte_reader,
        )
        data_module_name = f"{doc.slug}.data.ts"
        image_dir = public_root / doc.slug
        image_dir.mkdir(parents=True, exist_ok=True)
        (image_dir / "map-01.png").write_bytes(artifact.image_bytes)
        data_payload = _build_course_map_data_payload(artifact.data_payload)
        _write_text(
            generated_dir / data_module_name,
            _build_course_map_data_module(data_payload),
        )
        expected_data_files.add(data_module_name)
        expected_public_dirs.add(doc.slug)
        embeds[doc.slug] = CourseMapDocEmbed(
            component_import_path="../.components/CourseMapSection",
            data_import_path=f"../.generated/course-maps/{doc.slug}.data",
            data_import_name=_build_course_map_data_import_name(doc.slug),
            image_src=f"/course-maps/{doc.slug}/map-01.png",
            digest_lines=artifact.digest_lines,
        )

    _remove_stale_generated_files(
        generated_dir,
        expected_names=expected_data_files,
    )
    for path in public_root.iterdir():
        if path.is_dir() and path.name not in expected_public_dirs:
            shutil.rmtree(path)
    return embeds


def _build_curriculum_markdown(
    *,
    title: str,
    jsonl_text: str,
    slug: str | None = None,
    course_map_embed: CourseMapDocEmbed | None = None,
) -> str:
    del slug
    lines: list[str] = ["---", f"title: {_json_string(title)}", "---", ""]
    if course_map_embed is not None:
        lines.extend(
            [
                f'import CourseMapSection from "{course_map_embed.component_import_path}";',
                (
                    f"import {course_map_embed.data_import_name} "
                    f'from "{course_map_embed.data_import_path}";'
                ),
                "",
            ]
        )
    blocks: list[tuple[str, str]] = []
    in_course_map_section = False

    for row in _iter_rows(jsonl_text):
        row_type = str(row.get("row_type") or "")
        text = _normalize_text(row.get("clean_text"))

        if row_type == "page_number":
            continue
        if course_map_embed is not None and in_course_map_section:
            if row_type == "heading" and _is_curriculum_structural_heading_row(text=text, row=row):
                in_course_map_section = False
            else:
                continue
        if row_type == "heading":
            if course_map_embed is not None and text == "六、课程地图":
                blocks.append(("block", "## 六、课程地图"))
                blocks.append(("block", _build_course_map_section_block(course_map_embed)))
                in_course_map_section = True
                continue
            if text == title and not blocks:
                continue
            level = max(1, min(6, int(row.get("heading_level") or 2)))
            blocks.append(("block", f"{'#' * level} {text}"))
            continue
        if row_type == "table_caption" and text:
            blocks.append(("block", f"**{text}**"))
            continue
        if row_type == "table":
            html = _normalize_text(row.get("html")) or text
            if html:
                blocks.extend(
                    ("block", block) for block in _convert_table_html_to_markdown_blocks(html)
                )
            continue
        if row_type != "paragraph" or not text:
            continue
        if blocks and blocks[-1][0] == "paragraph" and _should_merge_paragraph(blocks[-1][1], text):
            previous = blocks[-1][1]
            blocks[-1] = ("paragraph", previous + text)
        else:
            blocks.append(("paragraph", text))

    for _, block_text in blocks:
        lines.append(block_text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _build_course_map_section_block(course_map_embed: CourseMapDocEmbed) -> str:
    lines = [
        (
            f"<CourseMapSection data={{{course_map_embed.data_import_name}}} "
            f'imageSrc="{course_map_embed.image_src}" />'
        )
    ]
    if course_map_embed.digest_lines:
        lines.extend(["", "### 课程地图文本摘要", ""])
        lines.extend(f"- {line}" for line in course_map_embed.digest_lines)
    return "\n".join(lines)


def _build_course_map_data_import_name(slug: str) -> str:
    parts = [part for part in re.split(r"[^a-zA-Z0-9]+", slug) if part]
    if not parts:
        return "courseMapData"
    head, *tail = parts
    return head + "".join(part[:1].upper() + part[1:] for part in tail) + "Data"


def _build_course_map_data_module(payload: dict[str, object]) -> str:
    return "\n".join(
        [
            "const data = " + json.dumps(payload, ensure_ascii=False, indent=2) + " as const;",
            "",
            "export default data;",
            "",
        ]
    )


def _build_course_map_data_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized = dict(payload)
    edges = [
        dict(item)
        for item in list(normalized.get("edges") or [])
        if isinstance(item, dict)
    ]
    incoming_counts: dict[str, int] = {}
    outgoing_counts: dict[str, int] = {}
    for edge in edges:
        source_label = str(edge.get("source_label") or "").strip()
        target_label = str(edge.get("target_label") or "").strip()
        if source_label:
            outgoing_counts[source_label] = outgoing_counts.get(source_label, 0) + 1
        if target_label:
            incoming_counts[target_label] = incoming_counts.get(target_label, 0) + 1

    normalized["nodes"] = [
        {
            **item,
            "route_group": _infer_course_map_route_group(str(item.get("node_label") or "")),
            "incoming_count": incoming_counts.get(str(item.get("node_label") or "").strip(), 0),
            "outgoing_count": outgoing_counts.get(str(item.get("node_label") or "").strip(), 0),
        }
        for item in list(normalized.get("nodes") or [])
        if isinstance(item, dict)
    ]
    normalized["edges"] = edges
    return normalized


def _infer_course_map_route_group(node_label: str) -> str:
    normalized = node_label.strip()
    if any(keyword in normalized for keyword in _COURSE_MAP_PRACTICE_KEYWORDS):
        return "practice"
    if any(keyword in normalized for keyword in _COURSE_MAP_EXTENSION_KEYWORDS):
        return "extension"
    if any(keyword in normalized for keyword in _COURSE_MAP_FOUNDATION_KEYWORDS):
        return "foundation"
    return "core"


def _is_curriculum_structural_heading_row(*, text: str, row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    section_hint = _normalize_text(row.get("section_hint"))
    if section_hint:
        return True
    return _looks_like_curriculum_structure_heading(text)


def _iter_rows(jsonl_text: str) -> Iterable[dict[str, object]]:
    for line in jsonl_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        yield json.loads(stripped)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _should_merge_paragraph(previous: str, current: str) -> bool:
    if not previous:
        return False
    if previous.endswith(("。", "！", "？", "；", "：", ".", "!", "?", ";", ":")):
        return False
    if _looks_like_compact_metadata_line(previous):
        return False
    return True


def _looks_like_compact_metadata_line(text: str) -> bool:
    normalized = text.strip()
    return bool(re.fullmatch(r"[^。；！？!?]{1,24}[：:][^，,。；！？!?]{1,16}", normalized))


def _clean_handbook_markdown(markdown: str) -> str:
    lines = markdown.splitlines()
    if not lines:
        return markdown

    frontmatter_end = -1
    if lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                frontmatter_end = index
                break

    prefix = lines[: frontmatter_end + 1] if frontmatter_end != -1 else []
    body = lines[frontmatter_end + 1 :] if frontmatter_end != -1 else lines

    cleaned_body: list[str] = []
    previous_blank = False
    for line in body:
        stripped = line.strip()
        if stripped in HANDBOOK_NOISE_LINES:
            continue
        if not stripped:
            if previous_blank:
                continue
            previous_blank = True
            cleaned_body.append("")
            continue
        previous_blank = False
        cleaned_body.append(line.rstrip())

    combined = prefix + cleaned_body if prefix else cleaned_body
    return "\n".join(combined).rstrip() + "\n"


class _TableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[_TableCell]] = []
        self._current_row: list[_TableCell] | None = None
        self._cell_parts: list[str] = []
        self._cell_rowspan = 1
        self._cell_colspan = 1
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._current_row = []
            return
        if tag not in {"td", "th"}:
            if self._in_cell and tag == "br":
                self._cell_parts.append("\n")
            return
        attr_map = {key: value for key, value in attrs}
        self._cell_parts = []
        self._cell_rowspan = _parse_positive_int(attr_map.get("rowspan"))
        self._cell_colspan = _parse_positive_int(attr_map.get("colspan"))
        self._in_cell = True

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._in_cell:
            text = _normalize_table_cell_text("".join(self._cell_parts))
            if self._current_row is not None:
                self._current_row.append(
                    _TableCell(
                        text=text,
                        rowspan=self._cell_rowspan,
                        colspan=self._cell_colspan,
                    )
                )
            self._in_cell = False
            return
        if tag == "tr" and self._current_row is not None:
            if self._current_row:
                self.rows.append(self._current_row)
            self._current_row = None

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_parts.append(data)


def _parse_positive_int(value: str | None) -> int:
    try:
        parsed = int(value or "1")
    except ValueError:
        return 1
    return parsed if parsed > 0 else 1


def _normalize_table_cell_text(text: str) -> str:
    normalized = text.replace("\xa0", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _convert_table_html_to_markdown_blocks(html: str) -> list[str]:
    parser = _TableHTMLParser()
    parser.feed(html)
    parser.close()
    grid = _expand_table_rows(parser.rows)
    if not grid:
        return []

    blocks: list[str] = []
    header_row: list[str] | None = None
    current_table: list[list[str]] = []
    for row in grid:
        trimmed_row = _trim_trailing_empty_cells(row)
        if not any(trimmed_row):
            continue
        if _is_section_row(trimmed_row):
            if current_table and not (
                header_row is not None
                and len(current_table) == 1
                and current_table[0] == header_row
            ):
                blocks.append(_render_markdown_table(current_table))
            current_table = [list(header_row)] if header_row is not None else []
            blocks.append(f"**{_escape_markdown_cell(trimmed_row[0])}**")
            continue
        if header_row is None:
            header_row = list(trimmed_row)
            current_table = [list(header_row)]
            continue
        if not current_table:
            current_table = [list(header_row)]
        current_table.append(trimmed_row)
    if current_table and not (
        header_row is not None and len(current_table) == 1 and current_table[0] == header_row
    ):
        blocks.append(_render_markdown_table(current_table))
    return blocks


def _expand_table_rows(rows: list[list[_TableCell]]) -> list[list[str]]:
    active_rowspans: dict[int, tuple[str, int]] = {}
    expanded_rows: list[list[str]] = []
    max_width = 0

    for source_row in rows:
        expanded_row: list[str] = []
        column_index = 0

        def consume_active_rowspans() -> None:
            nonlocal column_index
            while column_index in active_rowspans:
                text, remaining = active_rowspans[column_index]
                expanded_row.append(text)
                if remaining <= 1:
                    del active_rowspans[column_index]
                else:
                    active_rowspans[column_index] = (text, remaining - 1)
                column_index += 1

        consume_active_rowspans()
        for cell in source_row:
            consume_active_rowspans()
            for offset in range(cell.colspan):
                expanded_row.append(cell.text)
                if cell.rowspan > 1:
                    active_rowspans[column_index + offset] = (cell.text, cell.rowspan - 1)
            column_index += cell.colspan
        consume_active_rowspans()
        max_width = max(max_width, len(expanded_row))
        expanded_rows.append(expanded_row)

    for row in expanded_rows:
        row.extend([""] * (max_width - len(row)))
    return expanded_rows


def _trim_trailing_empty_cells(row: list[str]) -> list[str]:
    trimmed = list(row)
    while trimmed and not trimmed[-1]:
        trimmed.pop()
    return trimmed


def _is_section_row(row: list[str]) -> bool:
    nonempty = [cell for cell in row if cell]
    return bool(nonempty) and len(set(nonempty)) == 1


def _render_markdown_table(rows: list[list[str]]) -> str:
    width = max(len(row) for row in rows)
    normalized_rows = [row + [""] * (width - len(row)) for row in rows]
    if len(normalized_rows) == 1:
        return " | ".join(_escape_markdown_cell(cell) for cell in normalized_rows[0] if cell)

    header = normalized_rows[0]
    separator = ["---"] * width
    lines = [
        _render_markdown_row(header),
        _render_markdown_row(separator),
    ]
    lines.extend(_render_markdown_row(row) for row in normalized_rows[1:])
    return "\n".join(lines)


def _render_markdown_row(row: list[str]) -> str:
    return "| " + " | ".join(_escape_markdown_cell(cell) or " " for cell in row) + " |"


def _escape_markdown_cell(text: str) -> str:
    return text.replace("\\", "\\\\").replace("|", "\\|")


def _json_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
