from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_supervisor_core.context import SupervisorRequestContext

ScopeClass = Literal["in_scope", "out_of_scope"]

_CAMPUS_SCOPE_SIGNALS = (
    "中央民族大学",
    "民大",
    "培养方案",
    "人才培养",
    "培养计划",
    "课程",
    "学分",
    "学期",
    "大一",
    "大二",
    "大三",
    "大四",
    "学院",
    "专业",
    "民族实验班",
    "基地班",
    "创新班",
    "奖学金",
    "助学金",
    "选课",
    "开课",
    "教务",
    "校历",
    "图书馆",
    "宿舍",
    "学籍",
    "转专业",
    "毕业",
    "推免",
    "保研",
    "学生证",
    "处分",
    "申诉",
    "习概",
    "习近平新时代中国特色社会主义思想概论",
    "习近平法治思想概论",
    "马原",
    "毛概",
    "史纲",
    "形策",
    "民概",
    "图书",
    "春假",
    "library",
    "scholarship",
    "curriculum",
    "graduationrequirements",
    "course",
)
_EXTERNAL_INSTITUTION_SIGNALS = (
    "mit",
    "麻省理工",
    "harvard",
    "哈佛",
    "stanford",
    "斯坦福",
    "oxford",
    "牛津",
    "cambridge",
    "剑桥",
    "清华",
    "北京大学",
    "北大",
    "复旦",
    "上海交大",
    "浙大",
)
_GENERAL_WORLD_SIGNALS = (
    "天气",
    "股价",
    "汇率",
    "比特币",
    "世界杯",
    "nba",
    "写诗",
    "写一首诗",
    "讲个笑话",
    "推荐电影",
    "推荐一部电影",
    "电影",
    "量子力学",
    "相对论",
    "黑洞",
    "宇宙",
)
_GEOPOLITICAL_ENTITY_SIGNALS = (
    "中国",
    "美国",
    "英国",
    "法国",
    "德国",
    "日本",
    "俄罗斯",
    "欧盟",
    "联合国",
)
_POLITICAL_OFFICE_SIGNALS = (
    "国家主席",
    "主席是谁",
    "总统",
    "总理",
    "首相",
    "外交部长",
    "领导人是谁",
)
_CONTEXTUAL_FOLLOW_UP_SIGNALS = (
    "这个流程",
    "该流程",
    "流程怎么办",
)
_STRUCTURED_TRANSPORT_SIGNALS = (
    "校车",
    "班车",
    "通勤车",
    "接驳车",
)
_STRUCTURED_SERVICE_SUBJECT_SIGNALS = (
    "图书馆",
    "食堂",
    "会议室",
    "校医院",
    "校园卡",
    "一卡通",
    "宿舍",
    "报修",
)
_STRUCTURED_SERVICE_STATUS_SIGNALS = (
    "开门",
    "开放",
    "营业",
    "办公时间",
    "开放时间",
    "开到几点",
    "营业到几点",
    "状态",
)
_STRUCTURED_NOTICE_SIGNALS = (
    "通知",
    "公告",
    "公示",
)


@dataclass(frozen=True, slots=True)
class ScopeDecision:
    scope_class: ScopeClass
    reason: str
    matched_signal: str = ""


def evaluate_knowledge_scope(context: SupervisorRequestContext) -> ScopeDecision:
    if context.requested_scope is not None:
        return ScopeDecision(scope_class="in_scope", reason="explicit_requested_scope")

    normalized_goal = _normalize_goal(context.user_goal)
    if not normalized_goal:
        return ScopeDecision(scope_class="in_scope", reason="scope_undetermined_delegate")

    external_signal = _first_match(normalized_goal, _EXTERNAL_INSTITUTION_SIGNALS)
    if external_signal is not None:
        return ScopeDecision(
            scope_class="out_of_scope",
            reason="product_scope_boundary",
            matched_signal=external_signal,
        )

    world_signal = _first_match(normalized_goal, _GENERAL_WORLD_SIGNALS)
    if world_signal is not None:
        return ScopeDecision(
            scope_class="out_of_scope",
            reason="product_scope_boundary",
            matched_signal=world_signal,
        )

    political_fact_signal = _match_open_domain_political_fact(normalized_goal)
    if political_fact_signal is not None:
        return ScopeDecision(
            scope_class="out_of_scope",
            reason="product_scope_boundary",
            matched_signal=political_fact_signal,
        )

    structured_signal = _match_structured_runtime_candidate(normalized_goal)
    if structured_signal is not None:
        return ScopeDecision(
            scope_class="in_scope",
            reason="structured_runtime_candidate_signal",
            matched_signal=structured_signal,
        )

    campus_signal = _first_match(normalized_goal, _CAMPUS_SCOPE_SIGNALS)
    if campus_signal is not None:
        return ScopeDecision(
            scope_class="in_scope",
            reason="campus_scope_signal",
            matched_signal=campus_signal,
        )

    follow_up_signal = _first_match(normalized_goal, _CONTEXTUAL_FOLLOW_UP_SIGNALS)
    if follow_up_signal is not None:
        context_signal = _first_context_signal(context)
        if context_signal is not None:
            return ScopeDecision(
                scope_class="in_scope",
                reason="campus_context_signal",
                matched_signal=context_signal,
            )
        return ScopeDecision(
            scope_class="out_of_scope",
            reason="product_scope_boundary",
            matched_signal=follow_up_signal,
        )

    return ScopeDecision(scope_class="out_of_scope", reason="product_scope_boundary")


def _normalize_goal(user_goal: str) -> str:
    return "".join(user_goal.split()).casefold()


def _first_match(normalized_goal: str, signals: tuple[str, ...]) -> str | None:
    for signal in signals:
        normalized_signal = "".join(signal.split()).casefold()
        if normalized_signal and normalized_signal in normalized_goal:
            return signal
    return None


def _match_structured_runtime_candidate(normalized_goal: str) -> str | None:
    transport_signal = _first_match(normalized_goal, _STRUCTURED_TRANSPORT_SIGNALS)
    if transport_signal is not None:
        return transport_signal

    notice_signal = _first_match(normalized_goal, _STRUCTURED_NOTICE_SIGNALS)
    if notice_signal is not None:
        return notice_signal

    service_subject = _first_match(normalized_goal, _STRUCTURED_SERVICE_SUBJECT_SIGNALS)
    if service_subject is None:
        return None
    service_status = _first_match(normalized_goal, _STRUCTURED_SERVICE_STATUS_SIGNALS)
    if service_status is None:
        return None
    return service_subject


def _match_open_domain_political_fact(normalized_goal: str) -> str | None:
    entity_signal = _first_match(normalized_goal, _GEOPOLITICAL_ENTITY_SIGNALS)
    if entity_signal is None:
        return None

    office_signal = _first_match(normalized_goal, _POLITICAL_OFFICE_SIGNALS)
    if office_signal is None:
        return None
    return office_signal


def _first_context_signal(context: SupervisorRequestContext) -> str | None:
    personalization_hint = context.personalization_hint
    for term in (
        personalization_hint.recent_goal,
        *personalization_hint.confirmed_slot_terms,
    ):
        normalized_term = _normalize_goal(term)
        signal = _first_match(normalized_term, _CAMPUS_SCOPE_SIGNALS)
        if signal is not None:
            return signal
    for item in context.context.profile_memory.items:
        normalized_term = _normalize_goal(item.value)
        signal = _first_match(normalized_term, _CAMPUS_SCOPE_SIGNALS)
        if signal is not None:
            return signal
    return None


__all__ = ["ScopeClass", "ScopeDecision", "evaluate_knowledge_scope"]
