from __future__ import annotations

from dataclasses import dataclass, field

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
    NoticeCard as NoticeCard,
)
from campus_contracts.models_notice import (
    NoticeContextProjection as NoticeContextProjection,
)
from campus_contracts.models_notice import (
    NoticeDisplayPolicy as NoticeDisplayPolicy,
)
from campus_contracts.models_shared import (
    ContactDirectoryChannelType,
    ContactDirectoryClarificationReason,
    ContactDirectoryEntityType,
    ContactDirectoryFocus,
    CoordinateReferenceSystem,
    HistoricalDowngradeReason,
    PlaceEntityType,
    ServiceGuideAudience,
    ServiceGuideClarificationReason,
    ServiceGuideFocus,
    ServiceStatusValue,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    TransportDaypart,
    TransportScheduleClarificationReason,
    TransportScheduleIntent,
    TransportServiceDateMode,
    TransportServiceStatusValue,
    _validate_contact_directory_channel_type,
    _validate_contact_directory_clarification_reason,
    _validate_contact_directory_entity_type,
    _validate_contact_directory_focus,
    _validate_historical_downgrade_reason,
    _validate_service_guide_audience,
    _validate_service_guide_clarification_reason,
    _validate_service_guide_focus,
    _validate_service_status_value,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
    _validate_transport_daypart,
    _validate_transport_schedule_clarification_reason,
    _validate_transport_schedule_intent,
    _validate_transport_service_date_mode,
    _validate_transport_service_status_value,
)
from campus_contracts.models_temporal import TemporalQuery


@dataclass(frozen=True, slots=True)
class AcademicCalendarLookupPayload:
    query_text: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    academic_year_label: str = ""
    date_hint: str = ""

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")


@dataclass(frozen=True, slots=True)
class AcademicCalendarLookupResult:
    query_text: str
    outcome: ToolBusinessOutcome
    requested_date: str = ""
    resolved_date: str = ""
    academic_year_label: str = ""
    term_label: str = ""
    week_index: int | None = None
    day_kind: str = ""
    class_day_pattern: str = ""
    is_makeup_class: bool | None = None
    holiday_name: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)
    queried_time_anchor: str = ""
    effective_from: str = ""
    effective_until: str = ""
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if not self.source_refs:
                raise ValueError("source_refs must not be empty for resolved academic calendar")
            if (
                not self.resolved_date.strip()
                and self.week_index is None
                and not self.holiday_name.strip()
                and not self.class_day_pattern.strip()
            ):
                raise ValueError(
                    "resolved academic calendar results must include resolved_date, week_index, holiday_name, or class_day_pattern"
                )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed academic calendar results"
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
class ContactDirectoryEntitySelector:
    contact_id: str = ""
    department_query: str = ""
    office_query: str = ""
    service_query: str = ""
    person_query: str = ""
    role_query: str = ""
    purpose_query: str = ""
    contact_group_query: str = ""
    location_query: str = ""

    def __post_init__(self) -> None:
        if self.contact_id and not self.contact_id.strip():
            raise ValueError("contact_id must not be empty when provided")


@dataclass(frozen=True, slots=True)
class ContactDirectoryContactRef:
    contact_id: str
    display_name: str
    aliases: tuple[str, ...] = field(default_factory=tuple)
    entity_type: ContactDirectoryEntityType | str = "department"
    department: str = ""
    contact_group: str = ""
    campus_scope: str = ""
    audience: tuple[ServiceGuideAudience | str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.contact_id.strip():
            raise ValueError("contact_id must not be empty")
        if not self.display_name.strip():
            raise ValueError("display_name must not be empty")
        _validate_contact_directory_entity_type(self.entity_type)
        for item in self.audience:
            _validate_service_guide_audience(item)


@dataclass(frozen=True, slots=True)
class ContactDirectoryContactPoint:
    channel_type: ContactDirectoryChannelType | str
    label: str
    value: str
    normalized_value: str = ""
    contact_type: str = ""
    area_served: str = ""
    available_language: str = ""
    hours_ref: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        _validate_contact_directory_channel_type(self.channel_type)
        if not self.label.strip():
            raise ValueError("label must not be empty")
        if not self.value.strip():
            raise ValueError("value must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ContactDirectoryLocationRef:
    label: str
    location_ref: str = ""
    address_text: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.label.strip():
            raise ValueError("label must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ContactDirectoryOfficeHours:
    hours_id: str
    label: str
    day_pattern: str = ""
    time_range: str = ""
    effective_note: str = ""
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.hours_id.strip():
            raise ValueError("hours_id must not be empty")
        if not self.label.strip():
            raise ValueError("label must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ContactDirectoryCandidate:
    contact: ContactDirectoryContactRef
    clarification_hint: str = ""


@dataclass(frozen=True, slots=True)
class ContactDirectoryLookupPayload:
    query_text: str
    contact_focus: ContactDirectoryFocus | str
    entity_selector: ContactDirectoryEntitySelector | None = None
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    campus_scope: str = ""
    audience: ServiceGuideAudience | str = "unknown"
    result_limit: int | None = None

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_contact_directory_focus(self.contact_focus)
        _validate_service_guide_audience(self.audience)
        if self.result_limit is not None and self.result_limit <= 0:
            raise ValueError("result_limit must be positive")


@dataclass(frozen=True, slots=True)
class ContactDirectoryLookupResult:
    query_text: str
    contact_focus: ContactDirectoryFocus | str
    outcome: ToolBusinessOutcome
    resolved_contact: ContactDirectoryContactRef | None = None
    contact_points: tuple[ContactDirectoryContactPoint, ...] = field(default_factory=tuple)
    location_refs: tuple[ContactDirectoryLocationRef, ...] = field(default_factory=tuple)
    office_hours: tuple[ContactDirectoryOfficeHours, ...] = field(default_factory=tuple)
    candidate_contacts: tuple[ContactDirectoryCandidate, ...] = field(default_factory=tuple)
    source_refs: tuple[str, ...] = field(default_factory=tuple)
    queried_time_anchor: str = ""
    effective_from: str = ""
    effective_until: str = ""
    clarification_reason: ContactDirectoryClarificationReason | str = field(
        default="", compare=False
    )
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)
    field_status: dict[str, str] = field(default_factory=dict, compare=False)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_contact_directory_focus(self.contact_focus)
        _validate_tool_business_outcome(self.outcome)
        if self.clarification_reason:
            _validate_contact_directory_clarification_reason(self.clarification_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome == "resolved_current":
            if self.resolved_contact is None:
                raise ValueError(
                    "resolved_contact must not be empty for resolved contact directory"
                )
            if not (self.contact_points or self.location_refs or self.office_hours):
                raise ValueError(
                    "resolved contact directory results must include contact_points, location_refs, or office_hours"
                )
            if not self.source_refs:
                raise ValueError("source_refs must not be empty for resolved contact directory")
        if self.outcome == "clarification_required" and not self.clarification_reason:
            raise ValueError(
                "clarification_reason must not be empty for clarification-required contact directory results"
            )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed contact directory results"
            )


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
    status_note: str = ""
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
    section_id: str
    section_type: ServiceGuideFocus | str
    title: str
    content: str
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.section_id.strip():
            raise ValueError("section_id must not be empty")
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
class ServiceGuideProcedureStep:
    step_id: str
    content: str
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.step_id.strip():
            raise ValueError("step_id must not be empty")
        if not self.content.strip():
            raise ValueError("content must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


@dataclass(frozen=True, slots=True)
class ServiceGuideProcedureGroup:
    group_id: str
    title: str
    focus_tags: tuple[str, ...] = field(default_factory=tuple)
    steps: tuple[ServiceGuideProcedureStep, ...] = field(default_factory=tuple)
    source_refs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.group_id.strip():
            raise ValueError("group_id must not be empty")
        if not self.title.strip():
            raise ValueError("title must not be empty")
        if not self.steps:
            raise ValueError("steps must not be empty")
        if not self.source_refs:
            raise ValueError("source_refs must not be empty")


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
    procedure_groups: tuple[ServiceGuideProcedureGroup, ...] = field(default_factory=tuple)
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
    selected_section_ids: tuple[str, ...] = field(default_factory=tuple)
    omitted_section_ids: tuple[str, ...] = field(default_factory=tuple)
    omitted_section_reasons: dict[str, str] = field(default_factory=dict, compare=False)
    field_status: dict[str, str] = field(default_factory=dict, compare=False)

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
class TransportOperationalNotice:
    notice_id: str
    source_ref: str
    notice_kind: str
    route_ids: tuple[str, ...] = field(default_factory=tuple)
    effective_from: str = ""
    effective_until: str = ""
    operational_comment: str = ""

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if not self.source_ref.strip():
            raise ValueError("source_ref must not be empty")
        if not self.notice_kind.strip():
            raise ValueError("notice_kind must not be empty")


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
    operational_notices: tuple[TransportOperationalNotice, ...] = field(default_factory=tuple)
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
