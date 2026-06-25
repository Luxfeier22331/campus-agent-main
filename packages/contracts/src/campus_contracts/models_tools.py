from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_notice import (
    CampusNoticeChangeSetLookupPayload as CampusNoticeChangeSetLookupPayload,
)
from campus_contracts.models_notice import (
    CampusNoticeChangeSetLookupResult as CampusNoticeChangeSetLookupResult,
)
from campus_contracts.models_notice import (
    CampusNoticeDiscoverPayload as CampusNoticeDiscoverPayload,
)
from campus_contracts.models_notice import (
    CampusNoticeDiscoverResult as CampusNoticeDiscoverResult,
)
from campus_contracts.models_notice import (
    CampusNoticeGetPayload as CampusNoticeGetPayload,
)
from campus_contracts.models_notice import (
    CampusNoticeGetResult as CampusNoticeGetResult,
)
from campus_contracts.models_notice import (
    CampusNoticePeriodSummaryPayload as CampusNoticePeriodSummaryPayload,
)
from campus_contracts.models_notice import (
    CampusNoticePeriodSummaryResult as CampusNoticePeriodSummaryResult,
)
from campus_contracts.models_notice import (
    NoticeCard as NoticeCard,
)
from campus_contracts.models_notice import (
    NoticeContextProjection as NoticeContextProjection,
)
from campus_contracts.models_notice import (
    NoticeDateRange as NoticeDateRange,
)
from campus_contracts.models_notice import (
    NoticeDisplayPolicy as NoticeDisplayPolicy,
)
from campus_contracts.models_notice import (
    NoticePeriodSummaryGroup as NoticePeriodSummaryGroup,
)
from campus_contracts.models_shared import (
    CoordinateReferenceSystem,
    PlaceEntityType,
)
from campus_contracts.models_tools_transport import (
    ScheduledDeparture as ScheduledDeparture,
)
from campus_contracts.models_tools_transport import (
    TransportOperationalNotice as TransportOperationalNotice,
)
from campus_contracts.models_tools_transport import (
    TransportRouteCandidate as TransportRouteCandidate,
)
from campus_contracts.models_tools_transport import (
    TransportRouteRef as TransportRouteRef,
)
from campus_contracts.models_tools_transport import (
    TransportRouteSelector as TransportRouteSelector,
)
from campus_contracts.models_tools_transport import (
    TransportScheduleLookupPayload as TransportScheduleLookupPayload,
)
from campus_contracts.models_tools_transport import (
    TransportScheduleLookupResult as TransportScheduleLookupResult,
)
from campus_contracts.models_tools_transport import (
    TransportScheduleSnapshotRef as TransportScheduleSnapshotRef,
)
from campus_contracts.models_tools_transport import (
    TransportServiceTimeQuery as TransportServiceTimeQuery,
)
from campus_contracts.models_tools_transport import (
    TransportServiceWindow as TransportServiceWindow,
)
from campus_contracts.models_tools_transport import (
    TransportStopRef as TransportStopRef,
)


@dataclass(frozen=True, slots=True)
class GeoPoint:
    longitude: float
    latitude: float

    def __post_init__(self) -> None:
        if not -180.0 <= self.longitude <= 180.0:
            raise ValueError("longitude must be within [-180, 180]")
        if not -90.0 <= self.latitude <= 90.0:
            raise ValueError("latitude must be within [-90, 90]")


@dataclass(frozen=True, slots=True)
class PlaceRef:
    place_id: str
    entity_type: PlaceEntityType
    display_name: str
    campus_scope: str
    campus_area: str = ""

    def __post_init__(self) -> None:
        if not self.place_id.strip():
            raise ValueError("place_id must not be empty")
        if self.entity_type not in {"building", "service_point", "office", "gate", "stop"}:
            raise ValueError(f"unsupported place entity_type: {self.entity_type}")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")
        if not self.campus_scope.strip():
            raise ValueError("campus_scope must not be empty")


@dataclass(frozen=True, slots=True)
class PlaceCard:
    place: PlaceRef
    location_description: str
    landmark_hint: str = ""
    access_note: str = ""
    opening_note: str = ""
    service_tags: tuple[str, ...] = field(default_factory=tuple)
    point_geometry: GeoPoint | None = None
    coordinate_reference_system: CoordinateReferenceSystem | str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.location_description.strip():
            raise ValueError("location_description must not be empty")
        if self.point_geometry is not None and not self.coordinate_reference_system.strip():
            object.__setattr__(self, "coordinate_reference_system", "EPSG:4326")


@dataclass(frozen=True, slots=True)
class PlaceCandidate:
    place: PlaceRef
    clarification_hint: str = ""


@dataclass(frozen=True, slots=True)
class PlaceLookupPayload:
    query_text: str

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")


@dataclass(frozen=True, slots=True)
class PlaceLookupResult:
    query_text: str
    matched_alias: str = ""
    resolved_place: PlaceRef | None = None
    place_card: PlaceCard | None = None
    candidate_places: tuple[PlaceCandidate, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
