from __future__ import annotations

import unittest

from campus_contracts import CapabilityRequest, EvidenceBundle, KnowledgeScope, RagRequestPayload
from campus_knowledge_capability.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceProjection,
    RagSdkRunRequest,
    RagTaskKind,
)
from campus_knowledge_capability.rag_sdk_tools import (
    RagSdkToolError,
    execute_retrieve_evidence_tool,
)
from campus_knowledge_capability.service_planner_stage import execute_rag_planner_stage

from tests.agent.knowledge_capability_test_support import _make_handbook_source


class KnowledgeCapabilitySdkToolsTest(unittest.TestCase):
    def test_retrieve_evidence_tool_returns_bounded_projection_from_admitted_plan(self) -> None:
        request = _sdk_request("公费医疗报销需要什么材料")

        result = execute_retrieve_evidence_tool(
            request,
            {"query_slot_id": "indexed-lookup", "retrieval_intent": "requirement"},
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["source_count"], 1)
        self.assertEqual(result["anchors"][0]["source_id"], "handbook:medical")
        self.assertNotIn("raw_prompt", result)
        self.assertNotIn("retrieval_plan", result)

    def test_retrieve_evidence_tool_defaults_single_admitted_slot_when_model_omits_slot(
        self,
    ) -> None:
        request = _sdk_request("中央民族大学本科学生国家奖学金评审办法")

        result = execute_retrieve_evidence_tool(
            request,
            {"retrieval_intent": "specific_policy_lookup"},
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["query_slot_id"], "indexed-lookup")

    def test_retrieve_evidence_tool_coerces_invalid_single_admitted_slot_to_only_slot(
        self,
    ) -> None:
        request = _sdk_request("中央民族大学本科学生国家奖学金评审办法")

        result = execute_retrieve_evidence_tool(
            request,
            {
                "query_slot_id": "specific_policy_lookup",
                "retrieval_intent": "specific_policy_lookup",
            },
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["query_slot_id"], "indexed-lookup")

    def test_retrieve_evidence_tool_rejects_missing_slot_when_multiple_slots_are_admitted(
        self,
    ) -> None:
        request = _sdk_request(
            "比较当前办法和历史办法",
            admitted_query_slot_ids=("compare-current-lookup", "compare-other-lookup"),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_query_slot_not_admitted"):
            execute_retrieve_evidence_tool(
                request,
                {"retrieval_intent": "specific_policy_lookup"},
            )

    def test_retrieve_evidence_tool_rejects_unadmitted_query_slot_when_multiple_slots_exist(
        self,
    ) -> None:
        request = _sdk_request(
            "比较当前办法和历史办法",
            admitted_query_slot_ids=("compare-current-lookup", "compare-other-lookup"),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_query_slot_not_admitted"):
            execute_retrieve_evidence_tool(
                request,
                {"query_slot_id": "new-expanded-query", "retrieval_intent": "requirement"},
            )

    def test_retrieve_evidence_tool_rejects_model_supplied_scope_or_selector(self) -> None:
        request = _sdk_request("公费医疗报销需要什么材料")

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_scope_widening_rejected"):
            execute_retrieve_evidence_tool(
                request,
                {
                    "query_slot_id": "indexed-lookup",
                    "retrieval_intent": "requirement",
                    "corpus": "official_web",
                    "collection": "muc_public_pages",
                    "target_document_ids": ["handbook:other"],
                },
            )

    def test_retrieve_evidence_tool_rejects_selector_drift_against_plan(self) -> None:
        request = _sdk_request(
            "公费医疗报销需要什么材料",
            admitted_query_slot_ids=("expanded",),
            selector_blocked_query_slot_ids=("expanded",),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_selector_not_admitted"):
            execute_retrieve_evidence_tool(
                request,
                {"query_slot_id": "expanded", "retrieval_intent": "requirement"},
            )


def _request(user_goal: str) -> CapabilityRequest:
    return CapabilityRequest(
        capability="knowledge",
        user_goal=user_goal,
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


def _plan(request: CapabilityRequest):
    result = execute_rag_planner_stage(
        request=request,
        effective_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
        user_goal=request.user_goal,
        effective_user_goal=request.user_goal,
        handbook_plan=None,
        curriculum_plan=None,
        curriculum_course_plan=None,
        curriculum_program_family_plan=None,
    )
    assert result.retrieval_plan is not None
    return result.retrieval_plan


def _evidence() -> EvidenceBundle:
    return EvidenceBundle(
        query_text="公费医疗报销需要什么材料",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:medical",
                title="中央民族大学学生公费医疗管理办法",
                snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                score=0.91,
                chunk_id_suffix="medical-support-1",
                content_role="requirement",
                is_answer_bearing=True,
            ),
        ),
    )


def _sdk_request(
    user_goal: str,
    *,
    admitted_query_slot_ids: tuple[str, ...] = ("indexed-lookup",),
    selector_blocked_query_slot_ids: tuple[str, ...] = (),
) -> RagSdkRunRequest:
    return RagSdkRunRequest(
        user_goal=user_goal,
        query_intent=RagQueryIntent(
            task_kind=RagTaskKind.FACT_LOOKUP,
            normalized_query=user_goal,
            admitted_query_slot_ids=admitted_query_slot_ids,
        ),
        evidence=RagSdkEvidenceProjection.from_evidence_bundle(_evidence()),
        request_id="req-rag-sdk-tools-suite",
        selector_blocked_query_slot_ids=selector_blocked_query_slot_ids,
    )


if __name__ == "__main__":
    unittest.main()
