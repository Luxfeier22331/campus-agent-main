from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
)


@dataclass(frozen=True, slots=True)
class CampusServicesAccessContext:
    actor: ActorContext = field(default_factory=ActorContext)
    authorization: AuthorizationProjection = field(default_factory=AuthorizationProjection)


@dataclass(frozen=True, slots=True)
class ServiceStatusQuery:
    payload: ServiceStatusLookupPayload
    access_context: CampusServicesAccessContext = field(default_factory=CampusServicesAccessContext)


@dataclass(frozen=True, slots=True)
class TransportScheduleQuery:
    payload: TransportScheduleLookupPayload
    access_context: CampusServicesAccessContext = field(default_factory=CampusServicesAccessContext)


class CampusServicesQueryService(Protocol):
    def lookup_service_status(self, query: ServiceStatusQuery) -> ServiceStatusLookupResult: ...

    def lookup_transport_schedule(
        self,
        query: TransportScheduleQuery,
    ) -> TransportScheduleLookupResult: ...
