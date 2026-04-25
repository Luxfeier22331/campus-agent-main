from __future__ import annotations

import json
import unittest

import httpx
from campus_contracts import (
    ActorContext,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    TraceContext,
)
from campus_rag_agent.prompt_packets import build_rag_answer_prompt_packet
from campus_shared import (
    NormalizedProviderGroundingSupport,
    PromptRuntimeHTTPSettings,
    PromptRuntimeProviderConfig,
)
from campus_supervisor_core_worker.prompt_executor import (
    ProviderBackedRagPromptExecutor,
)


def _provider_config() -> PromptRuntimeProviderConfig:
    return PromptRuntimeProviderConfig(
        provider="openai-responses",
        transport="responses",
        base_url="https://prompt-runtime.example/v1",
        api_key="test-api-key",
        http_settings=PromptRuntimeHTTPSettings(),
    )


def _build_rag_packet():
    request = SpecialistRequest(
        target="rag-agent",
        user_goal="习近平新时代中国特色社会主义思想概论有哪些专业要上",
        request_id="req-rag-provider-exec",
        safety_identifier="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        trace=TraceContext(trace_id="trace-rag-provider-exec"),
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
    return build_rag_answer_prompt_packet(
        request,
        resolved_scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
        evidence=evidence,
    )


class ProviderBackedPromptExecutorTest(unittest.TestCase):
    def test_rag_executor_returns_typed_output_and_prompt_trace(self) -> None:
        captured_payloads: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_payloads.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output_parsed": {
                        "answer_text": "证据显示，法学民族实验班第四学期开设习近平新时代中国特色社会主义思想概论。",
                    },
                },
            )

        executor = ProviderBackedRagPromptExecutor(
            provider_config=_provider_config(),
            model_name="gpt-5.2-mini",
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                base_url="https://prompt-runtime.example/v1",
            ),
        )

        execution = executor.compose_answer(_build_rag_packet())

        self.assertEqual(
            execution.output.answer_text,
            "证据显示，法学民族实验班第四学期开设习近平新时代中国特色社会主义思想概论。",
        )
        self.assertEqual(execution.prompt_trace.prompt_id, "rag_answer_v1")
        self.assertEqual(execution.prompt_trace.model_provider, "openai-responses")
        self.assertEqual(execution.prompt_trace.model_name, "gpt-5.2-mini")
        self.assertEqual(
            captured_payloads[0]["safety_identifier"],
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )

    def test_rag_executor_returns_provider_grounding_supports_when_present(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output_parsed": {
                        "answer_text": "证据显示，法学民族实验班第四学期开设习近平新时代中国特色社会主义思想概论。",
                    },
                    "supports": [
                        {
                            "claimText": "第四学期",
                            "docId": "curriculum:law-001",
                            "snippet": "第四学期开设习近平新时代中国特色社会主义思想概论。",
                        }
                    ],
                },
            )

        executor = ProviderBackedRagPromptExecutor(
            provider_config=_provider_config(),
            model_name="gpt-5.2-mini",
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                base_url="https://prompt-runtime.example/v1",
            ),
        )

        execution = executor.compose_answer(_build_rag_packet())

        self.assertEqual(
            execution.provider_grounding_supports,
            (
                NormalizedProviderGroundingSupport(
                    claim_text="第四学期",
                    support_source_doc_id="curriculum:law-001",
                    support_snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                ),
            ),
        )

    def test_rag_executor_fail_closes_on_incomplete_response(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "status": "incomplete",
                    "incomplete_details": {
                        "reason": "max_output_tokens",
                    },
                },
            )

        executor = ProviderBackedRagPromptExecutor(
            provider_config=_provider_config(),
            model_name="gpt-5.2-mini",
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                base_url="https://prompt-runtime.example/v1",
            ),
        )

        with self.assertRaisesRegex(Exception, "provider_incomplete"):
            executor.compose_answer(_build_rag_packet())


if __name__ == "__main__":
    unittest.main()
