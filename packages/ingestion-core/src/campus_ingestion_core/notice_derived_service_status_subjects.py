from __future__ import annotations

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.notice_derived_service_status_text import _BOARDING_POINT_KEYWORDS


def _transport_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    if "通勤班车" in text and any(keyword in text for keyword in _BOARDING_POINT_KEYWORDS):
        return {
            "subject_id": "transport:intercampus-commute:boarding-point:fengtai",
            "display_name": "两校区通勤班车丰台校区乘车点",
            "aliases": (
                "通勤班车丰台校区乘车点",
                "两校区通勤班车乘车点",
                "两校区通勤班车",
                "通勤班车",
                title,
            ),
            "campus_scope": "fengtai",
        }
    if "地铁接驳车" in text and any(keyword in text for keyword in _BOARDING_POINT_KEYWORDS):
        return {
            "subject_id": "transport:subway-shuttle:boarding-point:fengtai",
            "display_name": "丰台校区地铁接驳车乘车点",
            "aliases": (
                "地铁接驳车乘车点",
                "丰台校区地铁接驳车",
                "地铁接驳车",
                title,
            ),
            "campus_scope": "fengtai",
        }
    notice_id = projection_entry.source_notice_id
    return {
        "subject_id": f"notice-derived-service-status:{notice_id}",
        "display_name": title or f"通知 {notice_id} 服务状态",
        "aliases": (title,) if title else (),
        "campus_scope": "",
    }


def _it_platform_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    if "信息门户" in text:
        return {
            "subject_id": "it-platform:information-portal",
            "display_name": "信息门户",
            "aliases": ("信息门户", "网上办事大厅", title),
            "campus_scope": "",
        }
    if "一卡通" in text:
        return {
            "subject_id": "it-platform:campus-card",
            "display_name": "一卡通平台",
            "aliases": ("一卡通", "校园卡", title),
            "campus_scope": "",
        }
    if "校园网" in text:
        return {
            "subject_id": "it-platform:campus-network",
            "display_name": "校园网",
            "aliases": ("校园网", "网络服务", title),
            "campus_scope": "",
        }
    if "有线网" in text:
        return {
            "subject_id": "it-platform:campus-network",
            "display_name": "有线网",
            "aliases": ("有线网", "校园网", "网络服务", title),
            "campus_scope": "",
        }
    if "VPN" in text:
        return {
            "subject_id": "it-platform:vpn",
            "display_name": "VPN 服务",
            "aliases": ("VPN", "VPN服务", title),
            "campus_scope": "",
        }
    return {
        "subject_id": f"it-platform:notice:{projection_entry.source_notice_id}",
        "display_name": title or "信息化服务",
        "aliases": (title,) if title else (),
        "campus_scope": "",
    }


def _library_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    campus_scope = "fengtai" if "丰台" in text else "haidian"
    display = "丰台校区图书馆" if campus_scope == "fengtai" else "海淀校区图书馆"
    return {
        "subject_id": f"library:{campus_scope}",
        "display_name": display,
        "aliases": ("图书馆", display, title),
        "campus_scope": campus_scope,
    }


def _service_counter_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    if "校医院" in text:
        return {
            "subject_id": "service-counter:campus-hospital",
            "display_name": "校医院",
            "aliases": ("校医院", "校园医院", title),
            "campus_scope": "",
        }
    return {
        "subject_id": "service-counter:comprehensive-service-hall",
        "display_name": "综合服务大厅",
        "aliases": ("综合服务大厅", "一站式服务中心", title),
        "campus_scope": "",
    }


def _facility_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    campus_scope = "fengtai" if "丰台" in text else ("haidian" if "海淀" in text else "")
    if "自习室" in text:
        suffix = f":{campus_scope}" if campus_scope else ""
        display = f"{'丰台校区' if campus_scope == 'fengtai' else '海淀校区' if campus_scope == 'haidian' else ''}公共自习室"
        return {
            "subject_id": f"facility:self-study-room{suffix}",
            "display_name": display or "公共自习室",
            "aliases": ("自习室", "公共自习室", title),
            "campus_scope": campus_scope,
        }
    if "体育馆" in text:
        return {
            "subject_id": f"facility:gymnasium:{campus_scope or 'unspecified'}",
            "display_name": "体育馆",
            "aliases": ("体育馆", "场馆", title),
            "campus_scope": campus_scope,
        }
    if "静园10号楼" in text and "浴室" in text:
        return {
            "subject_id": "facility:bathroom:jingyuan-10",
            "display_name": "静园10号楼负一层女浴室",
            "aliases": ("静园10号楼女浴室", "女浴室", "浴室", title),
            "campus_scope": "haidian",
        }
    if "浴室" in text:
        return {
            "subject_id": f"facility:bathroom:{campus_scope or 'unspecified'}",
            "display_name": f"{'丰台校区' if campus_scope == 'fengtai' else '海淀校区' if campus_scope == 'haidian' else ''}浴室"
            or "浴室",
            "aliases": ("浴室", title),
            "campus_scope": campus_scope,
        }
    return {
        "subject_id": f"facility:notice:{projection_entry.source_notice_id}",
        "display_name": title or f"通知 {projection_entry.source_notice_id} 涉及设施",
        "aliases": (title,) if title else (),
        "campus_scope": campus_scope,
    }
