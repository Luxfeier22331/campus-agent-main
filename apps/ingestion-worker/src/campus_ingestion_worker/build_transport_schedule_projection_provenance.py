from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry

_SHANGHAI_TZ = timezone(timedelta(hours=8))


def _transport_release_notice_provenance_records(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    admitted_at: str,
    materialized_at: str,
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen_notice_ids: set[str] = set()
    for entry in projection_entries:
        notice_id = str(entry.source_notice_id or "").strip()
        if not notice_id or notice_id in seen_notice_ids:
            continue
        seen_notice_ids.add(notice_id)
        records.append(
            {
                "source_notice_id": notice_id,
                "source_ref": _projection_source_ref(entry),
                "source_notice_release_time": _normalize_local_notice_timestamp(
                    entry.source_notice_release_time
                ),
                "admitted_at": admitted_at,
                "materialized_at": materialized_at,
            }
        )
    return records


def _projection_source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    parts = str(entry.source_notice_document_id or "").split(":")
    if len(parts) == 3 and parts[0] == "notice":
        return entry.source_notice_document_id
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _normalize_local_notice_timestamp(value: object) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    candidates = [normalized.replace("Z", "+00:00")]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ).isoformat()
        except ValueError:
            pass
    for layout in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(normalized, layout).replace(tzinfo=_SHANGHAI_TZ)
            return parsed.isoformat()
        except ValueError:
            pass
    return normalized
