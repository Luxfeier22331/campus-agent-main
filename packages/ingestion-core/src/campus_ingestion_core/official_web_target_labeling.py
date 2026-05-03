from __future__ import annotations

import re


def choose_official_web_service_name(*, source_title: str, target_label: str) -> str:
    normalized_target = _normalize_label(target_label)
    if normalized_target and should_prefer_target_label_for_service_name(source_title):
        return normalized_target
    return _normalize_label(source_title)


def choose_official_web_contact_display_name(*, source_title: str, target_label: str) -> str:
    normalized_target = _normalize_label(target_label)
    if normalized_target and is_generic_contact_title(source_title):
        return normalized_target
    return _normalize_label(source_title)


def should_prefer_target_label_for_service_name(title: str) -> bool:
    normalized = re.sub(r"\s+", "", _normalize_label(title))
    return bool(re.search(r"(管理办法|使用说明|登录|登陆|说明)$", normalized) or "系统" in normalized)


def is_generic_contact_title(title: str) -> bool:
    normalized = re.sub(r"\s+", "", _normalize_label(title))
    return normalized in {"联系方式", "部门简介", "信息化服务联系方式"}


def _normalize_label(value: str) -> str:
    return str(value or "").strip()
