from __future__ import annotations

import importlib
import io
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core import LocalDataRebuildReport, RegistryScopeChunkPreparationReport
from campus_ingestion_core.registry_scope_release import RegistryScopeReleaseReport


class IngestionWorkerRunTelemetryTest(unittest.TestCase):
    def test_sanitizes_ingestion_run_attributes_and_drops_raw_fields(self) -> None:
        from campus_ingestion_worker.ingestion_run_telemetry import (
            sanitize_ingestion_run_attributes,
        )

        attrs = sanitize_ingestion_run_attributes(
            {
                "schema_version": "ingestion-run-telemetry-v1",
                "operation": "registry_scope_release",
                "stage": "index_release",
                "run_id": "r20260501",
                "corpus": "regulations",
                "collection": "institutional_rules",
                "status": "completed",
                "duration_ms": 123,
                "document_count": 2,
                "chunk_count": 10,
                "point_count": 10,
                "embedding_cache_hit_count": 3,
                "embedding_cache_miss_count": 7,
                "embedding_provider_call_count": 7,
                "canonical_body": "raw canonical document body",
                "chunk_body": "raw chunk text",
                "ocr_raw_text": "raw OCR text",
                "authorization": "Bearer secret",
                "database_url": "postgres://user:secret@example/db",
            }
        )

        self.assertEqual(attrs["run_id"], "r20260501")
        self.assertEqual(attrs["document_count"], 2)
        self.assertEqual(attrs["embedding_cache_miss_count"], 7)
        self.assertNotIn("canonical_body", attrs)
        self.assertNotIn("chunk_body", attrs)
        self.assertNotIn("ocr_raw_text", attrs)
        self.assertNotIn("authorization", attrs)
        self.assertNotIn("database_url", attrs)

    def test_emit_ingestion_run_telemetry_returns_degraded_when_sink_fails(self) -> None:
        from campus_ingestion_worker.ingestion_run_telemetry import (
            emit_ingestion_run_telemetry,
        )

        with self.assertLogs("campus_ingestion_worker.ingestion_run_telemetry", level="WARNING"):
            result = emit_ingestion_run_telemetry(
                event_name="ingestion.run.completed",
                attributes={"run_id": "run-1", "status": "completed"},
                emit_event=lambda _event_name, _attributes: (_ for _ in ()).throw(
                    OSError("sink down")
                ),
            )

        self.assertEqual(result.status, "degraded")
        self.assertEqual(result.failure_kind, "telemetry_export_failed")

    def test_release_registry_scope_cli_emits_sanitized_run_event(self) -> None:
        worker = importlib.import_module("campus_ingestion_worker.release_registry_scope")
        report = RegistryScopeReleaseReport(
            corpus="official_web",
            collection="muc_public_pages",
            release_id="r20260501",
            serving_alias="muc_public_pages",
            physical_collection_name="muc_public_pages__r20260501",
            previous_physical_collection_name=None,
            manifest_object_key="official_web/releases/muc_public_pages/r20260501/index-release.json",
            validation_summary_object_key=(
                "official_web/releases/muc_public_pages/r20260501/validation-summary.json"
            ),
            validation_status="passed",
            document_count=2,
            point_count=6,
            indexed_at="2026-05-01T00:00:00+00:00",
            published_at="2026-05-01T00:01:00+00:00",
            retrieval_acceptance_status="passed",
            retrieval_acceptance_summary_object_key=(
                "official_web/releases/muc_public_pages/r20260501/retrieval-acceptance-summary.json"
            ),
            post_publish_audit_status="passed",
            embedding_cache_hit_count=3,
            embedding_cache_miss_count=4,
            embedding_provider_call_count=4,
        )

        with TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "ingestion-runtime-events.jsonl"
            with (
                patch.dict(
                    os.environ,
                    {"INGESTION_RUN_TELEMETRY_JSONL_PATH": str(event_path)},
                    clear=False,
                ),
                patch("campus_ingestion_worker.release_registry_scope.load_worker_env"),
                patch(
                    "campus_ingestion_worker.release_registry_scope.release_registry_scope",
                    return_value=report,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--corpus",
                        "official_web",
                        "--collection",
                        "muc_public_pages",
                        "--publish-alias",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            events = [
                json.loads(line) for line in event_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(payload["telemetry"]["status"], "emitted")
        self.assertEqual(events[0]["event_name"], "ingestion.run.started")
        self.assertEqual(events[0]["attributes"]["operation"], "registry_scope_release")
        self.assertEqual(events[1]["event_name"], "ingestion.run.completed")
        self.assertEqual(events[1]["attributes"]["operation"], "registry_scope_release")
        self.assertEqual(events[1]["attributes"]["run_id"], "r20260501")
        self.assertEqual(events[1]["attributes"]["point_count"], 6)
        self.assertEqual(events[1]["attributes"]["embedding_cache_hit_count"], 3)
        self.assertNotIn("manifest_object_key", events[1]["attributes"])

    def test_release_registry_scope_cli_emits_failed_run_event_before_reraising(self) -> None:
        worker = importlib.import_module("campus_ingestion_worker.release_registry_scope")

        with TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "ingestion-runtime-events.jsonl"
            with (
                patch.dict(
                    os.environ,
                    {"INGESTION_RUN_TELEMETRY_JSONL_PATH": str(event_path)},
                    clear=False,
                ),
                patch("campus_ingestion_worker.release_registry_scope.load_worker_env"),
                patch(
                    "campus_ingestion_worker.release_registry_scope.release_registry_scope",
                    side_effect=ValueError("release quality gate failed"),
                ),
                self.assertRaisesRegex(ValueError, "release quality gate failed"),
            ):
                worker.main(
                    [
                        "--corpus",
                        "regulations",
                        "--collection",
                        "institutional_rules",
                        "--no-publish-alias",
                    ]
                )

            events = [
                json.loads(line) for line in event_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(events[0]["event_name"], "ingestion.run.started")
        self.assertEqual(events[1]["event_name"], "ingestion.run.failed")
        self.assertEqual(events[1]["attributes"]["operation"], "registry_scope_release")
        self.assertEqual(events[1]["attributes"]["status"], "failed")
        self.assertEqual(events[1]["attributes"]["failure_kind"], "ValueError")

    def test_prepare_registry_scope_chunks_cli_emits_chunking_run_event(self) -> None:
        worker = importlib.import_module("campus_ingestion_worker.prepare_registry_scope_chunks")
        report = RegistryScopeChunkPreparationReport(
            corpus="regulations",
            collection="institutional_rules",
            preparation_run_id="prep-20260501-000000",
            selection_mode="current_scope",
            closeout_run_id=None,
            manifest_object_key="operations/prep/manifest.json",
            validation_summary_object_key="operations/prep/validation-summary.json",
            document_report_object_key="operations/prep/document-reports.jsonl",
            validation_status="passed",
            document_count=2,
            chunk_count=12,
            prepared_at="2026-05-01T00:00:00+00:00",
        )

        with TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "ingestion-runtime-events.jsonl"
            with (
                patch.dict(
                    os.environ,
                    {"INGESTION_RUN_TELEMETRY_JSONL_PATH": str(event_path)},
                    clear=False,
                ),
                patch("campus_ingestion_worker.prepare_registry_scope_chunks.load_worker_env"),
                patch(
                    "campus_ingestion_worker.prepare_registry_scope_chunks.prepare_registry_scope_chunks",
                    return_value=report,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--corpus",
                        "regulations",
                        "--collection",
                        "institutional_rules",
                        "--preparation-run-id",
                        "prep-20260501-000000",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            events = [
                json.loads(line) for line in event_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(payload["telemetry"]["status"], "emitted")
        self.assertEqual(events[0]["event_name"], "ingestion.run.started")
        self.assertEqual(events[0]["attributes"]["operation"], "registry_scope_chunk_preparation")
        self.assertEqual(events[1]["event_name"], "ingestion.run.completed")
        self.assertEqual(events[1]["attributes"]["operation"], "registry_scope_chunk_preparation")
        self.assertEqual(events[1]["attributes"]["stage"], "chunking")
        self.assertEqual(events[1]["attributes"]["chunk_count"], 12)

    def test_release_index_cli_marks_telemetry_degraded_without_failing_job(self) -> None:
        worker = importlib.import_module("campus_ingestion_worker.release_index")

        with (
            patch.dict(
                os.environ,
                {"INGESTION_RUN_TELEMETRY_JSONL_PATH": "/tmp/ignored.jsonl"},
                clear=False,
            ),
            patch("campus_ingestion_worker.release_index.load_worker_env"),
            patch("campus_ingestion_worker.release_index.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_worker.release_index.build_ingestion_run_event_emitter",
                return_value=lambda _event_name, _attributes: (_ for _ in ()).throw(
                    OSError("sink down")
                ),
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            rebuild.return_value = LocalDataRebuildReport(
                import_context={"REBUILD_PUBLISH_ALIAS": "0"},
                import_result={
                    "status": "ok",
                    "success_count": 2,
                    "skipped_count": 1,
                    "failed_count": 0,
                },
            )
            with self.assertLogs(
                "campus_ingestion_worker.ingestion_run_telemetry",
                level="WARNING",
            ):
                worker.main(
                    [
                        "--corpus",
                        "curriculum",
                        "--collection",
                        "curriculum_plan",
                        "--raw-version-id",
                        "sha256:test-001",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["import_result"]["status"], "ok")
        self.assertEqual(payload["telemetry"]["status"], "degraded")
        self.assertEqual(payload["telemetry"]["failure_kind"], "telemetry_export_failed")


if __name__ == "__main__":
    unittest.main()
