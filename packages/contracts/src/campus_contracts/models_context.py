from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    DEFAULT_POLICY_PROJECTION_VERSION,
    NoticeSourceFamily,
    NoticeTargetSurface,
    _validate_notice_source_family,
    _validate_notice_target_surface,
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
class CurriculumFollowUpSlots:
    program_family: str = ""
    program: str = ""
    semester: str = ""


@dataclass(frozen=True, slots=True)
class SelectedNoticeRef:
    notice_id: str
    source_family: NoticeSourceFamily | str = ""
    title: str = ""
    target_surface: NoticeTargetSurface | str = ""

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if self.source_family:
            _validate_notice_source_family(self.source_family)
        if self.target_surface:
            _validate_notice_target_surface(self.target_surface)


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
    session: SessionSummary = field(default_factory=SessionSummary)


@dataclass(frozen=True, slots=True)
class PersonalizationHint:
    actor_claim_terms: tuple[str, ...] = field(default_factory=tuple)
    recent_goal: str = ""
    confirmed_slot_terms: tuple[str, ...] = field(default_factory=tuple)
    curriculum_follow_up: CurriculumFollowUpSlots = field(default_factory=CurriculumFollowUpSlots)
