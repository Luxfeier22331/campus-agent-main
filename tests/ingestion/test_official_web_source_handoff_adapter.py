from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.source_handoff_store import InMemorySourceHandoffStore

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_handoff_consumer_test_support import (
    FakeExecutionStatusReporter,
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


class OfficialWebSourceHandoffAdapterTest(unittest.TestCase):
    def test_consumer_projects_stage_only_execution_into_canonical_store(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            declarations_path = root / "projection-declarations.json"
            record_path = inbox_dir / "owevt_completed_canonical.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload(run_id="owrun_canonical_001")
            objects = _standard_bundle_objects(bundle=bundle)
            bundle_key = _bundle_key(run_id="owrun_canonical_001")
            bundle_bytes = objects[("campus-rag-source", bundle_key)]
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_canonical",
                    run_id="owrun_canonical_001",
                    site_id="campus_public",
                    artifacts=[
                        {
                            "artifactType": "source_truth_bundle",
                            "objectKey": bundle_key,
                            "contentSha256": hashlib.sha256(bundle_bytes).hexdigest(),
                            "byteSize": len(bundle_bytes),
                            "recordCount": 1,
                        }
                    ],
                ),
            )
            object_store = FakeReplayObjectStore(objects)
            source_handoff_store = InMemorySourceHandoffStore()
            reporter = FakeExecutionStatusReporter()

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                declarations_path=declarations_path,
                document_registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
                derived_object_store=object_store,
                status_reporter=reporter,
                source_handoff_store=source_handoff_store,
            )

            persisted_record = json.loads(record_path.read_text(encoding="utf-8"))
            summary = source_handoff_store.operator_summary()

            self.assertEqual(result.status, "staged")
            self.assertEqual(summary["handoffs"]["by_status"], {"verified": 1})
            self.assertEqual(summary["executions"]["by_status"], {"completed": 1})
            self.assertEqual(summary["steps"]["by_status"]["passed"], 5)
            self.assertTrue(str(persisted_record["sourceHandoffId"]).startswith("ow_handoff:"))
            self.assertTrue(str(persisted_record["ingestionExecutionId"]).startswith("ow_exec:"))
            self.assertEqual(
                [call["payload"]["executionRef"] for call in reporter.calls],
                [
                    persisted_record["ingestionExecutionId"],
                    persisted_record["ingestionExecutionId"],
                ],
            )


if __name__ == "__main__":
    unittest.main()
