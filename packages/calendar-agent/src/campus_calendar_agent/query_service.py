from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from campus_contracts import (
    AcademicCalendarLookupPayload,
    AcademicCalendarLookupResult,
    ActorContext,
    AuthorizationProjection,
)


@dataclass(frozen=True, slots=True)
class CalendarAccessContext:
    actor: ActorContext = field(default_factory=ActorContext)
    authorization: AuthorizationProjection = field(default_factory=AuthorizationProjection)


@dataclass(frozen=True, slots=True)
class AcademicCalendarQuery:
    payload: AcademicCalendarLookupPayload
    access_context: CalendarAccessContext = field(default_factory=CalendarAccessContext)


class CalendarQueryService(Protocol):
    def lookup_academic_calendar(
        self,
        query: AcademicCalendarQuery,
    ) -> AcademicCalendarLookupResult: ...
