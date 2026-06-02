from __future__ import annotations

import re
import unicodedata

from campus_regulation_semantics.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    resolve_regulation_action_type,
    resolve_regulation_condition_subject,
)

_WHITESPACE_RE = re.compile(r"\s+")

_CATEGORY_DISCOVERY_CUES = (
    "有哪些",
    "都有什么",
    "有什么",
    "哪些",
    "能申请哪些",
    "可以申请哪些",
    "能申请什么",
    "可以申请什么",
)
_PROCEDURE_CUES = (
    "怎么申请",
    "如何申请",
    "怎么办理",
    "如何办理",
    "怎么评",
    "如何评",
    "流程",
    "手续",
)
_UNRESOLVED_CONTEXT_CUES = ("这个", "该", "这项", "这个奖学金", "该奖学金")
_POLICY_ACTION_REWRITE_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("处分怎么消", "处分怎么解除", "怎么消处分", "怎么解除处分", "消处分"),
        "解除处分 申请 条件 程序",
    ),
)
_FOCUSED_QUERY_CONTEXT_TERMS = ("条件", "要求", "资格", "程序", "流程", "材料", "申请")
_PROCEDURE_FOCUS_TERMS = ("流程", "步骤")
_REISSUE_PROCEDURE_QUERY_CUES = ("补办", "补发", "挂失", "遗失", "丢失", "丢了", "补卡", "补证")
_CATEGORY_OVERVIEW_CONDITION_CUES = (
    "需要满足什么条件",
    "需满足什么条件",
    "要满足什么条件",
    "需要满足哪些条件",
    "需满足哪些条件",
    "要满足哪些条件",
    "需要符合什么条件",
    "一般需要什么条件",
)
_DISCIPLINE_RELIEF_TIME_CUES = ("多久", "多长时间", "什么时候", "何时", "考察期", "满考察期")
_DISCIPLINE_RELIEF_ACTION_CUES = ("解除处分", "处分解除", "消处分")
_HEARING_APPLICATION_CUES = ("申请听证", "听证申请", "要求听证")
_DISCIPLINE_RELIEF_EXCLUSION_CUES = (
    "不能",
    "不得",
    "不予",
    "不受理",
    "无法",
    "不可以",
    "不可",
)
_RANK_THRESHOLD_CONTEXT_CUES = (
    "成绩",
    "绩点",
    "排名",
    "综测",
    "综合测评",
    "国奖",
    "奖学金",
    "评奖",
    "参评",
    "评选",
)
_RANK_THRESHOLD_VALUE_CUES = (
    "前十",
    "前10",
    "前30",
    "前三十",
    "排名",
    "综测",
    "综合测评",
)
_AMOUNT_FOCUS_MARKERS = ("金额", "多少钱", "多少元", "资助标准", "奖励标准", "标准")
_QUOTA_FOCUS_MARKERS = ("名额", "人数")
_RATIO_FOCUS_MARKERS = ("比例", "占比")
_LIMIT_FOCUS_MARKERS = ("额度", "上限")
_PAPER_PUBLICATION_CONTEXT_CUES = (
    "论文",
    "著作",
    "发表",
    "出版",
    "专利",
    "科研",
    "学术研究",
    "第一作者",
    "第二作者",
    "作者单位",
)


def _build_policy_action_query(normalized_query: str) -> str:
    compact_query = _compact_text(normalized_query)
    for cues, rewritten_query in _POLICY_ACTION_REWRITE_RULES:
        if any(_compact_text(cue) in compact_query for cue in cues):
            return rewritten_query
    return ""


def _looks_like_unresolved_policy_object_query(
    normalized_query: str,
    *,
    clarification_cues: tuple[str, ...] = (),
) -> bool:
    compact_query = _compact_text(normalized_query)
    if _has_any_compact_cue(compact_query, _UNRESOLVED_CONTEXT_CUES):
        return True
    return any(_compact_text(cue) in compact_query for cue in clarification_cues)


def _is_category_discovery_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return _has_any_compact_cue(compact_query, _CATEGORY_DISCOVERY_CUES)


def _is_ambiguous_category_procedure_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return _has_any_compact_cue(compact_query, _PROCEDURE_CUES)


def _is_category_scoped_policy_question(
    normalized_query: str,
    *,
    query_condition_subject: str,
    query_action_type: str,
) -> bool:
    if query_condition_subject:
        return True
    if query_action_type:
        return True
    compact_query = _compact_text(normalized_query)
    return any(
        _compact_text(cue) in compact_query
        for cue in (
            "条件",
            "要求",
            "资格",
            "能不能",
            "能否",
            "是否可以",
            "可以吗",
            "截止",
            "期限",
            "时间",
            "多少",
            "金额",
            "名额",
            "比例",
            "材料",
            "报销",
            "办理",
            "怎么办",
        )
    )


def _is_category_overview_condition_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return _has_any_compact_cue(compact_query, _CATEGORY_OVERVIEW_CONDITION_CUES)


def _query_condition_subject(
    normalized_query: str,
    *,
    category_display_name: str,
) -> str:
    compact_query = _compact_text(normalized_query)
    if "宿舍照明" in compact_query:
        return "deadline"
    if _looks_like_hearing_application_deadline_query(compact_query):
        return "deadline"
    if _looks_like_discipline_relief_operation_query(compact_query):
        return "application_procedure"
    if _has_any_compact_cue(compact_query, _REISSUE_PROCEDURE_QUERY_CUES):
        return "student_card_or_identity_credential"
    if "旷课" in compact_query and ("学时" in compact_query or "多少" in compact_query):
        return "attendance_absence_threshold"
    if _looks_like_discipline_relief_exclusion_query(compact_query):
        return "discipline_relief_exclusion"
    if _has_any_compact_cue(compact_query, _DISCIPLINE_RELIEF_ACTION_CUES) and _has_any_compact_cue(
        compact_query,
        _DISCIPLINE_RELIEF_TIME_CUES,
    ):
        return "discipline_relief_condition"
    if _has_any_compact_cue(compact_query, _HEARING_APPLICATION_CUES):
        return "application_procedure"
    if _looks_like_appeal_after_discipline_query(compact_query):
        return "application_procedure"
    if _looks_like_rank_threshold_query(compact_query):
        return "rank_threshold"
    if _looks_like_paper_publication_condition_query(compact_query):
        return "paper_or_publication"
    return resolve_regulation_condition_subject(
        text=normalized_query,
        context_text=normalized_query,
        document_title=category_display_name,
        action_type=_query_action_type(
            normalized_query,
            category_display_name=category_display_name,
        ),
    ).value


def _augment_focus_terms(
    *,
    normalized_query: str,
    focus_terms: tuple[str, ...],
    query_condition_subject: str,
) -> tuple[str, ...]:
    terms = list(focus_terms)
    compact_query = _compact_text(normalized_query)
    if "旷课" in compact_query and "旷课" not in terms:
        terms.append("旷课")
    if "学时" in compact_query and "学时" not in terms:
        terms.append("学时")
    if "旷课" in compact_query:
        definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get("attendance_absence_threshold")
        if definition is not None:
            for equivalents in definition.query_focus_equivalents:
                if "学时" not in equivalents:
                    continue
                for term in equivalents:
                    if term not in terms:
                        terms.append(term)
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(query_condition_subject)
    if definition is not None:
        for term in _condition_focus_terms_for_query(
            normalized_query=normalized_query,
            existing_terms=tuple(terms),
            query_condition_subject=query_condition_subject,
        ):
            if term not in terms:
                terms.append(term)
    return tuple(terms)


def _condition_focus_terms_for_query(
    *,
    normalized_query: str,
    existing_terms: tuple[str, ...],
    query_condition_subject: str,
) -> tuple[str, ...]:
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(query_condition_subject)
    if definition is None:
        return ()
    if query_condition_subject == "amount_or_quota":
        return _amount_or_quota_focus_terms(normalized_query)
    if query_condition_subject == "rank_threshold":
        compact_query = _compact_text(normalized_query)
        return tuple(
            term
            for term in definition.query_focus_terms
            if term in existing_terms or _compact_text(term) in compact_query
        )
    if query_condition_subject == "paper_or_publication":
        return _paper_publication_focus_terms(
            normalized_query=normalized_query,
            existing_terms=existing_terms,
        )
    return definition.query_focus_terms


def _paper_publication_focus_terms(
    *,
    normalized_query: str,
    existing_terms: tuple[str, ...],
) -> tuple[str, ...]:
    if _has_explicit_clause_anchor(normalized_query):
        return ()
    compact_query = _compact_text(normalized_query)
    focus_terms = list(existing_terms)
    if "论文" in compact_query and "发表" not in focus_terms:
        focus_terms.append("发表")
    if "著作" in compact_query and "出版" not in focus_terms:
        focus_terms.append("出版")
    if "第一作者" in compact_query and "第一作者" not in focus_terms:
        focus_terms.append("第一作者")
    if "第二作者" in compact_query and "第一、二作者" not in focus_terms:
        focus_terms.append("第一、二作者")
    if "专利" in compact_query and "发明" not in focus_terms:
        focus_terms.append("发明")
    return tuple(focus_terms)


def _has_explicit_clause_anchor(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return bool(re.search(r"第(?:[0-9]+|[一二三四五六七八九十百]+)(?:条|款)", compact_query))


def _amount_or_quota_focus_terms(normalized_query: str) -> tuple[str, ...]:
    compact_query = _compact_text(normalized_query)
    focus_terms: list[str] = []
    if _has_any_compact_cue(compact_query, _AMOUNT_FOCUS_MARKERS):
        focus_terms.append("金额")
    if _has_any_compact_cue(compact_query, _QUOTA_FOCUS_MARKERS):
        focus_terms.append("名额")
    if _has_any_compact_cue(compact_query, _RATIO_FOCUS_MARKERS):
        focus_terms.append("比例")
    if _has_any_compact_cue(compact_query, _LIMIT_FOCUS_MARKERS):
        focus_terms.append("额度")
    return tuple(focus_terms)


def _looks_like_discipline_relief_exclusion_query(compact_query: str) -> bool:
    if not _has_any_compact_cue(compact_query, _DISCIPLINE_RELIEF_ACTION_CUES):
        return False
    return _has_any_compact_cue(compact_query, _DISCIPLINE_RELIEF_EXCLUSION_CUES)


def _looks_like_discipline_relief_operation_query(compact_query: str) -> bool:
    if not _has_any_compact_cue(
        compact_query,
        ("处分怎么消", "消处分", "处分怎么解除", "怎么解除处分"),
    ):
        return False
    return not _has_any_compact_cue(compact_query, _DISCIPLINE_RELIEF_TIME_CUES)


def _looks_like_appeal_after_discipline_query(compact_query: str) -> bool:
    return _has_any_compact_cue(
        compact_query, ("处分决定", "处理决定", "处分")
    ) and _has_any_compact_cue(
        compact_query,
        ("申诉", "不服"),
    )


def _looks_like_hearing_application_deadline_query(compact_query: str) -> bool:
    if not _has_any_compact_cue(compact_query, _HEARING_APPLICATION_CUES):
        return False
    return _has_any_compact_cue(
        compact_query,
        ("什么时候", "何时", "多久内", "几天内", "多少天", "时间", "期限", "截止"),
    )


def _looks_like_rank_threshold_query(compact_query: str) -> bool:
    if not _has_any_compact_cue(compact_query, _RANK_THRESHOLD_VALUE_CUES):
        return False
    return _has_any_compact_cue(compact_query, _RANK_THRESHOLD_CONTEXT_CUES)


def _looks_like_paper_publication_condition_query(compact_query: str) -> bool:
    if not _has_any_compact_cue(compact_query, _PAPER_PUBLICATION_CONTEXT_CUES):
        return False
    return _has_any_compact_cue(
        compact_query,
        ("条件", "要求", "算", "能不能", "能否", "可以", "能拿", "能得", "能评", "不看"),
    )


def _query_action_type(
    normalized_query: str,
    *,
    category_display_name: str,
) -> str:
    compact_query = _compact_text(normalized_query)
    if _looks_like_discipline_relief_operation_query(compact_query):
        return "lift_discipline"
    return resolve_regulation_action_type(
        text=normalized_query,
        context_text=normalized_query,
        document_title=category_display_name,
    ).value


def _has_any_compact_cue(compact_query: str, cues: tuple[str, ...]) -> bool:
    return any(_compact_text(cue) in compact_query for cue in cues)


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip()


def _compact_text(text: str) -> str:
    normalized = _normalize_text(text).lower()
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


__all__ = [
    "_augment_focus_terms",
    "_build_policy_action_query",
    "_compact_text",
    "_has_any_compact_cue",
    "_is_ambiguous_category_procedure_query",
    "_is_category_discovery_query",
    "_is_category_overview_condition_query",
    "_is_category_scoped_policy_question",
    "_looks_like_unresolved_policy_object_query",
    "_normalize_text",
    "_query_action_type",
    "_query_condition_subject",
]
