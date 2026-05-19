from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_contracts import AgentRequest, AgentResponse, KnowledgeScope, RagRequestPayload
from campus_supervisor_agent_worker.agent_delegates import (
    AgentRuntimeBuildError,
    _build_agent_delegates,
    _build_openai_agents_runtime,
    _build_rag_openai_runtime,
)
from campus_supervisor_agent_worker.settings import ApiSettings


class RagAgentsSdkDelegateTest(unittest.TestCase):
    def test_worker_injects_rag_openai_runtime_without_target_specific_env(self) -> None:
        runner = object()

        delegates = _build_agent_delegates(
            settings=ApiSettings(
                prompt_runtime_provider="mock-runtime",
                agent_prompt_model="mock-model",
                agents_sdk_runtime_enabled=True,
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=None,
            openai_agents_runtime=None,
            rag_openai_runtime=runner,
        )

        with patch(
            "campus_supervisor_agent_worker.agent_delegates.delegate_to_rag_agent",
            return_value=AgentResponse(
                target="rag-agent",
                status="completed",
                answer_text="ok",
                confidence="medium",
            ),
        ) as delegate:
            response = delegates["rag-agent"](_request())

        self.assertEqual(response.status, "completed")
        self.assertEqual(delegate.call_count, 1)
        kwargs = delegate.call_args.kwargs
        self.assertIs(kwargs["rag_sdk_runner"], runner)

    def test_misconfigured_runtime_builder_raises_explicit_error(self) -> None:
        with self.assertRaisesRegex(AgentRuntimeBuildError, "rag_openai_runtime"):
            _build_rag_openai_runtime(
                ApiSettings(
                    prompt_runtime_provider="",
                    prompt_runtime_api_key="",
                    agent_prompt_model="",
                    agents_sdk_runtime_enabled=True,
                )
            )

    def test_real_provider_uses_prompt_runtime_model_when_agent_model_is_unset(self) -> None:
        with patch(
            "campus_supervisor_agent_worker.agent_delegates.PromptRuntimeProviderConfig",
        ):
            runner = _build_rag_openai_runtime(
                ApiSettings(
                    prompt_runtime_provider="openai-responses",
                    prompt_runtime_api_key="test-key",
                    prompt_runtime_base_url="https://example.test/v1",
                    prompt_runtime_model="gpt-5.5",
                    agent_prompt_model="",
                    agents_sdk_runtime_enabled=True,
                )
            )

        self.assertEqual(runner.__class__.__name__, "OpenAIAgentsRagRuntime")

    def test_misconfigured_openai_agents_runtime_builder_raises_explicit_error(self) -> None:
        with self.assertRaisesRegex(AgentRuntimeBuildError, "openai_agents_runtime"):
            _build_openai_agents_runtime(
                ApiSettings(
                    prompt_runtime_provider="",
                    prompt_runtime_api_key="",
                    agent_prompt_model="",
                    agents_sdk_runtime_enabled=True,
                )
            )

    def test_openai_agents_runtime_builder_does_not_use_agent_runtime_provider_as_prompt_provider(
        self,
    ) -> None:
        with self.assertRaisesRegex(AgentRuntimeBuildError, "provider_not_configured"):
            _build_openai_agents_runtime(
                ApiSettings(
                    runtime_provider="agent-os",
                    prompt_runtime_provider="",
                    prompt_runtime_api_key="test-key",
                    agent_prompt_model="gpt-agent",
                    agents_sdk_runtime_enabled=True,
                )
            )

    def test_rag_openai_runtime_builder_does_not_use_agent_runtime_provider_as_prompt_provider(
        self,
    ) -> None:
        with self.assertRaisesRegex(AgentRuntimeBuildError, "provider_not_configured"):
            _build_rag_openai_runtime(
                ApiSettings(
                    runtime_provider="agent-os",
                    prompt_runtime_provider="",
                    prompt_runtime_api_key="test-key",
                    agent_prompt_model="gpt-agent",
                    agents_sdk_runtime_enabled=True,
                )
            )


def _request() -> AgentRequest:
    return AgentRequest(
        target="rag-agent",
        user_goal="公费医疗报销需要什么材料",
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


if __name__ == "__main__":
    unittest.main()
