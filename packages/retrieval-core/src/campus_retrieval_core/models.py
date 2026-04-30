from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import (
    ALLOWED_SOURCE_TRUST_TIERS,
    AuthorizedRetrievalFilter,
    EvidenceBundle,
    EvidenceSource,
    PersonalizationHint,
    SourceTrustTier,
    VersionQuery,
)
from campus_ingestion_core.scope_catalog import assert_known_scope

RetrievalQueryMode = Literal[
    "current", "historical", "as_of", "compare", "freshness_sensitive", "live_assisted"
]
RetrievalStepType = Literal[
    "indexed_lookup",
    "entity_resolution",
    "historical_version_lookup",
    "compare_pair_lookup",
    "freshness_gate",
    "live_source_lookup",
    "scope_follow_up",
]
RetrievalExpectedOutput = Literal[
    "candidate_set",
    "entity_matches",
    "freshness_decision",
    "compare_inputs",
    "live_candidates",
]
RetrievalStepStatus = Literal["succeeded", "empty", "blocked", "failed"]
RetrievalFailureKind = Literal[
    "budget_exhausted",
    "unauthorized_scope",
    "unresolved_freshness",
    "live_lookup_unavailable",
    "no_grounding",
    "executor_error",
    "unsupported_step_type",
    "missing_dependency",
    "release_metadata_drift",
]

ALLOWED_RETRIEVAL_QUERY_MODES = (
    "current",
    "historical",
    "as_of",
    "compare",
    "freshness_sensitive",
    "live_assisted",
)
ALLOWED_RETRIEVAL_STEP_TYPES = (
    "indexed_lookup",
    "entity_resolution",
    "historical_version_lookup",
    "compare_pair_lookup",
    "freshness_gate",
    "live_source_lookup",
    "scope_follow_up",
)
ALLOWED_RETRIEVAL_EXPECTED_OUTPUTS = (
    "candidate_set",
    "entity_matches",
    "freshness_decision",
    "compare_inputs",
    "live_candidates",
)
ALLOWED_RETRIEVAL_STEP_STATUSES = ("succeeded", "empty", "blocked", "failed")
ALLOWED_RETRIEVAL_FAILURE_KINDS = (
    "budget_exhausted",
    "unauthorized_scope",
    "unresolved_freshness",
    "live_lookup_unavailable",
    "no_grounding",
    "executor_error",
    "unsupported_step_type",
    "missing_dependency",
    "release_metadata_drift",
)


@dataclass(frozen=True, slots=True)
class RetrievalScope:
    corpus: str
    collection: str

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class RetrievalSourceTrustPolicy:
    minimum_tier: SourceTrustTier | str = "T1"
    allow_live_source_lookup: bool = False

    def __post_init__(self) -> None:
        normalized_minimum_tier = (
            self.minimum_tier.strip() if isinstance(self.minimum_tier, str) else self.minimum_tier
        )
        if normalized_minimum_tier not in ALLOWED_SOURCE_TRUST_TIERS:
            raise ValueError(f"unsupported source trust tier: {self.minimum_tier}")
        if normalized_minimum_tier != self.minimum_tier:
            object.__setattr__(self, "minimum_tier", normalized_minimum_tier)


@dataclass(frozen=True, slots=True)
class RetrievalPlanBudget:
    max_steps: int = 1
    max_replans: int = 0
    max_live_lookups: int = 0

    def __post_init__(self) -> None:
        if self.max_steps <= 0:
            raise ValueError("max_steps must be greater than zero")
        if self.max_replans < 0:
            raise ValueError("max_replans must not be negative")
        if self.max_live_lookups < 0:
            raise ValueError("max_live_lookups must not be negative")


@dataclass(frozen=True, slots=True)
class RetrievalStepBudget:
    top_k: int = 3
    timeout_ms: int | None = None

    def __post_init__(self) -> None:
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")
        if self.timeout_ms is not None and self.timeout_ms < 0:
            raise ValueError("timeout_ms must not be negative")


@dataclass(frozen=True, slots=True)
class RetrievalSelector:
    target_document_ids: tuple[str, ...] = field(default_factory=tuple)
    target_version_ids: tuple[str, ...] = field(default_factory=tuple)
    target_revision_track: str = ""
    preferred_document_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_course_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_course_family_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_program_family_ids: tuple[str, ...] = field(default_factory=tuple)
    entity_keys: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        for field_name in (
            "target_document_ids",
            "target_version_ids",
            "preferred_document_ids",
            "canonical_course_ids",
            "canonical_course_family_ids",
            "canonical_program_family_ids",
            "entity_keys",
        ):
            current_value = getattr(self, field_name)
            normalized_value = tuple(
                value.strip() for value in current_value if isinstance(value, str) and value.strip()
            )
            if normalized_value != current_value:
                object.__setattr__(self, field_name, normalized_value)
        normalized_revision_track = self.target_revision_track.strip()
        if normalized_revision_track != self.target_revision_track:
            object.__setattr__(self, "target_revision_track", normalized_revision_track)


@dataclass(frozen=True, slots=True)
class RetrievalStepFailure:
    failure_kind: RetrievalFailureKind
    terminal: bool = True
    message: str = ""

    def __post_init__(self) -> None:
        if self.failure_kind not in ALLOWED_RETRIEVAL_FAILURE_KINDS:
            raise ValueError(f"unsupported retrieval failure kind: {self.failure_kind}")


@dataclass(frozen=True, slots=True)
class RetrievalStepActivity:
    step_id: str
    step_type: RetrievalStepType | str
    corpus: str
    collection: str
    status: RetrievalStepStatus | str
    query_text: str
    target_document_ids: tuple[str, ...] = field(default_factory=tuple)
    target_version_ids: tuple[str, ...] = field(default_factory=tuple)
    top_k: int = 0
    latency_ms: int | None = None
    candidate_count: int = 0
    reference_count: int = 0
    failure_kind: RetrievalFailureKind | str | None = None

    def __post_init__(self) -> None:
        if not self.step_id.strip():
            raise ValueError("step_id must not be empty")
        if self.step_type not in ALLOWED_RETRIEVAL_STEP_TYPES:
            raise ValueError(f"unsupported retrieval step type: {self.step_type}")
        assert_known_scope(self.corpus, self.collection)
        if self.status not in ALLOWED_RETRIEVAL_STEP_STATUSES:
            raise ValueError(f"unsupported retrieval step status: {self.status}")
        if self.top_k < 0:
            raise ValueError("top_k must not be negative")
        if self.latency_ms is not None and self.latency_ms < 0:
            raise ValueError("latency_ms must not be negative")
        if self.candidate_count < 0:
            raise ValueError("candidate_count must not be negative")
        if self.reference_count < 0:
            raise ValueError("reference_count must not be negative")
        if (
            self.failure_kind is not None
            and self.failure_kind not in ALLOWED_RETRIEVAL_FAILURE_KINDS
        ):
            raise ValueError(f"unsupported retrieval failure kind: {self.failure_kind}")


@dataclass(frozen=True, slots=True)
class RetrievalStep:
    step_id: str
    step_type: RetrievalStepType | str
    scope: RetrievalScope
    query_text: str
    depends_on_step_ids: tuple[str, ...] = field(default_factory=tuple)
    selector: RetrievalSelector = field(default_factory=RetrievalSelector)
    budget: RetrievalStepBudget = field(default_factory=RetrievalStepBudget)
    expected_output: RetrievalExpectedOutput | str = "candidate_set"

    def __post_init__(self) -> None:
        normalized_step_id = self.step_id.strip()
        if not normalized_step_id:
            raise ValueError("step_id must not be empty")
        if normalized_step_id != self.step_id:
            object.__setattr__(self, "step_id", normalized_step_id)
        if self.step_type not in ALLOWED_RETRIEVAL_STEP_TYPES:
            raise ValueError(f"unsupported retrieval step type: {self.step_type}")
        normalized_query_text = self.query_text.strip()
        if not normalized_query_text:
            raise ValueError("query_text must not be empty")
        if normalized_query_text != self.query_text:
            object.__setattr__(self, "query_text", normalized_query_text)
        normalized_depends_on_step_ids = tuple(
            step_id.strip()
            for step_id in self.depends_on_step_ids
            if isinstance(step_id, str) and step_id.strip()
        )
        if normalized_depends_on_step_ids != self.depends_on_step_ids:
            object.__setattr__(self, "depends_on_step_ids", normalized_depends_on_step_ids)
        if self.expected_output not in ALLOWED_RETRIEVAL_EXPECTED_OUTPUTS:
            raise ValueError(f"unsupported retrieval expected output: {self.expected_output}")


@dataclass(frozen=True, slots=True)
class RetrievalPlan:
    plan_id: str
    query_mode: RetrievalQueryMode | str
    admitted_scopes: tuple[RetrievalScope, ...]
    steps: tuple[RetrievalStep, ...]
    budget: RetrievalPlanBudget = field(default_factory=RetrievalPlanBudget)
    version_query: VersionQuery | None = None
    source_trust_policy: RetrievalSourceTrustPolicy = field(
        default_factory=RetrievalSourceTrustPolicy
    )
    fail_close_on_budget_exhausted: bool = True
    fail_close_on_unresolved_freshness: bool = True
    fail_close_on_empty_supporting_evidence: bool = True

    def __post_init__(self) -> None:
        normalized_plan_id = self.plan_id.strip()
        if not normalized_plan_id:
            raise ValueError("plan_id must not be empty")
        if normalized_plan_id != self.plan_id:
            object.__setattr__(self, "plan_id", normalized_plan_id)
        if self.query_mode not in ALLOWED_RETRIEVAL_QUERY_MODES:
            raise ValueError(f"unsupported retrieval query mode: {self.query_mode}")
        if not self.admitted_scopes:
            raise ValueError("admitted_scopes must not be empty")
        if not self.steps:
            raise ValueError("steps must not be empty")
        if len(self.steps) > self.budget.max_steps:
            raise ValueError("steps exceed plan max_steps budget")
        admitted_scope_keys = {(scope.corpus, scope.collection) for scope in self.admitted_scopes}
        step_ids: set[str] = set()
        for step in self.steps:
            scope_key = (step.scope.corpus, step.scope.collection)
            if scope_key not in admitted_scope_keys:
                raise ValueError("step scope must stay within admitted_scopes")
            if step.step_id in step_ids:
                raise ValueError(f"duplicate step_id: {step.step_id}")
            step_ids.add(step.step_id)


@dataclass(frozen=True, slots=True)
class RetrievalStepResult:
    step_id: str
    status: RetrievalStepStatus | str
    grounding: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    references: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    activity: RetrievalStepActivity | None = None
    failure: RetrievalStepFailure | None = None

    def __post_init__(self) -> None:
        if not self.step_id.strip():
            raise ValueError("step_id must not be empty")
        if self.status not in ALLOWED_RETRIEVAL_STEP_STATUSES:
            raise ValueError(f"unsupported retrieval step status: {self.status}")
        if self.failure is not None and self.status not in {"blocked", "failed"}:
            raise ValueError("failure is only allowed for blocked or failed results")


@dataclass(frozen=True, slots=True)
class RetrievalExecutionResult:
    plan: RetrievalPlan
    step_results: tuple[RetrievalStepResult, ...]
    merged_evidence: EvidenceBundle
    replan_count: int = 0

    def __post_init__(self) -> None:
        if self.replan_count < 0:
            raise ValueError("replan_count must not be negative")

    @property
    def step_activities(self) -> tuple[RetrievalStepActivity, ...]:
        return tuple(result.activity for result in self.step_results if result.activity is not None)


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query_text: str
    corpus: str
    collection: str
    target_document_ids: tuple[str, ...] = field(default_factory=tuple)
    target_version_ids: tuple[str, ...] = field(default_factory=tuple)
    target_revision_track: str = ""
    preferred_document_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_course_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_course_family_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_program_family_ids: tuple[str, ...] = field(default_factory=tuple)
    authorized_filter: AuthorizedRetrievalFilter | None = None
    personalization_hint: PersonalizationHint | None = None
    top_k: int = 3
    timeout_ms: int | None = None

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")
        if self.timeout_ms is not None and self.timeout_ms < 0:
            raise ValueError("timeout_ms must not be negative")
        normalized_target_document_ids = tuple(
            doc_id.strip()
            for doc_id in self.target_document_ids
            if isinstance(doc_id, str) and doc_id.strip()
        )
        if normalized_target_document_ids != self.target_document_ids:
            object.__setattr__(self, "target_document_ids", normalized_target_document_ids)
        normalized_target_version_ids = tuple(
            version_id.strip()
            for version_id in self.target_version_ids
            if isinstance(version_id, str) and version_id.strip()
        )
        if normalized_target_version_ids != self.target_version_ids:
            object.__setattr__(self, "target_version_ids", normalized_target_version_ids)
        normalized_target_revision_track = self.target_revision_track.strip()
        if normalized_target_revision_track != self.target_revision_track:
            object.__setattr__(self, "target_revision_track", normalized_target_revision_track)
        normalized_preferred_document_ids = tuple(
            doc_id.strip()
            for doc_id in self.preferred_document_ids
            if isinstance(doc_id, str) and doc_id.strip()
        )
        if normalized_preferred_document_ids != self.preferred_document_ids:
            object.__setattr__(self, "preferred_document_ids", normalized_preferred_document_ids)
        normalized_canonical_course_ids = tuple(
            value.strip()
            for value in self.canonical_course_ids
            if isinstance(value, str) and value.strip()
        )
        if normalized_canonical_course_ids != self.canonical_course_ids:
            object.__setattr__(self, "canonical_course_ids", normalized_canonical_course_ids)
        normalized_canonical_course_family_ids = tuple(
            value.strip()
            for value in self.canonical_course_family_ids
            if isinstance(value, str) and value.strip()
        )
        if normalized_canonical_course_family_ids != self.canonical_course_family_ids:
            object.__setattr__(
                self, "canonical_course_family_ids", normalized_canonical_course_family_ids
            )
        normalized_canonical_program_family_ids = tuple(
            value.strip()
            for value in self.canonical_program_family_ids
            if isinstance(value, str) and value.strip()
        )
        if normalized_canonical_program_family_ids != self.canonical_program_family_ids:
            object.__setattr__(
                self, "canonical_program_family_ids", normalized_canonical_program_family_ids
            )

    def effective_authorized_filter(self) -> AuthorizedRetrievalFilter:
        if self.authorized_filter is not None:
            return self.authorized_filter
        return AuthorizedRetrievalFilter()

    def effective_entitlement_groups(self) -> tuple[str, ...]:
        return self.effective_authorized_filter().entitlement_groups

    def effective_visibility_scope(self) -> str | None:
        return self.effective_authorized_filter().visibility_scope

    def effective_visibility_level(self) -> str:
        return self.effective_authorized_filter().visibility_level or "public"

    def allows_document_access(
        self,
        *,
        visibility_level: str,
        entitlement_groups: tuple[str, ...] = (),
        visibility_scope: str | None = None,
    ) -> bool:
        normalized_visibility_level = visibility_level.strip() or "public"
        normalized_visibility_scope = (
            visibility_scope.strip() if isinstance(visibility_scope, str) else None
        )
        normalized_visibility_scope = normalized_visibility_scope or None

        if not self._allows_visibility_scope(normalized_visibility_scope):
            return False
        if normalized_visibility_level == "public":
            return True
        if normalized_visibility_level != "restricted":
            return False

        allowed_entitlements = set(self.effective_entitlement_groups())
        if not allowed_entitlements:
            return False
        normalized_entitlement_groups = {
            group.strip()
            for group in entitlement_groups
            if isinstance(group, str) and group.strip()
        }
        if not normalized_entitlement_groups:
            return False
        return bool(allowed_entitlements.intersection(normalized_entitlement_groups))

    def _allows_visibility_scope(self, document_visibility_scope: str | None) -> bool:
        if document_visibility_scope is None:
            return True
        request_visibility_scope = self.effective_visibility_scope()
        if request_visibility_scope is None:
            return False
        return request_visibility_scope == document_visibility_scope
