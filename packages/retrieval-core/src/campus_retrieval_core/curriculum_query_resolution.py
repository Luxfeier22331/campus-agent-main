from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from campus_contracts import EvidenceSource

_WHITESPACE_RE = re.compile(r"\s+")
_TITLE_FRAGMENT_RE = re.compile(r"(?P<fragment>.+?(?:培养方案|课程教学计划))")
_SEMESTER_ALIASES = (
    ("大一上", "第一学期"),
    ("大一下", "第二学期"),
    ("大二上", "第三学期"),
    ("大二下", "第四学期"),
    ("大三上", "第五学期"),
    ("大三下", "第六学期"),
    ("大四上", "第七学期"),
    ("大四下", "第八学期"),
    ("大五上", "第九学期"),
    ("大五下", "第十学期"),
)
_SEMESTER_NUMERIC_LABELS = {
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
_COURSE_MAP_LOOKUP_CUES = ("课程地图", "拓扑图", "课程结构图", "结果拓扑图")
_COURSE_SETTINGS_LOOKUP_CUES = ("课程设置",)
_STUDY_ADVICE_LOOKUP_CUES = ("修读建议",)
_COURSE_LIST_CUES = ("什么课", "哪些课", "有哪些课", "有什么课", "课程", "课表", "修什么")
_GENERIC_QUERY_NOISE = (
    "请问",
    "想问",
    "想看",
    "想知道",
    "想了解",
    "帮我看",
    "帮我查",
    "培养方案里",
    "培养方案中",
    "培养方案里面",
    "课程教学计划里",
    "课程教学计划中",
)
_COMPACT_TITLE_NOISE = (
    "本科专业",
    "本科",
    "专业",
    "人才",
    "培养",
    "方案",
    "课程教学计划",
)


@dataclass(frozen=True, slots=True)
class CurriculumQueryInterpretation:
    normalized_query_text: str
    program_query_fragment: str
    program_compact_key: str
    semester_labels: tuple[str, ...]
    intent_kind: str
    curriculum_lookup_target: Literal["", "course_map", "course_settings", "study_advice"] = ""


def interpret_curriculum_query(query_text: str) -> CurriculumQueryInterpretation:
    normalized_query_text = _normalize_curriculum_query_text(query_text)
    semester_labels = _extract_semester_labels(normalized_query_text)
    program_query_fragment = _extract_program_query_fragment(normalized_query_text)
    curriculum_lookup_target = _resolve_curriculum_lookup_target(normalized_query_text)
    intent_kind = _resolve_intent_kind(normalized_query_text)
    return CurriculumQueryInterpretation(
        normalized_query_text=normalized_query_text,
        program_query_fragment=program_query_fragment,
        program_compact_key=_compact_curriculum_title_key(program_query_fragment),
        semester_labels=semester_labels,
        intent_kind=intent_kind,
        curriculum_lookup_target=curriculum_lookup_target,
    )


def matching_curriculum_doc_ids(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[str, ...]:
    interpretation = interpret_curriculum_query(query_text)
    if not interpretation.program_compact_key:
        return ()
    exact_doc_ids: list[str] = []
    partial_doc_ids: list[str] = []
    for source in sources:
        if not _is_curriculum_source(source):
            continue
        compact_keys = {
            _compact_curriculum_title_key(candidate)
            for candidate in _source_title_candidates(source)
        }
        if (
            interpretation.program_compact_key in compact_keys
            and source.doc_id not in exact_doc_ids
        ):
            exact_doc_ids.append(source.doc_id)
            continue
        if any(
            interpretation.program_compact_key and interpretation.program_compact_key in compact_key
            for compact_key in compact_keys
        ) and source.doc_id not in partial_doc_ids:
            partial_doc_ids.append(source.doc_id)
    if exact_doc_ids:
        return tuple(exact_doc_ids)
    return tuple(partial_doc_ids)


def query_targets_curriculum_source_title(*, query_text: str, source: EvidenceSource) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    if not interpretation.program_compact_key or not _is_curriculum_source(source):
        return False
    return _source_matches_program(source, interpretation)


def filter_curriculum_query_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[tuple[EvidenceSource, ...], bool]:
    interpretation = interpret_curriculum_query(query_text)
    if not interpretation.program_compact_key:
        return tuple(sources), False
    matching_doc_ids = matching_curriculum_doc_ids(query_text=query_text, sources=sources)
    if len(matching_doc_ids) != 1:
        return tuple(sources), False
    filtered_sources = tuple(source for source in sources if source.doc_id == matching_doc_ids[0])
    if interpretation.semester_labels:
        filtered_sources = tuple(
            source
            for source in filtered_sources
            if _source_matches_semester(source, interpretation.semester_labels)
        )
    return filtered_sources, True


def build_curriculum_document_support_query_text(
    *,
    query_text: str,
    source: EvidenceSource,
) -> str:
    interpretation = interpret_curriculum_query(query_text)
    normalized_query = interpretation.normalized_query_text.strip()
    if not normalized_query or not interpretation.program_compact_key:
        return normalized_query
    if not _source_matches_program(source, interpretation):
        return normalized_query
    if interpretation.intent_kind == "course_list" and interpretation.semester_labels:
        return interpretation.semester_labels[0]
    if (
        interpretation.program_query_fragment
        and interpretation.program_query_fragment in normalized_query
    ):
        focused_query = normalized_query.replace(
            interpretation.program_query_fragment, "", 1
        ).strip()
        if focused_query:
            return focused_query
    return normalized_query


def _normalize_curriculum_query_text(query_text: str) -> str:
    normalized = _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", query_text)).strip()
    for source, target in _load_safe_alias_replacements():
        normalized = normalized.replace(source, target)
    for source, target in _SEMESTER_ALIASES:
        normalized = normalized.replace(source, target)
    return normalized


@lru_cache(maxsize=1)
def _load_safe_alias_replacements() -> tuple[tuple[str, str], ...]:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "curriculum_plan"
        / "query-planning.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    return tuple(
        (
            str(item.get("alias", "")).strip(),
            str(item.get("canonical", "")).strip(),
        )
        for item in payload.get("safe_aliases", ())
        if isinstance(item, dict)
        and str(item.get("alias", "")).strip()
        and str(item.get("canonical", "")).strip()
    )


def _extract_semester_labels(query_text: str) -> tuple[str, ...]:
    semester_labels = [
        label
        for label in dict.fromkeys(target for _, target in _SEMESTER_ALIASES)
        if label in query_text
    ]
    return tuple(semester_labels)


def _extract_program_query_fragment(query_text: str) -> str:
    match = _TITLE_FRAGMENT_RE.search(query_text)
    if not match:
        return ""
    fragment = match.group("fragment").strip(" \t\r\n,，.。;；:：()（）[]【】《》\"'")
    for noise in _GENERIC_QUERY_NOISE:
        fragment = fragment.replace(noise, "")
    return fragment.strip()


def _resolve_intent_kind(normalized_query_text: str) -> str:
    if _resolve_curriculum_lookup_target(normalized_query_text):
        return "curriculum_lookup"
    if any(cue in normalized_query_text for cue in _COURSE_LIST_CUES):
        return "course_list"
    return "generic"


def _resolve_curriculum_lookup_target(
    normalized_query_text: str,
) -> Literal["", "course_map", "course_settings", "study_advice"]:
    if any(cue in normalized_query_text for cue in _COURSE_MAP_LOOKUP_CUES):
        return "course_map"
    if any(cue in normalized_query_text for cue in _COURSE_SETTINGS_LOOKUP_CUES):
        return "course_settings"
    if any(cue in normalized_query_text for cue in _STUDY_ADVICE_LOOKUP_CUES):
        return "study_advice"
    return ""


def _source_matches_program(
    source: EvidenceSource,
    interpretation: CurriculumQueryInterpretation,
) -> bool:
    if not interpretation.program_compact_key:
        return False
    compact_keys = {
        _compact_curriculum_title_key(candidate) for candidate in _source_title_candidates(source)
    }
    return interpretation.program_compact_key in compact_keys


def _source_matches_semester(source: EvidenceSource, semester_labels: tuple[str, ...]) -> bool:
    if not semester_labels:
        return True
    source_text = " ".join(
        part
        for part in (
            source.detail_label,
            *source.structural_path,
            source.snippet,
        )
        if part.strip()
    )
    normalized_source_text = _normalize_text(source_text)
    for label in semester_labels:
        normalized_label = _normalize_text(label)
        if normalized_label in normalized_source_text:
            return True
        numeric_label = _SEMESTER_NUMERIC_LABELS.get(label, "")
        if not numeric_label:
            continue
        if f"第{numeric_label}学期" in normalized_source_text:
            return True
        if re.search(
            rf"(?:(?<=\|)|(?<=\s)|^){re.escape(numeric_label)}(?:(?=\|)|(?=\s)|$)",
            normalized_source_text,
        ):
            return True
    return False


def _source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates = [source.source_title.strip(), source.doc_id.split(":", 1)[-1].strip()]
    if source.structural_path:
        candidates.append(source.structural_path[0].strip())
    return tuple(
        candidate for candidate in dict.fromkeys(candidate for candidate in candidates if candidate)
    )


def _compact_curriculum_title_key(text: str) -> str:
    normalized = _normalize_text(text)
    if not normalized:
        return ""
    compact = normalized.translate(str.maketrans("", "", "（）()[]【】《》“”\"'`·-_/ "))
    for noise in _COMPACT_TITLE_NOISE:
        compact = compact.replace(noise, "")
    return compact


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().lower()


def _is_curriculum_source(source: EvidenceSource) -> bool:
    return source.collection == "curriculum_plan" or source.doc_id.startswith("curriculum:")


__all__ = [
    "CurriculumQueryInterpretation",
    "build_curriculum_document_support_query_text",
    "filter_curriculum_query_sources",
    "interpret_curriculum_query",
    "matching_curriculum_doc_ids",
    "query_targets_curriculum_source_title",
]
