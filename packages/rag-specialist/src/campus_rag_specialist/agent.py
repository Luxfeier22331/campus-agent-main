from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query
from campus_retrieval_core.evidence_ranking import select_supporting_evidence_sources


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
    max_seen_statements = 6 if course_list_query else 3
    ranked_sources = (
        tuple(sources)
        if course_list_query
        else tuple(
            sorted(
                sources,
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
        if not course_list_query and index == 0 and len(novel_statements) >= 2:
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
    if _is_curriculum_semester_course_list_query(evidence.query_text):
        semester_course_list_answer = _compose_curriculum_semester_course_list_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if semester_course_list_answer:
            return semester_course_list_answer
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
    return "根据学生手册相关规定"
