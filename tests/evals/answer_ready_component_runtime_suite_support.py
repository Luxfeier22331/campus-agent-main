# ruff: noqa: F401
# ruff: noqa: F401
from __future__ import annotations

from dataclasses import replace

from campus_contracts import (
    CapabilityResponse,
    ClaimSupport,
    EvidenceBundle,
    RagResultDiagnostics,
    RagResultPayload,
)
from campus_evals.answer_ready_component_runtime import (
    AnswerReadyComponentRuntimeArtifact,
    build_answer_ready_component_observation,
    collect_answer_ready_component_runtime_observations,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.knowledge_capability_test_support import (
    _make_handbook_source,
    _make_official_web_source,
)


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "unit:article-1",
        **metadata,
    }
    answer_role = str(payload.get("answer_role") or "").strip()
    condition_subject = str(payload.get("condition_subject") or "").strip()
    condition_group_id = str(payload.get("condition_group_id") or "").strip()
    category_audience = str(payload.get("category_audience") or "").strip()

    if condition_subject:
        payload.setdefault("condition_subject_taxonomy_version", "condition_subject.v1")
        payload.setdefault("condition_subject_provenance", "test-helper:default")
    if condition_subject and answer_role in {"procedure_step", "category_overview"}:
        payload.setdefault("condition_group_subject", condition_subject)
    if answer_role == "procedure_step":
        payload.setdefault("procedure_step_index", 1)
        payload.setdefault("procedure_actor", "student")
        payload.setdefault("procedure_action", "apply")
        payload.setdefault("procedure_action_taxonomy_version", "procedure_action.v1")
        payload.setdefault("procedure_action_provenance", "test-helper:default")
        if condition_subject and not condition_group_id:
            payload["condition_group_id"] = f"unit:article-1:{condition_subject}"
    if answer_role == "category_overview":
        payload.setdefault("category_registry_version", "policy_category_registry.v1")
        if category_audience and "audience" not in payload:
            payload["audience"] = category_audience
        if (
            "category_member_document_ids" in payload
            and "member_policy_document_ids" not in payload
        ):
            payload["member_policy_document_ids"] = payload["category_member_document_ids"]
        if "category_member_titles" in payload and "member_policy_titles" not in payload:
            payload["member_policy_titles"] = payload["category_member_titles"]
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


__all__ = [name for name in globals() if not name.startswith("__")]
