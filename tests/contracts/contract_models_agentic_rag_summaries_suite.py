from __future__ import annotations

from tests.contracts.contract_models_test_support import *


class ContractModelsAgenticRagSummariesSuite(unittest.TestCase):
    def test_knowledge_tool_depth_summaries_are_safe_public_contracts(self) -> None:
        diagnostics = RagResultDiagnostics(
            planner_information_needs=(
                RagPlannerInformationNeed(
                    need_id="need:policy-condition",
                    question="公费医疗报销需要哪些材料？",
                    target_collection="student_rules",
                    query_mode="current",
                    expected_evidence_kind="requirement",
                    source_trust_tier="T1",
                ),
            ),
            projection_context_summaries=(
                RagProjectionContextSummary(
                    projection_id="projection:notice_context:test",
                    source_step_id="handoff:notice:campus_notice_get",
                    projection_kind="notice_context",
                    content_hash="sha256:test",
                    safety_summary={"max_chars": 1600, "fields_present": ["title"]},
                    evidence_use="framing_only",
                ),
            ),
            entity_resolution_summary=RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="course",
                canonical_id="course:muc.xigai",
                canonical_title="习近平新时代中国特色社会主义思想概论",
                target_collection="course_facts",
                resolution_source="canonical_alias_governance",
                confidence=0.95,
            ),
            replan_decision_summary=RagReplanDecisionSummary(
                attempted=True,
                replan_count=1,
                trigger_reason="empty_supporting_evidence",
                outcome="scope_preserved",
                fail_close_reason="",
            ),
            claim_evidence_graph=(
                ClaimEvidenceGraphEntry(
                    claim_id="claim:1",
                    claim_text="报销需要门诊收费票据。",
                    supported=True,
                    support_source_doc_ids=("handbook:medical",),
                    support_chunk_ids=("chunk:medical:1",),
                    support_need_ids=("need:policy-condition",),
                    support_version_sides=("primary",),
                    support_status="supported",
                    required_source_trust_tier="T1",
                    observed_source_trust_tiers=("T1",),
                ),
            ),
        )

        payload = asdict(diagnostics)

        self.assertEqual(
            payload["planner_information_needs"][0]["need_id"],
            "need:policy-condition",
        )
        self.assertEqual(
            payload["projection_context_summaries"][0]["evidence_use"],
            "framing_only",
        )
        self.assertEqual(payload["entity_resolution_summary"]["canonical_id"], "course:muc.xigai")
        self.assertEqual(
            payload["entity_resolution_summary"]["resolution_source"],
            "canonical_alias_governance",
        )
        self.assertEqual(
            payload["replan_decision_summary"]["trigger_reason"],
            "empty_supporting_evidence",
        )
        self.assertEqual(payload["claim_evidence_graph"][0]["support_status"], "supported")
        self.assertEqual(
            payload["claim_evidence_graph"][0]["support_need_ids"],
            ("need:policy-condition",),
        )
        self.assertEqual(
            payload["claim_evidence_graph"][0]["support_version_sides"],
            ("primary",),
        )
        self.assertNotIn("raw_payload", str(payload))
        self.assertNotIn("raw_body", str(payload))

    def test_rag_entity_resolution_summary_requires_safe_status_and_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "resolution_status must not be empty"):
            RagEntityResolutionSummary(
                resolution_status=" ",
                entity_type="course",
                resolution_source="canonical_alias_governance",
            )

        with self.assertRaisesRegex(ValueError, "resolution_source must not be empty"):
            RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="course",
                canonical_id="course:muc.xigai",
            )

        with self.assertRaisesRegex(ValueError, "confidence must be between 0 and 1"):
            RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="course",
                canonical_id="course:muc.xigai",
                resolution_source="canonical_alias_governance",
                confidence=1.1,
            )

    def test_rag_projection_context_summary_rejects_raw_payload_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            RagProjectionContextSummary(
                projection_id="projection:notice_context:test",
                source_step_id="handoff:notice:campus_notice_get",
                projection_kind="notice_context",
                content_hash="sha256:test",
                safety_summary={"raw_payload": "secret"},
                evidence_use="framing_only",
            )

    def test_claim_evidence_graph_entry_requires_non_empty_claim_and_status(self) -> None:
        with self.assertRaisesRegex(ValueError, "claim_text must not be empty"):
            ClaimEvidenceGraphEntry(
                claim_id="claim:1",
                claim_text=" ",
                support_status="supported",
            )


if __name__ == "__main__":
    unittest.main()
