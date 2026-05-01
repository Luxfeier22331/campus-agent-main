from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.source_handoff_state_machine import (
    FailureReason,
    IngestionExecution,
    SourceHandoff,
    SourceObjectRef,
    SourceRunRef,
    validate_operator_safe_payload,
)


class SourceHandoffStateMachineTest(unittest.TestCase):
    def test_required_object_refs_reject_missing_identity_and_local_paths(self) -> None:
        with self.assertRaisesRegex(ValueError, "content_sha256"):
            SourceObjectRef(
                object_role="handoff_bundle",
                bucket="campus-rag-source",
                object_key="official_web/run-001/source_truth_bundle.json",
                content_sha256="",
                byte_size=1024,
                required=True,
            )

        with self.assertRaisesRegex(ValueError, "local path"):
            SourceObjectRef(
                object_role="handoff_bundle",
                bucket="campus-rag-source",
                object_key="./var/official-web-handoffs/run-001.json",
                content_sha256="a" * 64,
                byte_size=1024,
                required=True,
            )

    def test_forbidden_payload_fields_are_rejected_recursively(self) -> None:
        with self.assertRaisesRegex(ValueError, "raw_html"):
            validate_operator_safe_payload(
                {
                    "source": {
                        "object_ref": "s3://campus-rag-source/key",
                        "raw_html": "<html>secret</html>",
                    }
                }
            )

    def test_verified_handoff_and_completed_execution_require_valid_transitions(self) -> None:
        now = datetime(2026, 5, 1, tzinfo=UTC)
        run_ref = SourceRunRef(
            source_channel="official_web",
            source_surface="baseline",
            site_id="muc_official",
            source_run_id="run-001",
            source_run_owner="app_api_official_web",
            source_run_status="completed",
            source_run_terminal_at=now,
            source_run_ref="official_web:crawl_run:run-001",
        )
        bundle = SourceObjectRef(
            object_role="handoff_bundle",
            bucket="campus-rag-source",
            object_key="official_web/run-001/source_truth_bundle.json",
            content_sha256="a" * 64,
            byte_size=4096,
            required=True,
        )
        handoff = SourceHandoff(
            handoff_id="handoff-001",
            schema_version="source_handoff.v1",
            source_run_ref=run_ref,
            handoff_kind="official_web_source_truth_replay",
            source_bucket="campus-rag-source",
            required_objects=(bundle,),
            idempotency_key="official_web:event-001",
            status="verified",
            created_at=now,
            updated_at=now,
            verified_at=now,
        )

        self.assertEqual(handoff.source_channel, "official_web")
        with self.assertRaisesRegex(ValueError, "result_kind"):
            IngestionExecution(
                execution_id="exec-001",
                handoff_id=handoff.handoff_id,
                processor_profile="official_web_source_truth_replay",
                requested_result_kind="stage_only",
                status="completed",
                result_kind="none",
                attempt_count=1,
                max_attempts=3,
                created_at=now,
                updated_at=now,
            )
        failed = IngestionExecution(
            execution_id="exec-001",
            handoff_id=handoff.handoff_id,
            processor_profile="official_web_source_truth_replay",
            requested_result_kind="stage_only",
            status="failed_terminal",
            result_kind="failed",
            attempt_count=1,
            max_attempts=3,
            failure_reason=FailureReason(code="checksum_mismatch", message="bundle changed"),
            created_at=now,
            updated_at=now,
            finished_at=now,
        )

        self.assertTrue(failed.is_terminal)


if __name__ == "__main__":
    unittest.main()
