from __future__ import annotations

from tests.evals.ragas_runtime_test_support import unittest


class SupplementalHttpFacadeTest(unittest.TestCase):
    def test_supplemental_http_module_keeps_public_exports_and_patch_seams(self) -> None:
        import campus_evals.supplemental_http as supplemental_http_module

        for name in (
            "OpenAICompatibleChatCompletionsLLM",
            "OpenAICompatibleResponsesLLM",
            "OpenAICompatibleTextChatCompletionsLLM",
            "OpenAICompatibleTextResponsesLLM",
            "OpenAICompatibleHTTPEmbeddings",
            "SupplementalPreflightFailedError",
            "build_http_ragas_embeddings",
            "build_http_ragas_llm",
            "classify_runtime_failure",
            "classify_retryable_runtime_failure",
            "format_runtime_exception_message",
            "is_retryable_provider_exception",
            "reset_supplemental_http_runtime_state_for_tests",
            "sanitize_runtime_message",
            "_retry_delay_seconds",
            "httpx",
            "random",
        ):
            self.assertTrue(hasattr(supplemental_http_module, name), name)
