from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
APP_ROOT = Path(__file__).resolve().parents[2]
DOCS_ROOT = APP_ROOT / "docs"
HANDBOOK_SPLIT_MANIFEST_PATH = (
    REPO_ROOT / "configs" / "ingestion" / "regulations" / "student_rules" / "split-manifest.v1.json"
)
DERIVED_BUCKET = "campus-rag-derived"
HANDBOOK_NOISE_LINES = {"学生手册"}
HANDBOOK_CORPUS = "regulations"
HANDBOOK_COLLECTION = "student_rules"
HANDBOOK_REVISION_TRACK = "source-faithful"
HANDBOOK_YEAR = "2018"
HANDBOOK_FILENAME = "canonical.md"
_COURSE_MAP_PRACTICE_KEYWORDS = ("实习", "论文", "课程设计", "实践", "训练", "毕业")
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
_MARKDOWN_ORDERED_LIST_RE = re.compile(r"^\d+\.\s+")
_MARKDOWN_UNORDERED_LIST_RE = re.compile(r"^[-*+]\s+")
_MARKDOWN_DECIMAL_LABEL_RE = re.compile(
    r"^(?P<label>\d+\.\d+(?:\.\d+)*)(?P<rest>(?:\s+|$).*)$"
)
_MARKDOWN_LIST_PREFIX_WITH_BREAK_RE = re.compile(r"(?m)^((?:\d+(?:\.\d+)*\.?)|[-*+])\s*\n+\s*")
_MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE = re.compile(r"(?m)^(?P<marker>\d+\.(?!\d))(?P<rest>\S)")
_HANDBOOK_CHAPTER_HEADING_RE = re.compile(r"^第[0-9一二三四五六七八九十百千零〇]+章(?:\s+.+)?$")
_HANDBOOK_ARTICLE_HEADING_RE = re.compile(r"^第[0-9一二三四五六七八九十百千零〇]+条(?:\s+.+)?$")
_MARKDOWN_LINE_LIMIT = 80


@dataclass(frozen=True)
class HandbookDoc:
    slug: str
    title: str
    document_id: str


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


HANDBOOK_DOC_SLUG_OVERRIDES: dict[str, str] = {
    "handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc": "student-attendance-management",
    "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15": "national-scholarship-evaluation",
}

CURRICULUM_DOC_SLUG_OVERRIDES: dict[str, str] = {
    "curriculum:法学（民族实验班）本科人才培养方案": "law-ethnic-experimental-program",
    "curriculum:计算机科学与技术（民族实验班）本科人才培养方案": (
        "computer-science-ethnic-experimental-program"
    ),
}


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _remove_stale_generated_files(target_dir: Path, *, expected_names: set[str]) -> None:
    for path in target_dir.iterdir():
        if path.is_file() and path.name not in expected_names:
            path.unlink()


def _remove_legacy_section_dirs(docs_root: Path) -> None:
    for legacy_dir in (docs_root / "regulations", docs_root / "curriculum"):
        if legacy_dir.exists():
            shutil.rmtree(legacy_dir)


def _wrap_markdown_plain_text(text: str) -> str:
    return "\n".join(_wrap_markdown_text_lines(text))


def _wrap_markdown_text_lines(
    text: str,
    *,
    initial_prefix: str = "",
    subsequent_prefix: str = "",
) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return [""]
    return [
        f"{initial_prefix if index == 0 else subsequent_prefix}{line.strip()}"
        for index, line in enumerate(stripped.splitlines())
        if line.strip()
    ]


def _json_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _format_json_content(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent="\t") + "\n"


def _format_js_object_literal(value: object) -> str:
    json_text = json.dumps(value, ensure_ascii=False, indent="\t")
    return re.sub(
        r'(?m)^(\t*)"([A-Za-z_][A-Za-z0-9_]*)":',
        r"\1\2:",
        json_text,
    )


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
