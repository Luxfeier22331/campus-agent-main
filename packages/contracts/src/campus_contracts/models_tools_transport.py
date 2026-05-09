from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    HistoricalDowngradeReason,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    TransportDaypart,
    TransportScheduleClarificationReason,
    TransportScheduleIntent,
    TransportServiceDateMode,
    TransportServiceStatusValue,
    _validate_historical_downgrade_reason,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
    _validate_transport_daypart,
    _validate_transport_schedule_clarification_reason,
    _validate_transport_schedule_intent,
    _validate_transport_service_date_mode,
    _validate_transport_service_status_value,
)
from campus_contracts.models_temporal import TemporalQuery
from campus_contracts.schema_metadata import schema_metadata


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
    route_id: str = field(
        default="",
        metadata=schema_metadata(description="Known route id if already resolved."),
    )
    service_family: str = field(
        default="",
        metadata=schema_metadata(
            description="Service family such as intercampus or metro shuttle."
        ),
    )
    route_variant_query: str = field(
        default="",
        metadata=schema_metadata(description="Route variant words from the user query."),
    )
    origin_campus: str = field(
        default="",
        metadata=schema_metadata(description="Origin campus if stated."),
    )
    destination_campus: str = field(
        default="",
        metadata=schema_metadata(description="Destination campus if stated."),
    )
    origin_stop_query: str = field(
        default="",
        metadata=schema_metadata(description="Origin stop if stated."),
    )
    destination_stop_query: str = field(
        default="",
        metadata=schema_metadata(description="Destination stop if stated."),
    )


@dataclass(frozen=True, slots=True)
class TransportServiceTimeQuery:
    date_mode: TransportServiceDateMode | str = field(
        default="today",
        metadata=schema_metadata(description="Service date interpretation."),
    )
    service_date: str = field(
        default="",
        metadata=schema_metadata(description="ISO date when date_mode is date."),
    )
    daypart: TransportDaypart | str = field(
        default="all_day",
        metadata=schema_metadata(description="Requested daypart."),
    )
    departure_not_before: str = field(
        default="",
        metadata=schema_metadata(description="Lower bound departure time in HH:MM if stated."),
    )
    departure_not_after: str = field(
        default="",
        metadata=schema_metadata(description="Upper bound departure time in HH:MM if stated."),
    )

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
    query_text: str = field(
        metadata=schema_metadata(description="Original transport schedule question.")
    )
    intent: TransportScheduleIntent | str = field(
        metadata=schema_metadata(description="Transport schedule lookup intent.")
    )
    route_selector: TransportRouteSelector | None = field(
        default=None,
        metadata=schema_metadata(description="Optional route selection hints."),
    )
    snapshot_query: TemporalQuery = field(
        default_factory=TemporalQuery,
        metadata=schema_metadata(description="Optional temporal query constraint."),
    )
    service_time_query: TransportServiceTimeQuery | None = field(
        default=None,
        metadata=schema_metadata(description="Optional service time constraints."),
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
