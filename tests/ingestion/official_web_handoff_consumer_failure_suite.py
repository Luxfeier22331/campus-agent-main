from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_worker.official_web_handoff_consumer_runtime import (
    download_source_truth_bundle,
    materialize_replay_input,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_handoff_consumer_test_support import (
    FakeReplayObjectStore,
    OfficialWebHandoffConsumerSettings,
    _bundle_key,
    _bundle_payload,
    _declarations_payload,
    _handoff_record,
    _standard_bundle_objects,
    _write_json,
    consume_handoff_record,
)


class OfficialWebHandoffConsumerFailureTest(unittest.TestCase):
    def test_source_truth_bundle_rejects_snake_case_run_identity_fallback(self) -> None:
        object_store = FakeReplayObjectStore(
            {
                (
                    "campus-rag-source",
                    _bundle_key(),
                ): json.dumps(
                    {
                        "schemaVersion": "official_web_source_truth_bundle.v1",
                        "sourceChannel": "official_web",
                        "site_id": "campus_public",
                        "crawl_run_id": "owrun_projection_001",
                        "pages": [],
                    }
                ).encode("utf-8")
            }
        )

        with self.assertRaisesRegex(ValueError, "siteId must be a non-empty string"):
            download_source_truth_bundle(
                object_store=object_store,
                bucket="campus-rag-source",
                key=_bundle_key(),
                expected_site_id="campus_public",
                expected_run_id="owrun_projection_001",
            )

    def test_replay_input_materialization_rejects_snake_case_page_artifact_fallback(
        self,
    ) -> None:
        bundle = _bundle_payload()
        page = bundle["pages"][0]
        assert isinstance(page, dict)
        manifest_key = str(page["pageManifestObjectKey"])
        blocks_key = str(page["contentBlocksObjectKey"])
        snake_case_page = {
            "raw_asset_id": page["rawAssetId"],
            "raw_version_id": page["rawVersionId"],
            "page_manifest_object_key": manifest_key,
            "content_blocks_object_key": blocks_key,
        }
        bundle["pages"] = [snake_case_page]

        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(ValueError, "rawAssetId must be a non-empty string"),
        ):
            materialize_replay_input(
                replay_input_dir=Path(temp_dir),
                bundle_payload=bundle,
                object_store=FakeReplayObjectStore(
                    {
                        ("campus-rag-source", manifest_key): b"{}",
                        ("campus-rag-source", blocks_key): b"",
                    }
                ),
                bucket="campus-rag-source",
            )

    def test_consume_handoff_record_marks_failure_when_bundle_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_missing_bundle.json"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_missing_bundle",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=FakeReplayObjectStore({}),
            )

            self.assertEqual(result.status, "failed")
            self.assertEqual(result.attempt_count, 1)
            self.assertEqual(result.error["code"], "missing_source_truth_bundle")

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "failed")
            self.assertEqual(persisted["processingAttemptCount"], 1)
            self.assertEqual(persisted["lastError"]["code"], "missing_source_truth_bundle")
            self.assertTrue(Path(persisted["executionReportPath"]).exists())

    def test_consume_handoff_record_marks_failure_when_page_artifact_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_missing_page_artifact.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_missing_page_artifact",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=FakeReplayObjectStore(
                    {
                        ("campus-rag-source", _bundle_key()): json.dumps(bundle).encode("utf-8"),
                    }
                ),
                declarations_path=declarations_path,
            )

            self.assertEqual(result.status, "failed")
            self.assertEqual(result.error["code"], "missing_page_manifest")

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "failed")
            self.assertEqual(persisted["lastError"]["code"], "missing_page_manifest")

    def test_consume_handoff_record_skips_when_event_already_staged(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_skip.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_skip",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(_standard_bundle_objects(bundle=bundle))
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            first = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                declarations_path=declarations_path,
            )
            request_count = len(object_store.requests)

            second = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                declarations_path=declarations_path,
            )

            self.assertEqual(first.status, "staged")
            self.assertEqual(second.status, "skipped")
            self.assertEqual(second.attempt_count, 1)
            self.assertEqual(len(object_store.requests), request_count)

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "staged")
            self.assertEqual(persisted["processingAttemptCount"], 1)
