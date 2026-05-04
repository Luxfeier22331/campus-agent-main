from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RagRuntimeStageContract:
    stage_name: str
    owner: str
    input_artifacts: tuple[str, ...] = field(default_factory=tuple)
    output_artifacts: tuple[str, ...] = field(default_factory=tuple)
    fail_close_semantic: str = ""
    allowed_legacy_heuristic_authority: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.stage_name.strip():
            raise ValueError("stage_name must not be empty")
        if not self.owner.strip():
            raise ValueError("owner must not be empty")


RAG_AGENT_RUNTIME_STAGES: tuple[RagRuntimeStageContract, ...] = (
    RagRuntimeStageContract(
        stage_name="planner",
        owner="packages/rag-agent",
        input_artifacts=(
            "AgentRequest",
            "RagRequestPayload",
            "KnowledgeScope",
            "RagIntentFrame",
            "bounded workflow context projection",
        ),
        output_artifacts=(
            "RagRetrievalContext",
            "RetrievalPlan",
        ),
        fail_close_semantic="scope_or_version_unresolved",
        allowed_legacy_heuristic_authority=(),
    ),
    RagRuntimeStageContract(
        stage_name="retrieval",
        owner="packages/retrieval-core",
        input_artifacts=(
            "RetrievalPlan",
            "AuthorizedRetrievalFilter",
            "PersonalizationHint",
        ),
        output_artifacts=(
            "RetrievalExecutionResult",
            "RetrievalStepResult",
            "merged EvidenceBundle",
        ),
        fail_close_semantic="retrieval_failed",
        allowed_legacy_heuristic_authority=(),
    ),
    RagRuntimeStageContract(
        stage_name="evidence_selection",
        owner="packages/rag-agent",
        input_artifacts=(
            "merged EvidenceBundle",
            "RetrievalExecutionResult",
            "version answer context",
        ),
        output_artifacts=(
            "supporting EvidenceBundle",
            "retrieval adequacy",
        ),
        fail_close_semantic="unsupported_by_evidence",
        allowed_legacy_heuristic_authority=(
            "answer shape may adjust support budget",
            "title_lookup may label presentation only",
        ),
    ),
    RagRuntimeStageContract(
        stage_name="synthesis",
        owner="packages/rag-agent",
        input_artifacts=(
            "supporting EvidenceBundle",
            "retrieval adequacy",
            "RagIntentFrame",
        ),
        output_artifacts=(
            "deterministic answer draft",
            "optional prompt answer draft",
        ),
        fail_close_semantic="prompt_fallback_or_no_answer",
        allowed_legacy_heuristic_authority=(
            "presentation hint",
            "support row rendering",
        ),
    ),
    RagRuntimeStageContract(
        stage_name="grounding",
        owner="packages/rag-agent",
        input_artifacts=(
            "answer draft",
            "supporting EvidenceBundle",
            "provider grounding supports",
        ),
        output_artifacts=(
            "grounding verdict",
            "claim supports",
            "source trust summary",
        ),
        fail_close_semantic="insufficient_grounding",
        allowed_legacy_heuristic_authority=(),
    ),
)


def resolve_stage_contract(stage_name: str) -> RagRuntimeStageContract:
    normalized_name = stage_name.strip()
    for stage in RAG_AGENT_RUNTIME_STAGES:
        if stage.stage_name == normalized_name:
            return stage
    raise KeyError(f"unknown rag runtime stage: {stage_name}")


__all__ = [
    "RAG_AGENT_RUNTIME_STAGES",
    "RagRuntimeStageContract",
    "resolve_stage_contract",
]
