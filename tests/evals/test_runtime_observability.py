from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.runtime_observability import (
    RuntimeEventWriter,
    bind_runtime_event_context,
    bind_runtime_event_sink,
    emit_runtime_event,
    load_runtime_events,
    summarize_phase15_request_truth,
    summarize_provider_events,
)


class RuntimeObservabilityTest(unittest.TestCase):
    def test_runtime_event_writer_records_contextual_jsonl_events(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1")

            with (
                bind_runtime_event_sink(writer),
                bind_runtime_event_context(
                    run_number=1,
                    case_id="case-1",
                    adapter_id="ragas",
                ),
            ):
                emit_runtime_event(
                    "supplemental_request_failed",
                    endpoint="/responses",
                    provider_origin="https://provider.example",
                    model="gpt-5.4",
                    attempt=1,
                    max_attempts=2,
                    http_status=503,
                    failure_reasons=["http_5xx"],
                    failure_disposition="transient_retryable",
                )

            records = load_runtime_events(path, session_id="session-1")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["case_id"], "case-1")
        self.assertEqual(records[0]["adapter_id"], "ragas")
        self.assertEqual(records[0]["event_type"], "supplemental_request_failed")

    def test_summarize_provider_events_aggregates_request_failures_and_breaker_events(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1")

            with bind_runtime_event_sink(writer):
                emit_runtime_event(
                    "supplemental_request_succeeded",
                    provider_origin="https://provider.example",
                    endpoint="/responses",
                    model="gpt-5.4",
                    preflight=True,
                )
                emit_runtime_event(
                    "supplemental_request_failed",
                    provider_origin="https://provider.example",
                    endpoint="/responses",
                    model="gpt-5.4",
                    preflight=False,
                    failure_reasons=["http_5xx", "timeout"],
                    failure_disposition="transient_retryable",
                    prompt_runtime_state="provider_incomplete",
                    prompt_runtime_detail="max_output_tokens",
                )
                emit_runtime_event(
                    "supplemental_request_failed",
                    provider_origin="https://provider.example",
                    endpoint="/responses",
                    model="gpt-5.4",
                    preflight=False,
                    failure_reasons=["content_filter"],
                    failure_disposition="non_retryable_request",
                    prompt_runtime_state="content_filter",
                    prompt_runtime_detail="content_filter",
                )
                emit_runtime_event(
                    "supplemental_breaker_fast_failed",
                    provider_origin="https://provider.example",
                    endpoint="/responses",
                    model="gpt-5.4",
                )

            summary = summarize_provider_events(path, session_id="session-1")

        self.assertEqual(summary["provider_count"], 1)
        provider = summary["providers"][0]
        self.assertEqual(provider["request_count"], 3)
        self.assertEqual(provider["success_count"], 1)
        self.assertEqual(provider["failure_count"], 2)
        self.assertEqual(provider["preflight_request_count"], 1)
        self.assertEqual(provider["preflight_success_count"], 1)
        self.assertEqual(provider["http_5xx_count"], 1)
        self.assertEqual(provider["timeout_count"], 1)
        self.assertEqual(provider["content_filter_count"], 1)
        self.assertEqual(
            provider["prompt_runtime_state_counts"], {"content_filter": 1, "provider_incomplete": 1}
        )
        self.assertEqual(
            provider["prompt_runtime_detail_counts"],
            {"content_filter": 1, "max_output_tokens": 1},
        )
        self.assertEqual(provider["circuit_open_count"], 1)
        self.assertEqual(
            provider["failure_disposition_counts"],
            {"non_retryable_request": 1, "transient_retryable": 1},
        )

    def test_runtime_event_writer_verbose_mode_prints_retry_and_recovery_messages(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1", verbose=True)
            stream = io.StringIO()

            with (
                redirect_stdout(stream),
                bind_runtime_event_sink(writer),
                bind_runtime_event_context(
                    run_number=1,
                    case_id="case-1",
                    adapter_id="ragas",
                    metric_name="faithfulness",
                ),
            ):
                emit_runtime_event(
                    "supplemental_request_failed",
                    endpoint="/responses",
                    provider_origin="https://provider.example",
                    model="gpt-5.4",
                    attempt=1,
                    max_attempts=2,
                    final_attempt=False,
                    http_status=503,
                    failure_reasons=["http_5xx"],
                    failure_disposition="transient_retryable",
                )
                emit_runtime_event(
                    "supplemental_request_succeeded",
                    endpoint="/responses",
                    provider_origin="https://provider.example",
                    model="gpt-5.4",
                    attempt=2,
                    max_attempts=2,
                    http_status=200,
                )

        output = stream.getvalue()
        self.assertIn("retrying attempt=1/2", output)
        self.assertIn("recovered attempt=2/2", output)

    def test_runtime_event_writer_verbose_mode_prints_faithfulness_checkpoint_progress(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1", verbose=True)
            stream = io.StringIO()

            with (
                redirect_stdout(stream),
                bind_runtime_event_sink(writer),
                bind_runtime_event_context(
                    run_number=1,
                    case_id="case-1",
                    adapter_id="ragas",
                    metric_name="faithfulness",
                ),
            ):
                emit_runtime_event(
                    "faithfulness_checkpoint_hit",
                    faithfulness_stage="nli_verdicts",
                    checkpoint_path="/tmp/repair/run-01/case-1/ragas.faithfulness.json",
                    source_checkpoint_path="/tmp/original/run-01/case-1/ragas.faithfulness.json",
                    batch_index=2,
                )

        output = stream.getvalue()
        self.assertIn("checkpoint", output)
        self.assertIn("stage=nli_verdicts", output)
        self.assertIn("batch=2", output)

    def test_summarize_phase15_request_truth_aggregates_adequacy_and_claim_support_summary(
        self,
    ) -> None:
        summary = summarize_phase15_request_truth(
            (
                {
                    "retrieval_adequacy_verdict": "ambiguous",
                    "retrieval_adequacy_reason": "policy_object_missing",
                    "grounding_verdict": "",
                    "claim_support_summary": None,
                },
                {
                    "retrieval_adequacy_verdict": "sufficient",
                    "retrieval_adequacy_reason": "sufficient",
                    "grounding_verdict": "unsupported",
                    "claim_support_summary": {
                        "total_claims": 3,
                        "supported_claims": 1,
                        "unsupported_claims": 2,
                        "unsupported_claim_types": [
                            "audience_or_major_or_program_or_class_family",
                            "offering_unit_or_owning_school",
                        ],
                        "unsupported_fields": [
                            "audience_claims",
                            "offering_unit_claims",
                        ],
                    },
                },
                {
                    "retrieval_adequacy_verdict": "sufficient",
                    "retrieval_adequacy_reason": "sufficient",
                    "grounding_verdict": "grounded",
                    "claim_support_summary": {
                        "total_claims": 2,
                        "supported_claims": 2,
                        "unsupported_claims": 0,
                        "unsupported_claim_types": [],
                        "unsupported_fields": [],
                    },
                },
            )
        )

        self.assertEqual(summary["request_count"], 3)
        self.assertEqual(
            summary["retrieval_adequacy_verdict_counts"], {"ambiguous": 1, "sufficient": 2}
        )
        self.assertEqual(
            summary["retrieval_adequacy_reason_counts"],
            {"policy_object_missing": 1, "sufficient": 2},
        )
        self.assertEqual(summary["grounding_verdict_counts"], {"grounded": 1, "unsupported": 1})
        self.assertEqual(
            summary["unsupported_claim_type_counts"],
            {
                "audience_or_major_or_program_or_class_family": 1,
                "offering_unit_or_owning_school": 1,
            },
        )
        self.assertEqual(
            summary["unsupported_field_counts"],
            {"audience_claims": 1, "offering_unit_claims": 1},
        )


if __name__ == "__main__":
    unittest.main()
