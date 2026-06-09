from __future__ import annotations

import re

from campus_contracts import EvidenceSource

from .answer_shared import _normalize_snippet


def _official_web_section_path(source: EvidenceSource) -> tuple[str, ...]:
    raw_section_path = (
        source.anchor.get("section_path") if isinstance(source.anchor, dict) else None
    )
    if not isinstance(raw_section_path, (list, tuple)):
        return ()
    return tuple(
        _normalize_snippet(str(item)) for item in raw_section_path if _normalize_snippet(str(item))
    )


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
    return normalized.strip("，,、 ")


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


__all__ = [
    "_build_official_web_roster_fragments",
    "_extract_leading_person_name",
    "_extract_official_web_roster_entry",
    "_official_web_section_path",
    "_simplify_official_web_school_role",
]
