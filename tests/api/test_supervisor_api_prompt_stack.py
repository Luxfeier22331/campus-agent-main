from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    CapabilityRequest,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    TraceContext,
)
from campus_knowledge_capability.prompt_packets import build_rag_answer_prompt_packet
from campus_supervisor_agent_worker.app import create_bridge_app
from campus_supervisor_agent_worker.prompt_stack import (
    build_rag_prompt_stack,
)
from campus_supervisor_agent_worker.settings import ApiSettings


class SupervisorApiPromptStackTest(unittest.TestCase):
    def test_create_bridge_app_exposes_explicit_prompt_runtime_configuration(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                runtime_provider="openai-responses",
                prompt_runtime_provider="openai-responses",
                supervisor_prompt_model="gpt-5.2",
                agent_prompt_model="gpt-5.2-mini",
            )
        )

        self.assertEqual(app.runtime.prompt_runtime.provider, "openai-responses")
        self.assertEqual(app.runtime.prompt_runtime.supervisor_prompt_model, "gpt-5.2")
        self.assertEqual(app.runtime.prompt_runtime.agent_prompt_model, "gpt-5.2-mini")
        self.assertEqual(
            app.runtime.prompt_runtime.developer_invariants_id,
            "repo_global_developer_invariants_v1",
        )
        self.assertEqual(app.runtime.prompt_runtime.developer_invariants_version, "v1")
        self.assertTrue(app.runtime.prompt_runtime.strict_structured_outputs)

    def test_prompt_runtime_admission_does_not_require_supervisor_terminal_model(
        self,
    ) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                runtime_provider="openai-responses",
                prompt_runtime_provider="openai-responses",
                supervisor_prompt_model="",
                agent_prompt_model="gpt-5.2-mini",
                prompt_runtime_api_key="test-key",
            )
        )

        self.assertTrue(app.runtime.prompt_runtime.admitted)
        self.assertEqual(app.runtime.prompt_runtime.admission_reason, "")
        self.assertEqual(app.runtime.prompt_runtime.agent_prompt_model, "gpt-5.2-mini")

    def test_build_rag_prompt_stack_keeps_evidence_out_of_developer_zone(self) -> None:
        request = CapabilityRequest(
            target="knowledge",
            user_goal="习近平新时代中国特色社会主义思想概论有哪些专业要上",
            request_id="req-rag-prompt-stack",
            trace=TraceContext(trace_id="trace-rag-prompt-stack"),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(actor=ActorContext(user_id="student-001")),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
            ),
        )
        evidence = EvidenceBundle(
            query_text=request.user_goal,
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:law-001",
                    revision_track="source-faithful",
                    version_id="v1:curriculum:law-001",
                    chunk_id="curriculum:law-001:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/law-001",
                    latest_url="https://campus.example/curriculum/law-001",
                    source_channel="manual_curated",
                    collection="curriculum_plan",
                    is_current=True,
                    source_title="法学民族实验班培养方案",
                    detail_label="第四学期课程",
                    snippet="习近平新时代中国特色社会主义思想概论，3学分，法学专业本科生修读。",
                    structural_path=("第四学期", "课程设置"),
                    score=0.93,
                ),
            ),
        )
        packet = build_rag_answer_prompt_packet(
            request,
            resolved_scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
            evidence=evidence,
        )

        stack = build_rag_prompt_stack(
            packet,
            provider="openai-responses",
            model_name="gpt-5.2-mini",
        )

        self.assertEqual(stack.prompt_id, "rag_answer_v1")
        self.assertEqual(
            tuple(message.zone for message in stack.messages),
            (
                "repo_global_developer_invariants",
                "package_role_prompt",
                "trusted_task_packet",
                "untrusted_user_input",
                "untrusted_evidence_packet",
            ),
        )
        developer_contents = "\n".join(
            message.content for message in stack.messages if message.role == "developer"
        )
        self.assertNotIn(request.user_goal, developer_contents)
        self.assertNotIn("法学专业本科生修读", developer_contents)
        self.assertIn(request.user_goal, stack.messages[-2].content)
        self.assertIn("法学专业本科生修读", stack.messages[-1].content)


if __name__ == "__main__":
    unittest.main()
