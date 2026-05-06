from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, EvidenceBundle, KnowledgeScope, RagRequestPayload
from campus_rag_agent.rag_sdk_models import RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import RagSdkAnswerOutput
from campus_rag_agent.service import delegate_to_rag_agent

from tests.agent.rag_agent_test_support import _make_handbook_source


class RagAgentSdkRolloutTest(unittest.TestCase):
    def test_shadow_mode_executes_sdk_but_returns_legacy_answer(self) -> None:
        calls = 0

        def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal calls
            calls += 1
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="SDK shadow answer must not be returned.",
                    answer_kind="short_answer",
                    semantic_outcome="grounded_answer",
                    confidence="medium",
                    cited_source_ids=("handbook:medical",),
                )
            )

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: _evidence(),
            rag_sdk_runner=runner,
            rag_sdk_rollout_mode="shadow",
        )

        self.assertEqual(calls, 1)
        self.assertEqual(response.status, "completed")
        self.assertNotIn("SDK shadow answer", response.answer_text)
        self.assertNotEqual(response.result.diagnostics.prompt_runtime_state, "rag_sdk_completed")

    def test_shadow_mode_runtime_failure_does_not_fail_user_response(self) -> None:
        calls = 0

        def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal calls
            calls += 1
            raise RuntimeError("shadow SDK failure")

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: _evidence(),
            rag_sdk_runner=runner,
            rag_sdk_rollout_mode="shadow",
        )

        self.assertEqual(calls, 1)
        self.assertEqual(response.status, "completed")
        self.assertNotEqual(response.result.diagnostics.no_answer_reason, "rag_sdk_runtime_failed")

    def test_fallback_only_mode_does_not_execute_sdk(self) -> None:
        calls = 0

        def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
            nonlocal calls
            calls += 1
            return RagSdkRunResult(output=object())

        response = delegate_to_rag_agent(
            _request(),
            retriever=lambda *args, **kwargs: _evidence(),
            rag_sdk_runner=runner,
            rag_sdk_rollout_mode="fallback_only",
        )

        self.assertEqual(calls, 0)
        self.assertEqual(response.status, "completed")


def _request() -> AgentRequest:
    return AgentRequest(
        target="rag-agent",
        user_goal="公费医疗报销需要什么材料",
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


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


if __name__ == "__main__":
    unittest.main()
