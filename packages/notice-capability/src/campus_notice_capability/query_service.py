from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeChangeSetLookupResult,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    CampusNoticePeriodSummaryPayload,
    CampusNoticePeriodSummaryResult,
)


@dataclass(frozen=True, slots=True)
class NoticeAccessContext:
    actor: ActorContext = field(default_factory=ActorContext)
    authorization: AuthorizationProjection = field(default_factory=AuthorizationProjection)


@dataclass(frozen=True, slots=True)
class NoticeDiscoverQuery:
    payload: CampusNoticeDiscoverPayload
    access_context: NoticeAccessContext = field(default_factory=NoticeAccessContext)


@dataclass(frozen=True, slots=True)
class NoticeGetQuery:
    payload: CampusNoticeGetPayload
    access_context: NoticeAccessContext = field(default_factory=NoticeAccessContext)


@dataclass(frozen=True, slots=True)
class NoticePeriodSummaryQuery:
    payload: CampusNoticePeriodSummaryPayload
    access_context: NoticeAccessContext = field(default_factory=NoticeAccessContext)


@dataclass(frozen=True, slots=True)
class NoticeChangeSetLookupQuery:
    payload: CampusNoticeChangeSetLookupPayload
    access_context: NoticeAccessContext = field(default_factory=NoticeAccessContext)


class NoticeQueryService(Protocol):
    def discover_notice(self, query: NoticeDiscoverQuery) -> CampusNoticeDiscoverResult: ...

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult: ...

    def summarize_notice_period(
        self,
        query: NoticePeriodSummaryQuery,
    ) -> CampusNoticePeriodSummaryResult: ...

    def lookup_notice_change_set(
        self,
        query: NoticeChangeSetLookupQuery,
    ) -> CampusNoticeChangeSetLookupResult: ...
