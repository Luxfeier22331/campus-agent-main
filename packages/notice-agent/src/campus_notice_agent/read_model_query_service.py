from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from campus_contracts import (
    CampusNoticeDiscoverResult,
    CampusNoticeGetResult,
    NoticeCard,
)

from campus_notice_agent.query_service import (
    NoticeAccessContext,
    NoticeDiscoverQuery,
    NoticeGetQuery,
)

INTERNAL_NOTICE_RESTRICTED_SOURCE_FAMILY = "internal_notice_restricted"


@dataclass(frozen=True, slots=True)
class NoticeReadModelRecord:
    source_family: str
    source_notice_id: str
    title: str
    source_url: str
    canonical_url: str = ""
    published_at: str = ""
    effective_at: str = ""
    target_surface: str = ""
    primary_role: str = ""
    canonical_markdown_object_key: str = ""
    attachment_refs: tuple[str, ...] = field(default_factory=tuple)
    provenance_refs: tuple[str, ...] = field(default_factory=tuple)


class NoticeReadRepository(Protocol):
    def search(
        self,
        *,
        source_families: Sequence[str],
        query_text: str,
        max_results: int,
    ) -> tuple[NoticeReadModelRecord, ...]: ...

    def get_by_notice_id(
        self,
        *,
        notice_id: str,
        source_family: str = "",
    ) -> NoticeReadModelRecord | None: ...


class NoticeBodyRepository(Protocol):
    def get_body(self, object_key: str) -> str: ...


class NoticeBodyObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class ObjectStoreNoticeBodyRepository:
    object_store: NoticeBodyObjectStore
    bucket: str
    encoding: str = "utf-8"

    def get_body(self, object_key: str) -> str:
        normalized_key = object_key.strip()
        if not normalized_key:
            raise LookupError("notice body object key is required")
        payload = self.object_store.get_bytes(bucket=self.bucket, key=normalized_key)
        return payload.decode(self.encoding)


class NoticeReadModelQueryService:
    def __init__(
        self,
        *,
        read_repository: NoticeReadRepository,
        body_repository: NoticeBodyRepository,
    ) -> None:
        self._read_repository = read_repository
        self._body_repository = body_repository

    def discover_notice(self, query: NoticeDiscoverQuery) -> CampusNoticeDiscoverResult:
        source_families = _internal_source_families(query.payload.source_families)
        if not source_families or not _has_internal_notice_access(query.access_context):
            return CampusNoticeDiscoverResult(
                query_text=query.payload.query_text,
                outcome="temporarily_unverifiable",
                source_families=source_families,
                fail_close_reason="source_family_unavailable",
                queried_time_anchor=_queried_time_anchor(),
            )

        rows = self._read_repository.search(
            source_families=source_families,
            query_text=query.payload.query_text,
            max_results=query.payload.max_results,
        )
        if not rows:
            return CampusNoticeDiscoverResult(
                query_text=query.payload.query_text,
                outcome="not_found",
                source_families=source_families,
                queried_time_anchor=_queried_time_anchor(),
            )
        return CampusNoticeDiscoverResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            source_families=source_families,
            notice_cards=tuple(_notice_card(row) for row in rows),
            queried_time_anchor=_queried_time_anchor(),
        )

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        source_family = (
            query.payload.source_family.strip()
            if query.payload.source_family
            else INTERNAL_NOTICE_RESTRICTED_SOURCE_FAMILY
        )
        if (
            source_family != INTERNAL_NOTICE_RESTRICTED_SOURCE_FAMILY
            or not _has_internal_notice_access(query.access_context)
        ):
            return CampusNoticeGetResult(
                notice_id=query.payload.notice_id,
                outcome="temporarily_unverifiable",
                source_family=source_family,
                fail_close_reason="source_family_unavailable",
            )

        row = self._read_repository.get_by_notice_id(
            notice_id=query.payload.notice_id,
            source_family=source_family,
        )
        if row is None:
            return CampusNoticeGetResult(
                notice_id=query.payload.notice_id,
                outcome="not_found",
                source_family=source_family,
            )
        object_key = row.canonical_markdown_object_key.strip()
        if not object_key:
            return CampusNoticeGetResult(
                notice_id=query.payload.notice_id,
                outcome="temporarily_unverifiable",
                source_family=row.source_family,
                fail_close_reason="source_truth_unavailable",
            )
        try:
            body = self._body_repository.get_body(object_key)
        except LookupError:
            return CampusNoticeGetResult(
                notice_id=query.payload.notice_id,
                outcome="temporarily_unverifiable",
                source_family=row.source_family,
                fail_close_reason="source_truth_unavailable",
            )
        if not body.strip():
            return CampusNoticeGetResult(
                notice_id=query.payload.notice_id,
                outcome="temporarily_unverifiable",
                source_family=row.source_family,
                fail_close_reason="source_truth_unavailable",
            )
        return CampusNoticeGetResult(
            notice_id=row.source_notice_id,
            outcome="resolved_current",
            title=row.title,
            source_family=row.source_family,
            source_url=row.source_url,
            canonical_url=row.canonical_url,
            normalized_body=body,
            published_at=row.published_at,
            effective_at=row.effective_at,
            attachment_refs=tuple(row.attachment_refs),
            provenance_refs=tuple(row.provenance_refs),
        )


def _internal_source_families(source_families: Sequence[str]) -> tuple[str, ...]:
    normalized = tuple(str(item).strip() for item in source_families if str(item).strip())
    if not normalized:
        return (INTERNAL_NOTICE_RESTRICTED_SOURCE_FAMILY,)
    return tuple(
        dict.fromkeys(
            item for item in normalized if item == INTERNAL_NOTICE_RESTRICTED_SOURCE_FAMILY
        )
    )


def _has_internal_notice_access(access_context: NoticeAccessContext) -> bool:
    authorization = access_context.authorization
    if not authorization.principal_id.strip():
        return False
    retrieval_filter = authorization.retrieval_filter
    entitlement_groups = tuple(
        item.strip()
        for item in (*authorization.entitlement_groups, *retrieval_filter.entitlement_groups)
        if item.strip()
    )
    return bool(entitlement_groups) and retrieval_filter.visibility_level == "restricted"


def _notice_card(row: NoticeReadModelRecord) -> NoticeCard:
    return NoticeCard(
        notice_id=row.source_notice_id,
        title=row.title,
        source_family=row.source_family,
        source_url=row.source_url,
        canonical_url=row.canonical_url,
        published_at=row.published_at,
        effective_at=row.effective_at,
        is_current=True,
    )


def _queried_time_anchor() -> str:
    return datetime.now(UTC).isoformat()


__all__ = [
    "INTERNAL_NOTICE_RESTRICTED_SOURCE_FAMILY",
    "NoticeBodyObjectStore",
    "NoticeBodyRepository",
    "NoticeReadModelQueryService",
    "NoticeReadModelRecord",
    "NoticeReadRepository",
    "ObjectStoreNoticeBodyRepository",
]
