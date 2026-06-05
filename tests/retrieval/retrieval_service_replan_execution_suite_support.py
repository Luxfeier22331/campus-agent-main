# ruff: noqa: F401
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle
from campus_regulation_semantics.answer_ready_evidence_contract import (
    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
)
from campus_retrieval_core.service import (
    RetrievalBackendError,
    build_jsonl_retrieval_observation_sink,
    build_retrieval_observation_event_sink,
    execute_retrieval_plan,
)

from tests.retrieval.retrieval_service_test_support import _make_source


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    answer_role = str(metadata.get("answer_role") or "eligibility_condition")
    parent_unit_id = str(metadata.get("parent_unit_id") or "test:article-1")
    condition_group_id = str(
        metadata.get("condition_group_id") or f"{parent_unit_id}:group-01:generic_condition"
    )
    condition_subject = str(metadata.get("condition_subject") or "generic_condition")
    condition_group_subject = str(metadata.get("condition_group_subject") or condition_subject)
    condition_polarity = str(metadata.get("condition_polarity") or "positive")

    payload: dict[str, object] = {
        "answer_role": answer_role,
        "parent_unit_id": parent_unit_id,
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    }
    if answer_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "material_requirement",
        "time_constraint",
        "procedure_step",
    }:
        payload.update(
            {
                "condition_subject": condition_subject,
                "condition_group_subject": condition_group_subject,
                "condition_group_id": condition_group_id,
                "condition_subject_taxonomy_version": (
                    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
                ),
                "condition_subject_provenance": "test-fixture:explicit",
                "condition_polarity": condition_polarity,
            }
        )
    if answer_role == "procedure_step":
        payload.update(
            {
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "apply",
                "procedure_action_taxonomy_version": (
                    ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION
                ),
                "procedure_action_provenance": "test-fixture:explicit",
            }
        )
    payload.update(metadata)
    return {
        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload,
        "page_start": 1,
        "page_end": 1,
    }


__all__ = [name for name in globals() if not name.startswith("__")]
