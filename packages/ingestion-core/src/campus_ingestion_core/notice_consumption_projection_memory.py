from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core.notice_consumption_projection_shared import (
    NoticeConsumptionProjectionEntry,
    normalize_notice_ids,
)


class InMemoryNoticeConsumptionProjectionStore:
    def __init__(
        self,
        records: Sequence[NoticeConsumptionProjectionEntry] = (),
    ) -> None:
        self._records: dict[tuple[str, str, str], NoticeConsumptionProjectionEntry] = {}
        self.upsert_many(tuple(records))

    def upsert_many(self, records: Sequence[NoticeConsumptionProjectionEntry]) -> None:
        for record in records:
            self._records[(record.source_corpus, record.source_collection, record.unit_id)] = record

    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records: Sequence[NoticeConsumptionProjectionEntry],
    ) -> None:
        stale_keys = [
            key for key in self._records if key[0] == source_corpus and key[1] == source_collection
        ]
        for key in stale_keys:
            self._records.pop(key, None)
        self.upsert_many(records)

    def replace_notices(
        self,
        source_corpus: str,
        source_collection: str,
        notice_ids: Sequence[str],
        records: Sequence[NoticeConsumptionProjectionEntry],
    ) -> None:
        normalized_notice_ids = set(normalize_notice_ids(notice_ids))
        if not normalized_notice_ids:
            return
        stale_keys = [
            key
            for key, record in self._records.items()
            if key[0] == source_corpus
            and key[1] == source_collection
            and record.source_notice_id in normalized_notice_ids
        ]
        for key in stale_keys:
            self._records.pop(key, None)
        self.upsert_many(records)

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]:
        normalized_notice_ids = set(normalize_notice_ids(notice_ids))
        return tuple(
            sorted(
                (
                    record
                    for record in self._records.values()
                    if record.source_corpus == source_corpus
                    and record.source_collection == source_collection
                    and (
                        not normalized_notice_ids
                        or record.source_notice_id in normalized_notice_ids
                    )
                ),
                key=lambda item: (item.source_notice_id, item.unit_id),
            )
        )
