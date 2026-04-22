from __future__ import annotations

from campus_contracts import EvidenceBundle, SpecialistRequest
from campus_ingestion_core import load_runtime_profile
from campus_ingestion_core.corpus_profiles import (
    is_official_web_stable_reference_like_profile,
)

from campus_rag_agent.query_planning import CurriculumQueryPlan, HandbookQueryPlan

from .service_common import _is_official_web_freshness_fail_close, _normalize_text

_UNSUPPORTED_HANDBOOK_CLAUSE_CUE_GROUPS = (
    ("本校", "单位", "作者单位", "署名单位"),
    ("几分", "多少分", "加分", "得分", "分值", "第二作者的分", "拿分", "给分"),
)


def _build_no_answer_response(
    evidence: EvidenceBundle,
    *,
    resolved_policy_title: str = "",
) -> str:
    if evidence.corpus == "curriculum" and evidence.collection == "course_facts":
        return (
            "当前未检索到足够依据支持回答这个课程问题，请补充更具体的课程名称、课程类别或修读字段。"
        )
    if evidence.corpus == "curriculum" and evidence.collection == "program_family_facts":
        return "我还不能稳定确认你想问的是哪一类项目班；你可以直接说民族班、基地班，或者补充更具体的班型。"
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        return "当前未检索到足够依据支持回答这个培养方案问题，请补充更具体的培养方案名称、学位要求或课程表名称。"
    if evidence.corpus == "official_web":
        profile = load_runtime_profile(evidence.corpus, evidence.collection)
        if is_official_web_stable_reference_like_profile(profile):
            if _is_official_web_freshness_fail_close(evidence):
                return "当前本地官网页面链路还不支持回答今天/最新/最近这类时效敏感问题，请改问明确的页面标题、机构名称或文章主题。"
            return "当前未检索到足够依据支持回答这个官网页面问题，请确认问题是否落在当前已导入的官网页面范围内，或补充更明确的页面标题、机构名称或文章主题。"
    if resolved_policy_title:
        return (
            f"在《{resolved_policy_title}》中，当前未检索到足够依据支持回答这个问题；"
            "请确认是否有更具体的条款表述。"
        )
    return "当前未检索到足够依据支持回答这个学生手册问题，请确认它是否属于学生手册范围，或补充更具体的制度名称。"


def _build_version_filter_unresolved_answer(
    *,
    evidence: EvidenceBundle,
    resolved_policy_title: str = "",
) -> str:
    if evidence.corpus == "curriculum":
        return (
            "当前还不能稳定定位你要查询的历史版本；请补充更明确的培养方案名称、版本日期或版本标识。"
        )
    if resolved_policy_title:
        return (
            f"当前还不能稳定定位《{resolved_policy_title}》对应的历史版本；"
            "请补充更明确的版本日期或版本标识。"
        )
    return "当前还不能稳定定位你要查询的历史版本；请补充更明确的制度名称、版本日期或版本标识。"


def _build_curriculum_unsupported_response(plan: CurriculumQueryPlan) -> str:
    if plan.unsupported_reason == "curriculum_course_map_unsupported":
        if plan.resolved_document_title:
            return (
                f"当前还不能稳定解析《{plan.resolved_document_title}》里的课程地图/拓扑图，"
                "因此不会根据课程地图推断课程先后关系、课程依赖或修读安排。"
                "你可以改问课程设置、修读建议、某学期有什么课，或直接查看原培养方案中的课程地图页。"
            )
        return (
            "当前还不能稳定解析培养方案里的课程地图/拓扑图，因此不会根据课程地图推断课程先后关系、"
            "课程依赖或修读安排。你可以改问课程设置、修读建议、某学期有什么课，或直接查看原培养方案中的课程地图页。"
        )
    return _build_no_answer_response(
        EvidenceBundle(query_text="", corpus="curriculum", collection="curriculum_plan")
    )


def _build_restricted_access_denied_response(
    request: SpecialistRequest,
    evidence: EvidenceBundle,
) -> str:
    principal_type = (
        request.context.actor.principal_type.strip() or request.actor.principal_type.strip()
    )
    if principal_type == "operator":
        return "当前请求命中了受限内容，但当前 operator 投影无权读取；请检查最小授权投影。"
    if principal_type == "service":
        return "当前 service principal 无权访问该受限内容。"
    if principal_type in {"campus_member", "student", "staff", "faculty"}:
        return "当前身份无权访问该受限内容；如需继续，请确认校内身份与授权范围。"
    return _build_no_answer_response(evidence)


def _resolved_policy_title(handbook_plan: HandbookQueryPlan | None) -> str:
    if handbook_plan is None or handbook_plan.status != "resolved":
        return ""
    return handbook_plan.resolved_policy_title


def _resolved_policy_no_answer_reason(handbook_plan: HandbookQueryPlan | None) -> str:
    if handbook_plan is None or handbook_plan.status != "resolved":
        return ""
    return "resolved_policy_clause_not_found"


def _resolve_no_answer_semantics(
    *,
    evidence: EvidenceBundle,
    handbook_plan: HandbookQueryPlan | None,
) -> tuple[str, str, bool]:
    if _is_official_web_freshness_fail_close(evidence):
        return "freshness_fail_close", "freshness_fail_close", True
    return _resolved_policy_no_answer_reason(handbook_plan), "unsupported_by_evidence", False


def _should_fail_closed_resolved_policy_clause(
    *,
    user_goal: str,
    evidence: EvidenceBundle,
    handbook_plan: HandbookQueryPlan | None,
) -> bool:
    if handbook_plan is None or handbook_plan.status != "resolved":
        return False
    if not evidence.sources:
        return False
    normalized_goal = _normalize_text(user_goal).lower()
    normalized_support = _normalize_text(
        " ".join(
            " ".join(
                fragment
                for fragment in (
                    source.source_title,
                    source.detail_label,
                    source.snippet,
                )
                if fragment
            )
            for source in evidence.sources
        )
    ).lower()
    matched_group_count = 0
    for cue_group in _UNSUPPORTED_HANDBOOK_CLAUSE_CUE_GROUPS:
        if not any(cue in normalized_goal for cue in cue_group):
            continue
        matched_group_count += 1
        if any(cue in normalized_support for cue in cue_group):
            continue
        return True
    return matched_group_count >= 2
