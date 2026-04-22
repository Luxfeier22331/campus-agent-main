from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.evidence_ranking import (
    query_targets_source_title,
    select_supporting_evidence_sources,
)

from .agent_curriculum import (
    _compose_curriculum_lookup_answer,
    _compose_curriculum_semester_course_list_answer,
    _extract_curriculum_semester_scoped_statements,
    _is_curriculum_course_list_query,
    _is_curriculum_course_row,
    _is_curriculum_lookup_query,
    _is_curriculum_semester_course_list_query,
    _is_curriculum_table_heading,
)
from .agent_official_web import (
    _OFFICIAL_WEB_IGNORED_CONTENT_ROLES,
    _compose_official_web_answer,
    _extract_official_web_scholar_domains,
    _extract_official_web_scholar_name,
    _flatten_official_web_sentences,
    _is_official_web_reference_query,
    _is_official_web_source,
    _normalize_official_web_statement_line,
    _score_official_web_statement,
)
from .agent_shared import (
    _answer_prefix,
    _lead_source_title,
    _normalize_snippet,
    _render_source_support,
    _replace_academic_years_match,
)

DEFAULT_MAX_ANSWER_SOURCES = 3
_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_CJK_SEGMENT_RE = re.compile(r"[\u4e00-\u9fff]+")
_LEADING_ENUM_RE = re.compile(r"^(?:[0-9]{1,2}[.、]\s*|[一二三四五六七八九十百]+[、.]\s*)")
_PROCEDURE_QUERY_HINTS = (
    "怎么办",
    "如何",
    "怎么",
    "办理",
    "申请",
    "流程",
    "补办",
    "手续",
    "replace",
)
_NON_PROCEDURE_REQUIREMENT_QUERY_HINTS = ("怎么要求", "如何要求", "怎么规定", "如何规定")
_TIME_QUERY_HINTS = (
    "时间",
    "几点",
    "多久",
    "几年",
    "哪天",
    "学制",
    "照明",
    "熄灯",
    "亮灯",
    "hours",
)
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
_PROCEDURE_TIME_HINTS = (
    "时间",
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
)


@dataclass(frozen=True, slots=True)
class AnswerDraft:
    answer_text: str
    supporting_sources: tuple[EvidenceSource, ...]
    supporting_contexts: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RagAgent:
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
    if _is_curriculum_lookup_query(query_text):
        return "curriculum_lookup"
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
    if _is_curriculum_course_list_query(query_text) and _is_curriculum_course_row(
        source, statement
    ):
        score += 4
    if mode == "procedure":
        score += sum(2 for token in _ACTION_STATEMENT_HINTS if token in normalized)
        if source.content_role == "procedure":
            score += 2
    if mode == "time":
        score += sum(2 for token in _TIME_STATEMENT_HINTS if token in normalized)
        if source.content_role == "time_rule":
            score += 2
        if ("学制" in query_text or "几年" in query_text) and _ACADEMIC_YEARS_FACT_RE.search(
            normalized
        ):
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


def _candidate_source_statements(
    query_text: str, source: EvidenceSource
) -> tuple[tuple[str, ...], bool]:
    scoped_statements = _extract_curriculum_semester_scoped_statements(
        query_text=query_text,
        source=source,
    )
    if scoped_statements is not None:
        return scoped_statements, True
    return _extract_source_statements(source), False


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


def _rank_source_statements(
    query_text: str, source: EvidenceSource, *, mode: str
) -> tuple[str, ...]:
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
    curriculum_lookup_query = _is_curriculum_lookup_query(query_text)
    consumable_sources = tuple(
        source for source in sources if not _should_ignore_official_web_source(source)
    )
    ranked_source_input = consumable_sources or sources
    max_seen_statements = 6 if course_list_query or curriculum_lookup_query else 3
    ranked_sources = (
        tuple(ranked_source_input)
        if course_list_query or curriculum_lookup_query
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
        seen_statements.update(
            _normalize_snippet(statement).lower() for statement in novel_statements
        )
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
        if (
            (course_list_query or curriculum_lookup_query)
            and len(rows) >= 2
            and len(seen_statements) >= 5
        ):
            break
        if (
            index == 0
            and mode == "time"
            and any("学制" in statement for statement in novel_statements)
        ):
            break
        if len(rows) >= max_sources or len(seen_statements) >= max_seen_statements:
            break

    if rows:
        return tuple(rows)

    fallback_source = ranked_sources[0]
    return ((fallback_source, _rank_source_statements(query_text, fallback_source, mode=mode)),)


def _should_ignore_official_web_source(source: EvidenceSource) -> bool:
    return (
        _is_official_web_source(source)
        and source.content_role in _OFFICIAL_WEB_IGNORED_CONTENT_ROLES
    )


def _answer_source_sort_key(
    query_text: str, source: EvidenceSource, *, mode: str
) -> tuple[int, int, int, int]:
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
        has_campus = any(
            "三个校区" in sentence or ("海淀" in sentence and "丰台" in sentence)
            for sentence in sentences
        )
        has_discipline = any(
            "12个学科门类" in sentence or "71个本科专业" in sentence for sentence in sentences
        )
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
        has_excellence = any(
            "强基计划" in sentence or "一流本科专业" in sentence for sentence in sentences
        )
        return has_scale and has_excellence
    if normalized_title == "博士后":
        has_stations = any("博士后科研流动站" in sentence for sentence in sentences)
        has_assessment = any(
            "合格率均为100" in sentence or "优秀博士后流动站" in sentence for sentence in sentences
        )
        return has_stations and has_assessment
    if normalized_title == "研究生培养":
        has_discipline = any("12个学科门类" in sentence for sentence in sentences)
        has_authorization = any(
            "24个研究生招生培养单位" in sentence or "博士一级学科授权点" in sentence
            for sentence in sentences
        )
        return has_discipline and has_authorization
    return True


def _compose_generic_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    fragments = ["；".join(statements) for _, statements in selected_rows if statements]
    if not fragments:
        fragments = [_render_source_support(source) for source, _ in selected_rows]

    answer_prefix = _answer_prefix(evidence)
    supporting_sources = tuple(source for source, _ in selected_rows)
    lead_title = _lead_source_title(supporting_sources)
    topic_label = _query_topic_label(evidence.query_text)
    if lead_title and _normalize_snippet(lead_title) in _normalize_snippet(evidence.query_text):
        return f"{answer_prefix}，《{lead_title}》明确：{'；'.join(fragments)}"
    if topic_label and topic_label not in _normalize_snippet(" ".join(fragments)):
        return f"{answer_prefix}，关于{topic_label}：{'；'.join(fragments)}"
    return f"{answer_prefix}，{'；'.join(fragments)}"


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
    answer_body = "；".join(step_fragments)
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
    if any(
        token in normalized
        for token in ("审批", "备案", "办理补办手续", "学生处办理", "审核", "盖章")
    ):
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
    if evidence.corpus == "official_web" and is_official_web_stable_reference_like_collection(
        evidence.collection
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
