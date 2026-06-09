from __future__ import annotations

import unittest

from campus_contracts import (
    CapabilityRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    WorkflowCapabilityContext,
)

from tests.agent.knowledge_capability_test_support import delegate_to_knowledge_capability


class KnowledgeCapabilityWorkflowProjectionGroundingTest(unittest.TestCase):
    def test_transport_override_rag_step_grounds_from_workflow_projection_context(
        self,
    ) -> None:
        user_goal = "\n".join(
            (
                "2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
                "",
                "已读取的班车基线：",
                "线路：丰台到海淀通勤车",
                "摘要：丰台到海淀通勤车通常在丰台校区南门内候车。",
                "",
                "已读取的通知变更集：",
                "摘要：通知 353903 明确 2026-05-07 丰台校区乘车点调整至南门外停车区。",
            )
        )
        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal=user_goal,
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
                workflow_context=WorkflowCapabilityContext(
                    workflow_run_ref="workflow:transport-notice-override",
                    step_id="handoff:knowledge:rag_request",
                    capability_id="knowledge",
                    capability="knowledge",
                    required_projection_kind="notice_change_set",
                    expected_output_artifacts=("evidence_bundle", "grounding_verdict"),
                    projection_refs=(
                        {
                            "projection_id": "projection:schedule_baseline:test",
                            "source_step_id": (
                                "handoff:campus_services:transport_schedule_lookup"
                            ),
                            "projection_kind": "schedule_baseline",
                            "content_hash": "b" * 64,
                            "safety": {
                                "truncated": False,
                                "redacted": False,
                                "max_chars": 1600,
                                "fields_present": ["route_display_name", "summary"],
                            },
                        },
                        {
                            "projection_id": "projection:notice_change_set:test",
                            "source_step_id": (
                                "handoff:notice:campus_notice_change_set_lookup"
                            ),
                            "projection_kind": "notice_change_set",
                            "content_hash": "c" * 64,
                            "safety": {
                                "truncated": False,
                                "redacted": False,
                                "max_chars": 1600,
                                "fields_present": ["change_set_id", "summary"],
                            },
                        },
                    ),
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text=user_goal,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
                sources=(),
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("南门外停车区", response.answer_text)
        self.assertEqual(response.result.evidence.corpus, "regulations")
        self.assertEqual(response.result.evidence.collection, "student_rules")
        self.assertEqual(
            tuple(source.anchor["projection_kind"] for source in response.result.evidence.sources),
            ("schedule_baseline", "notice_change_set"),
        )
        self.assertTrue(
            all(
                source.doc_id.startswith(f"workflow-projection:{source.anchor['projection_kind']}:")
                for source in response.result.evidence.sources
            )
        )
        self.assertTrue(
            all(source.is_answer_bearing for source in response.result.evidence.sources)
        )
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertEqual(
            tuple(
                summary.evidence_use
                for summary in response.result.diagnostics.projection_context_summaries
            ),
            ("grounding_evidence", "grounding_evidence"),
        )
        self.assertNotIn(
            "raw_payload", str(response.result.diagnostics.projection_context_summaries)
        )

    def test_transport_override_rag_step_does_not_require_regular_rag_scope(self) -> None:
        user_goal = "\n".join(
            (
                "2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
                "",
                "已读取的班车基线：",
                "线路：丰台到海淀通勤车",
                "摘要：丰台到海淀通勤车通常在丰台校区南门内候车。",
                "",
                "已读取的通知变更集：",
                "摘要：通知 353903 明确 2026-05-07 丰台校区乘车点调整至南门外停车区。",
            )
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal=user_goal,
                payload=RagRequestPayload(),
                workflow_context=_transport_override_workflow_context(),
            ),
            retriever=lambda *args, **kwargs: self.fail("retriever should not be called"),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.evidence.corpus, "workflow")
        self.assertEqual(response.result.evidence.collection, "transport_notice_override")
        self.assertEqual(len(response.result.evidence.sources), 2)
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")


def _transport_override_workflow_context() -> WorkflowCapabilityContext:
    return WorkflowCapabilityContext(
        workflow_run_ref="workflow:transport-notice-override",
        step_id="handoff:knowledge:rag_request",
        capability_id="knowledge",
        capability="knowledge",
        required_projection_kind="notice_change_set",
        expected_output_artifacts=("evidence_bundle", "grounding_verdict"),
        projection_refs=(
            {
                "projection_id": "projection:schedule_baseline:test",
                "source_step_id": "handoff:campus_services:transport_schedule_lookup",
                "projection_kind": "schedule_baseline",
                "content_hash": "b" * 64,
                "safety": {
                    "truncated": False,
                    "redacted": False,
                    "max_chars": 1600,
                    "fields_present": ["route_display_name", "summary"],
                },
            },
            {
                "projection_id": "projection:notice_change_set:test",
                "source_step_id": "handoff:notice:campus_notice_change_set_lookup",
                "projection_kind": "notice_change_set",
                "content_hash": "c" * 64,
                "safety": {
                    "truncated": False,
                    "redacted": False,
                    "max_chars": 1600,
                    "fields_present": ["change_set_id", "summary"],
                },
            },
        ),
    )


if __name__ == "__main__":
    unittest.main()
