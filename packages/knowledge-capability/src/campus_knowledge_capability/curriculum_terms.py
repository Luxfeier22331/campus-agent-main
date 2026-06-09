from __future__ import annotations

from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from .answer_shared import _normalize_snippet

_CURRICULUM_COURSE_LIST_QUERY_HINTS = ("什么课", "哪些课", "有什么课", "有哪些课", "修什么")
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


def _is_curriculum_course_list_query(query_text: str) -> bool:
    normalized_query = _normalize_snippet(query_text)
    return any(hint in normalized_query for hint in _CURRICULUM_COURSE_LIST_QUERY_HINTS)


def _is_curriculum_lookup_query(query_text: str) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    return interpretation.intent_kind == "curriculum_lookup"


def _curriculum_semester_labels(query_text: str) -> tuple[str, ...]:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
        return ()
    return tuple(dict.fromkeys(interpretation.semester_labels))


def _curriculum_semester_answer_label(query_text: str) -> str:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "course_list" or len(interpretation.semester_labels) != 1:
        return ""
    canonical_label = interpretation.semester_labels[0]
    alias_labels = tuple(
        source
        for source, target in interpretation.semester_alias_labels
        if target == canonical_label
    )
    if alias_labels:
        return f"{alias_labels[0]}（{canonical_label}）"
    return canonical_label


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


__all__ = [
    "_CURRICULUM_COURSE_LIST_QUERY_HINTS",
    "_CURRICULUM_EMPTY_TABLE_CELLS",
    "_CURRICULUM_SEMESTER_NUMERIC_LABELS",
    "_curriculum_semester_answer_label",
    "_curriculum_semester_labels",
    "_curriculum_target_semesters",
    "_is_curriculum_course_list_query",
    "_is_curriculum_lookup_query",
    "_is_curriculum_semester_course_list_query",
]
