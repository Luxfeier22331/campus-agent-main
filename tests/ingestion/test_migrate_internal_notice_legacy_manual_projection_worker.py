from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_legacy_manual_migration import (
    InternalNoticeLegacyManualMigrationReport,
)

worker = importlib.import_module(
    "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection"
)


class MigrateInternalNoticeLegacyManualProjectionWorkerCliTest(unittest.TestCase):
    def test_apply_migrates_selected_notices_and_records_admission(self) -> None:
        report = InternalNoticeLegacyManualMigrationReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("351907",),
            applied=True,
            projection_entry_count=1,
            legacy_manual_review_count=1,
            pending_multimodal_count=1,
            no_adoption_count=0,
            unchanged_count=0,
            item_reports=(),
        )
        admission_store = object()

        with (
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.migrate_legacy_manual_review_projection_entries",
                return_value=report,
            ) as migrate,
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ) as build_admission_store,
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.record_internal_notice_consumption_admission",
                return_value="batch-legacy-manual-001",
            ) as record_admission,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "351907", "--apply"])

        self.assertEqual(migrate.call_args.kwargs["notice_ids"], ("351907",))
        self.assertTrue(migrate.call_args.kwargs["apply"])
        build_admission_store.assert_called_once()
        self.assertEqual(record_admission.call_args.kwargs["command"], "legacy_manual_migration")
        self.assertIs(record_admission.call_args.kwargs["store"], admission_store)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-legacy-manual-001")
        self.assertEqual(payload["pending_multimodal_count"], 1)

    def test_dry_run_does_not_record_admission(self) -> None:
        report = InternalNoticeLegacyManualMigrationReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("351907",),
            applied=False,
            projection_entry_count=1,
            legacy_manual_review_count=1,
            pending_multimodal_count=1,
            no_adoption_count=0,
            unchanged_count=0,
            item_reports=(),
        )

        with (
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.migrate_legacy_manual_review_projection_entries",
                return_value=report,
            ),
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.build_internal_notice_consumption_admission_store_from_env"
            ) as build_admission_store,
            patch(
                "campus_ingestion_worker.migrate_internal_notice_legacy_manual_projection.record_internal_notice_consumption_admission"
            ) as record_admission,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "351907"])

        build_admission_store.assert_not_called()
        record_admission.assert_not_called()
        payload = json.loads(stdout.getvalue())
        self.assertNotIn("batch_id", payload)
        self.assertFalse(payload["applied"])


if __name__ == "__main__":
    unittest.main()
