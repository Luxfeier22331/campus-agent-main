from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from campus_contracts import EvidenceBundle
from campus_rag_agent.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceAnchor,
    RagSdkEvidenceProjection,
    RagSdkRunRequest,
    RagTaskKind,
)
from campus_rag_agent.rag_sdk_output import RagSdkAnswerOutput
from campus_shared import PromptRuntimeProviderConfig
from campus_supervisor_agent_worker.rag_agents_sdk_openai_runner import (
    OpenAIRagAgentsSdkRunner,
)

from tests.agent.rag_agent_test_support import _make_handbook_source


class OpenAIRagAgentsSdkRunnerTest(unittest.TestCase):
    def test_source_uses_native_runtime_wrapper_and_no_direct_sdk_loop(self) -> None:
        source = Path(
            "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/"
            "rag_agents_sdk_openai_runner.py"
        ).read_text(encoding="utf-8")

        for fragment in (
            "OpenAIAgentsNativeRuntime",
            "FunctionTool",
            "output_type=",
            "self._runtime.run(",
            'build_agents_sdk_tool_descriptors(("retrieve_evidence",))',
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, source)
        for forbidden in (
            "from agents import Agent",
            "Runner.run_sync(",
            "RunConfig(",
            "ModelSettings(",
            "OpenAIProvider(",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        for forbidden in ("web_search", "file_search", "hosted_mcp", "computer_use"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_runner_maps_structured_sdk_output_to_rag_sdk_result(self) -> None:
        runner = OpenAIRagAgentsSdkRunner(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai",
                transport="responses",
                api_key="test-key",
                base_url="https://api.openai.com/v1",
            ),
            model_name="gpt-5.4-mini",
        )
        captured_kwargs = None

        def fake_run(
            *,
            agent_name,
            instructions,
            input_text,
            context,
            tool_descriptors,
            execute_tool,
            output_type,
        ):
            nonlocal captured_kwargs
            captured_kwargs = {
                "agent_name": agent_name,
                "instructions": instructions,
                "input_text": input_text,
                "context": context,
                "tool_descriptors": tool_descriptors,
                "execute_tool": execute_tool,
                "output_type": output_type,
            }
            return _FakeRuntimeResult(
                final_output={
                    "answer_text": "本科生可申请国家奖学金。",
                    "answer_kind": "list",
                    "semantic_outcome": "grounded_answer",
                    "confidence": "medium",
                    "cited_source_ids": ["handbook:scholarship"],
                    "answer_items": [
                        {"text": "国家奖学金", "source_ids": ["handbook:scholarship"]}
                    ],
                    "claims": [
                        {
                            "claim_id": "claim-1",
                            "text": "本科生可申请国家奖学金。",
                            "claim_type": "fact",
                        }
                    ],
                    "claim_supports": [
                        {
                            "claim_id": "claim-1",
                            "anchors": [
                                {
                                    "source_id": "handbook:scholarship",
                                    "chunk_id": "handbook:scholarship:source-faithful:v1:scholarship-1",
                                    "excerpt": "本科生可申请国家奖学金。",
                                    "span_ref": "chunk-0001:0-12",
                                }
                            ],
                        }
                    ],
                    "item_supports": [
                        {
                            "item_text": "国家奖学金",
                            "anchors": [
                                {
                                    "source_id": "handbook:scholarship",
                                    "chunk_id": "handbook:scholarship:source-faithful:v1:scholarship-1",
                                    "excerpt": "本科生可申请国家奖学金。",
                                    "span_ref": "chunk-0001:0-12",
                                }
                            ],
                        }
                    ],
                    "evidence_anchors": [
                        {
                            "source_id": "handbook:scholarship",
                            "chunk_id": "handbook:scholarship:source-faithful:v1:scholarship-1",
                            "excerpt": "本科生可申请国家奖学金。",
                            "span_ref": "chunk-0001:0-12",
                        }
                    ],
                },
                model_response_ref="resp-rag-sdk-001",
            )

        with patch.object(runner._runtime, "run", side_effect=fake_run):
            result = runner(_run_request())

        self.assertIsInstance(result.output, RagSdkAnswerOutput)
        self.assertEqual(result.output.answer_text, "本科生可申请国家奖学金。")
        self.assertEqual(result.trace_projection["schema_version"], "rag-sdk-trace-projection-v1")
        self.assertEqual(result.trace_projection["model_response_ref"], "resp-rag-sdk-001")
        self.assertIsNotNone(captured_kwargs)
        assert captured_kwargs is not None
        self.assertEqual(captured_kwargs["agent_name"], "rag-agent-internal-sdk-loop")
        self.assertEqual(captured_kwargs["input_text"], "有哪些本科生可以申请的奖学金")
        self.assertEqual(captured_kwargs["tool_descriptors"][0].name, "retrieve_evidence")
        self.assertEqual(captured_kwargs["output_type"].__name__, "_RagSdkStructuredOutput")

    def test_tool_output_is_bounded_evidence_projection(self) -> None:
        runner = OpenAIRagAgentsSdkRunner(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai",
                transport="responses",
                api_key="test-key",
                base_url="https://api.openai.com/v1",
            ),
            model_name="gpt-5.4-mini",
        )
        request = _run_request()
        tool = runner.build_retrieve_evidence_tool(request)
        seen_output = None

        async def invoke():
            return await tool.on_invoke_tool(
                object(),
                '{"query_slot_id":"indexed-lookup","retrieval_intent":"policy_list"}',
            )

        import asyncio

        seen_output = asyncio.run(invoke())

        self.assertIn("handbook:scholarship", seen_output)
        self.assertIn("本科生可申请国家奖学金", seen_output)
        self.assertNotIn("raw_prompt", seen_output)
        self.assertNotIn("retrieval_plan", seen_output)

    def test_retrieve_evidence_tool_schema_is_registry_backed(self) -> None:
        runner = OpenAIRagAgentsSdkRunner(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai",
                transport="responses",
                api_key="test-key",
                base_url="https://api.openai.com/v1",
            ),
            model_name="gpt-5.4-mini",
        )

        tool = runner.build_retrieve_evidence_tool(_run_request())

        self.assertEqual(tool.name, "retrieve_evidence")
        self.assertIn("bounded evidence anchors", tool.description)
        self.assertEqual(tool.params_json_schema["type"], "object")
        self.assertEqual(tool.params_json_schema["additionalProperties"], False)
        self.assertEqual(
            set(tool.params_json_schema["properties"]),
            {"query_slot_id", "retrieval_intent"},
        )
        self.assertTrue(tool.strict_json_schema)

    def test_tool_defaults_single_admitted_query_slot_when_model_omits_slot(self) -> None:
        runner = OpenAIRagAgentsSdkRunner(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai",
                transport="responses",
                api_key="test-key",
                base_url="https://api.openai.com/v1",
            ),
            model_name="gpt-5.4-mini",
        )
        request = _run_request()
        tool = runner.build_retrieve_evidence_tool(request)

        async def invoke():
            return await tool.on_invoke_tool(
                object(),
                '{"retrieval_intent":"policy_lookup"}',
            )

        import asyncio

        seen_output = asyncio.run(invoke())

        self.assertIn('"query_slot_id": "indexed-lookup"', seen_output)
        self.assertIn("本科生可申请国家奖学金", seen_output)

    def test_tool_coerces_invalid_single_admitted_query_slot_to_only_slot(self) -> None:
        runner = OpenAIRagAgentsSdkRunner(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai",
                transport="responses",
                api_key="test-key",
                base_url="https://api.openai.com/v1",
            ),
            model_name="gpt-5.4-mini",
        )
        request = _run_request()
        tool = runner.build_retrieve_evidence_tool(request)

        async def invoke():
            return await tool.on_invoke_tool(
                object(),
                '{"query_slot_id":"specific_policy_lookup","retrieval_intent":"policy_lookup"}',
            )

        import asyncio

        seen_output = asyncio.run(invoke())

        self.assertIn('"query_slot_id": "indexed-lookup"', seen_output)
        self.assertIn("本科生可申请国家奖学金", seen_output)

    def test_tool_rejects_unadmitted_slot(self) -> None:
        runner = OpenAIRagAgentsSdkRunner(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai",
                transport="responses",
                api_key="test-key",
                base_url="https://api.openai.com/v1",
            ),
            model_name="gpt-5.4-mini",
        )
        request = replace(
            _run_request(),
            query_intent=RagQueryIntent(
                task_kind=RagTaskKind.COMPARISON,
                normalized_query="比较奖学金办法",
                admitted_query_slot_ids=("compare-current-lookup", "compare-other-lookup"),
            ),
        )
        tool = runner.build_retrieve_evidence_tool(request)

        async def invoke():
            return await tool.on_invoke_tool(
                object(),
                '{"query_slot_id":"expanded","retrieval_intent":"policy_list"}',
            )

        with self.assertRaisesRegex(ValueError, "rag_sdk_query_slot_not_admitted"):
            import asyncio

            asyncio.run(invoke())


class _FakeRuntimeResult:
    def __init__(self, *, final_output: object, model_response_ref: str) -> None:
        self.final_output = final_output
        self.model_response_ref = model_response_ref


def _run_request() -> RagSdkRunRequest:
    evidence = EvidenceBundle(
        query_text="有哪些本科生可以申请的奖学金",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:scholarship",
                title="中央民族大学本科生奖学金评定办法",
                snippet="本科生可申请国家奖学金。",
                score=0.91,
                chunk_id_suffix="scholarship-1",
                content_role="policy_list",
                is_answer_bearing=True,
            ),
        ),
    )
    projection = RagSdkEvidenceProjection.from_evidence_bundle(evidence)
    first_anchor = projection.anchors[0]
    return RagSdkRunRequest(
        user_goal="有哪些本科生可以申请的奖学金",
        query_intent=RagQueryIntent(
            task_kind=RagTaskKind.CATEGORY_DISCOVERY,
            normalized_query="有哪些本科生可以申请的奖学金",
            category_id="scholarship",
            admitted_query_slot_ids=("indexed-lookup",),
        ),
        evidence=replace(
            projection,
            anchors=(
                RagSdkEvidenceAnchor(
                    source_id=first_anchor.source_id,
                    chunk_id=first_anchor.chunk_id,
                    excerpt=first_anchor.excerpt,
                    span_ref="chunk-0001:0-12",
                    title=first_anchor.title,
                    url=first_anchor.url,
                ),
            ),
        ),
        request_id="req-rag-sdk-001",
    )


if __name__ == "__main__":
    unittest.main()
