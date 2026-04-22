from __future__ import annotations

import json
import unittest
from dataclasses import dataclass

import httpx
from campus_contracts import PromptTrace
from campus_shared import (
    NormalizedProviderGroundingSupport,
    PromptRuntimeHTTPSettings,
    PromptRuntimeProviderConfig,
    PromptRuntimeValidationError,
    ResponsesStructuredOutputExecutor,
    normalize_provider_grounding_supports,
    validate_prompt_trace_contract,
)
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec
from pydantic import BaseModel


class PromptRuntimeValidationTest(unittest.TestCase):
    def test_validate_prompt_trace_requires_model_metadata(self) -> None:
        spec = get_supervisor_prompt_spec("supervisor_clarify_v1")
        with self.assertRaises(PromptRuntimeValidationError):
            validate_prompt_trace_contract(
                prompt_trace=PromptTrace(
                    prompt_id="supervisor_clarify_v1",
                    prompt_version="v1",
                    template_sha256=spec.template_sha256,
                    variables_schema_version=spec.variables_schema_version,
                    output_schema_version=spec.output_schema_version,
                ),
                spec=spec,
            )

    def test_normalize_provider_grounding_supports_flattens_common_provider_shapes(self) -> None:
        supports = normalize_provider_grounding_supports(
            {
                "supports": [
                    {
                        "claimText": "第四学期",
                        "docId": "curriculum:law-ethnic-experimental",
                        "snippet": "第四学期开设习近平新时代中国特色社会主义思想概论。",
                    },
                    {
                        "claim_text": "3学分",
                        "support_source_doc_id": "curriculum:law-ethnic-experimental",
                        "support_snippet": "习近平新时代中国特色社会主义思想概论 3学分。",
                    },
                ]
            }
        )

        self.assertEqual(
            supports,
            (
                NormalizedProviderGroundingSupport(
                    claim_text="第四学期",
                    support_source_doc_id="curriculum:law-ethnic-experimental",
                    support_snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                ),
                NormalizedProviderGroundingSupport(
                    claim_text="3学分",
                    support_source_doc_id="curriculum:law-ethnic-experimental",
                    support_snippet="习近平新时代中国特色社会主义思想概论 3学分。",
                ),
            ),
        )

    def test_responses_executor_includes_safety_identifier_when_supported(self) -> None:
        captured_payloads: list[str] = []

        class ResponseModel(BaseModel):
            answer_text: str

        @dataclass(frozen=True, slots=True)
        class Message:
            role: str
            content: str

        @dataclass(frozen=True, slots=True)
        class Stack:
            prompt_id: str
            model_provider: str
            model_name: str
            messages: tuple[Message, ...]

        def handler(request: httpx.Request) -> httpx.Response:
            captured_payloads.append(request.read().decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output_parsed": {
                        "answer_text": "ok",
                    },
                },
            )

        executor = ResponsesStructuredOutputExecutor(
            PromptRuntimeProviderConfig(
                provider="openai-responses",
                transport="responses",
                base_url="https://prompt-runtime.example/v1",
                api_key="test-api-key",
                http_settings=PromptRuntimeHTTPSettings(),
            ),
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                base_url="https://prompt-runtime.example/v1",
            ),
        )

        executor.execute(
            Stack(
                prompt_id="prompt_v1",
                model_provider="openai-responses",
                model_name="gpt-5.2-mini",
                messages=(Message(role="developer", content="{}"),),
            ),
            response_model=ResponseModel,
            safety_identifier="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )

        self.assertEqual(
            json.loads(captured_payloads[0])["safety_identifier"],
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )

    def test_responses_executor_omits_safety_identifier_when_provider_config_disables_it(
        self,
    ) -> None:
        captured_payloads: list[str] = []

        class ResponseModel(BaseModel):
            answer_text: str

        @dataclass(frozen=True, slots=True)
        class Message:
            role: str
            content: str

        @dataclass(frozen=True, slots=True)
        class Stack:
            prompt_id: str
            model_provider: str
            model_name: str
            messages: tuple[Message, ...]

        def handler(request: httpx.Request) -> httpx.Response:
            captured_payloads.append(request.read().decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output_parsed": {
                        "answer_text": "ok",
                    },
                },
            )

        executor = ResponsesStructuredOutputExecutor(
            PromptRuntimeProviderConfig(
                provider="openai-responses",
                transport="responses",
                base_url="https://prompt-runtime.example/v1",
                api_key="test-api-key",
                http_settings=PromptRuntimeHTTPSettings(),
                supports_safety_identifier=False,
            ),
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                base_url="https://prompt-runtime.example/v1",
            ),
        )

        executor.execute(
            Stack(
                prompt_id="prompt_v1",
                model_provider="openai-responses",
                model_name="gpt-5.2-mini",
                messages=(Message(role="developer", content="{}"),),
            ),
            response_model=ResponseModel,
            safety_identifier="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )

        self.assertNotIn('"safety_identifier"', captured_payloads[0])

    def test_responses_executor_execute_with_metadata_extracts_provider_grounding_supports(
        self,
    ) -> None:
        class ResponseModel(BaseModel):
            answer_text: str

        @dataclass(frozen=True, slots=True)
        class Message:
            role: str
            content: str

        @dataclass(frozen=True, slots=True)
        class Stack:
            prompt_id: str
            model_provider: str
            model_name: str
            messages: tuple[Message, ...]

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output_parsed": {
                        "answer_text": "ok",
                    },
                    "supports": [
                        {
                            "claimText": "第四学期",
                            "docId": "curriculum:law-ethnic-experimental",
                            "snippet": "第四学期开设习近平新时代中国特色社会主义思想概论。",
                        }
                    ],
                },
            )

        executor = ResponsesStructuredOutputExecutor(
            PromptRuntimeProviderConfig(
                provider="openai-responses",
                transport="responses",
                base_url="https://prompt-runtime.example/v1",
                api_key="test-api-key",
                http_settings=PromptRuntimeHTTPSettings(),
            ),
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                base_url="https://prompt-runtime.example/v1",
            ),
        )

        execution = executor.execute_with_metadata(
            Stack(
                prompt_id="prompt_v1",
                model_provider="openai-responses",
                model_name="gpt-5.2-mini",
                messages=(Message(role="developer", content="{}"),),
            ),
            response_model=ResponseModel,
        )

        self.assertEqual(execution.output.answer_text, "ok")
        self.assertEqual(
            execution.provider_grounding_supports,
            (
                NormalizedProviderGroundingSupport(
                    claim_text="第四学期",
                    support_source_doc_id="curriculum:law-ethnic-experimental",
                    support_snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                ),
            ),
        )


if __name__ == "__main__":
    unittest.main()
