from __future__ import annotations


def select_wechat_public_notice_pending_multimodal_notice_ids(
    *,
    projection_store,
    source_corpus: str,
    source_collection: str,
    limit: int,
) -> tuple[str, ...]:
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    entries = projection_store.list_by_scope(source_corpus, source_collection)
    pending_notice_ids: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        if not _is_pending_multimodal_entry(entry):
            continue
        notice_id = str(entry.source_notice_id or "").strip()
        if not notice_id or notice_id in seen:
            continue
        seen.add(notice_id)
        pending_notice_ids.append(notice_id)
        if len(pending_notice_ids) >= limit:
            break
    return tuple(pending_notice_ids)


def _is_pending_multimodal_entry(entry) -> bool:
    return (
        str(entry.consumption_status or "").strip() == "pending_multimodal_processing"
        and str(entry.target_surface or "").strip() == "multimodal_processing_candidate"
    )
