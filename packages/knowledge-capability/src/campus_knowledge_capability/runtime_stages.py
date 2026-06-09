from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RagRuntimeStageContract:
    stage_name: str
    owner: str
    input_artifacts: tuple[str, ...] = field(default_factory=tuple)
    output_artifacts: tuple[str, ...] = field(default_factory=tuple)
    fail_close_semantic: str = ""
    allowed_presentation_heuristics: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.stage_name.strip():
            raise ValueError("stage_name must not be empty")
        if not self.owner.strip():
            raise ValueError("owner must not be empty")


KNOWLEDGE_CAPABILITY_RUNTIME_STAGES: tuple[RagRuntimeStageContract, ...] = (
    RagRuntimeStageContract(
        stage_name="planner",
        owner="packages/knowledge-capability",
        input_artifacts=(
            "CapabilityRequest",
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
        allowed_presentation_heuristics=(),
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
        allowed_presentation_heuristics=(),
    ),
    RagRuntimeStageContract(
        stage_name="evidence_selection",
        owner="packages/knowledge-capability",
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
        allowed_presentation_heuristics=(
            "answer shape may adjust support budget",
            "title_lookup may label presentation only",
        ),
    ),
    RagRuntimeStageContract(
        stage_name="synthesis",
        owner="packages/knowledge-capability",
        input_artifacts=(
            "supporting EvidenceBundle",
            "retrieval adequacy",
            "RagIntentFrame",
        ),
        output_artifacts=(
            "deterministic answer draft",
            "optional prompt answer draft",
        ),
        fail_close_semantic="prompt_runtime_failed_or_no_answer",
        allowed_presentation_heuristics=(
            "presentation hint",
            "support row rendering",
        ),
    ),
    RagRuntimeStageContract(
        stage_name="grounding",
        owner="packages/knowledge-capability",
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
        allowed_presentation_heuristics=(),
    ),
)


def resolve_stage_contract(stage_name: str) -> RagRuntimeStageContract:
    normalized_name = stage_name.strip()
    for stage in KNOWLEDGE_CAPABILITY_RUNTIME_STAGES:
        if stage.stage_name == normalized_name:
            return stage
    raise KeyError(f"unknown rag runtime stage: {stage_name}")


__all__ = [
    "KNOWLEDGE_CAPABILITY_RUNTIME_STAGES",
    "RagRuntimeStageContract",
    "resolve_stage_contract",
]
