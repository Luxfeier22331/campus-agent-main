from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core.internal_notice_read_model_shared import (
    InternalNoticeReadModelEntry,
    normalize_notice_ids,
)


class InMemoryInternalNoticeReadModelStore:
    def __init__(
        self,
        records: Sequence[InternalNoticeReadModelEntry] = (),
    ) -> None:
        self._records: dict[tuple[str, str, str], InternalNoticeReadModelEntry] = {}
        self.upsert_many(tuple(records))

    def upsert_many(self, records: Sequence[InternalNoticeReadModelEntry]) -> None:
        for record in records:
            self._records[(record.source_corpus, record.source_collection, record.unit_id)] = record

    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records: Sequence[InternalNoticeReadModelEntry],
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
        records: Sequence[InternalNoticeReadModelEntry],
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
    ) -> tuple[InternalNoticeReadModelEntry, ...]:
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

    def search(
        self,
        *,
        source_families: Sequence[str],
        query_text: str,
        max_results: int,
    ) -> tuple[InternalNoticeReadModelEntry, ...]:
        allowed_source_families = {
            str(item).strip() for item in source_families if str(item).strip()
        }
        terms = tuple(str(query_text).strip().casefold().split())
        candidates = (
            record
            for record in self._records.values()
            if record.queryable
            and (not allowed_source_families or record.source_family in allowed_source_families)
        )
        rows = [
            record
            for record in candidates
            if not terms
            or all(term in f"{record.title}\n{record.search_text}".casefold() for term in terms)
        ]
        return tuple(
            sorted(
                rows,
                key=lambda item: (item.published_at_ts, item.source_notice_id),
                reverse=True,
            )[:max_results]
        )

    def get_by_notice_id(
        self,
        *,
        notice_id: str,
        source_family: str = "",
    ) -> InternalNoticeReadModelEntry | None:
        source_family = source_family.strip()
        rows = [
            record
            for record in self._records.values()
            if record.queryable
            and record.source_notice_id == notice_id
            and (not source_family or record.source_family == source_family)
        ]
        if not rows:
            return None
        return sorted(rows, key=lambda item: (item.published_at_ts, item.unit_id), reverse=True)[0]
