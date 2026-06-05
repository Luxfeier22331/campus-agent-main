from __future__ import annotations

import re

from campus_regulation_semantics.regulation_semantic_registry import (
    resolve_regulation_procedure_action,
    resolve_regulation_procedure_actor,
)

from .regulation_chunking_answer_ready_support import _answer_role
from .regulation_chunking_shared import (
    _ARTICLE_PREFIXED_ITEM_RE,
    _GENERIC_ITEM_RE,
    _PROCEDURE_TAIL_SPLIT_RE,
)


def _mixed_procedure_split_pair(
    *,
    text: str,
    prefix_text: str,
) -> tuple[str, str] | None:
    candidates: list[tuple[str, str]] = []
    overall_role = _answer_role(text=text, prefix_text=prefix_text, role_hint=None)
    match = _PROCEDURE_TAIL_SPLIT_RE.search(text)
    if match is not None:
        candidates.append(
            (
                match.group("head").strip().rstrip("；;"),
                match.group("tail").strip(),
            )
        )
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        if char not in "，,；;。":
            continue
        if char in "，," and _has_unclosed_parenthetical_prefix(text[:index]):
            continue
        head_text = text[:index].strip().rstrip("，,；;。 ")
        tail_text = text[index + 1 :].strip()
        if head_text and tail_text:
            candidates.append((head_text, tail_text))

    seen: set[tuple[str, str]] = set()
    for head_text, tail_text in candidates:
        candidate = (head_text, tail_text)
        if candidate in seen:
            continue
        seen.add(candidate)
        head_role = _answer_role(text=head_text, prefix_text=prefix_text, role_hint=None)
        tail_role = _answer_role(text=tail_text, prefix_text=prefix_text, role_hint=None)
        if head_role in {"eligibility_condition", "exception_rule", "exclusion_rule"} and (
            tail_role == "procedure_step"
            or _has_leading_procedure_step_sentence(text=tail_text, prefix_text=prefix_text)
        ):
            if overall_role == "procedure_step" and _looks_like_short_structural_heading(head_text):
                continue
            return candidate
    return None


def _looks_like_short_structural_heading(text: str) -> bool:
    normalized = text.strip().rstrip("。；;：:，,、 ")
    if not normalized:
        return False
    match = _ARTICLE_PREFIXED_ITEM_RE.match(normalized) or _GENERIC_ITEM_RE.match(normalized)
    if match is not None:
        normalized = normalized[match.end("label") :].strip().rstrip("。；;：:，,、 ")
    if not normalized or len(normalized) > 8:
        return False
    if any(
        marker in normalized
        for marker in (
            "符合",
            "达到",
            "达标",
            "具备",
            "须",
            "应",
            "应当",
            "需",
            "需要",
            "必须",
            "不得",
            "不能",
            "不予",
            "未",
            "前",
            "后",
            "时",
            "以上",
            "以下",
            "不少于",
            "不超过",
        )
    ):
        return False
    return bool(re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9]{1,8}", normalized))


def _has_unclosed_parenthetical_prefix(text: str) -> bool:
    depth = 0
    for char in text:
        if char in "（(":
            depth += 1
            continue
        if char in "）)" and depth > 0:
            depth -= 1
    return depth > 0


def _has_leading_procedure_step_sentence(*, text: str, prefix_text: str) -> bool:
    if _looks_like_structural_procedure_tail(text=text, prefix_text=prefix_text):
        return True
    for index, char in enumerate(text):
        if char not in "。；;":
            continue
        leading_text = text[: index + 1].strip()
        remainder_text = text[index + 1 :].strip()
        if not leading_text:
            continue
        if not _looks_like_structural_procedure_tail(text=leading_text, prefix_text=prefix_text):
            continue
        if not remainder_text:
            return True
        if _answer_role(text=remainder_text, prefix_text=prefix_text, role_hint=None) in {
            "supporting_detail",
            "procedure_step",
        }:
            return True
    return False


def _looks_like_structural_procedure_tail(*, text: str, prefix_text: str) -> bool:
    if _answer_role(text=text, prefix_text=prefix_text, role_hint=None) == "procedure_step":
        return True
    if any(marker in text for marker in ("不合格", "未通过", "不予", "不得", "不能", "取消资格")):
        return False
    if not any(
        marker in text
        for marker in (
            "提交",
            "申请",
            "提出",
            "填写",
            "报送",
            "上报",
            "备案",
            "审核",
            "审批",
            "审查",
            "审定",
            "核准",
            "签署意见",
            "受理",
            "办理",
            "协调",
            "答复",
            "公示",
            "挂失",
            "补办",
            "补发",
            "申诉",
            "听证",
            "发放",
            "拨付",
            "研究决定",
            "考评",
            "接入校园网",
        )
    ):
        return False
    actor_assignment = resolve_regulation_procedure_actor(text=text)
    action_assignment = resolve_regulation_procedure_action(
        text=text,
        actor=actor_assignment.value,
    )
    return action_assignment.value in {
        "apply",
        "review",
        "college_review",
        "office_review",
        "submit_materials",
        "process",
        "publish_notice",
        "disburse",
        "report_loss",
        "reissue",
    }
