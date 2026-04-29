from __future__ import annotations

import re

from .grounding_validation_claim_patterns import _AUDIENCE_SPLIT_RE


def _normalize_material_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^(?:并|再|后|先|及时)", "", normalized)
    normalized = re.sub(r"^(?:提交|填写|携带|提供|准备)", "", normalized)
    return normalized.strip("，,；;：:。 ")


def _normalize_procedure_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^(?:并|再|后|先|及时)", "", normalized)
    normalized = re.sub(r"^(?:办理|进行|完成|到|向|经|由)", "", normalized)
    normalized = normalized.strip("，,；;：:。 ")
    if normalized == "办理挂失":
        return "挂失"
    return normalized


def _normalize_offering_unit_claim(claim: str) -> str:
    normalized = claim.strip("，,；;：:。 ")
    normalized = re.sub(r"^.*(?:由|是)", "", normalized)
    normalized = re.sub(r"^(?:这门课|本课|该课|课程)", "", normalized)
    return normalized.strip("，,；;：:。 ")


def _expand_audience_claim(raw_claim: str) -> tuple[str, ...]:
    normalized = raw_claim.strip("，,；;：:。 ")
    normalized = re.sub(
        r"等(?=(?:专业|本预科学生|本科生|研究生|学生|民族班|实验班|基地班)$)",
        "",
        normalized,
    )
    if not normalized:
        return ()

    suffix = _resolve_audience_suffix(normalized)
    parts = [
        part.strip("，,；;：:。 ")
        for part in _AUDIENCE_SPLIT_RE.split(normalized)
        if part.strip("，,；;：:。 ")
    ]
    if len(parts) <= 1:
        return (normalized,)

    expanded: list[str] = []
    for part in parts:
        cleaned = re.sub(r"^(?:面向|适用于|适用对象为|针对)", "", part).strip("，,；;：:。 ")
        cleaned = re.sub(
            r"等(?=(?:专业|本预科学生|本科生|研究生|学生|民族班|实验班|基地班)$)",
            "",
            cleaned,
        )
        if suffix and not cleaned.endswith(suffix):
            cleaned = f"{cleaned}{suffix}"
        if cleaned:
            expanded.append(cleaned)
    return tuple(dict.fromkeys(expanded))


def _resolve_audience_suffix(claim: str) -> str:
    for suffix in ("本预科学生", "本科生", "研究生", "学生", "民族班", "实验班", "基地班", "专业"):
        if claim.endswith(suffix):
            return suffix
    return ""


__all__ = [
    "_expand_audience_claim",
    "_normalize_material_claim",
    "_normalize_offering_unit_claim",
    "_normalize_procedure_claim",
    "_resolve_audience_suffix",
]
