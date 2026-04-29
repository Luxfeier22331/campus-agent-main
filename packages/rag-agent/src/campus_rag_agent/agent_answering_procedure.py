from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_answering_generic import _compose_generic_answer
from .agent_selection_query import _CJK_SEGMENT_RE, _PROCEDURE_QUERY_HINTS
from .agent_shared import _answer_prefix, _normalize_snippet

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

    return f"{_answer_prefix(evidence)}，{_procedure_intro(evidence.query_text)}{'；'.join(step_fragments)}"


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
    return _normalize_snippet(normalized).strip("；，。 ")


def _classify_procedure_fragment(fragment: str) -> str:
    normalized = _normalize_snippet(fragment)
    if not normalized or any(token in normalized for token in _PROCEDURE_SIDE_NOTE_HINTS):
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
    return "" if not compact else "，".join(dict.fromkeys(compact))


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


__all__ = ["_compose_procedure_answer"]
