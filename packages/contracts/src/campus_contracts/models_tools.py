from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    CoordinateReferenceSystem,
    HistoricalDowngradeReason,
    NoticeSourceFamily,
    PlaceEntityType,
    ServiceStatusValue,
    TemporalQueryMode,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    TransportServiceStatusValue,
    _validate_historical_downgrade_reason,
    _validate_notice_source_family,
    _validate_service_status_value,
    _validate_temporal_query_mode,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
    _validate_transport_service_status_value,
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


@dataclass(frozen=True, slots=True)
class TemporalQuery:
    mode: TemporalQueryMode = "current"
    as_of: str = ""
    year_hint: str = ""

    def __post_init__(self) -> None:
        _validate_temporal_query_mode(self.mode)
        normalized_as_of = self.as_of.strip()
        normalized_year_hint = self.year_hint.strip()
        if normalized_as_of != self.as_of:
            object.__setattr__(self, "as_of", normalized_as_of)
        if normalized_year_hint != self.year_hint:
            object.__setattr__(self, "year_hint", normalized_year_hint)
        if self.mode == "as_of":
            if not normalized_as_of:
                raise ValueError("as_of is required when temporal mode is as_of")
        elif normalized_as_of:
            raise ValueError("as_of is only allowed when temporal mode is as_of")
        if self.mode == "current_year":
            if not normalized_year_hint:
                raise ValueError("year_hint is required when temporal mode is current_year")
        elif normalized_year_hint:
            raise ValueError("year_hint is only allowed when temporal mode is current_year")


@dataclass(frozen=True, slots=True)
class NoticeCard:
    notice_id: str
    title: str
    source_family: NoticeSourceFamily | str
    source_url: str
    canonical_url: str = ""
    summary: str = ""
    published_at: str = ""
    effective_at: str = ""
    is_current: bool = False

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if not self.title.strip():
            raise ValueError("title must not be empty")
        _validate_notice_source_family(self.source_family)
        if not self.source_url.strip():
            raise ValueError("source_url must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceStatusLookupPayload:
    subject_query: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    campus_scope: str = ""

    def __post_init__(self) -> None:
        if not self.subject_query.strip():
            raise ValueError("subject_query must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceStatusLookupResult:
    subject_query: str
    outcome: ToolBusinessOutcome
    resolved_subject: str = ""
    observed_status: ServiceStatusValue | str = field(default="", compare=False)
    queried_time_anchor: str = ""
    effective_from: str = ""
    effective_until: str = ""
    override_source_refs: tuple[str, ...] = field(default_factory=tuple)
    related_notice_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.subject_query.strip():
            raise ValueError("subject_query must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.observed_status:
            _validate_service_status_value(self.observed_status)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if not self.resolved_subject.strip():
                raise ValueError("resolved_subject must not be empty for resolved service status")
            if not self.observed_status:
                raise ValueError("observed_status must not be empty for resolved service status")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError(
                "historical_downgrade_reason must not be empty for historical service status results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed service status results"
            )


@dataclass(frozen=True, slots=True)
class TransportStopRef:
    stop_id: str
    display_name: str

    def __post_init__(self) -> None:
        if not self.stop_id.strip():
            raise ValueError("stop_id must not be empty")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")


@dataclass(frozen=True, slots=True)
class TransportScheduleLookupPayload:
    route_query: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    origin_stop_query: str = ""
    destination_stop_query: str = ""

    def __post_init__(self) -> None:
        if not self.route_query.strip():
            raise ValueError("route_query must not be empty")


@dataclass(frozen=True, slots=True)
class TransportScheduleLookupResult:
    route_query: str
    outcome: ToolBusinessOutcome
    resolved_route: str = ""
    service_status: TransportServiceStatusValue | str = field(default="", compare=False)
    queried_time_anchor: str = ""
    window_start: str = ""
    window_end: str = ""
    stop_refs: tuple[TransportStopRef, ...] = field(default_factory=tuple)
    related_notice_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.route_query.strip():
            raise ValueError("route_query must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.service_status:
            _validate_transport_service_status_value(self.service_status)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if not self.resolved_route.strip():
                raise ValueError("resolved_route must not be empty for resolved transport schedule")
            if not self.service_status:
                raise ValueError("service_status must not be empty for resolved transport schedule")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError(
                "historical_downgrade_reason must not be empty for historical transport schedule results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed transport schedule results"
            )


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverPayload:
    query_text: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    source_families: tuple[NoticeSourceFamily | str, ...] = field(default_factory=tuple)
    max_results: int = 5

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        if self.max_results <= 0:
            raise ValueError("max_results must be positive")


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverResult:
    query_text: str
    outcome: ToolBusinessOutcome
    source_families: tuple[NoticeSourceFamily | str, ...] = field(
        default_factory=tuple, compare=False
    )
    notice_cards: tuple[NoticeCard, ...] = field(default_factory=tuple)
    queried_time_anchor: str = ""
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_tool_business_outcome(self.outcome)
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if (
            self.outcome in {"resolved_current", "resolved_historical_reference"}
            and not self.notice_cards
        ):
            raise ValueError("notice_cards must not be empty for resolved notice discovery results")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError(
                "historical_downgrade_reason must not be empty for historical notice discovery"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed notice discovery results"
            )


@dataclass(frozen=True, slots=True)
class CampusNoticeGetPayload:
    notice_id: str
    source_family: NoticeSourceFamily | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if self.source_family:
            _validate_notice_source_family(self.source_family)


@dataclass(frozen=True, slots=True)
class CampusNoticeGetResult:
    notice_id: str
    outcome: ToolBusinessOutcome
    title: str = ""
    source_family: NoticeSourceFamily | str = field(default="", compare=False)
    source_url: str = ""
    canonical_url: str = ""
    normalized_body: str = ""
    published_at: str = ""
    effective_at: str = ""
    attachment_refs: tuple[str, ...] = field(default_factory=tuple)
    provenance_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.source_family:
            _validate_notice_source_family(self.source_family)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome in {"resolved_current", "resolved_historical_reference"}:
            if not self.title.strip():
                raise ValueError("title must not be empty for resolved notice results")
            if not self.source_family:
                raise ValueError("source_family must not be empty for resolved notice results")
            if not self.source_url.strip():
                raise ValueError("source_url must not be empty for resolved notice results")
            if not self.normalized_body.strip():
                raise ValueError("normalized_body must not be empty for resolved notice results")
        if self.outcome == "resolved_historical_reference" and not self.historical_downgrade_reason:
            raise ValueError(
                "historical_downgrade_reason must not be empty for historical notice get results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed notice get results"
            )
