from __future__ import annotations

import re
from collections.abc import Sequence

_TRANSPORT_TARGET_TITLE_PATTERNS = (
    r"校车.*(运行|运营|班次|时间|调整|安排)",
    r"班车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"通勤班车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"通勤车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"接驳车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"地铁接驳车.*(调整|增加|运行|运营|班次|时间|安排|发车)",
    r"专车",
    r"乘车点",
    r"班次推迟",
)

_SERVICE_STATUS_TARGET_TITLE_PATTERNS = (
    r"暑假期间.*办理",
    r"寒假期间.*办理",
    r"假期期间.*办理",
    r"暂停.*(服务|办理|使用|访问|营业)",
    r"恢复.*(服务|办理|使用|开放|营业|浴室|正常)",
    r"(临时|暂时).*(关闭|停用|办理)",
    r"开放时间",
    r"服务时间",
    r"营业时间",
    r"工作安排",
    r"门诊",
    r"开诊",
    r"闭馆",
    r"食堂.*开放",
    r"校医院",
    r"浴室.*(试运行|恢复|开放)",
    r"停车权限",
    r"停水",
    r"停电",
    r"断网",
    r"升级维护",
)


def resolve_authenticated_notice_target_candidates(
    *,
    notice_family: str,
    primary_route: str,
    title: str,
) -> list[str]:
    if primary_route == "regulation_candidate":
        return ["regulation"]
    if primary_route == "service_status_candidate":
        if _is_transport_schedule_target(notice_family=notice_family, title=title):
            return ["transport_schedule"]
        if _is_service_status_target(notice_family=notice_family, title=title):
            return ["service_status"]
    return []


def _is_transport_schedule_target(*, notice_family: str, title: str) -> bool:
    if notice_family not in {"transport_commute_status", "facility_transport_classroom_status"}:
        return False
    return _matches_any(_TRANSPORT_TARGET_TITLE_PATTERNS, title)


def _is_service_status_target(*, notice_family: str, title: str) -> bool:
    if notice_family not in {
        "service_status_override",
        "facility_service_status",
        "facility_transport_classroom_status",
        "it_platform_service_status",
        "library_service_status",
    }:
        return False
    return _matches_any(_SERVICE_STATUS_TARGET_TITLE_PATTERNS, title)


def _matches_any(patterns: Sequence[str], value: str) -> bool:
    return any(re.search(pattern, value, flags=re.IGNORECASE) for pattern in patterns)


__all__ = ["resolve_authenticated_notice_target_candidates"]
