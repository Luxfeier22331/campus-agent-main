from __future__ import annotations

import gzip
import unittest

from scripts.proof_runtime_otel_langfuse_fanout import (
    STAGING_COLLECTOR_TEMPLATE,
    CapturedOtlpRequest,
    assert_langfuse_otlp_request,
    build_minimal_otlp_trace_request,
    build_staging_collector_env,
)


class RuntimeOtelLangfuseFanoutProofTest(unittest.TestCase):
    def test_staging_template_exists_for_local_fanout_proof(self) -> None:
        self.assertTrue(STAGING_COLLECTOR_TEMPLATE.exists())
        self.assertEqual(STAGING_COLLECTOR_TEMPLATE.name, "collector-staging-template.yaml")

    def test_staging_collector_env_points_all_trace_sinks_to_fake_server(self) -> None:
        env = build_staging_collector_env(
            fake_base_url="http://host.docker.internal:18080",
            langfuse_auth_header="Basic local-proof",
            langfuse_ingestion_version="4",
        )

        self.assertEqual(env["DEPLOYMENT_ENVIRONMENT"], "local-langfuse-proof")
        self.assertEqual(env["OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT"], "0.0.0.0:4318")
        self.assertEqual(env["OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT"], "0.0.0.0:13133")
        self.assertEqual(env["OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE"], "100")
        self.assertEqual(
            env["OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT"], "http://host.docker.internal:18080/sentry"
        )
        self.assertEqual(
            env["OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT"], "http://host.docker.internal:18080/axiom"
        )
        self.assertEqual(
            env["OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT"],
            "http://host.docker.internal:18080/api/public/otel",
        )
        self.assertEqual(env["OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER"], "Basic local-proof")
        self.assertEqual(env["OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION"], "4")

    def test_minimal_trace_payload_is_otlp_protobuf_with_trace_identity(self) -> None:
        payload = build_minimal_otlp_trace_request(
            trace_id_hex="11111111111111111111111111111111",
            span_id_hex="2222222222222222",
        )

        self.assertGreater(len(payload), 30)
        self.assertIn(bytes.fromhex("11111111111111111111111111111111"), payload)
        self.assertIn(bytes.fromhex("2222222222222222"), payload)

    def test_minimal_trace_payload_carries_langfuse_runtime_attributes(self) -> None:
        payload = build_minimal_otlp_trace_request()

        for token in (
            b"langfuse.trace.name",
            b"online-answer",
            b"langfuse.session.id",
            b"conv-langfuse-proof",
            b"request_id",
            b"req-langfuse-proof",
            b"run_id",
            b"run-langfuse-proof",
            b"workflow_id",
            b"campus-agent.chat.run-langfuse-proof",
            b"trace_id",
            b"trace-langfuse-proof",
        ):
            self.assertIn(token, payload)

    def test_assert_langfuse_request_requires_headers_path_and_body(self) -> None:
        payload = build_minimal_otlp_trace_request(
            trace_id_hex="11111111111111111111111111111111",
            span_id_hex="2222222222222222",
        )
        captured = CapturedOtlpRequest(
            path="/api/public/otel/v1/traces",
            headers={
                "authorization": "Basic local-proof",
                "x-langfuse-ingestion-version": "4",
                "content-encoding": "gzip",
            },
            body=gzip.compress(payload),
        )

        evidence = assert_langfuse_otlp_request(
            captured,
            expected_auth_header="Basic local-proof",
            expected_ingestion_version="4",
        )

        self.assertEqual(evidence.path, "/api/public/otel/v1/traces")
        self.assertEqual(evidence.authorization, "Basic local-proof")
        self.assertEqual(evidence.ingestion_version, "4")
        self.assertEqual(evidence.decoded_body_size, len(payload))

    def test_assert_langfuse_request_requires_runtime_attribute_contract(self) -> None:
        captured = CapturedOtlpRequest(
            path="/api/public/otel/v1/traces",
            headers={
                "authorization": "Basic local-proof",
                "x-langfuse-ingestion-version": "4",
            },
            body=b"not-an-attribute-bearing-otlp-payload",
        )

        with self.assertRaisesRegex(AssertionError, "missing Langfuse runtime attribute"):
            assert_langfuse_otlp_request(
                captured,
                expected_auth_header="Basic local-proof",
                expected_ingestion_version="4",
            )

    def test_assert_langfuse_request_fails_closed_for_wrong_contract(self) -> None:
        captured = CapturedOtlpRequest(
            path="/v1/traces",
            headers={"authorization": "Bearer token"},
            body=b"",
        )

        with self.assertRaisesRegex(AssertionError, "Langfuse OTLP path"):
            assert_langfuse_otlp_request(
                captured,
                expected_auth_header="Basic local-proof",
                expected_ingestion_version="4",
            )


if __name__ == "__main__":
    unittest.main()
