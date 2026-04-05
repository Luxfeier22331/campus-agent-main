from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagRequestPayload,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
)
from campus_rag_specialist.intent import frame_rag_intent
from campus_rag_specialist.prompt_packets import (
    build_rag_answer_prompt_packet,
    build_rag_clarify_prompt_packet,
    build_rag_no_answer_prompt_packet,
)
from campus_rag_specialist.prompts.registry import (
    get_rag_prompt_spec,
    list_rag_prompt_specs,
)


def _make_request() -> SpecialistRequest:
    return SpecialistRequest(
        target="rag-specialist",
        user_goal="这个规定怎么办",
        context=ContextProjection(
            actor=ActorContext(
                user_id="student-001",
                cohort="2023",
                major="法学",
            ),
            profile_memory=ProfileMemorySummary(
                items=(
                    ProfileMemoryItem(
                        item_id="memory-001",
                        key="recent_goal",
                        value="学生证补办",
                        source_type="user_declared",
                        confidence="high",
                        visibility="user_visible",
                    ),
                ),
            ),
            session=SessionSummary(
                confirmed_slots=(SessionSlot(name="policy_topic", value="学生证"),),
                turn_count=3,
            ),
        ),
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
        ),
    )


def _make_evidence() -> EvidenceBundle:
    return EvidenceBundle(
        corpus="regulations",
        collection="student_handbook",
        query_text="学生证补办流程",
        sources=(
            EvidenceSource(
                doc_id="handbook:test-001",
                revision_track="source-faithful",
                version_id="v1:test-001",
                chunk_id="handbook:test-001:chunk-0001",
                anchor={"page_start": 1, "page_end": 1},
                canonical_url="https://campus.example/handbook/test-001",
                latest_url="https://campus.example/handbook/test-001",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet="补办学生证需要先提交申请表，再到学院审核。",
                score=0.82,
                source_title="学生证管理办法",
                structural_path=("学生证管理办法", "补办"),
                detail_label="补办流程",
                content_role="procedure",
                is_answer_bearing=True,
            ),
        ),
    )


class RagPromptRegistryTest(unittest.TestCase):
    def test_rag_prompt_registry_exposes_first_rollout_assets(self) -> None:
        specs = list_rag_prompt_specs()

        self.assertEqual(
            {spec.prompt_id for spec in specs},
            {"rag_answer_v1", "rag_clarify_v1", "rag_no_answer_v1"},
        )
        answer = get_rag_prompt_spec("rag_answer_v1")
        clarify = get_rag_prompt_spec("rag_clarify_v1")
        no_answer = get_rag_prompt_spec("rag_no_answer_v1")

        self.assertEqual(answer.owner_package, "campus_rag_specialist")
        self.assertEqual(clarify.owner_package, "campus_rag_specialist")
        self.assertEqual(no_answer.owner_package, "campus_rag_specialist")
        self.assertEqual(answer.supported_modes, ("answer",))
        self.assertEqual(clarify.supported_modes, ("clarify",))
        self.assertEqual(no_answer.supported_modes, ("no_answer",))
        self.assertIn("<role>", answer.template_text)
        self.assertIn("<role>", clarify.template_text)
        self.assertIn("<output_contract>", no_answer.template_text)
        self.assertRegex(answer.template_sha256, r"^[0-9a-f]{64}$")
        self.assertRegex(clarify.template_sha256, r"^[0-9a-f]{64}$")
        self.assertRegex(no_answer.template_sha256, r"^[0-9a-f]{64}$")


class RagPromptPacketTest(unittest.TestCase):
    def test_build_rag_clarify_prompt_packet_separates_task_from_user_input(self) -> None:
        request = _make_request()
        intent_frame = frame_rag_intent(request)

        packet = build_rag_clarify_prompt_packet(
            request,
            intent_frame=intent_frame,
            resolved_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
        )

        self.assertEqual(packet.prompt_id, "rag_clarify_v1")
        self.assertEqual(packet.task.mode, "clarify")
        self.assertEqual(packet.task.personalization_mode, "user_grounded")
        self.assertEqual(packet.task.resolved_scope_corpus, "regulations")
        self.assertEqual(packet.task.resolved_scope_collection, "student_handbook")
        self.assertEqual(packet.task.ambiguity_reason, "referential")
        self.assertEqual(packet.task.missing_slots, ("target_policy",))
        self.assertEqual(packet.user_input_text, "这个规定怎么办")
        self.assertEqual(packet.evidence, ())
        self.assertFalse(hasattr(packet.task, "user_input_text"))

    def test_build_rag_no_answer_prompt_packet_serializes_safe_evidence_entries(self) -> None:
        request = _make_request()
        packet = build_rag_no_answer_prompt_packet(
            request,
            resolved_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            evidence=_make_evidence(),
            no_answer_reason="insufficient_grounding",
        )

        self.assertEqual(packet.prompt_id, "rag_no_answer_v1")
        self.assertEqual(packet.task.mode, "no_answer")
        self.assertEqual(packet.task.no_answer_reason, "insufficient_grounding")
        self.assertEqual(len(packet.evidence), 1)
        evidence_entry = packet.evidence[0]
        self.assertEqual(evidence_entry.doc_id, "handbook:test-001")
        self.assertEqual(evidence_entry.source_title, "学生证管理办法")
        self.assertEqual(evidence_entry.detail_label, "补办流程")
        self.assertEqual(evidence_entry.structural_path, ("学生证管理办法", "补办"))
        self.assertEqual(evidence_entry.snippet, "补办学生证需要先提交申请表，再到学院审核。")
        self.assertTrue(evidence_entry.safe_summary)
        self.assertFalse(hasattr(evidence_entry, "anchor"))
        self.assertFalse(hasattr(evidence_entry, "canonical_url"))

    def test_build_rag_answer_prompt_packet_serializes_safe_evidence_entries(self) -> None:
        request = _make_request()
        packet = build_rag_answer_prompt_packet(
            request,
            resolved_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            evidence=_make_evidence(),
        )

        self.assertEqual(packet.prompt_id, "rag_answer_v1")
        self.assertEqual(packet.task.mode, "answer")
        self.assertEqual(packet.task.resolved_scope_corpus, "regulations")
        self.assertEqual(packet.task.resolved_scope_collection, "student_handbook")
        self.assertEqual(packet.task.output_schema_name, "rag_answer_v1")
        self.assertTrue(packet.task.citation_expected)
        self.assertEqual(len(packet.evidence), 1)
        self.assertEqual(packet.evidence[0].doc_id, "handbook:test-001")


if __name__ == "__main__":
    unittest.main()
