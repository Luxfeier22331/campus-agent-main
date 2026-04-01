from __future__ import annotations

from contextlib import redirect_stdout
import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_evals.runtime_observability import (
    RuntimeEventWriter,
    bind_runtime_event_context,
    bind_runtime_event_sink,
    emit_runtime_event,
    load_runtime_events,
    summarize_provider_events,
)


class RuntimeObservabilityTest(unittest.TestCase):
    def test_runtime_event_writer_records_contextual_jsonl_events(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1")

            with bind_runtime_event_sink(writer):
                with bind_runtime_event_context(run_number=1, case_id="case-1", adapter_id="ragas"):
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
        self.assertEqual(provider["request_count"], 2)
        self.assertEqual(provider["success_count"], 1)
        self.assertEqual(provider["failure_count"], 1)
        self.assertEqual(provider["preflight_request_count"], 1)
        self.assertEqual(provider["preflight_success_count"], 1)
        self.assertEqual(provider["http_5xx_count"], 1)
        self.assertEqual(provider["timeout_count"], 1)
        self.assertEqual(provider["circuit_open_count"], 1)
        self.assertEqual(provider["failure_disposition_counts"], {"transient_retryable": 1})

    def test_runtime_event_writer_verbose_mode_prints_retry_and_recovery_messages(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1", verbose=True)
            stream = io.StringIO()

            with redirect_stdout(stream):
                with bind_runtime_event_sink(writer):
                    with bind_runtime_event_context(run_number=1, case_id="case-1", adapter_id="ragas", metric_name="faithfulness"):
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

    def test_runtime_event_writer_verbose_mode_prints_faithfulness_checkpoint_progress(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "events.jsonl"
            writer = RuntimeEventWriter(path=path, session_id="session-1", verbose=True)
            stream = io.StringIO()

            with redirect_stdout(stream):
                with bind_runtime_event_sink(writer):
                    with bind_runtime_event_context(
                        run_number=1,
                        case_id="case-1",
                        adapter_id="ragas",
                        metric_name="faithfulness",
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


if __name__ == "__main__":
    unittest.main()
