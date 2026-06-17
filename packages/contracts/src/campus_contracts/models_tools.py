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
)
from campus_contracts.models_temporal import TemporalQuery
from campus_contracts.models_tools_academic_calendar import (
    AcademicCalendarLookupPayload as AcademicCalendarLookupPayload,
)
from campus_contracts.models_tools_academic_calendar import (
    AcademicCalendarLookupResult as AcademicCalendarLookupResult,
)
from campus_contracts.models_tools_academic_calendar import (
    AcademicCalendarRelatedContext as AcademicCalendarRelatedContext,
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
from campus_contracts.schema_metadata import schema_metadata


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
    contact_id: str = field(
        default="",
        metadata=schema_metadata(description="Known contact id if already resolved."),
    )
    department_query: str = field(
        default="",
        metadata=schema_metadata(description="Department name fragment."),
    )
    office_query: str = field(
        default="",
        metadata=schema_metadata(description="Office name fragment."),
    )
    service_query: str = field(
        default="",
        metadata=schema_metadata(description="Service or task the contact should support."),
    )
    person_query: str = field(
        default="",
        metadata=schema_metadata(description="Person name fragment."),
    )
    role_query: str = field(
        default="",
        metadata=schema_metadata(description="Role name fragment."),
    )
    purpose_query: str = field(
        default="",
        metadata=schema_metadata(description="Reason for contacting."),
    )
    contact_group_query: str = field(
        default="",
        metadata=schema_metadata(description="Contact group fragment."),
    )
    location_query: str = field(
        default="",
        metadata=schema_metadata(description="Location fragment."),
    )

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
    query_text: str = field(
        metadata=schema_metadata(description="Original contact directory question.")
    )
    contact_focus: ContactDirectoryFocus | str = field(
        metadata=schema_metadata(description="Requested contact information focus.")
    )
    entity_selector: ContactDirectoryEntitySelector | None = field(
        default=None,
        metadata=schema_metadata(
            description="Optional selector for the contact entity to resolve."
        ),
    )
    temporal_query: TemporalQuery = field(
        default_factory=TemporalQuery,
        metadata=schema_metadata(description="Optional temporal query constraint."),
    )
    campus_scope: str = field(
        default="",
        metadata=schema_metadata(description="Optional campus scope such as haidian or fengtai."),
    )
    audience: ServiceGuideAudience | str = field(
        default="unknown",
        metadata=schema_metadata(description="Audience for the contact."),
    )
    result_limit: int | None = field(
        default=None,
        metadata=schema_metadata(
            description="Optional positive maximum result count.",
            minimum=1,
        ),
    )

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
    subject_query: str = field(
        metadata=schema_metadata(description="Campus service, facility, or operation to check.")
    )
    temporal_query: TemporalQuery = field(
        default_factory=TemporalQuery,
        metadata=schema_metadata(description="Optional temporal query constraint."),
    )
    campus_scope: str = field(
        default="",
        metadata=schema_metadata(description="Optional campus scope such as haidian or fengtai."),
    )

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
    service_query: str = field(
        metadata=schema_metadata(description="Campus service or process to explain.")
    )
    guide_focus: ServiceGuideFocus | str = field(
        metadata=schema_metadata(description="Requested service guide section.")
    )
    temporal_query: TemporalQuery = field(
        default_factory=TemporalQuery,
        metadata=schema_metadata(description="Optional temporal query constraint."),
    )
    campus_scope: str = field(
        default="",
        metadata=schema_metadata(description="Optional campus scope such as haidian or fengtai."),
    )
    audience: ServiceGuideAudience | str = field(
        default="unknown",
        metadata=schema_metadata(description="Audience for the guide."),
    )
    result_limit: int | None = field(
        default=None,
        metadata=schema_metadata(
            description="Optional positive maximum result count.",
            minimum=1,
        ),
    )

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
