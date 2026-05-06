from __future__ import annotations

import unittest

from campus_rag_agent.rag_sdk_trace import (
    build_rag_sdk_trace_projection,
    reject_unsafe_rag_sdk_projection,
)


class RagAgentSdkTraceTest(unittest.TestCase):
    def test_trace_projection_contains_only_sanitized_fields(self) -> None:
        projection = build_rag_sdk_trace_projection(
            rollout_mode="candidate",
            runtime="openai_agents_sdk",
            tool_names=("retrieve_evidence",),
            model_response_ref="resp_123",
            latency_ms=12,
        )

        self.assertEqual(projection["schema_version"], "rag-sdk-trace-projection-v1")
        self.assertEqual(projection["tool_names"], ["retrieve_evidence"])
        self.assertNotIn("raw_prompt", projection)
        self.assertNotIn("raw_transcript", projection)

    def test_trace_projection_rejects_raw_sdk_or_provider_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsafe RAG SDK projection key"):
            reject_unsafe_rag_sdk_projection({"raw_prompt": "secret"})
        with self.assertRaisesRegex(ValueError, "unsafe RAG SDK projection value"):
            reject_unsafe_rag_sdk_projection(
                {"trace": "https://platform.openai.com/traces/trace_123"}
            )


if __name__ == "__main__":
    unittest.main()
