from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    CoordinateReferenceSystem,
    HistoricalDowngradeReason,
    NoticeSourceFamily,
    NoticeTargetSurface,
    PlaceEntityType,
    ServiceGuideAudience,
    ServiceGuideClarificationReason,
    ServiceGuideFocus,
    ServiceStatusValue,
    TemporalQueryMode,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    TransportDaypart,
    TransportScheduleClarificationReason,
    TransportScheduleIntent,
    TransportServiceDateMode,
    TransportServiceStatusValue,
    _validate_historical_downgrade_reason,
    _validate_notice_source_family,
    _validate_notice_target_surface,
    _validate_service_guide_audience,
    _validate_service_guide_clarification_reason,
    _validate_service_guide_focus,
    _validate_service_status_value,
    _validate_temporal_query_mode,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
    _validate_transport_daypart,
    _validate_transport_schedule_clarification_reason,
    _validate_transport_schedule_intent,
    _validate_transport_service_date_mode,
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
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed service status results"
            )


@dataclass(frozen=True, slots=True)
class ServiceGuideServiceRef:
    service_id: str
    display_name: str
    aliases: tuple[str, ...] = field(default_factory=tuple)
    category: str = ""
    campus_scope: str = ""
    audience: tuple[ServiceGuideAudience | str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.service_id.strip():
            raise ValueError("service_id must not be empty")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")
        for item in self.audience:
            _validate_service_guide_audience(item)


@dataclass(frozen=True, slots=True)
class ServiceGuideSection:
    section_type: ServiceGuideFocus | str
    title: str
    content: str
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.section_type == "full_guide":
            raise ValueError("section_type must be a concrete service guide section")
        _validate_service_guide_focus(self.section_type)
        if not self.title.strip():
            raise ValueError("title must not be empty")
        if not self.content.strip():
            raise ValueError("content must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceGuideMaterial:
    name: str
    required: bool
    note: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("name must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceGuideEntryRef:
    label: str
    entry_type: str
    url: str = ""
    location_ref: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.label.strip():
            raise ValueError("label must not be empty")
        if self.entry_type not in {
            "online_url",
            "offline_location",
            "phone",
            "email",
            "instructions_only",
        }:
            raise ValueError(f"unsupported service guide entry_type: {self.entry_type}")
        if self.entry_type == "online_url" and not self.url.strip():
            raise ValueError("url must not be empty for online_url entry")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceGuideOfficeHours:
    label: str
    day_pattern: str = ""
    time_range: str = ""
    effective_note: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.label.strip():
            raise ValueError("label must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceGuideContactRef:
    label: str
    department: str = ""
    phone: str = ""
    email: str = ""
    location_ref: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.label.strip():
            raise ValueError("label must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceGuideCandidate:
    service: ServiceGuideServiceRef
    clarification_hint: str = ""


@dataclass(frozen=True, slots=True)
class ServiceGuideLookupPayload:
    service_query: str
    guide_focus: ServiceGuideFocus | str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    campus_scope: str = ""
    audience: ServiceGuideAudience | str = "unknown"
    result_limit: int | None = None

    def __post_init__(self) -> None:
        if not self.service_query.strip():
            raise ValueError("service_query must not be empty")
        _validate_service_guide_focus(self.guide_focus)
        _validate_service_guide_audience(self.audience)
        if self.result_limit is not None and self.result_limit <= 0:
            raise ValueError("result_limit must be positive")


@dataclass(frozen=True, slots=True)
class ServiceGuideLookupResult:
    service_query: str
    guide_focus: ServiceGuideFocus | str
    outcome: ToolBusinessOutcome
    resolved_service: ServiceGuideServiceRef | None = None
    guide_sections: tuple[ServiceGuideSection, ...] = field(default_factory=tuple)
    required_materials: tuple[ServiceGuideMaterial, ...] = field(default_factory=tuple)
    entry_refs: tuple[ServiceGuideEntryRef, ...] = field(default_factory=tuple)
    office_hours: tuple[ServiceGuideOfficeHours, ...] = field(default_factory=tuple)
    contact_refs: tuple[ServiceGuideContactRef, ...] = field(default_factory=tuple)
    eligibility_notes: tuple[str, ...] = field(default_factory=tuple)
    source_refs: tuple[str, ...] = field(default_factory=tuple)
    candidate_services: tuple[ServiceGuideCandidate, ...] = field(default_factory=tuple)
    queried_time_anchor: str = ""
    effective_from: str = ""
    effective_until: str = ""
    clarification_reason: ServiceGuideClarificationReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)
    matched_service_category: str = ""

    def __post_init__(self) -> None:
        if not self.service_query.strip():
            raise ValueError("service_query must not be empty")
        _validate_service_guide_focus(self.guide_focus)
        _validate_tool_business_outcome(self.outcome)
        if self.clarification_reason:
            _validate_service_guide_clarification_reason(self.clarification_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if self.resolved_service is None:
                raise ValueError("resolved_service must not be empty for resolved service guide")
            if not self.source_refs:
                raise ValueError("source_refs must not be empty for resolved service guide")
        if self.outcome == "clarification_required" and not self.clarification_reason:
            raise ValueError(
                "clarification_reason must not be empty for clarification-required service guide results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed service guide results"
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
class TransportRouteSelector:
    route_id: str = ""
    service_family: str = ""
    route_variant_query: str = ""
    origin_campus: str = ""
    destination_campus: str = ""
    origin_stop_query: str = ""
    destination_stop_query: str = ""


@dataclass(frozen=True, slots=True)
class TransportServiceTimeQuery:
    date_mode: TransportServiceDateMode | str = "today"
    service_date: str = ""
    daypart: TransportDaypart | str = "all_day"
    departure_not_before: str = ""
    departure_not_after: str = ""

    def __post_init__(self) -> None:
        _validate_transport_service_date_mode(self.date_mode)
        _validate_transport_daypart(self.daypart)
        normalized_service_date = self.service_date.strip()
        normalized_departure_not_before = self.departure_not_before.strip()
        normalized_departure_not_after = self.departure_not_after.strip()
        if normalized_service_date != self.service_date:
            object.__setattr__(self, "service_date", normalized_service_date)
        if normalized_departure_not_before != self.departure_not_before:
            object.__setattr__(self, "departure_not_before", normalized_departure_not_before)
        if normalized_departure_not_after != self.departure_not_after:
            object.__setattr__(self, "departure_not_after", normalized_departure_not_after)
        if self.date_mode == "date":
            if not normalized_service_date:
                raise ValueError("service_date is required when date_mode is date")
        elif normalized_service_date:
            raise ValueError("service_date is only allowed when date_mode is date")
        if (
            normalized_departure_not_before
            and normalized_departure_not_after
            and normalized_departure_not_before > normalized_departure_not_after
        ):
            raise ValueError("departure_not_before must not be later than departure_not_after")


@dataclass(frozen=True, slots=True)
class TransportRouteRef:
    route_id: str
    display_name: str
    service_family: str

    def __post_init__(self) -> None:
        if not self.route_id.strip():
            raise ValueError("route_id must not be empty")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")
        if not self.service_family.strip():
            raise ValueError("service_family must not be empty")


@dataclass(frozen=True, slots=True)
class ScheduledDeparture:
    departure_at: str
    arrival_at: str = ""
    origin_stop_ref: TransportStopRef | None = None
    destination_stop_ref: TransportStopRef | None = None

    def __post_init__(self) -> None:
        if not self.departure_at.strip():
            raise ValueError("departure_at must not be empty")


@dataclass(frozen=True, slots=True)
class TransportServiceWindow:
    first_departure_at: str = ""
    last_departure_at: str = ""


@dataclass(frozen=True, slots=True)
class TransportScheduleSnapshotRef:
    snapshot_id: str
    published_at: str
    effective_from: str = ""
    effective_until: str = ""
    source_ref: str = ""

    def __post_init__(self) -> None:
        if not self.snapshot_id.strip():
            raise ValueError("snapshot_id must not be empty")
        if not self.published_at.strip():
            raise ValueError("published_at must not be empty")
        if not self.source_ref.strip():
            raise ValueError("source_ref must not be empty")


@dataclass(frozen=True, slots=True)
class TransportRouteCandidate:
    route: TransportRouteRef
    clarification_hint: str = ""


@dataclass(frozen=True, slots=True)
class TransportScheduleLookupPayload:
    query_text: str
    intent: TransportScheduleIntent | str
    route_selector: TransportRouteSelector | None = None
    snapshot_query: TemporalQuery = field(default_factory=TemporalQuery)
    service_time_query: TransportServiceTimeQuery | None = None
    result_limit: int | None = None

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_transport_schedule_intent(self.intent)
        if self.result_limit is not None and self.result_limit <= 0:
            raise ValueError("result_limit must be positive")
        if self.intent == "schedule_snapshot_metadata" and self.service_time_query is not None:
            raise ValueError(
                "service_time_query is not allowed for schedule_snapshot_metadata intent"
            )


@dataclass(frozen=True, slots=True)
class TransportScheduleLookupResult:
    query_text: str
    intent: TransportScheduleIntent | str
    outcome: ToolBusinessOutcome
    resolved_route: TransportRouteRef | None = None
    service_status: TransportServiceStatusValue | str = field(default="", compare=False)
    queried_time_anchor: str = ""
    requested_service_date: str = ""
    selected_departure: ScheduledDeparture | None = None
    departure_options: tuple[ScheduledDeparture, ...] = field(default_factory=tuple)
    service_window: TransportServiceWindow | None = None
    schedule_snapshot: TransportScheduleSnapshotRef | None = None
    timetable_entries: tuple[ScheduledDeparture, ...] = field(default_factory=tuple)
    candidate_routes: tuple[TransportRouteCandidate, ...] = field(default_factory=tuple)
    clarification_reason: TransportScheduleClarificationReason | str = field(
        default="", compare=False
    )
    stop_refs: tuple[TransportStopRef, ...] = field(default_factory=tuple)
    related_notice_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_transport_schedule_intent(self.intent)
        _validate_tool_business_outcome(self.outcome)
        if self.service_status:
            _validate_transport_service_status_value(self.service_status)
        if self.clarification_reason:
            _validate_transport_schedule_clarification_reason(self.clarification_reason)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if (
            self.outcome == "resolved_current"
            and self.intent != "schedule_snapshot_metadata"
            and self.resolved_route is None
        ):
            raise ValueError("resolved_route must not be empty for resolved transport schedule")
        if self.outcome == "clarification_required" and not self.clarification_reason:
            raise ValueError(
                "clarification_reason must not be empty for clarification-required transport schedule results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed transport schedule results"
            )
        if self.selected_departure is not None and (
            self.departure_options or self.timetable_entries or self.service_window is not None
        ):
            raise ValueError(
                "selected_departure must not be combined with departure_options, timetable_entries, or service_window"
            )
        if self.outcome == "temporarily_unverifiable" and (
            self.selected_departure is not None
            or self.departure_options
            or self.timetable_entries
            or self.service_window is not None
        ):
            raise ValueError(
                "fail-closed transport schedule results must not carry resolved schedule payload fields"
            )


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverPayload:
    query_text: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    source_families: tuple[NoticeSourceFamily | str, ...] = field(default_factory=tuple)
    target_surfaces: tuple[NoticeTargetSurface | str, ...] = field(default_factory=tuple)
    max_results: int = 5

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        for target_surface in self.target_surfaces:
            _validate_notice_target_surface(target_surface)
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
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed notice get results"
            )
