from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    AcademicCalendarAnswerFocus,
    AcademicCalendarQueryKind,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    _validate_academic_calendar_answer_focus,
    _validate_academic_calendar_query_kind,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
)
from campus_contracts.models_temporal import TemporalQuery
from campus_contracts.schema_metadata import schema_metadata


@dataclass(frozen=True, slots=True)
class AcademicCalendarLookupPayload:
    query_text: str = field(
        metadata=schema_metadata(description="Original academic calendar fact question.")
    )
    query_kind: AcademicCalendarQueryKind | str = field(
        metadata=schema_metadata(description="Deterministic academic calendar fact query kind.")
    )
    answer_focus: AcademicCalendarAnswerFocus | str = field(
        default="",
        metadata=schema_metadata(
            description="Optional answer focus for the academic calendar query."
        ),
    )
    temporal_query: TemporalQuery = field(
        default_factory=TemporalQuery,
        metadata=schema_metadata(description="Optional temporal query constraint."),
    )
    academic_year_label: str = field(
        default="",
        metadata=schema_metadata(
            description="Optional explicit academic year label such as 2026-2027学年."
        ),
    )
    date_hint: str = field(
        default="",
        metadata=schema_metadata(
            description="Optional ISO date to resolve week, holiday, or makeup-class arrangement."
        ),
    )
    event_query: str = field(
        default="",
        metadata=schema_metadata(description="Optional named event query such as 春假 or 劳动节."),
    )
    target_date: str = field(
        default="",
        metadata=schema_metadata(description="Optional ISO date being queried."),
    )
    audience: str = field(
        default="",
        metadata=schema_metadata(description="Optional audience such as student or faculty."),
    )
    term_label: str = field(
        default="",
        metadata=schema_metadata(description="Optional term label such as 春季学期."),
    )

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        if not str(self.query_kind).strip():
            raise ValueError("query_kind must not be empty")
        _validate_academic_calendar_query_kind(str(self.query_kind))
        if self.answer_focus:
            _validate_academic_calendar_answer_focus(str(self.answer_focus))


@dataclass(frozen=True, slots=True)
class AcademicCalendarRelatedContext:
    relation: str
    event_name: str = ""
    event_type: str = ""
    display_start_date: str = ""
    display_end_date: str = ""
    duration_days: int | None = None
    applies_to: tuple[str, ...] = field(default_factory=tuple)
    source_refs: tuple[str, ...] = field(default_factory=tuple)
    source_title: str = ""
    source_url: str = ""

    def __post_init__(self) -> None:
        if not self.relation.strip():
            raise ValueError("relation must not be empty")


@dataclass(frozen=True, slots=True)
class AcademicCalendarLookupResult:
    query_text: str
    outcome: ToolBusinessOutcome
    query_kind: AcademicCalendarQueryKind | str = ""
    answer_focus: AcademicCalendarAnswerFocus | str = ""
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
    event_name: str = ""
    event_type: str = ""
    event_aliases: tuple[str, ...] = field(default_factory=tuple)
    event_start_date: str = ""
    event_end_date_exclusive: str = ""
    display_start_date: str = ""
    display_end_date: str = ""
    applies_to: tuple[str, ...] = field(default_factory=tuple)
    source_title: str = ""
    source_url: str = ""
    calendar_record_id: str = ""
    conflict_refs: tuple[str, ...] = field(default_factory=tuple)
    duration_days: int | None = None
    primary_record_id: str = ""
    primary_source_refs: tuple[str, ...] = field(default_factory=tuple)
    related_calendar_contexts: tuple[AcademicCalendarRelatedContext, ...] = field(
        default_factory=tuple
    )

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        if self.query_kind:
            _validate_academic_calendar_query_kind(self.query_kind)
        if self.answer_focus:
            _validate_academic_calendar_answer_focus(self.answer_focus)
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
                and not self.event_name.strip()
            ):
                raise ValueError(
                    "resolved academic calendar results must include resolved_date, week_index, holiday_name, class_day_pattern, or event_name"
                )
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed academic calendar results"
            )
