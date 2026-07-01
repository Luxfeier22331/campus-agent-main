from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlparse


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeBrowserUrlBackfillResult:
    bundle_records: tuple[dict[str, Any], ...]
    summary: dict[str, Any]


def backfill_authenticated_notice_browser_urls(
    *,
    bundle_records: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    source_home_url: str,
) -> AuthenticatedNoticeBrowserUrlBackfillResult:
    updated_records: list[dict[str, Any]] = []
    records_seen = 0
    already_present_count = 0
    backfilled_count = 0
    missing_notice_type_count = 0
    unavailable_count = 0
    source_counts: dict[str, int] = {
        "api_notice_link": 0,
        "portal_print_route": 0,
        "unavailable": 0,
    }

    for record in bundle_records:
        records_seen += 1
        cloned = copy.deepcopy(dict(record))
        notice = dict(cloned.get("notice") or {})
        if notice.get("notice_browser_url") and notice.get("notice_browser_url_source"):
            already_present_count += 1
            source = str(notice.get("notice_browser_url_source") or "unavailable")
            source_counts[source] = source_counts.get(source, 0) + 1
            updated_records.append(cloned)
            continue

        browser_urls = build_authenticated_notice_browser_urls(
            notice=notice,
            record=cloned,
            source_home_url=source_home_url,
        )
        if browser_urls["portal_print_url"] is None:
            missing_notice_type_count += 1
        if browser_urls["notice_browser_url_source"] == "unavailable":
            unavailable_count += 1
        else:
            backfilled_count += 1
        source_counts[str(browser_urls["notice_browser_url_source"])] = (
            source_counts.get(str(browser_urls["notice_browser_url_source"]), 0) + 1
        )
        notice.update(browser_urls)
        cloned["notice"] = notice
        updated_records.append(cloned)

    return AuthenticatedNoticeBrowserUrlBackfillResult(
        bundle_records=tuple(updated_records),
        summary={
            "records_seen": records_seen,
            "already_present_count": already_present_count,
            "backfilled_count": backfilled_count,
            "missing_notice_type_count": missing_notice_type_count,
            "unavailable_count": unavailable_count,
            "notice_browser_url_source_counts": source_counts,
        },
    )


def build_authenticated_notice_browser_urls(
    *,
    notice: dict[str, Any],
    record: dict[str, Any],
    source_home_url: str,
) -> dict[str, str | None]:
    notice_id = _notice_id(notice=notice, record=record)
    notice_type = _notice_type(notice)
    notice_link = _optional_text(notice.get("notice_link"))
    notice_link_state = _optional_int(notice.get("notice_link_state"))
    notice_source = _optional_int(notice.get("notice_source"))
    portal_print_url = _portal_print_url(
        notice_id=notice_id,
        notice_link_state=notice_link_state,
        notice_type=notice_type,
        source_home_url=source_home_url,
    )
    if notice_source == 1 and notice_link_state != 1 and notice_link:
        return {
            "portal_print_url": portal_print_url,
            "notice_browser_url": notice_link,
            "notice_browser_url_source": "api_notice_link",
        }
    if portal_print_url:
        return {
            "portal_print_url": portal_print_url,
            "notice_browser_url": portal_print_url,
            "notice_browser_url_source": "portal_print_route",
        }
    return {
        "portal_print_url": None,
        "notice_browser_url": None,
        "notice_browser_url_source": "unavailable",
    }


def _portal_print_url(
    *,
    notice_id: str,
    notice_link_state: int | None,
    notice_type: str | None,
    source_home_url: str,
) -> str | None:
    if not (notice_id and notice_type):
        return None
    params = {
        "type": notice_type,
        "notice_id": notice_id,
        "show_type": "1",
    }
    if notice_link_state == 1:
        params["notice_link_state"] = "1"
    return f"{_source_home_origin(source_home_url)}/#/print?{urlencode(params)}"


def _source_home_origin(value: str) -> str:
    parsed = urlparse(value.strip() or "https://portal.example.edu")
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return "https://portal.example.edu"


def _notice_id(*, notice: dict[str, Any], record: dict[str, Any]) -> str:
    return str(notice.get("notice_id") or record.get("notice_id") or "").strip()


def _notice_type(notice: dict[str, Any]) -> str | None:
    direct = _optional_text(notice.get("notice_type"))
    if direct:
        return direct
    categories = notice.get("categories")
    if isinstance(categories, list):
        for category in categories:
            if not isinstance(category, dict):
                continue
            notice_type = _optional_text(category.get("notice_type"))
            if notice_type:
                return notice_type
    return None


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_int(value: object) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


__all__ = [
    "AuthenticatedNoticeBrowserUrlBackfillResult",
    "backfill_authenticated_notice_browser_urls",
    "build_authenticated_notice_browser_urls",
]
