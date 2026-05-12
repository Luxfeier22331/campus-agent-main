from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from campus_contracts.models_shared import (
    AllowedCorpus,
    RevisionTrack,
    SourceChannel,
    SourceTrustTier,
    VersionQueryMode,
    _normalize_source_trust_tier,
    _validate_collection,
    _validate_collection_scope,
    _validate_corpus,
    _validate_remote_content_suspicion_label,
    _validate_revision_track,
    _validate_source_channel,
    _validate_source_trust_tier,
    _validate_version_query_mode,
)

_FORBIDDEN_SAFE_SUMMARY_KEY_TOKENS = (
    "raw_prompt",
    "raw_transcript",
    "provider_raw_response",
    "raw_response",
    "raw_payload",
    "raw_body",
    "jwt",
    "cookie",
    "auth_envelope",
    "retrieval_backend_dump",
)
_FORBIDDEN_SAFE_SUMMARY_VALUE_TOKENS = (
    "authorization:",
    "bearer ",
    "cookie:",
    "set-cookie:",
    "access_token=",
    "refresh_token=",
    "sessionid=",
    "session_id=",
    "sso_tgc=",
    "token=",
)


def _normalize_safe_summary_key_token(value: str) -> str:
    return "".join(char for char in value.strip().lower() if char.isalnum())


def _reject_raw_safe_summary_keys(value: object, field_name: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized_key = _normalize_safe_summary_key_token(str(key))
            if any(
                _normalize_safe_summary_key_token(token) in normalized_key
                for token in _FORBIDDEN_SAFE_SUMMARY_KEY_TOKENS
            ):
                raise ValueError(f"{field_name} contains forbidden raw workflow trace key: {key}")
            _reject_raw_safe_summary_keys(item, field_name)
        return
    if isinstance(value, list | tuple):
        for item in value:
            _reject_raw_safe_summary_keys(item, field_name)
        return
    if isinstance(value, str):
        normalized = value.strip().lower()
        if any(token in normalized for token in _FORBIDDEN_SAFE_SUMMARY_VALUE_TOKENS):
            raise ValueError(f"{field_name} contains forbidden raw workflow trace value")


@dataclass(frozen=True, slots=True)
class KnowledgeScope:
    corpus: AllowedCorpus
    collection: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class DocumentRef:
    document_id: str
    revision_track: RevisionTrack
    version_id: str
    corpus: AllowedCorpus
    collection: str
    source_uri: str
    content_hash: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)
        _validate_revision_track(self.revision_track)


@dataclass(frozen=True, slots=True)
class EvidenceSource:
    doc_id: str
    revision_track: RevisionTrack
    version_id: str
    chunk_id: str
    anchor: dict[str, object]
    canonical_url: str
    latest_url: str
    source_channel: SourceChannel
    collection: str
    is_current: bool
    snippet: str
    score: float
    source_title: str = ""
    structural_path: tuple[str, ...] = field(default_factory=tuple)
    content_kind: str = ""
    content_role: str = ""
    detail_label: str = ""
    semantic_role: str = ""
    polarity: str = ""
    action_type: str = ""
    claim_type: str = ""
    audience_scope: str = ""
    article_no: str = ""
    clause_no: str = ""
    section_kind: str = ""
    is_answer_bearing: bool = False
    canonical_source_id: str = ""
    canonical_source_title: str = ""
    source_unit_kind: str = ""
    source_unit_key: str = ""
    source_trust_tier: SourceTrustTier | str = field(default="", compare=False)
    remote_content_suspicion_labels: tuple[str, ...] = field(default_factory=tuple, compare=False)

    def __post_init__(self) -> None:
        _validate_revision_track(self.revision_track)
        _validate_source_channel(self.source_channel)
        _validate_collection(self.collection)
        normalized_source_trust_tier = _normalize_source_trust_tier(
            self.source_trust_tier,
            collection=self.collection,
            source_channel=self.source_channel,
        )
        if normalized_source_trust_tier != self.source_trust_tier:
            object.__setattr__(self, "source_trust_tier", normalized_source_trust_tier)
        for label in self.remote_content_suspicion_labels:
            _validate_remote_content_suspicion_label(label)


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    corpus: AllowedCorpus
    collection: str
    query_text: str = ""
    sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)
        for source in self.sources:
            normalized_source_trust_tier = _normalize_source_trust_tier(
                source.source_trust_tier,
                collection=source.collection or self.collection,
                source_channel=source.source_channel,
            )
            if normalized_source_trust_tier != source.source_trust_tier:
                object.__setattr__(source, "source_trust_tier", normalized_source_trust_tier)


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class VersionQuery:
    mode: VersionQueryMode = "current"
    as_of: str = ""
    version_id: str = ""
    compare_to_version_id: str = ""

    def __post_init__(self) -> None:
        _validate_version_query_mode(self.mode)
        normalized_as_of = self.as_of.strip()
        normalized_version_id = self.version_id.strip()
        normalized_compare_to_version_id = self.compare_to_version_id.strip()
        if normalized_as_of != self.as_of:
            object.__setattr__(self, "as_of", normalized_as_of)
        if normalized_version_id != self.version_id:
            object.__setattr__(self, "version_id", normalized_version_id)
        if normalized_compare_to_version_id != self.compare_to_version_id:
            object.__setattr__(self, "compare_to_version_id", normalized_compare_to_version_id)
        if self.mode == "as_of":
            if not normalized_as_of:
                raise ValueError("as_of is required when version mode is as_of")
            if normalized_version_id:
                raise ValueError("version_id is not allowed when version mode is as_of")
            if normalized_compare_to_version_id:
                raise ValueError(
                    "compare_to_version_id is only allowed when version mode is compare"
                )
        elif normalized_as_of:
            raise ValueError("as_of is only allowed when version mode is as_of")
        if self.mode not in {"historical", "compare"} and normalized_version_id:
            raise ValueError(
                "version_id is only allowed when version mode is historical or compare"
            )
        if self.mode != "compare" and normalized_compare_to_version_id:
            raise ValueError("compare_to_version_id is only allowed when version mode is compare")
        if normalized_compare_to_version_id and not normalized_version_id:
            raise ValueError("version_id is required when compare_to_version_id is set")


@dataclass(frozen=True, slots=True)
class RagRequestPayload:
    scope: KnowledgeScope | None = None
    version_query: VersionQuery = field(default_factory=lambda: VersionQuery())


@dataclass(frozen=True, slots=True)
class ClaimSupport:
    claim_type: str
    claim_text: str
    supported: bool
    support_source_doc_id: str = ""
    support_snippet: str = ""
    required_source_trust_tier: SourceTrustTier | str = field(default="", compare=False)
    support_source_trust_tier: SourceTrustTier | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.claim_type.strip():
            raise ValueError("claim_type must not be empty")
        if not self.claim_text.strip():
            raise ValueError("claim_text must not be empty")
        if self.required_source_trust_tier:
            _validate_source_trust_tier(self.required_source_trust_tier)
        if self.support_source_trust_tier:
            _validate_source_trust_tier(self.support_source_trust_tier)


@dataclass(frozen=True, slots=True)
class SourceTrustSummary:
    observed_tiers: tuple[SourceTrustTier, ...] = field(default_factory=tuple)
    answer_bearing_tiers: tuple[SourceTrustTier, ...] = field(default_factory=tuple)
    blocked_claim_types: tuple[str, ...] = field(default_factory=tuple)
    freshness_claim_blocked: bool = False
    authorization_claim_blocked: bool = False

    def __post_init__(self) -> None:
        for tier in self.observed_tiers:
            _validate_source_trust_tier(tier)
        for tier in self.answer_bearing_tiers:
            _validate_source_trust_tier(tier)


@dataclass(frozen=True, slots=True)
class RagPlannerInformationNeed:
    need_id: str
    question: str
    target_collection: str
    query_mode: str
    expected_evidence_kind: str
    source_trust_tier: SourceTrustTier | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.need_id.strip():
            raise ValueError("need_id must not be empty")
        if not self.question.strip():
            raise ValueError("question must not be empty")
        if not self.target_collection.strip():
            raise ValueError("target_collection must not be empty")
        if not self.query_mode.strip():
            raise ValueError("query_mode must not be empty")
        if not self.expected_evidence_kind.strip():
            raise ValueError("expected_evidence_kind must not be empty")
        if self.source_trust_tier:
            _validate_source_trust_tier(self.source_trust_tier)


@dataclass(frozen=True, slots=True)
class RagProjectionContextSummary:
    projection_id: str
    source_step_id: str
    projection_kind: str
    content_hash: str
    safety_summary: dict[str, Any] = field(default_factory=dict, compare=False)
    evidence_use: str = "framing_only"

    def __post_init__(self) -> None:
        if not self.projection_id.strip():
            raise ValueError("projection_id must not be empty")
        if not self.source_step_id.strip():
            raise ValueError("source_step_id must not be empty")
        if not self.projection_kind.strip():
            raise ValueError("projection_kind must not be empty")
        if not self.content_hash.strip():
            raise ValueError("content_hash must not be empty")
        if not self.evidence_use.strip():
            raise ValueError("evidence_use must not be empty")
        _reject_raw_safe_summary_keys(self.safety_summary, "safety_summary")


@dataclass(frozen=True, slots=True)
class RagEntityResolutionSummary:
    resolution_status: str
    entity_type: str = ""
    canonical_id: str = ""
    canonical_title: str = ""
    target_collection: str = ""
    resolution_source: str = ""
    confidence: float = 0.0
    ambiguity_reason: str = ""

    def __post_init__(self) -> None:
        if not self.resolution_status.strip():
            raise ValueError("resolution_status must not be empty")
        if not self.resolution_source.strip():
            raise ValueError("resolution_source must not be empty")
        if self.confidence < 0 or self.confidence > 1:
            raise ValueError("confidence must be between 0 and 1")
        if self.resolution_status == "resolved" and not self.canonical_id.strip():
            raise ValueError("canonical_id must not be empty when entity is resolved")


@dataclass(frozen=True, slots=True)
class RagReplanDecisionSummary:
    attempted: bool = False
    replan_count: int = 0
    trigger_reason: str = ""
    outcome: str = ""
    fail_close_reason: str = ""

    def __post_init__(self) -> None:
        if self.replan_count < 0:
            raise ValueError("replan_count must not be negative")
        if self.attempted and not self.trigger_reason.strip():
            raise ValueError("trigger_reason must not be empty when replan was attempted")
        if self.attempted and not self.outcome.strip():
            raise ValueError("outcome must not be empty when replan was attempted")


@dataclass(frozen=True, slots=True)
class ClaimEvidenceGraphEntry:
    claim_id: str
    claim_text: str
    supported: bool = False
    support_source_doc_ids: tuple[str, ...] = field(default_factory=tuple)
    support_chunk_ids: tuple[str, ...] = field(default_factory=tuple)
    support_need_ids: tuple[str, ...] = field(default_factory=tuple)
    support_version_sides: tuple[str, ...] = field(default_factory=tuple)
    support_status: str = ""
    required_source_trust_tier: SourceTrustTier | str = field(default="", compare=False)
    observed_source_trust_tiers: tuple[SourceTrustTier | str, ...] = field(
        default_factory=tuple,
        compare=False,
    )

    def __post_init__(self) -> None:
        if not self.claim_id.strip():
            raise ValueError("claim_id must not be empty")
        if not self.claim_text.strip():
            raise ValueError("claim_text must not be empty")
        if not self.support_status.strip():
            raise ValueError("support_status must not be empty")
        if self.required_source_trust_tier:
            _validate_source_trust_tier(self.required_source_trust_tier)
        for tier in self.observed_source_trust_tiers:
            _validate_source_trust_tier(tier)


@dataclass(frozen=True, slots=True)
class RemoteContentSuspicionSummary:
    flagged_source_count: int = 0
    flag_labels: tuple[str, ...] = field(default_factory=tuple)
    generation_blocked: bool = False

    def __post_init__(self) -> None:
        if self.flagged_source_count < 0:
            raise ValueError("flagged_source_count must not be negative")
        for label in self.flag_labels:
            _validate_remote_content_suspicion_label(label)


@dataclass(frozen=True, slots=True)
class RetrievalStepActivitySummary:
    step_id: str
    step_type: str
    corpus: AllowedCorpus
    collection: str
    status: str
    need_ids: tuple[str, ...] = field(default_factory=tuple)
    top_k: int = 0
    latency_ms: int | None = None
    candidate_count: int = 0
    reference_count: int = 0
    failure_kind: str = ""

    def __post_init__(self) -> None:
        if not self.step_id.strip():
            raise ValueError("step_id must not be empty")
        if not self.step_type.strip():
            raise ValueError("step_type must not be empty")
        if not self.collection.strip():
            raise ValueError("collection must not be empty")
        if not self.status.strip():
            raise ValueError("status must not be empty")
        if self.top_k < 0:
            raise ValueError("top_k must not be negative")
        if self.latency_ms is not None and self.latency_ms < 0:
            raise ValueError("latency_ms must not be negative")
        if self.candidate_count < 0:
            raise ValueError("candidate_count must not be negative")
        if self.reference_count < 0:
            raise ValueError("reference_count must not be negative")


@dataclass(frozen=True, slots=True)
class RetrievalPlanSummary:
    plan_id: str
    query_mode: str
    replan_count: int = 0
    terminal_state: str = "completed"
    step_activities: tuple[RetrievalStepActivitySummary, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.plan_id.strip():
            raise ValueError("plan_id must not be empty")
        if not self.query_mode.strip():
            raise ValueError("query_mode must not be empty")
        if self.replan_count < 0:
            raise ValueError("replan_count must not be negative")
        if self.terminal_state not in {"completed", "blocked", "failed_closed"}:
            raise ValueError(f"unsupported terminal_state: {self.terminal_state}")


@dataclass(frozen=True, slots=True)
class RagStageActivitySummary:
    request_id: str = ""
    plan_id: str = ""
    query_mode: str = ""
    stage_name: str = ""
    stage_status: str = ""
    candidate_count: int = 0
    supporting_evidence_count: int = 0
    grounding_verdict: str = ""
    diagnostic_reason: str = ""
    presentation_kind: str = ""
    presentation_path: str = ""
    latency_ms: int | None = None
    retrieval_ms: int | None = None
    prompt_ms: int | None = None
    adapter_ms: int | None = None
    diagnostic_ms: int | None = None

    def __post_init__(self) -> None:
        if not self.stage_name.strip():
            raise ValueError("stage_name must not be empty")
        if not self.stage_status.strip():
            raise ValueError("stage_status must not be empty")
        if self.candidate_count < 0:
            raise ValueError("candidate_count must not be negative")
        if self.supporting_evidence_count < 0:
            raise ValueError("supporting_evidence_count must not be negative")
        for field_name in (
            "latency_ms",
            "retrieval_ms",
            "prompt_ms",
            "adapter_ms",
            "diagnostic_ms",
        ):
            value = getattr(self, field_name)
            if value is not None and value < 0:
                raise ValueError(f"{field_name} must not be negative")


@dataclass(frozen=True, slots=True)
class PromptTrace:
    prompt_id: str = ""
    prompt_version: str = ""
    template_sha256: str = ""
    variables_schema_version: str = ""
    output_schema_version: str = ""
    model_provider: str = ""
    model_name: str = ""


@dataclass(frozen=True, slots=True)
class RagResultDiagnostics:
    resolved_scope_corpus: AllowedCorpus | None = None
    resolved_scope_collection: str = ""
    resolved_policy_document_id: str = ""
    resolved_policy_title: str = ""
    rewritten_query: str = ""
    clarification_reason: str = ""
    no_answer_reason: str = ""
    fail_close_reason: str = ""
    semantic_outcome: str = ""
    retrieval_adequacy_verdict: str = ""
    retrieval_adequacy_reason: str = ""
    grounding_verdict: str = ""
    grounding_downgraded: bool = False
    freshness_fail_closed: bool = False
    scope_class: str = ""
    policy_reason: str = ""
    retrieved_title_summary: tuple[str, ...] = field(default_factory=tuple)
    candidate_title_summary: tuple[str, ...] = field(default_factory=tuple)
    resolution_mode: str = ""
    used_verified_identity: bool = False
    used_soft_preference: bool = False
    resolved_entity_type: str = ""
    resolved_course_id: str = ""
    resolved_course_title: str = ""
    resolved_course_family_id: str = ""
    resolved_course_family_title: str = ""
    resolved_program_family_id: str = ""
    resolved_program_family_title: str = ""
    session_program_family: str = ""
    session_program: str = ""
    session_semester: str = ""
    remote_content_suspicion_summary: RemoteContentSuspicionSummary | None = field(
        default=None,
        compare=False,
    )
    source_trust_summary: SourceTrustSummary | None = field(default=None, compare=False)
    claim_supports: tuple[ClaimSupport, ...] = field(default_factory=tuple)
    unsupported_fields: tuple[str, ...] = field(default_factory=tuple)
    partial_answer: bool = False
    prompt_runtime_state: str = ""
    prompt_runtime_detail: str = ""
    answer_presentation_kind: str = ""
    answer_presentation_path: str = ""
    answer_diagnostic_reason: str = ""
    retrieval_plan_summary: RetrievalPlanSummary | None = field(default=None, compare=False)
    stage_activities: tuple[RagStageActivitySummary, ...] = field(default_factory=tuple)
    retrieved_sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = field(default_factory=tuple)
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = field(
        default_factory=tuple
    )
    entity_resolution_summary: RagEntityResolutionSummary | None = field(
        default=None,
        compare=False,
    )
    replan_decision_summary: RagReplanDecisionSummary | None = field(
        default=None,
        compare=False,
    )
    claim_evidence_graph: tuple[ClaimEvidenceGraphEntry, ...] = field(default_factory=tuple)
    prompt_trace: PromptTrace | None = None
