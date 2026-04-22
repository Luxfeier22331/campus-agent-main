from __future__ import annotations

from collections.abc import Sequence
from threading import RLock

from campus_ingestion_core.authenticated_notice_source_truth_inventory_shared import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)


class InMemoryAuthenticatedNoticeSourceTruthInventoryStore:
    def __init__(self) -> None:
        self._entries: dict[tuple[str, str, str], AuthenticatedNoticeSourceTruthInventoryEntry] = {}
        self._lock = RLock()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None:
        with self._lock:
            for record in records:
                self._entries[(record.corpus, record.collection, record.notice_id)] = record

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None:
        with self._lock:
            self._entries = {
                key: value
                for key, value in self._entries.items()
                if key[:2] != (corpus, collection)
            }
            for record in records:
                self._entries[(record.corpus, record.collection, record.notice_id)] = record

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
        selected_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
        with self._lock:
            return tuple(
                sorted(
                    (
                        record
                        for record in self._entries.values()
                        if record.corpus == corpus
                        and record.collection == collection
                        and (not selected_notice_ids or record.notice_id in selected_notice_ids)
                    ),
                    key=lambda record: record.notice_id,
                )
            )
