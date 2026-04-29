from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_admission import (
    InternalNoticeConsumptionAdmissionRecord,
)

worker = importlib.import_module(
    "campus_ingestion_worker.list_internal_notice_consumption_admissions"
)


class ListInternalNoticeConsumptionAdmissionsWorkerCliTest(unittest.TestCase):
    def test_main_lists_admission_batches_with_filters(self) -> None:
        store = _FakeAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-multimodal-001",
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    command="multimodal_process",
                    selected_notice_ids=("351907",),
                    status="completed",
                    result_counts={"processed_count": 1},
                    created_at="2026-04-25T00:00:00Z",
                    error="",
                ),
            )
        )

        with (
            patch(
                "campus_ingestion_worker.list_internal_notice_consumption_admissions.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.list_internal_notice_consumption_admissions.build_internal_notice_consumption_admission_store_from_env",
                return_value=store,
            ) as build_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(
                [
                    "--notice-id",
                    "351907",
                    "--command",
                    "multimodal_process",
                    "--status",
                    "completed",
                    "--limit",
                    "20",
                ]
            )

        build_store.assert_called_once_with(prefer_operator=True)
        self.assertEqual(
            store.calls[0],
            {
                "source_corpus": "campus_notices",
                "source_collection": "internal_notice",
                "notice_ids": ("351907",),
                "commands": ("multimodal_process",),
                "statuses": ("completed",),
                "limit": 20,
            },
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["record_count"], 1)
        self.assertEqual(payload["selection_source"], "explicit_notice_ids")
        self.assertEqual(payload["records"][0]["batch_id"], "batch-multimodal-001")

    def test_main_merges_notice_ids_from_selection_path(self) -> None:
        store = _FakeAdmissionStore(())
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["351907", "355222", "351907"]}),
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.list_internal_notice_consumption_admissions.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.list_internal_notice_consumption_admissions.build_internal_notice_consumption_admission_store_from_env",
                    return_value=store,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(["--notice-id", "355222", "--selection-path", str(selection_path)])

        self.assertEqual(store.calls[0]["notice_ids"], ("351907", "355222"))


class _FakeAdmissionStore:
    def __init__(self, records: tuple[InternalNoticeConsumptionAdmissionRecord, ...]) -> None:
        self.records = records
        self.calls: list[dict[str, object]] = []

    def list_records(
        self,
        *,
        source_corpus: str,
        source_collection: str,
        notice_ids: tuple[str, ...] = (),
        commands: tuple[str, ...] = (),
        statuses: tuple[str, ...] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionRecord, ...]:
        self.calls.append(
            {
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "notice_ids": notice_ids,
                "commands": commands,
                "statuses": statuses,
                "limit": limit,
            }
        )
        return self.records


if __name__ == "__main__":
    unittest.main()
