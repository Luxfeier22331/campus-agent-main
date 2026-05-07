from __future__ import annotations

import re

ANSWER_READY_EVIDENCE_CONTRACT_VERSION = "answer_ready_evidence.v1"


def build_answer_ready_contract_metadata(
    *,
    text: str,
    metadata: dict[str, object],
    root_unit_id: str,
) -> dict[str, object]:
    answer_role = _text(metadata.get("answer_role"))
    if not answer_role:
        return {}
    contract: dict[str, object] = {
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        "parent_unit_id": _text(metadata.get("parent_unit_id")) or root_unit_id,
    }
    condition_subject = infer_condition_subject(text=text, metadata=metadata)
    if condition_subject:
        contract["condition_subject"] = condition_subject
    condition_polarity = infer_condition_polarity(metadata=metadata)
    if condition_polarity:
        contract["condition_polarity"] = condition_polarity
    if answer_role == "procedure_step":
        contract.update(build_procedure_step_metadata(text=text, metadata=metadata))
    return contract


def build_category_overview_contract_metadata(
    *,
    category_id: str,
    parent_unit_id: str,
) -> dict[str, object]:
    return {
        "answer_role": "category_overview",
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        "parent_unit_id": parent_unit_id,
        "condition_polarity": "neutral",
        "condition_subject": "audience_scope",
        "category_id": category_id,
    }


def infer_condition_subject(*, text: str, metadata: dict[str, object]) -> str:
    explicit = _text(metadata.get("condition_subject"))
    if explicit:
        return explicit
    answer_role = _text(metadata.get("answer_role"))
    compact = _compact(text)
    if answer_role == "procedure_step":
        return "application_procedure"
    if answer_role == "exclusion_rule" and "处分" in compact:
        return "discipline_relief_exclusion"
    if any(marker in compact for marker in ("排名", "前10%", "前30%", "综合测评")):
        return "rank_threshold"
    if any(marker in compact for marker in ("论文", "发表", "学术研究", "专利", "竞赛")):
        return "paper_or_publication"
    if any(marker in compact for marker in ("证明材料", "申请材料", "提交材料", "材料")):
        return "material_requirement"
    if any(marker in compact for marker in ("截止", "期限", "公示", "不少于", "每周", "时间")):
        return "deadline"
    if any(marker in compact for marker in ("本科", "预科", "学生", "年级", "专业")):
        return "audience_scope"
    if answer_role in {"eligibility_condition", "exception_rule"}:
        return "generic_condition"
    return ""


def infer_condition_polarity(*, metadata: dict[str, object]) -> str:
    explicit = _text(metadata.get("condition_polarity"))
    if explicit:
        return explicit
    answer_role = _text(metadata.get("answer_role"))
    if answer_role == "exclusion_rule":
        return "negative"
    if answer_role == "exception_rule":
        return "positive"
    polarity = _text(metadata.get("polarity"))
    if polarity:
        return polarity
    if answer_role in {
        "eligibility_condition",
        "example_evidence",
        "procedure_step",
    }:
        return "positive"
    if answer_role in {"category_overview", "policy_list", "supporting_detail"}:
        return "neutral"
    return ""


def build_procedure_step_metadata(*, text: str, metadata: dict[str, object]) -> dict[str, object]:
    compact = _compact(text)
    step_index = _procedure_step_index(metadata=metadata, text=text)
    actor = _procedure_actor(compact)
    action = _procedure_action(compact)
    result: dict[str, object] = {}
    if step_index is not None:
        result["procedure_step_index"] = step_index
    if actor:
        result["procedure_actor"] = actor
    if action:
        result["procedure_action"] = action
    materials = _procedure_materials(compact)
    if materials:
        result["procedure_materials"] = materials
    next_actor = _procedure_next_actor(compact)
    if next_actor:
        result["procedure_next_actor"] = next_actor
    return result


def _procedure_step_index(*, metadata: dict[str, object], text: str) -> int | None:
    explicit = metadata.get("procedure_step_index")
    if isinstance(explicit, int) and not isinstance(explicit, bool):
        return explicit
    for value in (
        _text(metadata.get("provision_label")),
        _text(metadata.get("item_label")),
        text.strip(),
    ):
        if not value:
            continue
        match = re.match(r"^\s*(?:[（(])?(?P<number>\d+)", value)
        if match:
            return int(match.group("number"))
    return None


def _procedure_actor(compact: str) -> str:
    if "学生本人" in compact or "学生" in compact:
        return "student"
    if "学院" in compact or "院系" in compact:
        return "college"
    if "教务处" in compact:
        return "academic_affairs_office"
    if "学生处" in compact:
        return "student_affairs_office"
    return ""


def _procedure_action(compact: str) -> str:
    if "提交" in compact and "申请" in compact:
        return "submit_application"
    if "审核" in compact:
        return "review"
    if "公示" in compact:
        return "publish_notice"
    if "挂失" in compact:
        return "report_loss"
    if "办理" in compact:
        return "process"
    if "申请" in compact:
        return "apply"
    return "procedure_step"


def _procedure_materials(compact: str) -> list[str]:
    materials: list[str] = []
    for marker in ("申请材料", "证明材料", "书面申请", "补办申请表", "解除处分申请表"):
        if marker in compact:
            materials.append(marker)
    return materials


def _procedure_next_actor(compact: str) -> str:
    if "学院" in compact or "院系" in compact:
        return "college"
    if "教务处" in compact:
        return "academic_affairs_office"
    if "学生处" in compact:
        return "student_affairs_office"
    return ""


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value.strip())


__all__ = [
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    "build_answer_ready_contract_metadata",
    "build_category_overview_contract_metadata",
    "build_procedure_step_metadata",
    "infer_condition_polarity",
    "infer_condition_subject",
]
