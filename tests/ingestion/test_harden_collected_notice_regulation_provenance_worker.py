from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.models import DocumentRegistryRecord

from tests.ingestion.test_collected_notice_regulation_first_batch_promotion import (
    _candidate_audit,
    _consistency_report,
    _materialization_report,
    _target_document,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry

worker = importlib.import_module(
    "campus_ingestion_worker.harden_collected_notice_regulation_provenance"
)


class HardenCollectedNoticeRegulationProvenanceWorkerTests(unittest.TestCase):
    def test_main_writes_report_without_updating_registry_in_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            selection_path = root / "selection.json"
            output_path = root / "report.json"
            selection_path.write_text(
                json.dumps(_selection(), ensure_ascii=False), encoding="utf-8"
            )
            registry = InMemoryDocumentRegistry((_registry_record(),))

            with (
                patch(
                    "campus_ingestion_worker.harden_collected_notice_regulation_provenance.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.harden_collected_notice_regulation_provenance.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    ["--selection-path", str(selection_path), "--output-path", str(output_path)]
                )

            report = json.loads(stdout.getvalue())
            self.assertEqual(report["mode"], "dry_run")
            self.assertFalse(report["write_enabled"])
            self.assertEqual(report["candidate_update_count"], 1)
            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), report)
            unchanged = registry.latest_versions(
                "institutional_regulation:muc:594",
                revision_track="current-effective",
            )[0]
            self.assertEqual(unchanged.source_channel, "manual_curated")


def _selection() -> dict[str, object]:
    from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
        build_first_batch_regulation_selection,
    )

    institutional = _materialization_report(
        target_collection="institutional_rules",
        documents=[_target_document(source_notice_id="594", collection="institutional_rules")],
    )
    scoped = _materialization_report(
        target_collection="scoped_rules",
        documents=[],
    )
    return build_first_batch_regulation_selection(
        candidate_audit=_candidate_audit(),
        consistency_report=_consistency_report(),
        institutional_materialization=institutional,
        scoped_materialization=scoped,
        selected_notice_ids=("594",),
    )


def _registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="institutional_regulation:muc:594",
        revision_track="current-effective",
        version_id="sha256:existing",
        source_uri="campusrag://manual/regulation",
        content_hash="sha256:existing",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-29T00:00:00+00:00",
        parser_version="collected_notice_regulation_first_batch_promotion_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key="regulations/documents/institutional_rules/test/units.jsonl",
        canonical_markdown_object_key="regulations/documents/institutional_rules/test/canonical.md",
        processed_object_keys=("regulations/documents/institutional_rules/test/units.jsonl",),
        import_source="test",
    )


if __name__ == "__main__":
    unittest.main()
