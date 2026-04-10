from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query
from campus_retrieval_core.evidence_ranking import (
    query_targets_source_title,
    select_supporting_evidence_sources,
)


DEFAULT_MAX_ANSWER_SOURCES = 3
_WHITESPACE_RE = re.compile(r"\s+")
_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_CJK_SEGMENT_RE = re.compile(r"[\u4e00-\u9fff]+")
_LEADING_ENUM_RE = re.compile(r"^(?:[0-9]{1,2}[.、]\s*|[一二三四五六七八九十百]+[、.]\s*)")
_PROCEDURE_QUERY_HINTS = ("怎么办", "如何", "怎么", "办理", "申请", "流程", "补办", "手续", "replace")
_NON_PROCEDURE_REQUIREMENT_QUERY_HINTS = ("怎么要求", "如何要求", "怎么规定", "如何规定")
_TIME_QUERY_HINTS = ("时间", "几点", "多久", "几年", "哪天", "学制", "照明", "熄灯", "亮灯", "hours")
_CURRICULUM_COURSE_LIST_QUERY_HINTS = ("什么课", "哪些课", "有什么课", "有哪些课", "修什么")
_ACTION_STATEMENT_HINTS = (
    "挂失",
    "申请",
    "补办",
    "办理",
    "提交",
    "填写",
    "审批",
    "备案",
    "注册",
    "检测",
    "充值",
    "报销",
    "replace",
)
_TIME_STATEMENT_HINTS = (
    "时间",
    "几点",
    "学制",
    "亮灯",
    "熄灯",
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
    "星期",
    "月",
    "日",
    ":",
)
_ACADEMIC_YEARS_FACT_RE = re.compile(r"学制[:： ]*(?:\d+|[一二三四五六七八九十两]+)年")
_CURRICULUM_TOTAL_CREDITS_FACT_RE = re.compile(r"总学分[^0-9]{0,12}([0-9]{2,3})(?:\s*学分)?")
_CURRICULUM_STUDY_YEARS_FACT_RE = re.compile(r"学制[^0-9一二三四五六七八九十两]{0,12}((?:\d+|[一二三四五六七八九十两]+)年)")
_CURRICULUM_SEMESTER_NUMERIC_LABELS = {
    "第一学期": "1",
    "第二学期": "2",
    "第三学期": "3",
    "第四学期": "4",
    "第五学期": "5",
    "第六学期": "6",
    "第七学期": "7",
    "第八学期": "8",
    "第九学期": "9",
    "第十学期": "10",
}
_CURRICULUM_EMPTY_TABLE_CELLS = frozenset({"", "-", "—", "/", "／"})
_LOW_SIGNAL_QUERY_TOKENS = frozenset(
    {
        "中央",
        "民族",
        "大学",
        "学生",
        "规定",
        "办法",
        "内容",
        "相关",
        "什么",
        "哪些",
        "如何",
        "怎么",
        "怎么办",
        "流程",
        "办理",
        "hours",
    }
)
_PROCEDURE_SIDE_NOTE_HINTS = (
    "优惠卡",
    "检测",
    "充值",
    "销毁",
    "转借",
    "处分",
    "负责解释",
    "不良后果",
    "第二次",
    "再次遗失",
    "补发第二次",
    "弄虚作假",
    "原则上",
    "骑缝章",
)
_PROCEDURE_TIME_HINTS = ("时间", "周一", "周二", "周三", "周四", "周五", "周六", "周日", "星期", "月", "日")
_OFFICIAL_WEB_NOTICE_QUERY_HINTS = ("讲座", "预告", "通知", "公告", "活动")
_OFFICIAL_WEB_NOTICE_TIME_HINTS = ("讲座时间", "活动时间", "时间：")
_OFFICIAL_WEB_NOTICE_LOCATION_HINTS = ("讲座地点", "活动地点", "地点：")
_OFFICIAL_WEB_NOTICE_TOPIC_HINTS = ("讲座主题", "活动主题", "主题：", "聚焦", "围绕", "介绍")
_OFFICIAL_WEB_REFERENCE_QUERY_HINTS = ("简介", "概况", "介绍")
_OFFICIAL_WEB_ROSTER_QUERY_HINTS = ("现任领导", "领导班子")
_OFFICIAL_WEB_NEWS_QUERY_HINTS = ("解读", "专访")
_OFFICIAL_WEB_LOW_VALUE_TAIL_HINTS = ("二维码", "扫码", "扫描", "预约讲座", "预约报名", "图书馆积分")
_OFFICIAL_WEB_METADATA_LINE_PREFIXES = ("标题：", "章节：")
_OFFICIAL_WEB_DISCLAIMER_HINTS = ("Copyright@", "新闻网版权与免责声明", "投稿方式：", "版权均属于")
_OFFICIAL_WEB_SLOGAN_HINTS = ("高举习近平新时代中国特色社会主义思想", "阔步前行")
_OFFICIAL_WEB_SERVICE_TRIAD = "服务校友、服务母校、服务社会"
_OFFICIAL_WEB_IGNORED_CONTENT_ROLES = frozenset({"source_attribution", "boilerplate", "media_caption"})
_OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS = (
    ("历史学", ("历史学会", "新史学", "历史学", "中国史", "清史", "辽史", "元史", "考古")),
    ("社会学/民族学/人类学", ("社会学", "民族学", "人类学")),
    ("语言学/藏学", ("语言学", "藏学", "藏文", "突厥语", "彝语", "羌语", "语言文字")),
    ("音乐/艺术", ("音乐", "二胡", "民乐", "艺术")),
)
_OFFICIAL_WEB_REFERENCE_PAGE_TITLES = frozenset(
    {
        "学校简介",
        "学校概况",
        "校友会简介",
        "基金会简介",
        "本科培养",
        "博士后",
        "研究生培养",
        "学术名流",
    }
)


@dataclass(frozen=True, slots=True)
class AnswerDraft:
    answer_text: str
    supporting_sources: tuple[EvidenceSource, ...]
    supporting_contexts: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RagSpecialistAgent:
    runtime_provider: str = ""
    max_answer_sources: int = DEFAULT_MAX_ANSWER_SOURCES

    def build_answer(self, evidence: EvidenceBundle) -> AnswerDraft:
        if not evidence.sources:
            return AnswerDraft(answer_text="", supporting_sources=(), supporting_contexts=())

        candidate_sources = select_supporting_evidence_sources(
            query_text=evidence.query_text,
            sources=evidence.sources,
            max_sources=self.max_answer_sources,
        )
        selected_rows = _select_answer_support_rows(
            query_text=evidence.query_text,
            sources=candidate_sources,
            max_sources=self.max_answer_sources,
        )
        supporting_sources = tuple(source for source, _ in selected_rows)
        supporting_contexts = _render_supporting_contexts(selected_rows)
        answer_text = _compose_direct_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        return AnswerDraft(
            answer_text=answer_text,
            supporting_sources=supporting_sources,
            supporting_contexts=supporting_contexts,
        )

    def compose_answer(self, evidence: EvidenceBundle) -> str:
        return self.build_answer(evidence).answer_text


@dataclass(frozen=True, slots=True)
class _CurriculumSemesterTableLayout:
    single_semester_index: int = -1
    distribution_semester_indexes: tuple[tuple[str, int], ...] = ()


def _normalize_snippet(snippet: str) -> str:
    return _WHITESPACE_RE.sub(" ", snippet).strip()


def _render_source_support(source: EvidenceSource) -> str:
    normalized = _normalize_snippet(source.snippet)
    filtered_lines: list[str] = []
    title = _normalize_snippet(source.source_title)
    ignored_lines = {
        title,
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))
    for raw_line in re.split(r"[\r\n]+", normalized):
        line = _normalize_snippet(raw_line)
        if not line or line in ignored_lines:
            continue
        filtered_lines.append(line)
    rendered = " ".join(filtered_lines) if filtered_lines else normalized
    rendered = re.sub(r"(学制[:： ]*)(\d+)年", _replace_academic_years_match, rendered)
    return rendered


def _extract_source_statements(source: EvidenceSource) -> tuple[str, ...]:
    title = _normalize_snippet(source.source_title)
    ignored_lines = {
        title,
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))

    statements: list[str] = []
    for raw_line in re.split(r"[\r\n]+", source.snippet):
        line = _normalize_snippet(raw_line)
        if _is_official_web_source(source):
            line = _normalize_official_web_statement_line(line=line, title=title)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        if title and line.startswith(title):
            continue
        line = _LEADING_ENUM_RE.sub("", line)
        line = re.sub(r"^[（(]?[一二三四五六七八九十百]+[)）]\s*", "", line)
        line = re.sub(r"\s*[:：]\s*$", "", line).strip()
        line = re.sub(r"(学制[:： ]*)(\d+)年", _replace_academic_years_match, line)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        statements.append(line)

    if statements:
        return tuple(dict.fromkeys(statements))
    rendered = _render_source_support(source)
    return (rendered,) if rendered else ()


def _query_mode(query_text: str) -> str:
    normalized = _normalize_snippet(query_text).lower()
    if any(hint in normalized for hint in _NON_PROCEDURE_REQUIREMENT_QUERY_HINTS):
        return "generic"
    if any(hint in normalized for hint in _PROCEDURE_QUERY_HINTS):
        return "procedure"
    if any(hint in normalized for hint in _TIME_QUERY_HINTS):
        return "time"
    return "generic"


def _query_keywords(query_text: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(query_text).lower()
    keywords: list[str] = []
    for token in _ASCII_TOKEN_RE.findall(normalized):
        keywords.append(token)
    for segment in _CJK_SEGMENT_RE.findall(normalized):
        if len(segment) >= 4 and segment not in _LOW_SIGNAL_QUERY_TOKENS:
            keywords.append(segment)
        for token_size in (3, 2):
            if len(segment) < token_size:
                continue
            for index in range(len(segment) - token_size + 1):
                token = segment[index : index + token_size]
                if token in _LOW_SIGNAL_QUERY_TOKENS:
                    continue
                keywords.append(token)
    return tuple(dict.fromkeys(token for token in keywords if token))


def _score_statement(
    query_text: str,
    source: EvidenceSource,
    statement: str,
    *,
    mode: str,
    keywords: tuple[str, ...],
) -> int:
    normalized = _normalize_snippet(statement).lower()
    if _is_curriculum_table_heading(source, statement):
        return 0
    score = 0
    for keyword in keywords:
        if keyword in normalized:
            score += 3 if len(keyword) >= 3 else 1
    if _is_curriculum_course_list_query(query_text) and _is_curriculum_course_row(source, statement):
        score += 4
    if mode == "procedure":
        score += sum(2 for token in _ACTION_STATEMENT_HINTS if token in normalized)
        if source.content_role == "procedure":
            score += 2
    if mode == "time":
        score += sum(2 for token in _TIME_STATEMENT_HINTS if token in normalized)
        if source.content_role == "time_rule":
            score += 2
        if ("学制" in query_text or "几年" in query_text) and _ACADEMIC_YEARS_FACT_RE.search(normalized):
            score += 8
    if "负责解释" in normalized:
        score -= 6
    if "研究生宿舍" in normalized and "研究生" not in _normalize_snippet(query_text):
        score -= 2
    if _is_official_web_source(source):
        score += _score_official_web_statement(
            query_text=query_text,
            source=source,
            statement=statement,
        )
    return score


def _is_curriculum_course_list_query(query_text: str) -> bool:
    normalized_query = _normalize_snippet(query_text)
    return any(hint in normalized_query for hint in _CURRICULUM_COURSE_LIST_QUERY_HINTS)


def _curriculum_semester_labels(query_text: str) -> tuple[str, ...]:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
        return ()
    return tuple(dict.fromkeys(interpretation.semester_labels))


def _curriculum_target_semesters(query_text: str) -> tuple[str, ...]:
    semester_labels = _curriculum_semester_labels(query_text)
    if not semester_labels:
        return ()
    return tuple(
        dict.fromkeys(
            _CURRICULUM_SEMESTER_NUMERIC_LABELS.get(label, "")
            for label in semester_labels
            if _CURRICULUM_SEMESTER_NUMERIC_LABELS.get(label, "")
        )
    )


def _is_curriculum_semester_course_list_query(query_text: str) -> bool:
    return bool(_curriculum_semester_labels(query_text))


def _is_curriculum_course_row(source: EvidenceSource, statement: str) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized = _normalize_snippet(statement)
    if normalized.count("|") < 5:
        return False
    return "课程号" not in normalized and "课程名称" not in normalized


def _is_curriculum_table_heading(source: EvidenceSource, statement: str) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized = _normalize_snippet(statement)
    if not normalized:
        return False
    if normalized.endswith("教学进程计划表"):
        return True
    if normalized in {"大类培养", "学科基础教育", "专业教育", "专业选修课程"}:
        return True
    if "课程清单如下" in normalized:
        return True
    if normalized.startswith("课程类别 |") or normalized.startswith("专业方向 |"):
        return True
    return False


def _candidate_source_statements(query_text: str, source: EvidenceSource) -> tuple[tuple[str, ...], bool]:
    scoped_statements = _extract_curriculum_semester_scoped_statements(
        query_text=query_text,
        source=source,
    )
    if scoped_statements is not None:
        return scoped_statements, True
    return _extract_source_statements(source), False


def _extract_curriculum_semester_scoped_statements(
    *,
    query_text: str,
    source: EvidenceSource,
) -> tuple[str, ...] | None:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return None
    if not _is_curriculum_semester_course_list_query(query_text):
        return None
    if "|" not in source.snippet:
        return None
    target_semesters = _curriculum_target_semesters(query_text)
    if not target_semesters:
        return None

    title = _normalize_snippet(source.source_title)
    ignored_lines = {
        title,
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))

    matched_rows: list[str] = []
    table_layout: _CurriculumSemesterTableLayout | None = None
    for raw_line in re.split(r"[\r\n]+", source.snippet):
        line = _normalize_snippet(raw_line)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        cells = _split_curriculum_table_cells(line)
        resolved_layout = _resolve_curriculum_semester_table_layout(cells)
        if resolved_layout is not None:
            table_layout = resolved_layout
            continue
        if _is_curriculum_table_heading(source, line) or not _is_curriculum_course_row(source, line):
            continue
        if _curriculum_row_matches_target_semester(
            cells=cells,
            layout=table_layout,
            target_semesters=target_semesters,
        ):
            matched_rows.append(line)
    return tuple(dict.fromkeys(matched_rows))


def _extract_curriculum_semester_course_titles_from_statement(
    statement: str,
    *,
    semester_labels: tuple[str, ...],
) -> tuple[str, ...]:
    normalized = _normalize_snippet(statement)
    if not normalized or "|" in normalized:
        return ()
    cleaned = normalized
    for label in semester_labels:
        cleaned = cleaned.replace(label, "")
    cleaned = re.sub(r"^(?:有|包括|课程有|课程包括|课程为|主要有)\s*", "", cleaned)
    cleaned = cleaned.strip("：:，,；;。 ")
    if not cleaned:
        return ()
    return tuple(
        dict.fromkeys(
            fragment.strip("：:，,；;。 ")
            for fragment in re.split(r"[、，,；;]", cleaned)
            if fragment.strip("：:，,；;。 ")
        )
    )


def _extract_curriculum_semester_course_titles(
    *,
    query_text: str,
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> tuple[str, ...]:
    semester_labels = _curriculum_semester_labels(query_text)
    target_semesters = _curriculum_target_semesters(query_text)
    if not semester_labels or not target_semesters or source.collection != "curriculum_plan":
        return ()

    if "|" in source.snippet and source.content_role == "table_fact":
        title = _normalize_snippet(source.source_title)
        ignored_lines = {
            title,
            *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
        }
        if source.detail_label.strip():
            ignored_lines.add(_normalize_snippet(source.detail_label))

        table_layout: _CurriculumSemesterTableLayout | None = None
        course_name_index = -1
        course_titles: list[str] = []
        for raw_line in re.split(r"[\r\n]+", source.snippet):
            line = _normalize_snippet(raw_line)
            if not line or line in ignored_lines or line.startswith("文号："):
                continue
            cells = _split_curriculum_table_cells(line)
            if "课程名称" in cells:
                course_name_index = cells.index("课程名称")
            resolved_layout = _resolve_curriculum_semester_table_layout(cells)
            if resolved_layout is not None:
                table_layout = resolved_layout
                continue
            if _is_curriculum_table_heading(source, line) or not _is_curriculum_course_row(source, line):
                continue
            if course_name_index < 0 or course_name_index >= len(cells):
                continue
            if not _curriculum_row_matches_target_semester(
                cells=cells,
                layout=table_layout,
                target_semesters=target_semesters,
            ):
                continue
            course_name = _normalize_snippet(cells[course_name_index])
            if course_name and course_name != "课程名称":
                course_titles.append(course_name)
        if course_titles:
            return tuple(dict.fromkeys(course_titles))

    fallback_titles: list[str] = []
    for statement in statements:
        fallback_titles.extend(
            _extract_curriculum_semester_course_titles_from_statement(
                statement,
                semester_labels=semester_labels,
            )
        )
    return tuple(dict.fromkeys(fallback_titles))


def _split_curriculum_table_cells(line: str) -> tuple[str, ...]:
    return tuple(_normalize_snippet(cell) for cell in line.split("|"))


def _resolve_curriculum_semester_table_layout(
    cells: tuple[str, ...],
) -> _CurriculumSemesterTableLayout | None:
    if "课程名称" not in cells:
        return None
    for index, cell in enumerate(cells):
        if cell.endswith("学期") and "各学期" not in cell:
            return _CurriculumSemesterTableLayout(single_semester_index=index)
    distribution_indexes = tuple(
        (cell, index)
        for index, cell in enumerate(cells)
        if cell in _CURRICULUM_SEMESTER_NUMERIC_LABELS.values()
    )
    if len(distribution_indexes) >= 2:
        return _CurriculumSemesterTableLayout(
            distribution_semester_indexes=distribution_indexes,
        )
    return None


def _curriculum_row_matches_target_semester(
    *,
    cells: tuple[str, ...],
    layout: _CurriculumSemesterTableLayout | None,
    target_semesters: tuple[str, ...],
) -> bool:
    if not cells:
        return False
    if layout is not None and layout.single_semester_index >= 0:
        if layout.single_semester_index >= len(cells):
            return False
        return cells[layout.single_semester_index] in target_semesters
    if layout is not None and layout.distribution_semester_indexes:
        return any(
            column_index < len(cells) and _curriculum_table_cell_has_value(cells[column_index])
            for semester_label, column_index in layout.distribution_semester_indexes
            if semester_label in target_semesters
        )
    return cells[-1] in target_semesters


def _curriculum_table_cell_has_value(value: str) -> bool:
    return _normalize_snippet(value) not in _CURRICULUM_EMPTY_TABLE_CELLS


def _score_source_statements(
    query_text: str,
    source: EvidenceSource,
    *,
    mode: str,
) -> tuple[tuple[int, str], ...]:
    keywords = _query_keywords(query_text)
    scored: list[tuple[int, str]] = []
    statements, _ = _candidate_source_statements(query_text, source)
    for statement in statements:
        score = _score_statement(query_text, source, statement, mode=mode, keywords=keywords)
        if score > 0:
            scored.append((score, statement))
    return tuple(sorted(scored, key=lambda item: (item[0], len(item[1])), reverse=True))


def _rank_source_statements(query_text: str, source: EvidenceSource, *, mode: str) -> tuple[str, ...]:
    statements, scoped = _candidate_source_statements(query_text, source)
    statement_limit = 4 if mode == "time" else 3
    if scoped and _is_curriculum_semester_course_list_query(query_text):
        return statements
    if scoped and _is_curriculum_course_list_query(query_text):
        return statements[:statement_limit]
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        if scoped:
            return ()
        return statements[:1]
    return tuple(statement for _, statement in scored[:statement_limit])


def _select_answer_support_rows(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    max_sources: int,
) -> tuple[tuple[EvidenceSource, tuple[str, ...]], ...]:
    if not sources or max_sources <= 0:
        return ()

    mode = _query_mode(query_text)
    course_list_query = _is_curriculum_course_list_query(query_text)
    consumable_sources = tuple(
        source for source in sources if not _should_ignore_official_web_source(source)
    )
    ranked_source_input = consumable_sources or sources
    max_seen_statements = 6 if course_list_query else 3
    ranked_sources = (
        tuple(ranked_source_input)
        if course_list_query
        else tuple(
            sorted(
                ranked_source_input,
                key=lambda source: _answer_source_sort_key(query_text, source, mode=mode),
                reverse=True,
            )
        )
    )
    rows: list[tuple[EvidenceSource, tuple[str, ...]]] = []
    seen_statements: set[str] = set()

    for index, source in enumerate(ranked_sources):
        ranked_statements = _rank_source_statements(query_text, source, mode=mode)
        novel_statements = tuple(
            statement
            for statement in ranked_statements
            if _normalize_snippet(statement).lower() not in seen_statements
        )
        if not novel_statements:
            continue
        rows.append((source, novel_statements))
        seen_statements.update(_normalize_snippet(statement).lower() for statement in novel_statements)
        if _should_stop_after_official_web_reference_rows(
            query_text=query_text,
            rows=tuple(rows),
        ):
            break
        if (
            not course_list_query
            and index == 0
            and len(novel_statements) >= 2
            and not _is_official_web_reference_query(query_text=query_text, source=source)
        ):
            break
        if course_list_query and len(rows) >= 2 and len(seen_statements) >= 5:
            break
        if index == 0 and mode == "time" and any("学制" in statement for statement in novel_statements):
            break
        if len(rows) >= max_sources or len(seen_statements) >= max_seen_statements:
            break

    if rows:
        return tuple(rows)

    fallback_source = ranked_sources[0]
    return ((fallback_source, _rank_source_statements(query_text, fallback_source, mode=mode)),)


def _should_ignore_official_web_source(source: EvidenceSource) -> bool:
    return _is_official_web_source(source) and source.content_role in _OFFICIAL_WEB_IGNORED_CONTENT_ROLES


def _answer_source_sort_key(query_text: str, source: EvidenceSource, *, mode: str) -> tuple[int, int, int, int]:
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        return (0, 0, 0, 0)
    best_score = scored[0][0]
    total_score = sum(score for score, _ in scored[:3])
    return (
        best_score,
        total_score,
        len(scored),
        1 if source.is_answer_bearing else 0,
    )


def _should_lock_official_web_reference_answer(
    *,
    query_text: str,
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> bool:
    if not _is_official_web_source(source):
        return False
    if not _is_official_web_reference_query(query_text=query_text, source=source):
        return False
    if not query_targets_source_title(query_text=query_text, source=source):
        return False
    return any(_normalize_snippet(statement) for statement in statements)


def _should_stop_after_official_web_reference_rows(
    *,
    query_text: str,
    rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> bool:
    if not rows:
        return False
    lead_source = rows[0][0]
    if not _should_lock_official_web_reference_answer(
        query_text=query_text,
        source=lead_source,
        statements=rows[0][1],
    ):
        return False
    normalized_title = _normalize_snippet(lead_source.source_title)
    lead_title = _lead_source_title(tuple(source for source, _ in rows))
    sentences = _flatten_official_web_sentences(rows, lead_title=lead_title)
    if normalized_title == "学校概况":
        has_campus = any("三个校区" in sentence or ("海淀" in sentence and "丰台" in sentence) for sentence in sentences)
        has_discipline = any("12个学科门类" in sentence or "71个本科专业" in sentence for sentence in sentences)
        return has_campus and has_discipline
    if normalized_title == "学术名流":
        names = {
            name
            for source, statements in rows
            if (name := _extract_official_web_scholar_name(source, statements))
        }
        domains = {
            domain
            for _, statements in rows
            for domain in _extract_official_web_scholar_domains(statements)
        }
        return len(names) >= 3 and bool(domains)
    if normalized_title == "本科培养":
        has_scale = any("本科专业" in sentence and "在招专业" in sentence for sentence in sentences)
        has_excellence = any("强基计划" in sentence or "一流本科专业" in sentence for sentence in sentences)
        return has_scale and has_excellence
    if normalized_title == "博士后":
        has_stations = any("博士后科研流动站" in sentence for sentence in sentences)
        has_assessment = any("合格率均为100" in sentence or "优秀博士后流动站" in sentence for sentence in sentences)
        return has_stations and has_assessment
    if normalized_title == "研究生培养":
        has_discipline = any("12个学科门类" in sentence for sentence in sentences)
        has_authorization = any("24个研究生招生培养单位" in sentence or "博士一级学科授权点" in sentence for sentence in sentences)
        return has_discipline and has_authorization
    return True


def _format_source_citation(sources: tuple[EvidenceSource, ...]) -> str:
    seen: set[str] = set()
    labels: list[str] = []
    for source in sources:
        locator = f"{source.doc_id}#{source.chunk_id}"
        if locator in seen:
            continue
        seen.add(locator)
        labels.append(locator)
    if not labels:
        return ""
    return f"[{', '.join(labels)}]"


def _compose_generic_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    fragments = [
        f"{'；'.join(statements)} [{source.doc_id}#{source.chunk_id}]"
        for source, statements in selected_rows
        if statements
    ]
    if not fragments:
        fragments = [
            f"{_render_source_support(source)} [{source.doc_id}#{source.chunk_id}]"
            for source, _ in selected_rows
        ]

    answer_prefix = _answer_prefix(evidence)
    supporting_sources = tuple(source for source, _ in selected_rows)
    lead_title = _lead_source_title(supporting_sources)
    topic_label = _query_topic_label(evidence.query_text)
    if lead_title and _normalize_snippet(lead_title) in _normalize_snippet(evidence.query_text):
        return f"{answer_prefix}，《{lead_title}》明确：{'；'.join(fragments)}"
    if topic_label and topic_label not in _normalize_snippet(' '.join(fragments)):
        return f"{answer_prefix}，关于{topic_label}：{'；'.join(fragments)}"
    return f"{answer_prefix}，{'；'.join(fragments)}"


def _compose_curriculum_semester_course_list_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if evidence.collection != "curriculum_plan":
        return ""
    semester_labels = _curriculum_semester_labels(evidence.query_text)
    if len(semester_labels) != 1:
        return ""

    course_titles: list[str] = []
    seen_titles: set[str] = set()
    for source, statements in selected_rows:
        for course_title in _extract_curriculum_semester_course_titles(
            query_text=evidence.query_text,
            source=source,
            statements=statements,
        ):
            normalized = _normalize_snippet(course_title).lower()
            if not normalized or normalized in seen_titles:
                continue
            seen_titles.add(normalized)
            course_titles.append(course_title)
    if not course_titles:
        return ""

    answer = f"{_answer_prefix(evidence)}，{semester_labels[0]}有{'、'.join(course_titles)}。"
    citation = _format_source_citation(tuple(source for source, _ in selected_rows))
    if citation:
        return f"{answer} {citation}"
    return answer


def _compose_procedure_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    procedure_parts = _build_procedure_answer_parts(selected_rows)
    if not procedure_parts:
        return _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)

    core_steps = [part for part in procedure_parts[:3] if part]
    step_fragments: list[str] = []
    for index, fragment in enumerate(core_steps):
        if len(core_steps) == 1:
            step_fragments.append(fragment)
            continue
        if index == 0:
            step_fragments.append(f"先{fragment}")
            continue
        if index == 1:
            step_fragments.append(f"再{fragment}")
            continue
        step_fragments.append(fragment)
    if procedure_parts[3]:
        step_fragments.append(procedure_parts[3])
    if not step_fragments:
        return _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)

    intro = _procedure_intro(evidence.query_text)
    citation = _format_source_citation(tuple(source for source, _ in selected_rows))
    answer_body = "；".join(step_fragments)
    if citation:
        return f"{_answer_prefix(evidence)}，{intro}{answer_body} {citation}"
    return f"{_answer_prefix(evidence)}，{intro}{answer_body}"


def _build_procedure_answer_parts(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, str, str, str]:
    immediate_actions: list[str] = []
    materials: list[str] = []
    approvals: list[str] = []
    time_windows: list[str] = []
    seen_fragments: set[str] = set()

    for _, statements in selected_rows:
        for statement in statements:
            for raw_fragment in re.split(r"[，,；。]", statement):
                fragment = _normalize_procedure_fragment(raw_fragment)
                if not fragment:
                    continue
                normalized = _normalize_snippet(fragment).lower()
                if normalized in seen_fragments:
                    continue
                role = _classify_procedure_fragment(fragment)
                if role == "":
                    continue
                seen_fragments.add(normalized)
                if role == "immediate_action":
                    immediate_actions.append(fragment)
                elif role == "required_material":
                    materials.append(fragment)
                elif role == "approval_or_destination":
                    approvals.append(fragment)
                elif role == "time_window":
                    time_windows.append(fragment)

    if not immediate_actions and not materials and not approvals and not time_windows:
        return ("", "", "", "")

    step_one_parts: list[str] = []
    step_two_parts: list[str] = []
    step_three_parts: list[str] = []
    used_materials: set[str] = set()
    used_approvals: set[str] = set()

    first_action = immediate_actions[0] if immediate_actions else ""
    second_action = immediate_actions[1] if len(immediate_actions) > 1 else ""

    if first_action:
        step_one_parts.append(first_action)
    for fragment in materials:
        if "写明" not in fragment:
            continue
        step_one_parts.append(fragment)
        used_materials.add(fragment)
        break
    for fragment in approvals:
        if "备案" not in fragment:
            continue
        step_one_parts.append(fragment)
        used_approvals.add(fragment)
        break

    if second_action:
        step_two_parts.append(second_action)
    for fragment in materials:
        if fragment in used_materials:
            continue
        step_two_parts.append(fragment)
        used_materials.add(fragment)
    for fragment in approvals:
        if fragment in used_approvals:
            continue
        step_two_parts.append(fragment)
        used_approvals.add(fragment)

    if not step_two_parts and materials:
        for fragment in materials:
            if fragment in used_materials:
                continue
            step_two_parts.append(fragment)
            used_materials.add(fragment)
    if not step_two_parts and approvals:
        for fragment in approvals:
            if fragment in used_approvals:
                continue
            step_two_parts.append(fragment)
            used_approvals.add(fragment)

    for fragment in approvals:
        if fragment in used_approvals:
            continue
        step_three_parts.append(fragment)
        used_approvals.add(fragment)

    return (
        _join_procedure_fragments(step_one_parts),
        _join_procedure_fragments(step_two_parts),
        _join_procedure_fragments(step_three_parts),
        time_windows[0] if time_windows else "",
    )


def _normalize_procedure_fragment(fragment: str) -> str:
    normalized = _normalize_snippet(fragment).strip("；，。 ")
    if not normalized:
        return ""
    normalized = normalized.replace("(见附表)", "").replace("（见附表）", "")
    if "申请补办" in normalized:
        normalized = re.sub(r"^学生[^，。；]*?应", "", normalized)
    normalized = re.sub(r"^(应|须|需|必须|并|再|然后)", "", normalized)
    normalized = re.sub(r"^学生(?:补办|遗失|如将)?学生证$", "", normalized)
    normalized = re.sub(r"^遗失或损坏的学生证$", "", normalized)
    normalized = _normalize_snippet(normalized).strip("；，。 ")
    return normalized


def _classify_procedure_fragment(fragment: str) -> str:
    normalized = _normalize_snippet(fragment)
    if not normalized:
        return ""
    if any(token in normalized for token in _PROCEDURE_SIDE_NOTE_HINTS):
        return ""
    if "挂失" in normalized or "申请补办" in normalized:
        return "immediate_action"
    if any(token in normalized for token in ("写明", "书面申请", "填写", "申请表")):
        return "required_material"
    if any(token in normalized for token in ("审批", "备案", "办理补办手续", "学生处办理", "审核", "盖章")):
        return "approval_or_destination"
    if any(token in normalized for token in _PROCEDURE_TIME_HINTS):
        return "time_window"
    if any(token in normalized for token in ("提交", "办理", "申请")):
        return "immediate_action"
    return ""


def _join_procedure_fragments(fragments: list[str]) -> str:
    compact = [fragment for fragment in fragments if fragment]
    if not compact:
        return ""
    return "，".join(dict.fromkeys(compact))


def _procedure_intro(query_text: str) -> str:
    subject = _normalize_snippet(query_text).strip("。？！? ")
    if not subject:
        return "可按以下步骤处理："
    if "学生证" in subject and any(token in subject for token in ("丢", "遗失", "损坏")):
        return "学生证遗失后可按以下步骤处理："
    for hint in sorted(_PROCEDURE_QUERY_HINTS, key=len, reverse=True):
        subject = subject.replace(hint, "")
    subject = subject.replace("丢了", "丢失").replace("遗失了", "遗失")
    subject = _normalize_snippet(subject).strip("。？！? ")
    if subject.endswith(("丢失", "遗失", "损坏")) and len(subject) <= 10:
        return f"{subject}后可按以下步骤处理："
    if subject and len(subject) <= 8 and _CJK_SEGMENT_RE.search(subject):
        return f"关于{subject}，可按以下步骤处理："
    return "可按以下步骤处理："


def _compose_direct_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if not selected_rows:
        return ""

    mode = _query_mode(evidence.query_text)
    if mode == "procedure":
        return _compose_procedure_answer(evidence=evidence, selected_rows=selected_rows)
    if (
        evidence.corpus == "official_web"
        and is_official_web_stable_reference_like_collection(evidence.collection)
    ):
        official_web_answer = _compose_official_web_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if official_web_answer:
            return official_web_answer
    if _is_curriculum_semester_course_list_query(evidence.query_text):
        semester_course_list_answer = _compose_curriculum_semester_course_list_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if semester_course_list_answer:
            return semester_course_list_answer
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        curriculum_lookup_answer = _compose_curriculum_lookup_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if curriculum_lookup_answer:
            return curriculum_lookup_answer
    return _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)


def _render_supporting_contexts(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    contexts: list[str] = []
    for source, statements in selected_rows:
        context = _render_supporting_context(source, statements)
        if context:
            contexts.append(context)
    return tuple(contexts)


def _render_supporting_context(source: EvidenceSource, statements: tuple[str, ...]) -> str:
    fragments = tuple(statement for statement in statements if statement)
    body = "；".join(fragments) if fragments else _render_source_support(source)
    if not body:
        return ""
    title = _normalize_snippet(source.source_title)
    if title and title not in body:
        return f"{title}：{body}"
    return body


def _query_topic_label(query_text: str) -> str:
    normalized = _normalize_snippet(query_text).strip("。？！? ")
    if not normalized:
        return ""
    lowered = normalized.lower()
    if any(hint in lowered for hint in _PROCEDURE_QUERY_HINTS):
        return ""
    if any(hint in lowered for hint in ("什么", "哪些", "how", "what", "when")):
        return ""
    if len(normalized) > 10:
        return ""
    if not _CJK_SEGMENT_RE.search(normalized):
        return ""
    return normalized


def _compose_curriculum_lookup_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    statements = _flatten_curriculum_statements(selected_rows)
    if not statements:
        return ""
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    normalized_query = _normalize_snippet(evidence.query_text)
    if any(token in normalized_query for token in ("学制", "几年")):
        years = _extract_curriculum_study_years(statements)
        if years:
            return _curriculum_fact_sentence(lead_title, f"学制为{years}")
    if "总学分" in normalized_query:
        credits = _extract_curriculum_total_credits(statements)
        if credits:
            return _curriculum_fact_sentence(lead_title, f"总学分为{credits}")
    return ""


def _flatten_curriculum_statements(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    statements: list[str] = []
    for source, row_statements in selected_rows:
        if row_statements:
            statements.extend(statement for statement in row_statements if statement)
            continue
        fallback = _render_source_support(source)
        if fallback:
            statements.append(fallback)
    return tuple(statements)


def _extract_curriculum_study_years(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        match = _CURRICULUM_STUDY_YEARS_FACT_RE.search(normalized)
        if match:
            return match.group(1)
        if "学制" in normalized:
            tail = normalized.split("学制", 1)[-1]
            fallback = re.search(r"((?:\d+|[一二三四五六七八九十两]+)年)", tail)
            if fallback:
                return fallback.group(1)
    return ""


def _extract_curriculum_total_credits(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        if "总学分" not in normalized:
            continue
        match = _CURRICULUM_TOTAL_CREDITS_FACT_RE.search(normalized)
        if match:
            return f"{match.group(1)}学分"
    return ""


def _curriculum_fact_sentence(lead_title: str, body: str) -> str:
    if lead_title:
        return f"《{lead_title}》{body}。"
    return f"{body}。"


def _is_official_web_source(source: EvidenceSource) -> bool:
    return (
        source.source_channel == "official_web"
        and is_official_web_stable_reference_like_collection(source.collection)
    )


def _normalize_official_web_statement_line(*, line: str, title: str) -> str:
    normalized = _normalize_snippet(line)
    if not normalized:
        return ""
    if normalized.startswith(_OFFICIAL_WEB_METADATA_LINE_PREFIXES):
        return ""
    if _looks_like_official_web_low_value_tail(normalized):
        return ""
    if title and normalized.startswith(title):
        salvaged = _salvage_official_web_title_tail(normalized, title=title)
        return salvaged
    return normalized


def _salvage_official_web_title_tail(line: str, *, title: str) -> str:
    segments = [
        _normalize_snippet(segment).strip(" /|｜")
        for segment in re.split(r"\s*[|｜/／]\s*", line)
        if _normalize_snippet(segment).strip(" /|｜")
    ]
    meaningful_segments = [
        segment
        for segment in segments
        if segment != title
        and segment not in {f"标题：{title}", f"章节：{title}"}
        and not segment.startswith("章节：")
    ]
    if meaningful_segments:
        return meaningful_segments[-1]
    suffix = line[len(title) :].strip(" /|｜:：-")
    if suffix and not _looks_like_official_web_low_value_tail(suffix):
        return suffix
    return ""


def _looks_like_official_web_low_value_tail(text: str) -> bool:
    normalized = _normalize_snippet(text)
    if not normalized:
        return False
    if any(token in normalized for token in ("二维码", "图书馆积分")):
        return True
    return normalized.startswith("请") and any(token in normalized for token in ("扫描", "扫码", "预约", "报名"))


def _score_official_web_statement(
    *,
    query_text: str,
    source: EvidenceSource,
    statement: str,
) -> int:
    normalized_query = _normalize_snippet(query_text)
    normalized_statement = _normalize_snippet(statement)
    score = 0
    if _is_official_web_notice_query(query_text=query_text, source=source):
        if any(token in normalized_statement for token in _OFFICIAL_WEB_NOTICE_TIME_HINTS):
            score += 8
        if any(token in normalized_statement for token in _OFFICIAL_WEB_NOTICE_LOCATION_HINTS):
            score += 7
        if any(token in normalized_statement for token in _OFFICIAL_WEB_NOTICE_TOPIC_HINTS):
            score += 5
        if _looks_like_official_web_low_value_tail(normalized_statement):
            score -= 12
    if any(term in normalized_query for term in ("简介", "概况", "介绍")):
        if any(token in normalized_statement for token in ("是一所", "是党和国家", "创建的一所", "特色鲜明")):
            score += 8
        if re.search(r"20\d{2}年", normalized_statement) and any(
            token in normalized_statement for token in ("入选", "大事记")
        ):
            score -= 6
    normalized_title = _normalize_snippet(source.source_title)
    if normalized_title == "本科培养":
        if "本科专业" in normalized_statement or "在招专业" in normalized_statement:
            score += 10
        if "强基计划" in normalized_statement or "一流本科专业" in normalized_statement:
            score += 8
        if any(token in normalized_statement for token in ("担当使命", "强国栋梁")):
            score -= 8
    elif normalized_title == "博士后":
        if "博士后科研流动站" in normalized_statement:
            score += 10
        if "合格率均为100" in normalized_statement or "优秀博士后流动站" in normalized_statement:
            score += 8
        if "双一流" in normalized_statement:
            score -= 6
    elif normalized_title == "研究生培养":
        if "12个学科门类" in normalized_statement:
            score += 10
        if "24个研究生招生培养单位" in normalized_statement:
            score += 9
        if "博士一级学科授权点" in normalized_statement or "硕士一级学科授权点" in normalized_statement:
            score += 8
        if any(token in normalized_statement for token in ("600余项", "500多人")):
            score -= 6
    elif normalized_title == "学术名流":
        if any(token in normalized_statement for _, tokens in _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS for token in tokens):
            score += 8
        if "代表著作" in normalized_statement or "主要著作" in normalized_statement:
            score += 4
        if re.search(r"^(19|20)\d{2}年", normalized_statement):
            score -= 3
    return score


def _is_official_web_notice_query(*, query_text: str, source: EvidenceSource) -> bool:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    return any(
        token in normalized_query or token in normalized_title
        for token in _OFFICIAL_WEB_NOTICE_QUERY_HINTS
    )


def _is_official_web_reference_query(*, query_text: str, source: EvidenceSource) -> bool:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    if any(token in normalized_query or token in normalized_title for token in _OFFICIAL_WEB_REFERENCE_QUERY_HINTS):
        return True
    return normalized_title in _OFFICIAL_WEB_REFERENCE_PAGE_TITLES and query_targets_source_title(
        query_text=query_text,
        source=source,
    )


def _official_web_answer_mode(*, query_text: str, source: EvidenceSource) -> str:
    normalized_query = _normalize_snippet(query_text)
    normalized_title = _normalize_snippet(source.source_title)
    if _is_official_web_notice_query(query_text=query_text, source=source):
        return "notice"
    if any(token in normalized_query or token in normalized_title for token in _OFFICIAL_WEB_ROSTER_QUERY_HINTS):
        return "roster"
    if _is_official_web_reference_query(query_text=query_text, source=source):
        return "reference"
    if any(token in normalized_query or token in normalized_title for token in _OFFICIAL_WEB_NEWS_QUERY_HINTS):
        return "news"
    return "generic"


def _split_official_web_sentences(text: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(text)
    if not normalized:
        return ()
    sentences: list[str] = []
    for raw_line in re.split(r"[\r\n]+", normalized):
        line = _normalize_snippet(raw_line).strip("；;")
        if not line:
            continue
        parts = re.split(r"[。！？?!]", line)
        if len(parts) == 1:
            parts = [line]
        for part in parts:
            sentence = _normalize_snippet(part).strip("；;，, ")
            if sentence:
                sentences.append(sentence)
    return tuple(sentences)


def _looks_like_official_web_heading(sentence: str) -> bool:
    normalized = _normalize_snippet(sentence)
    if len(normalized) > 18:
        return False
    if any(
        token in normalized
        for token in (
            "中央民族大学",
            "现任",
            "服务",
            "电话",
            "公众号",
            "基金会",
            "校友会",
            "双一流",
            "民族团结进步促进法",
            "统战新语",
            "强世功",
            "查显友",
        )
    ):
        return False
    return "：" not in normalized and "，" not in normalized and "、" not in normalized


def _looks_like_official_web_prompt_sentence(sentence: str) -> bool:
    normalized = _normalize_snippet(sentence)
    return any(token in normalized for token in ("承载着怎样", "将如何", "何以", "为何"))


def _flatten_official_web_sentences(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    *,
    lead_title: str,
) -> tuple[str, ...]:
    normalized_title = _normalize_snippet(lead_title)
    ignored = {normalized_title}
    if normalized_title:
        ignored.add(f"中央民族大学{normalized_title}")
    flattened: list[str] = []
    seen: set[str] = set()
    for _, statements in selected_rows:
        for statement in statements:
            for sentence in _split_official_web_sentences(statement):
                normalized = _normalize_snippet(sentence)
                if (
                    not normalized
                    or normalized in ignored
                    or _looks_like_official_web_low_value_tail(normalized)
                    or _looks_like_official_web_prompt_sentence(normalized)
                    or _looks_like_official_web_heading(normalized)
                    or any(token in normalized for token in _OFFICIAL_WEB_DISCLAIMER_HINTS)
                ):
                    continue
                key = normalized.lower()
                if key in seen:
                    continue
                seen.add(key)
                flattened.append(normalized)
    return tuple(flattened)


def _first_matching_official_web_sentence(
    sentences: tuple[str, ...],
    predicate,
) -> str:
    for sentence in sentences:
        if predicate(sentence):
            return sentence
    return ""


def _simplify_school_intro_sentence(sentence: str) -> str:
    if not sentence:
        return ""
    simplified = sentence.replace("中央民族大学是党和国家为", "中央民族大学是一所为")
    simplified = simplified.replace("、促进中华民族大团结", "")
    simplified = simplified.replace("的一所特色鲜明的高等院校", "创建的特色鲜明高等院校")
    return simplified


def _simplify_school_origin_sentence(sentence: str) -> str:
    if not sentence:
        return ""
    simplified = sentence.replace("学校前身是中国共产党", "前身是")
    simplified = simplified.replace("学校前身是", "前身是")
    simplified = re.sub(r"前身是(\d{4})年\d{1,2}月在延安创办的延安民族学院", r"前身是\1年在延安创办的延安民族学院", simplified)
    return simplified


def _build_official_web_school_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    intro = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "中央民族大学" in sentence and "是一所" in sentence,
    )
    origin = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "前身" in sentence or "延安民族学院" in sentence,
    )
    prestige = _first_matching_official_web_sentence(sentences, lambda sentence: "双一流" in sentence)
    fragments: list[str] = []
    if intro:
        fragments.append(_simplify_school_intro_sentence(intro))
    if origin:
        fragments.append(_simplify_school_origin_sentence(origin))
    if prestige:
        fragments.append("中央民族大学现为国家“双一流”建设高校")
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_school_overview_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    campus = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "三个校区" in sentence or ("海淀" in sentence and "丰台" in sentence),
    )
    discipline = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "12个学科门类" in sentence or "71个本科专业" in sentence,
    )
    if not discipline:
        discipline = _first_matching_official_web_sentence(
            sentences,
            lambda sentence: "多学科门类齐全" in sentence or "综合性大学" in sentence,
        )

    fragments: list[str] = []
    if campus:
        fragments.append(campus)
    if discipline:
        if "12个学科门类" in discipline and "71个本科专业" in discipline:
            fragments.append("学校现有覆盖12个学科门类的71个本科专业")
        else:
            fragments.append(discipline)
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_undergraduate_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    scale = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "本科专业" in sentence and "在招专业" in sentence,
    )
    excellence = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "强基计划" in sentence or "一流本科专业" in sentence,
    )
    fragments: list[str] = []
    if scale:
        fragments.append("学校现有本科专业71个，在招专业61个，涵盖11个学科门类")
    if excellence:
        fragments.append(excellence.replace("，覆盖了全校所有学院", ""))
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_postdoctoral_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    stations = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "6个博士后科研流动站" in sentence,
    )
    assessment = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "合格率均为100" in sentence or "优秀博士后流动站" in sentence,
    )
    fragments: list[str] = []
    if stations:
        fragments.append(
            "学校现有6个博士后科研流动站，覆盖民族学、社会学、中国少数民族语言文学、中国史、哲学、教育学"
        )
    if assessment:
        fragments.append("历次流动站评估合格率均为100％，其中民族学流动站获评“优秀博士后流动站”")
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_graduate_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    discipline = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "12个学科门类" in sentence,
    )
    authorization = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "24个研究生招生培养单位" in sentence,
    )
    fragments: list[str] = []
    if discipline:
        fragments.append("学校研究生教育涵盖12个学科门类")
    if authorization:
        fragments.append(
            "现有24个研究生招生培养单位，10个博士一级学科授权点、4个博士专业学位授权类别、28个硕士一级学科授权点和26个硕士专业学位授权类别"
        )
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_alumni_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    service = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: _OFFICIAL_WEB_SERVICE_TRIAD in sentence,
    )
    if not service:
        return ()
    return (
        "中央民族大学校友会简介以服务校友、服务母校、服务社会为主要方向",
    )


def _build_official_web_foundation_reference_fragments(sentences: tuple[str, ...]) -> tuple[str, ...]:
    governance = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "理事长" in sentence and "秘书长" in sentence,
    )
    fragments: list[str] = []
    if governance:
        simplified = re.sub(r"（[^）]+）", "", governance)
        if not simplified.startswith("中央民族大学教育基金会"):
            simplified = f"中央民族大学教育基金会{simplified}"
        fragments.append(simplified)
    public_account = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "官方微信公众号" in sentence,
    )
    if public_account:
        value = public_account.split("：", 1)[-1].strip()
        if value:
            fragments.append(f"官方微信公众号为{value}")
    return tuple(fragment for fragment in fragments if fragment)


def _official_web_section_path(source: EvidenceSource) -> tuple[str, ...]:
    raw_section_path = source.anchor.get("section_path") if isinstance(source.anchor, dict) else None
    if not isinstance(raw_section_path, (list, tuple)):
        return ()
    normalized = tuple(
        _normalize_snippet(str(item))
        for item in raw_section_path
        if _normalize_snippet(str(item))
    )
    return normalized


def _extract_official_web_scholar_name(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> str:
    title = _normalize_snippet(source.source_title)
    section_path = _official_web_section_path(source)
    if section_path:
        leaf = section_path[-1]
        if leaf and leaf != title:
            return leaf
    for item in reversed(source.structural_path):
        candidate = _normalize_snippet(item)
        if candidate and candidate != title:
            return candidate
    for statement in statements:
        name = _extract_leading_person_name(statement)
        if name:
            return name
    return ""


def _extract_official_web_scholar_domains(statements: tuple[str, ...]) -> tuple[str, ...]:
    combined = _normalize_snippet(" ".join(statements))
    if not combined:
        return ()
    domains: list[str] = []
    for label, tokens in _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS:
        if any(token in combined for token in tokens):
            domains.append(label)
    return tuple(domains)


def _build_official_web_scholar_reference_fragments(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    names: list[str] = []
    domains: list[str] = []
    for source, statements in selected_rows:
        name = _extract_official_web_scholar_name(source, statements)
        if name and name not in names:
            names.append(name)
        for domain in _extract_official_web_scholar_domains(statements):
            if domain not in domains:
                domains.append(domain)

    fragments: list[str] = []
    if names:
        fragments.append(f"“学术名流”页列有{'、'.join(names[:3])}等代表学者")
    if domains:
        fragments.append(f"涵盖{'、'.join(domains[:3])}等方向")
    return tuple(fragment for fragment in fragments if fragment)


def _extract_leading_person_name(text: str) -> str:
    candidate = _normalize_snippet(text)
    candidate = candidate.split("，", 1)[0]
    candidate = candidate.split("。", 1)[0]
    candidate = candidate.split("/", 1)[-1].strip()
    match = re.match(r"(?P<name>[\u4e00-\u9fff·]{2,4})(?:\s+(?P=name))?$", candidate)
    return match.group("name") if match else ""


def _simplify_official_web_school_role(role_text: str) -> str:
    normalized = _normalize_snippet(role_text)
    if "中央民族大学" in normalized:
        normalized = normalized[normalized.rfind("中央民族大学") + len("中央民族大学") :]
    normalized = normalized.strip("，,、 ")
    return normalized


def _extract_official_web_roster_entry(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if "现任" not in normalized:
        return ""
    leading_sentence = normalized.split("。", 1)[0]
    name = _extract_leading_person_name(leading_sentence)
    role_text = _simplify_official_web_school_role(
        normalized.split("现任", 1)[-1].split("。", 1)[0].strip()
    )
    if not name or not role_text:
        return ""
    return f"{role_text}{name}"


def _build_official_web_roster_fragments(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    entries: list[str] = []
    for _, statements in selected_rows:
        for statement in statements:
            entry = _extract_official_web_roster_entry(statement)
            if not entry or entry in entries:
                continue
            entries.append(entry)
            if len(entries) >= 3:
                break
        if len(entries) >= 3:
            break
    if not entries:
        return ()
    return (f"现任领导包括{'、'.join(entries)}",)


def _simplify_official_web_news_sentence(sentence: str) -> str:
    normalized = _normalize_snippet(sentence)
    if "“统战新语”" in normalized and "专访" in normalized:
        normalized = normalized[normalized.find("“统战新语”") :]
        normalized = normalized.replace("就此专访", "专访")
    return normalized


def _summarize_official_web_news_title(title: str) -> str:
    normalized = _normalize_snippet(title)
    if not normalized:
        return ""
    if "专访" in normalized and "解读" in normalized and "强世功" in normalized:
        simplified = normalized.replace("校长", "")
        if "接受" in simplified and " 解读" in simplified:
            left, right = simplified.split(" 解读", 1)
            return f"{left}，解读{right}"
    return ""


def _build_official_web_news_fragments(
    sentences: tuple[str, ...],
    *,
    lead_title: str,
) -> tuple[str, ...]:
    interview = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "专访" in sentence and "强世功" in sentence,
    )
    thesis = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "国家意志" in sentence or "法治保障" in sentence,
    )
    fragments: list[str] = []
    if interview:
        fragments.append(_simplify_official_web_news_sentence(interview))
    if thesis:
        fragments.append(_simplify_official_web_news_sentence(thesis))
    law_anchor = _first_matching_official_web_sentence(
        sentences,
        lambda sentence: "民族团结进步促进法" in sentence,
    )
    if law_anchor and not any("民族团结进步促进法" in fragment for fragment in fragments):
        fragments.insert(0, _simplify_official_web_news_sentence(law_anchor))
    title_fragment = _summarize_official_web_news_title(lead_title)
    if title_fragment and not any("民族团结进步促进法" in fragment for fragment in fragments):
        fragments.insert(0, title_fragment)
    elif title_fragment and not any("统战新语" in fragment and "强世功" in fragment for fragment in fragments):
        fragments.insert(0, title_fragment)
    return tuple(fragment for fragment in fragments if fragment)


def _build_official_web_generic_fragments(
    sentences: tuple[str, ...],
) -> tuple[str, ...]:
    fragments: list[str] = []
    for sentence in sentences:
        if any(token in sentence for token in _OFFICIAL_WEB_SLOGAN_HINTS):
            continue
        fragments.append(sentence)
        if len(fragments) >= 2:
            break
    return tuple(fragments)


def _compose_official_web_reference_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    normalized_title = _normalize_snippet(lead_title)
    if normalized_title == "学术名流":
        fragments = _build_official_web_scholar_reference_fragments(selected_rows)
    else:
        sentences = _flatten_official_web_sentences(selected_rows, lead_title=lead_title)
        if not sentences:
            return ""
        if "学校简介" in normalized_title:
            fragments = _build_official_web_school_reference_fragments(sentences)
        elif "学校概况" in normalized_title:
            fragments = _build_official_web_school_overview_fragments(sentences)
        elif normalized_title == "本科培养":
            fragments = _build_official_web_undergraduate_reference_fragments(sentences)
        elif normalized_title == "博士后":
            fragments = _build_official_web_postdoctoral_reference_fragments(sentences)
        elif normalized_title == "研究生培养":
            fragments = _build_official_web_graduate_reference_fragments(sentences)
        elif "校友会" in normalized_title:
            fragments = _build_official_web_alumni_reference_fragments(sentences)
        elif "基金会" in normalized_title:
            fragments = _build_official_web_foundation_reference_fragments(sentences)
        else:
            fragments = _build_official_web_generic_fragments(sentences)

    if not fragments:
        return ""

    citation = _format_source_citation(tuple(source for source, _ in selected_rows))
    body = "；".join(fragments)
    if citation:
        return f"{_answer_prefix(evidence)}，{body} {citation}"
    return f"{_answer_prefix(evidence)}，{body}"


def _compose_official_web_roster_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    fragments = _build_official_web_roster_fragments(selected_rows)
    if not fragments:
        return ""
    citation = _format_source_citation(tuple(source for source, _ in selected_rows))
    body = "；".join(fragments)
    if citation:
        return f"{_answer_prefix(evidence)}，{body} {citation}"
    return f"{_answer_prefix(evidence)}，{body}"


def _compose_official_web_news_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    sentences = _flatten_official_web_sentences(selected_rows, lead_title=lead_title)
    fragments = _build_official_web_news_fragments(sentences, lead_title=lead_title)
    if not fragments:
        fragments = _build_official_web_generic_fragments(sentences)
    if not fragments:
        return ""
    citation = _format_source_citation(tuple(source for source, _ in selected_rows))
    body = "；".join(fragments)
    if citation:
        return f"{_answer_prefix(evidence)}，{body} {citation}"
    return f"{_answer_prefix(evidence)}，{body}"


def _extract_official_web_labeled_value(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if "：" in normalized:
        normalized = normalized.split("：", 1)[-1]
    normalized = re.sub(r"\b时间[:：]\s*", "", normalized)
    normalized = normalized.replace("——", "—")
    return _normalize_snippet(normalized)


def _compose_official_web_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    lead_source = selected_rows[0][0]
    mode = _official_web_answer_mode(query_text=evidence.query_text, source=lead_source)
    if mode == "roster":
        return _compose_official_web_roster_answer(evidence=evidence, selected_rows=selected_rows)
    if mode == "reference":
        return _compose_official_web_reference_answer(evidence=evidence, selected_rows=selected_rows)
    if mode == "news":
        return _compose_official_web_news_answer(evidence=evidence, selected_rows=selected_rows)
    if mode != "notice":
        return ""

    topic = ""
    time_statement = ""
    location_statement = ""
    extra_statements: list[str] = []
    for _, statements in selected_rows:
        for statement in statements:
            normalized = _normalize_snippet(statement)
            if not normalized or _looks_like_official_web_low_value_tail(normalized):
                continue
            if not time_statement and any(token in normalized for token in _OFFICIAL_WEB_NOTICE_TIME_HINTS):
                time_statement = normalized
                continue
            if not location_statement and any(token in normalized for token in _OFFICIAL_WEB_NOTICE_LOCATION_HINTS):
                location_statement = normalized
                continue
            if not topic and any(token in normalized for token in _OFFICIAL_WEB_NOTICE_TOPIC_HINTS):
                topic = _normalize_official_web_topic(normalized)
                continue
            if normalized not in extra_statements:
                extra_statements.append(normalized)

    fragments: list[str] = []
    if topic:
        fragments.append(f"讲座主题为{topic}")
    elif extra_statements:
        fragments.append(extra_statements[0])
    if time_statement:
        value = _extract_official_web_labeled_value(time_statement)
        fragments.append(f"讲座时间为{value}" if value else time_statement)
    else:
        fragments.append("当前片段未提供讲座时间")
    if location_statement:
        value = _extract_official_web_labeled_value(location_statement)
        fragments.append(f"讲座地点为{value}" if value else location_statement)

    citation = _format_source_citation(tuple(source for source, _ in selected_rows))
    body = "；".join(fragment for fragment in fragments if fragment)
    if not body:
        return ""
    if citation:
        return f"{_answer_prefix(evidence)}，{body} {citation}"
    return f"{_answer_prefix(evidence)}，{body}"


def _normalize_official_web_topic(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if normalized.startswith(("讲座主题：", "活动主题：", "主题：")):
        return normalized.split("：", 1)[-1].strip() or normalized
    return normalized


def _lead_source_title(sources: tuple[EvidenceSource, ...]) -> str:
    if not sources:
        return ""
    explicit_title = _normalize_snippet(sources[0].source_title)
    if explicit_title:
        return explicit_title
    return sources[0].doc_id.split(":", 1)[-1].strip()


def _replace_academic_years_match(match: re.Match[str]) -> str:
    prefix, years = match.groups()
    return f"{prefix}{_arabic_number_to_chinese(years)}年"


def _arabic_number_to_chinese(value: str) -> str:
    numerals = {
        "1": "一",
        "2": "两",
        "3": "三",
        "4": "四",
        "5": "五",
        "6": "六",
        "7": "七",
        "8": "八",
        "9": "九",
    }
    if value in numerals:
        return numerals[value]
    return value


def _answer_prefix(evidence: EvidenceBundle) -> str:
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        return "根据培养方案相关内容"
    if (
        evidence.corpus == "official_web"
        and is_official_web_stable_reference_like_collection(evidence.collection)
    ):
        return "根据官网页面内容"
    return "根据学生手册相关规定"
