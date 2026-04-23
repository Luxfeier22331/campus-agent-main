from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    ALLOWED_CONFIDENCE_LEVELS,
    ALLOWED_MEMORY_SOURCE_TYPES,
    ALLOWED_MEMORY_VISIBILITIES,
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    DEFAULT_POLICY_PROJECTION_VERSION,
    ConfidenceLevel,
    MemorySourceType,
    MemoryVisibility,
    NoticeSourceFamily,
    _validate_notice_source_family,
)


@dataclass(frozen=True, slots=True)
class TraceContext:
    trace_id: str = ""
    parent_run_id: str = ""
    tool_call_id: str = ""


@dataclass(frozen=True, slots=True)
class ActorContext:
    user_id: str = ""
    principal_id: str = ""
    principal_type: str = ""
    roles: tuple[str, ...] = field(default_factory=tuple)
    departments: tuple[str, ...] = field(default_factory=tuple)
    cohort: str | None = None
    major: str | None = None
    program: str | None = None


@dataclass(frozen=True, slots=True)
class ProfileMemoryItem:
    item_id: str
    key: str
    value: str
    source_type: MemorySourceType = "user_declared"
    confidence: ConfidenceLevel = "low"
    visibility: MemoryVisibility = "user_visible"
    last_verified_at: str = ""

    def __post_init__(self) -> None:
        if not self.item_id.strip():
            raise ValueError("item_id must not be empty")
        if not self.key.strip():
            raise ValueError("key must not be empty")
        if not self.value.strip():
            raise ValueError("value must not be empty")
        if self.source_type not in ALLOWED_MEMORY_SOURCE_TYPES:
            raise ValueError(f"unsupported memory source_type: {self.source_type}")
        if self.confidence not in ALLOWED_CONFIDENCE_LEVELS:
            raise ValueError(f"unsupported confidence level: {self.confidence}")
        if self.visibility not in ALLOWED_MEMORY_VISIBILITIES:
            raise ValueError(f"unsupported visibility: {self.visibility}")


@dataclass(frozen=True, slots=True)
class ProfileMemorySummary:
    items: tuple[ProfileMemoryItem, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class CurriculumFollowUpSlots:
    program_family: str = ""
    program: str = ""
    semester: str = ""


@dataclass(frozen=True, slots=True)
class SelectedNoticeRef:
    notice_id: str
    source_family: NoticeSourceFamily | str = ""
    title: str = ""

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if self.source_family:
            _validate_notice_source_family(self.source_family)


@dataclass(frozen=True, slots=True)
class SessionSlot:
    name: str
    value: str
    confirmed: bool = True

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("session slot name must not be empty")
        if not self.value.strip():
            raise ValueError("session slot value must not be empty")


def resolve_curriculum_follow_up_slots(
    confirmed_slots: tuple[SessionSlot, ...],
) -> CurriculumFollowUpSlots:
    program_family = ""
    program = ""
    semester = ""
    for slot in confirmed_slots:
        if not slot.confirmed:
            continue
        value = slot.value.strip()
        if not value:
            continue
        if slot.name == CURRICULUM_PROGRAM_FAMILY_SLOT_NAME:
            program_family = value
        elif slot.name == CURRICULUM_PROGRAM_SLOT_NAME:
            program = value
        elif slot.name == CURRICULUM_SEMESTER_SLOT_NAME:
            semester = value
    return CurriculumFollowUpSlots(
        program_family=program_family,
        program=program,
        semester=semester,
    )


@dataclass(frozen=True, slots=True)
class SessionSummary:
    confirmed_slots: tuple[SessionSlot, ...] = field(default_factory=tuple)
    selected_notice_ref: SelectedNoticeRef | None = None
    turn_count: int = 0

    def __post_init__(self) -> None:
        if self.turn_count < 0:
            raise ValueError("turn_count must not be negative")

    @property
    def curriculum_follow_up(self) -> CurriculumFollowUpSlots:
        return resolve_curriculum_follow_up_slots(self.confirmed_slots)


@dataclass(frozen=True, slots=True)
class AuthorizedRetrievalFilter:
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_level: str = "public"
    visibility_scope: str | None = None
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION

    def __post_init__(self) -> None:
        visibility_level = self.visibility_level.strip() or "public"
        policy_projection_version = (
            self.policy_projection_version.strip() or DEFAULT_POLICY_PROJECTION_VERSION
        )

        if visibility_level != self.visibility_level:
            object.__setattr__(self, "visibility_level", visibility_level)
        if policy_projection_version != self.policy_projection_version:
            object.__setattr__(self, "policy_projection_version", policy_projection_version)


@dataclass(frozen=True, slots=True)
class AuthorizationProjection:
    principal_id: str = ""
    projection_source: str = ""
    entitlement_snapshot_id: str = ""
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    applicability_scope: str | None = None
    ownership_scopes: tuple[str, ...] = field(default_factory=tuple)
    approval_state: str = ""
    retrieval_filter: AuthorizedRetrievalFilter = field(default_factory=AuthorizedRetrievalFilter)


@dataclass(frozen=True, slots=True)
class ContextProjection:
    actor: ActorContext = field(default_factory=ActorContext)
    authorization: AuthorizationProjection = field(default_factory=AuthorizationProjection)
    profile_memory: ProfileMemorySummary = field(default_factory=ProfileMemorySummary)
    session: SessionSummary = field(default_factory=SessionSummary)


@dataclass(frozen=True, slots=True)
class PersonalizationHint:
    actor_claim_terms: tuple[str, ...] = field(default_factory=tuple)
    recent_goal: str = ""
    confirmed_slot_terms: tuple[str, ...] = field(default_factory=tuple)
    curriculum_follow_up: CurriculumFollowUpSlots = field(default_factory=CurriculumFollowUpSlots)
