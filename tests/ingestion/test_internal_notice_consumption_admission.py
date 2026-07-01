from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_consumption_admission import (
    InMemoryInternalNoticeConsumptionAdmissionStore,
    InternalNoticeConsumptionAdmissionEventRecord,
    InternalNoticeConsumptionAdmissionRecord,
    build_internal_notice_consumption_admission_record,
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)


class InternalNoticeConsumptionAdmissionTest(unittest.TestCase):
    def test_record_internal_notice_consumption_admission_writes_to_store(self) -> None:
        store = _CapturingAdmissionStore()

        batch_id = record_internal_notice_consumption_admission(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="projection_rebuild",
            notice_ids=("351907", "351907", "355222"),
            result_counts={"projection_entry_count": 4},
            selection_source="selection_path",
            selection_path="/tmp/selected-notices.json",
            selection_sha256="sha256-selection",
            command_args={"selection_path": "/tmp/selected-notices.json"},
            store=store,
        )

        self.assertTrue(batch_id.startswith("internal_notice_consumption:projection_rebuild:"))
        self.assertEqual(len(store.records), 1)
        record = store.records[0]
        self.assertEqual(record.selected_notice_ids, ("351907", "355222"))
        self.assertEqual(record.result_counts, {"projection_entry_count": 4})
        self.assertEqual(record.selection_source, "selection_path")
        self.assertEqual(record.selection_path, "/tmp/selected-notices.json")
        self.assertEqual(record.selection_sha256, "sha256-selection")
        self.assertEqual(record.command_args, {"selection_path": "/tmp/selected-notices.json"})

    def test_build_record_preserves_batch_id_for_lifecycle_updates(self) -> None:
        started = build_internal_notice_consumption_admission_record(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_process",
            notice_ids=("351907",),
            status="started",
        )
        completed = build_internal_notice_consumption_admission_record(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_process",
            notice_ids=("351907",),
            status="completed",
            batch_id=started.batch_id,
            created_at=started.created_at,
            result_counts={"processed_count": 1},
        )

        self.assertEqual(completed.batch_id, started.batch_id)
        self.assertEqual(completed.created_at, started.created_at)
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result_counts, {"processed_count": 1})

    def test_build_record_preserves_selection_provenance(self) -> None:
        record = build_internal_notice_consumption_admission_record(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="read_model_rebuild",
            notice_ids=("355222",),
            selection_source="explicit_notice_ids",
            selection_path="",
            selection_sha256="",
            command_args={"notice_ids": ["355222"], "selection_source": "explicit_notice_ids"},
        )

        self.assertEqual(record.selection_source, "explicit_notice_ids")
        self.assertEqual(record.selection_path, "")
        self.assertEqual(record.selection_sha256, "")
        self.assertEqual(
            record.command_args,
            {"notice_ids": ["355222"], "selection_source": "explicit_notice_ids"},
        )

    def test_in_memory_store_keeps_current_batch_and_append_only_events(self) -> None:
        store = InMemoryInternalNoticeConsumptionAdmissionStore()
        started_batch_id = record_internal_notice_consumption_admission(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_drain",
            notice_ids=("351907",),
            status="started",
            created_at="2026-04-25T00:00:00Z",
            store=store,
        )

        record_internal_notice_consumption_admission(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_drain",
            notice_ids=("351907",),
            status="completed",
            batch_id=started_batch_id,
            created_at="2026-04-25T00:00:00Z",
            result_counts={"processed_count": 1},
            store=store,
        )

        current_records = store.list_records(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            commands=("multimodal_drain",),
            limit=10,
        )
        events = store.list_events(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            batch_ids=(started_batch_id,),
            limit=10,
        )

        self.assertEqual(len(current_records), 1)
        self.assertEqual(current_records[0].status, "completed")
        self.assertEqual([event.status for event in events], ["started", "completed"])
        self.assertEqual(len({event.event_id for event in events}), 2)
        self.assertIsInstance(events[0], InternalNoticeConsumptionAdmissionEventRecord)

    def test_env_builder_fails_closed_after_python_db_runtime_retirement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Python database runtime is retired"):
            build_internal_notice_consumption_admission_store_from_env({})


class _CapturingAdmissionStore:
    def __init__(self) -> None:
        self.records: list[InternalNoticeConsumptionAdmissionRecord] = []

    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None:
        self.records.append(record)


if __name__ == "__main__":
    unittest.main()
