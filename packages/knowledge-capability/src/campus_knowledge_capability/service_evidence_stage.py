from __future__ import annotations

from dataclasses import dataclass, replace

from campus_contracts import CapabilityResponse, EvidenceBundle
from campus_retrieval_core import RetrievalExecutionResult

from campus_knowledge_capability.confidence import derive_confidence
from campus_knowledge_capability.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
)
from campus_knowledge_capability.remote_content_hardening import (
    apply_remote_content_suspicion_labels,
    should_block_remote_content_generation,
)

from .service_versioning_context import _VersionAnswerContext
from .service_versioning_evidence import (
    _build_version_aware_supporting_evidence,
    _is_compare_support_incomplete,
)


@dataclass(frozen=True, slots=True)
class RagEvidenceSelectionStageResult:
    response: CapabilityResponse | None
    supporting_evidence: EvidenceBundle
    confidence: str
    compare_support_incomplete: bool
    step_support_count: int = 0


def execute_rag_evidence_selection_stage(
    *,
    retrieved_evidence: EvidenceBundle,
    version_answer_context: _VersionAnswerContext,
    handbook_plan: HandbookQueryPlan | None = None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    retrieval_execution_result: RetrievalExecutionResult | None = None,
    remote_content_block_response_builder=None,
) -> RagEvidenceSelectionStageResult:
    supporting_evidence = _build_version_aware_supporting_evidence(
        retrieved_evidence,
        version_answer_context=version_answer_context,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
    )
    supporting_evidence = _with_step_level_support_provenance(
        supporting_evidence,
        retrieval_execution_result=retrieval_execution_result,
    )
    apply_remote_content_suspicion_labels(supporting_evidence)
    if should_block_remote_content_generation(supporting_evidence):
        if remote_content_block_response_builder is None:
            raise RuntimeError("remote content block response builder is required")
        return RagEvidenceSelectionStageResult(
            response=remote_content_block_response_builder(supporting_evidence),
            supporting_evidence=supporting_evidence,
            confidence="low",
            compare_support_incomplete=False,
            step_support_count=_step_support_count(supporting_evidence),
        )
    return RagEvidenceSelectionStageResult(
        response=None,
        supporting_evidence=supporting_evidence,
        confidence=derive_confidence(supporting_evidence, handbook_plan=handbook_plan),
        compare_support_incomplete=_is_compare_support_incomplete(
            supporting_evidence=supporting_evidence,
            version_answer_context=version_answer_context,
        ),
        step_support_count=_step_support_count(supporting_evidence),
    )


def _with_step_level_support_provenance(
    evidence: EvidenceBundle,
    *,
    retrieval_execution_result: RetrievalExecutionResult | None,
) -> EvidenceBundle:
    if retrieval_execution_result is None or not evidence.sources:
        return evidence
    step_ids_by_chunk = _step_ids_by_chunk_id(retrieval_execution_result)
    need_ids_by_chunk = _need_ids_by_chunk_id(retrieval_execution_result)
    if not step_ids_by_chunk and not need_ids_by_chunk:
        return evidence
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=tuple(
            _with_source_step_provenance(
                source,
                plan_id=retrieval_execution_result.plan.plan_id,
                replan_count=retrieval_execution_result.replan_count,
                step_ids=step_ids_by_chunk.get(source.chunk_id, ()),
                need_ids=need_ids_by_chunk.get(source.chunk_id, ()),
            )
            for source in evidence.sources
        ),
    )


def _step_ids_by_chunk_id(
    retrieval_execution_result: RetrievalExecutionResult,
) -> dict[str, tuple[str, ...]]:
    step_ids_by_chunk: dict[str, list[str]] = {}
    for step_result in retrieval_execution_result.step_results:
        for source in (*step_result.grounding, *step_result.references):
            if not source.chunk_id:
                continue
            step_ids = step_ids_by_chunk.setdefault(source.chunk_id, [])
            if step_result.step_id not in step_ids:
                step_ids.append(step_result.step_id)
    return {chunk_id: tuple(step_ids) for chunk_id, step_ids in step_ids_by_chunk.items()}


def _need_ids_by_chunk_id(
    retrieval_execution_result: RetrievalExecutionResult,
) -> dict[str, tuple[str, ...]]:
    need_ids_by_chunk: dict[str, list[str]] = {}
    for step_result in retrieval_execution_result.step_results:
        if step_result.activity is None:
            continue
        for source in (*step_result.grounding, *step_result.references):
            if not source.chunk_id:
                continue
            need_ids = need_ids_by_chunk.setdefault(source.chunk_id, [])
            for need_id in step_result.activity.need_ids:
                if need_id not in need_ids:
                    need_ids.append(need_id)
    return {chunk_id: tuple(need_ids) for chunk_id, need_ids in need_ids_by_chunk.items()}


def _with_source_step_provenance(
    source,
    *,
    plan_id: str,
    replan_count: int,
    step_ids: tuple[str, ...],
    need_ids: tuple[str, ...],
):
    if not step_ids and not need_ids:
        return source
    anchor = {
        **source.anchor,
        "retrieval_plan_id": plan_id,
        "retrieval_replan_count": replan_count,
    }
    if step_ids:
        anchor["retrieval_step_ids"] = step_ids
    if need_ids:
        anchor["retrieval_need_ids"] = need_ids
    return replace(source, anchor=anchor)


def _step_support_count(evidence: EvidenceBundle) -> int:
    step_ids = set()
    for source in evidence.sources:
        raw_step_ids = source.anchor.get("retrieval_step_ids")
        if isinstance(raw_step_ids, tuple):
            step_ids.update(str(step_id) for step_id in raw_step_ids if str(step_id).strip())
    return len(step_ids)


__all__ = [
    "RagEvidenceSelectionStageResult",
    "execute_rag_evidence_selection_stage",
]
