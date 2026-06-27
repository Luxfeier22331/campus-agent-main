from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts.models_shared import (
    ALLOWED_TOOL_NAMES,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    ToolName,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
)
from campus_contracts.models_tools_transport import TransportScheduleLookupResult

CAMPUS_SERVICES_TOOL_RESULT_SCHEMA_VERSION = "campus_services_tool_result.v1"

CampusServicesQueryKind = Literal["transport_schedule",]
CampusServicesFactKind = Literal["schedule_facts",]

ALLOWED_CAMPUS_SERVICES_QUERY_KINDS = ("transport_schedule",)
ALLOWED_CAMPUS_SERVICES_FACT_KINDS = ("schedule_facts",)

_FORBIDDEN_PROJECTION_TOKENS = (
    "raw_sql",
    "raw_source",
    "raw_html",
    "source_html",
    "object_locator",
    "object_store_key",
    "provider_raw_response",
)


@dataclass(frozen=True, slots=True)
class CampusServicesScheduleFacts:
    result: TransportScheduleLookupResult
    kind: CampusServicesFactKind = "schedule_facts"

    def __post_init__(self) -> None:
        _validate_campus_services_fact_kind(self.kind)
        if self.kind != "schedule_facts":
            raise ValueError("CampusServicesScheduleFacts kind must be schedule_facts")


CampusServicesFacts = CampusServicesScheduleFacts


@dataclass(frozen=True, slots=True)
class CampusServicesToolResultEnvelope:
    tool_name: ToolName | str
    query_kind: CampusServicesQueryKind | str
    outcome: ToolBusinessOutcome | str
    facts: CampusServicesFacts
    source_refs: tuple[str, ...] = field(default_factory=tuple)
    projection_ref: str = ""
    content_hash: str = ""
    clarification_options: tuple[str, ...] = field(default_factory=tuple)
    fail_close_reason: ToolFailCloseReason | str = ""
    schema_version: str = CAMPUS_SERVICES_TOOL_RESULT_SCHEMA_VERSION
    tool: str = "transport_schedule_lookup"

    def __post_init__(self) -> None:
        if self.schema_version != CAMPUS_SERVICES_TOOL_RESULT_SCHEMA_VERSION:
            raise ValueError("schema_version must be campus_services_tool_result.v1")
        if self.tool != "transport_schedule_lookup":
            raise ValueError("tool must be transport_schedule_lookup")
        _validate_tool_name(str(self.tool_name))
        _validate_campus_services_query_kind(self.query_kind)
        _validate_tool_business_outcome(self.outcome)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if (
            self.outcome in {"resolved_current", "resolved_historical_reference", "not_found"}
            and not self.source_refs
        ):
            raise ValueError("source_refs must not be empty")
        if not self.projection_ref.strip():
            raise ValueError("projection_ref must not be empty")
        if not self.content_hash.strip():
            raise ValueError("content_hash must not be empty")
        _reject_forbidden_projection_ref(self.projection_ref)
        for source_ref in self.source_refs:
            _reject_forbidden_projection_ref(source_ref)
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed campus services results"
            )


def _validate_campus_services_query_kind(value: str) -> None:
    if value not in ALLOWED_CAMPUS_SERVICES_QUERY_KINDS:
        raise ValueError(f"unsupported campus_services query_kind: {value}")


def _validate_tool_name(value: str) -> None:
    if value not in ALLOWED_TOOL_NAMES:
        raise ValueError(f"unsupported tool name: {value}")


def _validate_campus_services_fact_kind(value: str) -> None:
    if value not in ALLOWED_CAMPUS_SERVICES_FACT_KINDS:
        raise ValueError(f"unsupported campus_services fact kind: {value}")


def _reject_forbidden_projection_ref(value: str) -> None:
    normalized = value.strip().lower()
    for token in _FORBIDDEN_PROJECTION_TOKENS:
        if token in normalized:
            raise ValueError("forbidden raw campus services projection key")
