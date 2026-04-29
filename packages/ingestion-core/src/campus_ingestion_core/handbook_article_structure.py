from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

TOP_LEVEL_CLAUSE_RE = re.compile(
    r"^(?:[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十百千万〇零两]+、)"
)
NUMERIC_SUBCLAUSE_RE = re.compile(r"^[0-9]+[.、]")
INLINE_LIST_MARKER_RE = re.compile(
    r"^(?P<label>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]|[一二三四五六七八九十百千万〇零两]+、))\s*(?P<body>.+)$"
)
HEADING_TEXT_RE = re.compile(r"^[\u4e00-\u9fff0-9、与及和\-\(\)（）.．%％]{1,32}$")
HEADING_SUFFIXES = (
    "公示",
    "复审",
    "初审",
    "审核",
    "推荐",
    "初选",
    "评选",
    "方式",
    "手续",
    "认定",
    "程序",
    "申请",
    "考核",
)
TITLE_HEADING_SUFFIXES = (
    *HEADING_SUFFIXES,
    "计划",
    "通知",
    "奖励",
    "标准",
    "条件",
    "要求",
    "职责",
)
HEADING_FORBIDDEN_FRAGMENTS = (
    "为进一步",
    "进一步",
    "是指",
    "为了",
    "依据",
    "在",
    "由",
    "按",
    "根据",
    "按照",
    "可以",
    "必须",
    "应当",
    "不得",
    "负责",
    "组织",
    "进行",
    "提交",
    "完成",
    "办理",
    "取得",
    "录入",
    "审核",
    "确定",
    "通知",
)
PLAIN_HEADING_ALLOWLIST = {
    "毕业、结业与肄业",
}
INLINE_HEADING_ALLOWLIST = {
    "候选人公示",
    "学生申请",
    "院系审核,提交材料",
    "公布参加转专业考试学生名单及考试具体安排",
    "报名审核",
    "公示",
    "办理出国(境)手续",
    "选拔考核方式",
    "笔试考核",
    "面试考核",
    "确定入围名单方式",
    "考核方式",
    "拟接收名单的确定",
    "手续办理",
    "课程认定",
    "学分认定",
    "成绩认定",
    "认定程序",
}
INLINE_HEADING_BODY_STARTERS = (
    "中央民族大学",
    "党委学生工作部、学生处",
    "国家民族事务委员会",
    "本科学生",
    "学生需要",
    "学生工作部",
    "学校将",
    "学校",
    "学院(系)",
    "各院系",
    "教务处",
    "国际合作处",
    "院系",
    "公示无异议后",
    "入围名单确定后",
    "有多个项目同时进行选拔时",
    "教务处综合申请者",
    "考核形式",
    "按照分数优先原则",
    "语言类专家",
    "项目管理人员",
    "参与",
)
NOTE_MARKERS = ("备注:", "注:")


@dataclass(frozen=True, slots=True)
class ArticleStructureGroup:
    prefix_lines: tuple[str, ...]
    blocks: tuple[tuple[str, ...], ...]


def normalize_article_body_structure(text: str) -> str:
    normalized_lines: list[str] = []
    for raw_line in text.splitlines():
        normalized = _normalize_fragment(raw_line)
        if not normalized:
            continue
        normalized_lines.extend(_normalize_article_structure_line(normalized))
    return "\n".join(normalized_lines)


def build_article_structure_groups(lines: Sequence[str]) -> tuple[ArticleStructureGroup, ...]:
    normalized_lines = [_normalize_fragment(line) for line in lines if _normalize_fragment(line)]
    if not normalized_lines:
        return ()
    top_level_is_clause = any(TOP_LEVEL_CLAUSE_RE.match(line) for line in normalized_lines)

    groups: list[ArticleStructureGroup] = []
    current_prefix: list[str] = []
    current_blocks: list[tuple[str, ...]] = []
    current_block: list[str] = []

    for line in normalized_lines:
        if _starts_new_article_block(line, top_level_is_clause=top_level_is_clause):
            if current_block:
                current_blocks.append(tuple(current_block))
            current_block = [line]
            continue
        if current_block and line.endswith(("：", ":")):
            current_blocks.append(tuple(current_block))
            groups.append(
                ArticleStructureGroup(
                    prefix_lines=tuple(current_prefix),
                    blocks=tuple(current_blocks),
                )
            )
            current_prefix = [line]
            current_blocks = []
            current_block = []
            continue
        if current_block:
            current_block.append(line)
            continue
        current_prefix.append(line)

    if current_block:
        current_blocks.append(tuple(current_block))
    if current_blocks:
        groups.append(
            ArticleStructureGroup(
                prefix_lines=tuple(current_prefix),
                blocks=tuple(current_blocks),
            )
        )
    return tuple(groups)


def article_structure_has_nested_subclauses(lines: Sequence[str]) -> bool:
    normalized_lines = [_normalize_fragment(line) for line in lines if _normalize_fragment(line)]
    return any(TOP_LEVEL_CLAUSE_RE.match(line) for line in normalized_lines) and any(
        NUMERIC_SUBCLAUSE_RE.match(line) for line in normalized_lines
    )


def _starts_new_article_block(line: str, *, top_level_is_clause: bool) -> bool:
    if top_level_is_clause:
        return bool(TOP_LEVEL_CLAUSE_RE.match(line))
    return bool(NUMERIC_SUBCLAUSE_RE.match(line))


def _normalize_article_structure_line(line: str) -> tuple[str, ...]:
    inline_match = INLINE_LIST_MARKER_RE.match(line)
    if inline_match is not None:
        split_body = _split_inline_heading_body(inline_match.group("body").strip())
        if split_body is not None:
            return (
                _compose_heading_line(inline_match.group("label").strip(), split_body[0]),
                split_body[1],
            )
        return (line,)

    split_plain = _split_plain_heading_body(line)
    if split_plain is not None:
        return split_plain
    return (line,)


def _compose_heading_line(label: str, heading: str) -> str:
    if label.startswith(("(", "（")):
        return f"{label}{heading}"
    if NUMERIC_SUBCLAUSE_RE.match(label):
        return f"{label} {heading}"
    return f"{label}{heading}"


def _split_plain_heading_body(text: str) -> tuple[str, str] | None:
    for heading in sorted(PLAIN_HEADING_ALLOWLIST, key=len, reverse=True):
        if not text.startswith(heading):
            continue
        remainder = text[len(heading) :].strip()
        if remainder:
            return heading, remainder
    split_note = _split_note_marker_body(text)
    if split_note is not None:
        return split_note
    return None


def _split_inline_heading_body(body: str) -> tuple[str, str] | None:
    normalized = _normalize_fragment(body)
    if not normalized or "\n" in normalized:
        return None
    for starter in INLINE_HEADING_BODY_STARTERS:
        marker_index = normalized.find(starter)
        if marker_index == 0:
            marker_index = normalized.find(starter, len(starter))
        if marker_index <= 0:
            continue
        heading = normalized[:marker_index].strip()
        remainder = normalized[marker_index:].strip()
        if not _is_heading_candidate(heading):
            continue
        return heading, remainder
    return None


def _is_heading_candidate(text: str) -> bool:
    if text in INLINE_HEADING_ALLOWLIST:
        return True
    if is_title_like_heading(text):
        return True
    if not text or not HEADING_TEXT_RE.fullmatch(text):
        return False
    if not text.endswith(HEADING_SUFFIXES):
        return False
    if any(fragment in text for fragment in HEADING_FORBIDDEN_FRAGMENTS):
        return False
    return not text.endswith(("的", "地", "得", "了", "时", "后", "前"))


def _split_note_marker_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_fragment(text)
    if not normalized:
        return None
    for marker in NOTE_MARKERS:
        marker_index = normalized.find(marker)
        if marker_index <= 0:
            continue
        heading = normalized[:marker_index].strip()
        remainder = normalized[marker_index:].strip()
        if not is_title_like_heading(heading):
            continue
        return heading, remainder
    return None


def is_title_like_heading(text: str) -> bool:
    normalized = _normalize_fragment(text)
    if not normalized or not HEADING_TEXT_RE.fullmatch(normalized):
        return False
    if any(marker in normalized for marker in ("，", ",", "。", "；", ";", "：", ":")):
        return False
    core = _strip_trailing_parenthetical(normalized)
    if not core or len(core) > 24:
        return False
    if core.endswith(("的", "地", "得", "了", "时", "后", "前")):
        return False
    return core.endswith(TITLE_HEADING_SUFFIXES)


def _strip_trailing_parenthetical(text: str) -> str:
    normalized = _normalize_fragment(text)
    for left, right in (("(", ")"), ("（", "）")):
        if not normalized.endswith(right):
            continue
        left_index = normalized.rfind(left)
        if left_index <= 0:
            continue
        if normalized[left_index + 1 : -1].count(left) or normalized[left_index + 1 : -1].count(
            right
        ):
            continue
        return normalized[:left_index].strip()
    return normalized


def _normalize_fragment(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().split())


__all__ = [
    "NUMERIC_SUBCLAUSE_RE",
    "TOP_LEVEL_CLAUSE_RE",
    "ArticleStructureGroup",
    "article_structure_has_nested_subclauses",
    "build_article_structure_groups",
    "is_title_like_heading",
    "normalize_article_body_structure",
]
