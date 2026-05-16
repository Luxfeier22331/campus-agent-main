from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source

from .agent_answering_generic import _compose_generic_answer
from .agent_selection_query import _CJK_SEGMENT_RE, _PROCEDURE_QUERY_HINTS
from .agent_shared import _answer_prefix, _normalize_snippet

_PROCEDURE_SIDE_NOTE_HINTS = (
    "优惠卡",
    "检测",
    "充值",
    "销毁",
    "转借",
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


def _compose_procedure_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    query_text: str = "",
) -> str:
    answer_query_text = query_text.strip() or evidence.query_text
    typed_steps_answer = _compose_typed_procedure_steps_answer(
        evidence=evidence,
        selected_rows=selected_rows,
        query_text=answer_query_text,
    )
    if typed_steps_answer:
        return typed_steps_answer
    procedure_parts = _build_procedure_answer_parts(selected_rows)
    if not procedure_parts:
        return _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)

    core_steps = [part for part in procedure_parts[:3] if part]
    if len(core_steps) == 1 and _is_single_appeal_deadline_action(core_steps[0]):
        return _compose_single_appeal_deadline_answer(
            query_text=answer_query_text,
            action=core_steps[0],
            prefix=_answer_prefix(evidence),
        )
    step_fragments: list[str] = []
    for index, fragment in enumerate(core_steps):
        if len(core_steps) == 1 or (
            index == 0 and fragment.startswith(("可以", "应", "须", "需", "必须"))
        ):
            step_fragments.append(fragment)
        elif index == 0:
            step_fragments.append(f"先{fragment}")
        elif index == 1:
            step_fragments.append(f"再{fragment}")
        else:
            step_fragments.append(fragment)
    if procedure_parts[3]:
        step_fragments.append(procedure_parts[3])
    if not step_fragments:
        return _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)

    return f"{_answer_prefix(evidence)}，{_procedure_intro(answer_query_text)}{'；'.join(step_fragments)}"


def _compose_typed_procedure_steps_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    query_text: str,
) -> str:
    typed_rows = tuple(
        (source, statements)
        for source, statements in selected_rows
        if evidence_attributes_for_source(source).procedure.step_index is not None
    )
    if len(typed_rows) < 2:
        return ""
    rendered_steps: list[str] = []
    for source, statements in sorted(
        typed_rows,
        key=lambda row: evidence_attributes_for_source(row[0]).procedure.step_index or 0,
    ):
        statement = next(
            (
                _normalize_typed_procedure_statement(item)
                for item in statements
                if _normalize_typed_procedure_statement(item)
            ),
            "",
        )
        if not statement:
            continue
        step_index = evidence_attributes_for_source(source).procedure.step_index
        rendered_steps.append(f"{step_index}. {statement}")
    if not rendered_steps:
        return ""
    return f"{_answer_prefix(evidence)}，{_procedure_intro(query_text)}{'；'.join(rendered_steps)}"


def _normalize_typed_procedure_statement(statement: str) -> str:
    normalized = _strip_procedure_metadata_prefix(statement)
    normalized = re.sub(r"^[0-9]+[、.．]\s*", "", normalized)
    return _normalize_snippet(normalized).strip("；，。 ")


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
            compound_fragments = _extract_compound_procedure_fragments(statement)
            for full_fragment in compound_fragments:
                normalized_full_fragment = _normalize_snippet(full_fragment).lower()
                if normalized_full_fragment in seen_fragments:
                    continue
                seen_fragments.add(normalized_full_fragment)
                immediate_actions.append(full_fragment)
            if compound_fragments:
                continue
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
        if "写明" in fragment:
            step_one_parts.append(fragment)
            used_materials.add(fragment)
            break
    for fragment in approvals:
        if "备案" in fragment:
            step_one_parts.append(fragment)
            used_approvals.add(fragment)
            break

    if second_action:
        step_two_parts.append(second_action)
    for fragment in materials:
        if fragment not in used_materials:
            step_two_parts.append(fragment)
            used_materials.add(fragment)
    for fragment in approvals:
        if fragment not in used_approvals:
            step_two_parts.append(fragment)
            used_approvals.add(fragment)

    if not step_two_parts and materials:
        for fragment in materials:
            if fragment not in used_materials:
                step_two_parts.append(fragment)
                used_materials.add(fragment)
    if not step_two_parts and approvals:
        for fragment in approvals:
            if fragment not in used_approvals:
                step_two_parts.append(fragment)
                used_approvals.add(fragment)

    for fragment in approvals:
        if fragment not in used_approvals:
            step_three_parts.append(fragment)
            used_approvals.add(fragment)

    return (
        _join_procedure_fragments(step_one_parts),
        _join_procedure_fragments(step_two_parts),
        _join_procedure_fragments(step_three_parts),
        time_windows[0] if time_windows else "",
    )


def _extract_compound_procedure_fragments(statement: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    if not normalized:
        return ()
    fragments: list[str] = []
    appeal_match = re.search(
        r"(?:可以在|应在|须在)?[^，,。；;]*?决定书之日起10日内,"
        r"向学校学生申诉处理委员会提出书面申诉",
        normalized,
    )
    if appeal_match is not None:
        fragments.append(appeal_match.group(0).strip(" ，,。；;"))
    return tuple(dict.fromkeys(fragments))


def _is_single_appeal_deadline_action(fragment: str) -> bool:
    normalized = _normalize_snippet(fragment)
    return (
        "决定书之日起10日内" in normalized
        and "学生申诉处理委员会" in normalized
        and "书面申诉" in normalized
    )


def _compose_single_appeal_deadline_answer(
    *,
    query_text: str,
    action: str,
    prefix: str,
) -> str:
    normalized_query = _normalize_snippet(query_text)
    if "处分" in normalized_query and "不服" in normalized_query:
        normalized_action = action.strip().rstrip("。；;")
        if normalized_action.startswith("可以在"):
            normalized_action = "可在" + normalized_action.removeprefix("可以在")
        elif normalized_action.startswith("在"):
            normalized_action = "可在" + normalized_action.removeprefix("在")
        elif normalized_action.startswith("可以"):
            normalized_action = "可" + normalized_action.removeprefix("可以")
        normalized_action = normalized_action.replace("日内,", "日内")
        normalized_action = normalized_action.replace("日内，", "日内")
        return f"如对处分决定不服，{normalized_action}。"
    subject = "申诉时"
    return f"{prefix}，{subject}，{action}"


def _normalize_procedure_fragment(fragment: str) -> str:
    normalized = _normalize_snippet(fragment).strip("；，。 ")
    if not normalized:
        return ""
    normalized = _strip_procedure_metadata_prefix(normalized)
    normalized = normalized.replace("(见附表)", "").replace("（见附表）", "")
    if "申请补办" in normalized:
        normalized = re.sub(r"^学生[^，。；]*?应", "", normalized)
    normalized = re.sub(r"^(应|须|需|必须|并|再|然后)", "", normalized)
    normalized = re.sub(r"^学生(?:补办|遗失|如将)?学生证$", "", normalized)
    normalized = re.sub(r"^遗失或损坏的学生证$", "", normalized)
    return _normalize_snippet(normalized).strip("；，。 ")


def _strip_procedure_metadata_prefix(fragment: str) -> str:
    normalized = _normalize_snippet(fragment)
    normalized = re.sub(
        r"^[^，。；]*?(?:办法|规定|细则|条例|章程)\s+文号[:：][^，。；]*\s*",
        "",
        normalized,
    )
    normalized = re.sub(
        r"^[^，。；]*?(?:办法|规定|细则|条例|章程)\s+(?=[一二三四五六七八九十百0-9]+[、.．])",
        "",
        normalized,
    )
    normalized = re.sub(r"^[一二三四五六七八九十百0-9]+[、.．]\s*", "", normalized)
    return _normalize_snippet(normalized)


def _classify_procedure_fragment(fragment: str) -> str:
    normalized = _normalize_snippet(fragment)
    if not normalized or any(token in normalized for token in _PROCEDURE_SIDE_NOTE_HINTS):
        return ""
    if "挂失" in normalized or "申请补办" in normalized:
        return "immediate_action"
    if "提出书面申诉" in normalized or "书面申诉" in normalized:
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
    return "" if not compact else "，".join(dict.fromkeys(compact))


def _procedure_intro(query_text: str) -> str:
    subject = _normalize_snippet(query_text).strip("。？！? ")
    if not subject:
        return "可按以下步骤处理："
    if "学生证" in subject and any(token in subject for token in ("丢", "遗失", "损坏")):
        return "学生证遗失后可按以下步骤处理："
    if flow_match := re.search(
        r"(?P<subject>[^，,。?？]{1,24})的流程(?:是什么|有哪些|如何|怎么)?", subject
    ):
        flow_subject = _normalize_snippet(flow_match.group("subject")).strip(" ，,。?？")
        if flow_subject:
            return f"{flow_subject}流程："
    for hint in sorted(_PROCEDURE_QUERY_HINTS, key=len, reverse=True):
        subject = subject.replace(hint, "")
    subject = subject.replace("丢了", "丢失").replace("遗失了", "遗失")
    subject = _normalize_snippet(subject).strip("。？！? ")
    if subject.endswith(("丢失", "遗失", "损坏")) and len(subject) <= 10:
        return f"{subject}后可按以下步骤处理："
    if subject and len(subject) <= 8 and _CJK_SEGMENT_RE.search(subject):
        return f"关于{subject}，可按以下步骤处理："
    return "可按以下步骤处理："


__all__ = ["_compose_procedure_answer"]
