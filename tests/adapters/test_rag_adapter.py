import unittest

from tests.conftest import (
    runtime_detail_error_response,
    sample_answer_payload,
    sample_canonical_headers,
    sample_search_payload,
)

from campus_agent.adapters import CanonicalHeaders, CampusRagAdapter, MockCampusRagRuntime


class CampusRagAdapterTest(unittest.TestCase):
    def test_search_wraps_flat_runtime_payload_in_canonical_envelope(self) -> None:
        runtime = MockCampusRagRuntime()
        adapter = CampusRagAdapter(runtime=runtime)

        response = adapter.search(
            payload=sample_search_payload(),
            headers=CanonicalHeaders.from_dict(sample_canonical_headers()),
        )

        runtime_request = runtime.requests[-1]
        self.assertEqual(runtime_request["path"], "/api/search")
        self.assertEqual(runtime_request["headers"]["X-Request-ID"], "tool-call-001")
        self.assertEqual(runtime_request["headers"]["x-actor-user-id"], "user-123")
        self.assertNotIn("x-rag-authenticated", runtime_request["headers"])
        self.assertEqual(
            runtime_request["canonical_trace_headers"]["x-trace-id"],
            "trace-001",
        )
        self.assertTrue(response["ok"])
        self.assertEqual(response["tool_name"], "campus_rag_search")
        self.assertEqual(response["request_id"], "tool-call-001")
        self.assertEqual(response["trace_id"], "trace-001")
        self.assertEqual(response["data"]["query"], "library hours")
        self.assertGreaterEqual(len(response["data"]["hits"]), 1)

    def test_gate1_materials_publish_workflow_payload_and_runtime_call_shape(self) -> None:
        adapter = CampusRagAdapter(runtime=MockCampusRagRuntime())

        materials = adapter.gate1_contract_materials()

        self.assertIn("workflow_expected_payloads", materials)
        self.assertIn("adapter_call_shapes", materials)
        self.assertEqual(
            materials["header_mapping"]["x-actor-user-id"],
            "x-actor-user-id",
        )
        self.assertEqual(
            materials["adapter_call_shapes"]["campus_rag_answer"]["path"],
            "/api/answer",
        )
        self.assertEqual(
            materials["workflow_expected_payloads"]["campus_rag_search"]["query"],
            "library hours",
        )
        self.assertEqual(
            materials["workflow_expected_payloads"]["campus_rag_search"]["corpora"],
            ["student_handbook"],
        )
        self.assertEqual(
            materials["workflow_expected_payloads"]["campus_rag_answer"]["corpora"],
            ["student_handbook"],
        )
        self.assertEqual(
            materials["runtime_truth_alignment"]["default_registry_corpus"],
            "student_handbook",
        )

    def test_answer_uses_runtime_truth_shape_and_keeps_canonical_trace_id(self) -> None:
        runtime = MockCampusRagRuntime()
        adapter = CampusRagAdapter(runtime=runtime)

        response = adapter.answer(
            payload=sample_answer_payload(),
            headers=CanonicalHeaders.from_dict(sample_canonical_headers()),
        )

        runtime_request = runtime.requests[-1]
        self.assertEqual(runtime_request["path"], "/api/answer")
        self.assertTrue(response["ok"])
        self.assertEqual(response["tool_name"], "campus_rag_answer")
        self.assertEqual(response["trace_id"], "trace-001")
        self.assertEqual(response["data"]["answer_type"], "answer")
        self.assertEqual(response["data"]["answer_artifact_version"], "v1")
        self.assertEqual(response["data"]["render_mode"], "compat_text")
        self.assertIsInstance(response["data"]["artifact"], dict)
        self.assertEqual(response["data"]["artifact"]["type"], "answer_items")
        self.assertGreaterEqual(len(response["data"]["sources"]), 1)
        self.assertEqual(response["data"]["sources"][0]["doc_id"], "handbook:test-001")
        self.assertIn("anchor", response["data"]["sources"][0])
        self.assertIn("canonical_url", response["data"]["sources"][0])
        self.assertIn("latest_url", response["data"]["sources"][0])
        self.assertEqual(
            response["data"]["answer"],
            "- Students must complete the required credits. [S1]",
        )

    def test_fastapi_detail_error_is_wrapped_into_canonical_error_envelope(self) -> None:
        runtime = MockCampusRagRuntime(search_response=runtime_detail_error_response())
        adapter = CampusRagAdapter(runtime=runtime)

        response = adapter.search(
            payload=sample_search_payload(),
            headers=CanonicalHeaders.from_dict(sample_canonical_headers()),
        )

        self.assertFalse(response["ok"])
        self.assertEqual(response["tool_name"], "campus_rag_search")
        self.assertEqual(response["request_id"], "req_unknown_corpora")
        self.assertEqual(response["trace_id"], "trace-001")
        self.assertEqual(response["error"]["code"], "unknown_corpora")
        self.assertEqual(
            response["error"]["message"],
            "Unknown corpora requested: handbook",
        )
        self.assertFalse(response["error"]["retryable"])


if __name__ == "__main__":
    unittest.main()
