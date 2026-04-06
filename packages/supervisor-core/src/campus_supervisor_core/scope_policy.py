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
    "习概",
    "马原",
    "毛概",
    "史纲",
    "形策",
    "民概",
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

    campus_signal = _first_match(normalized_goal, _CAMPUS_SCOPE_SIGNALS)
    if campus_signal is not None:
        return ScopeDecision(
            scope_class="in_scope",
            reason="campus_scope_signal",
            matched_signal=campus_signal,
        )

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

    return ScopeDecision(scope_class="in_scope", reason="scope_undetermined_delegate")


def _normalize_goal(user_goal: str) -> str:
    return "".join(user_goal.split()).casefold()


def _first_match(normalized_goal: str, signals: tuple[str, ...]) -> str | None:
    for signal in signals:
        normalized_signal = "".join(signal.split()).casefold()
        if normalized_signal and normalized_signal in normalized_goal:
            return signal
    return None


__all__ = ["ScopeDecision", "ScopeClass", "evaluate_knowledge_scope"]
