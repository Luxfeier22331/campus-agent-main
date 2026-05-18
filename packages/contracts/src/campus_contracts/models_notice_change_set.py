from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

NOTICE_CHANGE_SET_ARTIFACT_KIND = "notice_change_set"
NOTICE_CHANGE_SET_DISPLAY_NAME = "NoticeChangeSet"
NOTICE_CHANGE_SET_PRODUCER_BINDING_ID = "notice.notice_change_set.transport_override_lookup"
NOTICE_CHANGE_SET_PRODUCER_TOOL_NAME = "campus_notice_change_set_lookup"
NOTICE_CHANGE_SET_SCHEMA_VERSION = "notice-change-set-v1"

ALLOWED_NOTICE_CHANGE_SET_TARGET_FAMILIES = ("transport_schedule",)
ALLOWED_NOTICE_CHANGE_KINDS = (
    "baseline_delta",
    "temporary_overlay",
    "temporary_exception",
    "service_suspension",
    "service_restoration",
    "stop_or_boarding_point_change",
    "route_or_direction_change",
    "historical_search_only",
    "no_current_change",
)
ALLOWED_NOTICE_CHANGE_ADMISSION_STATES = (
    "answer_eligible",
    "searchable_only",
    "stale",
    "missing_baseline",
    "missing_evidence",
    "conflict",
    "ambiguous_scope",
    "unsupported",
)
ALLOWED_NOTICE_CHANGE_FACT_KINDS = (
    "departure_time_added",
    "departure_time_removed",
    "departure_time_changed",
    "window_changed",
    "stop_changed",
    "route_changed",
    "direction_changed",
    "service_suspended",
    "service_restored",
    "service_limited",
    "baseline_delta_summary",
    "no_current_change_summary",
)
ALLOWED_NOTICE_CHANGE_CONFIDENCE_LEVELS = (
    "deterministic",
    "model_reviewed",
    "low_confidence_fail_closed",
)
ALLOWED_NOTICE_CHANGE_FAIL_CLOSE_REASONS = (
    "transport_baseline_missing",
    "notice_change_not_found",
    "notice_searchable_only",
    "notice_effective_window_expired",
    "notice_effective_window_unparseable",
    "notice_media_evidence_incomplete",
    "notice_source_ref_missing",
    "transport_scope_ambiguous",
    "transport_notice_conflict",
    "transport_change_unsupported",
    "raw_payload_forbidden",
)
NOTICE_CHANGE_SET_FORBIDDEN_RAW_KEY_TOKENS = (
    "raw_prompt",
    "raw_transcript",
    "provider_raw_response",
    "raw_response",
    "provider_trace",
    "raw_tool_result",
    "raw_source",
    "raw_html",
    "source_html",
    "raw_ocr_dump",
    "ocr_dump",
    "raw_sql",
    "sql_rows",
    "object_locator",
    "object_store_key",
    "jwt",
    "cookie",
    "auth_envelope",
    "retrieval_backend_dump",
)


@dataclass(frozen=True, slots=True)
class NoticeChangeSetQueryScope:
    campus: str = ""
    service_kind: str = "transport_schedule"
    route_labels: tuple[str, ...] = field(default_factory=tuple)
    direction_labels: tuple[str, ...] = field(default_factory=tuple)
    stop_labels: tuple[str, ...] = field(default_factory=tuple)
    query_time_anchor: str = ""
    service_date: str = ""

    def __post_init__(self) -> None:
        if self.service_kind != "transport_schedule":
            raise ValueError("notice change set service_kind must be transport_schedule")


@dataclass(frozen=True, slots=True)
class NoticeChangeSetEffectiveWindow:
    starts_at: str = ""
    ends_at: str = ""
    date_set: tuple[str, ...] = field(default_factory=tuple)
    timezone: str = "Asia/Shanghai"
    current_at_query_time: bool = False

    def __post_init__(self) -> None:
        if not self.timezone.strip():
            raise ValueError("effective_window timezone must not be empty")

    @property
    def has_temporal_bound(self) -> bool:
        return bool(self.starts_at.strip() or self.ends_at.strip() or self.date_set)


@dataclass(frozen=True, slots=True)
class NoticeChangeSetSourceRef:
    source_ref_id: str
    notice_id: str
    title: str
    source_url: str
    published_at: str
    excerpt: str = ""

    def __post_init__(self) -> None:
        if not self.source_ref_id.strip():
            raise ValueError("source_ref_id must not be empty")
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if not self.title.strip():
            raise ValueError("title must not be empty")
        if not self.source_url.strip():
            raise ValueError("source_url must not be empty")
        if not self.published_at.strip():
            raise ValueError("published_at must not be empty")


@dataclass(frozen=True, slots=True)
class NoticeChangeSetFact:
    fact_id: str
    fact_kind: str
    change_text: str
    source_notice_id: str
    source_ref_id: str
    route_label: str = ""
    direction_label: str = ""
    service_window: Mapping[str, str] = field(default_factory=dict, compare=False)
    confidence: str = "deterministic"

    def __post_init__(self) -> None:
        if not self.fact_id.strip():
            raise ValueError("fact_id must not be empty")
        if self.fact_kind not in ALLOWED_NOTICE_CHANGE_FACT_KINDS:
            raise ValueError(f"unsupported notice change fact_kind: {self.fact_kind}")
        if not self.change_text.strip():
            raise ValueError("change_text must not be empty")
        if not self.source_notice_id.strip():
            raise ValueError("source_notice_id must not be empty")
        if not self.source_ref_id.strip():
            raise ValueError("source_ref_id must not be empty")
        if self.confidence not in ALLOWED_NOTICE_CHANGE_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported notice change confidence: {self.confidence}")


@dataclass(frozen=True, slots=True)
class NoticeChangeSetConflict:
    conflict_id: str
    reason: str
    source_ref_ids: tuple[str, ...] = field(default_factory=tuple)
    summary: str = ""

    def __post_init__(self) -> None:
        if not self.conflict_id.strip():
            raise ValueError("conflict_id must not be empty")
        if not self.reason.strip():
            raise ValueError("conflict reason must not be empty")
        if not self.source_ref_ids:
            raise ValueError("conflict source_ref_ids must not be empty")


@dataclass(frozen=True, slots=True)
class NoticeChangeSetSafetySummary:
    raw_payload_absent: bool = True
    payload_key_names: tuple[str, ...] = field(default_factory=tuple)
    redacted: bool = False
    notes: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.raw_payload_absent:
            raise ValueError("notice_change_set must not carry raw payload")
        _reject_forbidden_raw_key_tokens(self.payload_key_names)


@dataclass(frozen=True, slots=True)
class NoticeChangeSet:
    change_set_id: str
    target_family: str
    query_scope: NoticeChangeSetQueryScope
    effective_window: NoticeChangeSetEffectiveWindow
    change_kind: str
    answer_eligible: bool
    admission_state: str
    content_hash: str
    facts: tuple[NoticeChangeSetFact, ...] = field(default_factory=tuple)
    source_refs: tuple[NoticeChangeSetSourceRef, ...] = field(default_factory=tuple)
    conflicts: tuple[NoticeChangeSetConflict, ...] = field(default_factory=tuple)
    safety_summary: NoticeChangeSetSafetySummary = field(
        default_factory=NoticeChangeSetSafetySummary
    )
    fail_close_reasons: tuple[str, ...] = field(default_factory=tuple)
    schema_version: str = NOTICE_CHANGE_SET_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != NOTICE_CHANGE_SET_SCHEMA_VERSION:
            raise ValueError("unsupported notice_change_set schema_version")
        if not self.change_set_id.strip():
            raise ValueError("change_set_id must not be empty")
        if self.target_family not in ALLOWED_NOTICE_CHANGE_SET_TARGET_FAMILIES:
            raise ValueError(f"unsupported notice_change_set target_family: {self.target_family}")
        if self.change_kind not in ALLOWED_NOTICE_CHANGE_KINDS:
            raise ValueError(f"unsupported notice change_kind: {self.change_kind}")
        if self.admission_state not in ALLOWED_NOTICE_CHANGE_ADMISSION_STATES:
            raise ValueError(f"unsupported notice change admission_state: {self.admission_state}")
        if not self.content_hash.strip():
            raise ValueError("content_hash must not be empty")
        _validate_fail_close_reasons(self.fail_close_reasons)
        self._validate_answer_admission()
        self._validate_source_refs()
        self._validate_conflicts()

    def _validate_answer_admission(self) -> None:
        if self.answer_eligible:
            if self.admission_state != "answer_eligible":
                raise ValueError(
                    "answer_eligible change set must use admission_state=answer_eligible"
                )
            if self.fail_close_reasons:
                raise ValueError("answer_eligible change set must not carry fail_close_reasons")
            if not self.facts:
                raise ValueError("answer_eligible change set must carry at least one fact")
            if not self.source_refs:
                raise ValueError("answer_eligible change set must carry source_refs")
            if (
                not self.effective_window.has_temporal_bound
                and self.change_kind != "baseline_delta"
            ):
                raise ValueError("answer_eligible change set requires an effective window")
            return

        if self.admission_state == "answer_eligible":
            raise ValueError("non-answer change set must not use admission_state=answer_eligible")
        if self.facts:
            raise ValueError("non-answer change set must not carry answer facts")
        if (
            self.admission_state
            in {
                "missing_baseline",
                "missing_evidence",
                "conflict",
                "ambiguous_scope",
                "unsupported",
            }
            and not self.fail_close_reasons
        ):
            raise ValueError("fail-closed change set must carry fail_close_reasons")

    def _validate_source_refs(self) -> None:
        source_ref_ids = {source.source_ref_id for source in self.source_refs}
        notice_ids = {source.notice_id for source in self.source_refs}
        for fact in self.facts:
            if fact.source_ref_id not in source_ref_ids:
                raise ValueError("notice change fact source_ref_id must exist in source_refs")
            if fact.source_notice_id not in notice_ids:
                raise ValueError("notice change fact source_notice_id must exist in source_refs")

    def _validate_conflicts(self) -> None:
        source_ref_ids = {source.source_ref_id for source in self.source_refs}
        for conflict in self.conflicts:
            if any(
                source_ref_id not in source_ref_ids for source_ref_id in conflict.source_ref_ids
            ):
                raise ValueError("notice change conflict source_ref_ids must exist in source_refs")
        if self.admission_state == "conflict" and not self.conflicts:
            raise ValueError("conflict change set must carry conflict summaries")


def _validate_fail_close_reasons(reasons: tuple[str, ...]) -> None:
    for reason in reasons:
        if reason not in ALLOWED_NOTICE_CHANGE_FAIL_CLOSE_REASONS:
            raise ValueError(f"unsupported notice change fail_close_reason: {reason}")


def _reject_forbidden_raw_key_tokens(payload_key_names: tuple[str, ...]) -> None:
    for key_name in payload_key_names:
        normalized = key_name.strip().lower()
        for token in NOTICE_CHANGE_SET_FORBIDDEN_RAW_KEY_TOKENS:
            if token in normalized:
                raise ValueError(f"notice_change_set payload key is forbidden: {key_name}")


__all__ = [
    "ALLOWED_NOTICE_CHANGE_ADMISSION_STATES",
    "ALLOWED_NOTICE_CHANGE_CONFIDENCE_LEVELS",
    "ALLOWED_NOTICE_CHANGE_FACT_KINDS",
    "ALLOWED_NOTICE_CHANGE_FAIL_CLOSE_REASONS",
    "ALLOWED_NOTICE_CHANGE_KINDS",
    "ALLOWED_NOTICE_CHANGE_SET_TARGET_FAMILIES",
    "NOTICE_CHANGE_SET_ARTIFACT_KIND",
    "NOTICE_CHANGE_SET_DISPLAY_NAME",
    "NOTICE_CHANGE_SET_FORBIDDEN_RAW_KEY_TOKENS",
    "NOTICE_CHANGE_SET_PRODUCER_BINDING_ID",
    "NOTICE_CHANGE_SET_PRODUCER_TOOL_NAME",
    "NOTICE_CHANGE_SET_SCHEMA_VERSION",
    "NoticeChangeSet",
    "NoticeChangeSetConflict",
    "NoticeChangeSetEffectiveWindow",
    "NoticeChangeSetFact",
    "NoticeChangeSetQueryScope",
    "NoticeChangeSetSafetySummary",
    "NoticeChangeSetSourceRef",
]
