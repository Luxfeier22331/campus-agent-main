from __future__ import annotations

import re

from .answer_shared import _normalize_snippet


def compose_material_requirement_answer(
    *,
    query_text: str,
    rows: tuple[tuple[str, str], ...],
) -> str:
    if not _query_asks_material_requirement(query_text) or not rows:
        return ""
    items: list[str] = []
    for statement, _ in rows:
        items.extend(_extract_material_items(statement))
    material_items = tuple(dict.fromkeys(item for item in items if item))
    if not material_items:
        return ""
    subject = _material_requirement_subject(query_text)
    if subject:
        answer = f"{subject}需要提交：" + "、".join(material_items)
    else:
        answer = "需要提交的材料包括：" + "、".join(material_items)
    context_labels = tuple(dict.fromkeys(label for _, label in rows if label))
    if context_labels:
        return f"{answer}。来源：{'；'.join(context_labels)}。"
    return f"{answer}。"


def _query_asks_material_requirement(query_text: str) -> bool:
    normalized = _normalize_snippet(query_text)
    if "材料" not in normalized:
        return False
    return any(cue in normalized for cue in ("提交", "提供", "准备", "哪些", "什么", "需要"))


def _material_requirement_subject(query_text: str) -> str:
    normalized = _normalize_snippet(query_text)
    match = re.search(
        r"(?P<subject>申请[^，,。?？]{1,24}?)(?:需要|需|要|应当|应该|必须|须)?"
        r"(?:提交|提供|准备|哪些|什么)",
        normalized,
    )
    if match is None:
        return ""
    subject = match.group("subject").strip(" ，,。?？:：")
    return subject if subject != "申请" else ""


def _extract_material_items(statement: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return ()
    items: list[str] = []
    for match in re.finditer(r"提交(?P<item>[^，,。；;]*?书面申请)", normalized):
        items.append(match.group("item"))
    for match in re.finditer(r"填写(?P<item>《[^》]+》)", normalized):
        items.append(match.group("item"))
    attached = re.search(r"附(?P<items>[^。；;]+)", normalized)
    if attached is not None:
        items.extend(_split_attached_material_items(attached.group("items")))
    return tuple(dict.fromkeys(_normalize_material_item(item) for item in items if item.strip()))


def _split_attached_material_items(text: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(text).strip(" ，,。；;:：")
    if not normalized:
        return ()
    return tuple(item.strip(" ，,。；;:：") for item in re.split(r"[、,，]", normalized) if item)


def _normalize_material_item(text: str) -> str:
    normalized = _normalize_snippet(text).strip(" ，,。；;:：")
    return re.sub(r"^各种", "", normalized)


__all__ = ["compose_material_requirement_answer"]
