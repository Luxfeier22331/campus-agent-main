from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

from campus_ingestion_core.regulation_rag_release_lane import (
    RagReleaseCandidateEnqueueReport,
)

_MODULE_NAME = "campus_ingestion_worker.enqueue_regulation_rag_release_candidates"


class EnqueueRegulationRagReleaseCandidatesWorkerCliTest(unittest.TestCase):
    def test_main_enqueues_explicit_document_ids_for_collection(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
            ) as build_store,
            patch(
                f"{_MODULE_NAME}.enqueue_regulation_rag_release_candidates_for_registry_delta"
            ) as enqueue,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            build_registry.return_value = object()
            build_store.return_value = object()
            enqueue.return_value = RagReleaseCandidateEnqueueReport(
                created_count=2,
                skipped_unchanged_count=0,
                candidate_ids=("candidate-001", "candidate-002"),
            )

            worker.main(
                [
                    "--collection",
                    "institutional_rules",
                    "--document-id",
                    "doc-001",
                    "--document-id",
                    "doc-002",
                ]
            )

        build_registry.assert_called_once_with(prefer_operator=True)
        build_store.assert_called_once_with(prefer_operator=True)
        enqueue.assert_called_once_with(
            store=build_store.return_value,
            registry=build_registry.return_value,
            corpus="regulations",
            collection="institutional_rules",
            changed_document_ids=("doc-001", "doc-002"),
            force=False,
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["created_count"], 2)
        self.assertEqual(payload["selected_documents_by_collection"]["institutional_rules"], 2)
        self.assertEqual(payload["candidate_ids"], ["candidate-001", "candidate-002"])

    def test_main_enqueues_materialization_report_documents_grouped_by_collection(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "materialization.execute.json"
            report_path.write_text(
                json.dumps(
                    {
                        "materialized_documents": [
                            {
                                "target_collection": "institutional_rules",
                                "target_document_id": "institutional-doc",
                            },
                            {
                                "target_collection": "scoped_rules",
                                "target_document_id": "scoped-doc",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
                ) as build_store,
                patch(
                    f"{_MODULE_NAME}.enqueue_regulation_rag_release_candidates_for_registry_delta"
                ) as enqueue,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                build_registry.return_value = object()
                build_store.return_value = object()
                enqueue.side_effect = (
                    RagReleaseCandidateEnqueueReport(
                        created_count=1,
                        skipped_unchanged_count=0,
                        candidate_ids=("candidate-institutional",),
                    ),
                    RagReleaseCandidateEnqueueReport(
                        created_count=1,
                        skipped_unchanged_count=0,
                        candidate_ids=("candidate-scoped",),
                    ),
                )

                worker.main(["--from-materialization-report", str(report_path)])

        enqueue.assert_has_calls(
            [
                call(
                    store=build_store.return_value,
                    registry=build_registry.return_value,
                    corpus="regulations",
                    collection="institutional_rules",
                    changed_document_ids=("institutional-doc",),
                    force=False,
                ),
                call(
                    store=build_store.return_value,
                    registry=build_registry.return_value,
                    corpus="regulations",
                    collection="scoped_rules",
                    changed_document_ids=("scoped-doc",),
                    force=False,
                ),
            ]
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["created_count"], 2)
        self.assertEqual(
            payload["selected_documents_by_collection"],
            {"institutional_rules": 1, "scoped_rules": 1},
        )
        self.assertEqual(
            payload["candidate_ids"],
            ["candidate-institutional", "candidate-scoped"],
        )

    def test_main_force_reenqueue_passes_force_flag_and_reports_count(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
            ) as build_store,
            patch(
                f"{_MODULE_NAME}.enqueue_regulation_rag_release_candidates_for_registry_delta"
            ) as enqueue,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            build_registry.return_value = object()
            build_store.return_value = object()
            enqueue.return_value = RagReleaseCandidateEnqueueReport(
                created_count=1,
                skipped_unchanged_count=0,
                candidate_ids=("candidate-001",),
                forced_reenqueue_count=1,
            )

            worker.main(
                [
                    "--collection",
                    "institutional_rules",
                    "--document-id",
                    "doc-001",
                    "--force",
                ]
            )

        enqueue.assert_called_once_with(
            store=build_store.return_value,
            registry=build_registry.return_value,
            corpus="regulations",
            collection="institutional_rules",
            changed_document_ids=("doc-001",),
            force=True,
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["created_count"], 1)
        self.assertEqual(payload["forced_reenqueue_count"], 1)
        self.assertEqual(
            payload["collections"]["institutional_rules"]["forced_reenqueue_count"],
            1,
        )


if __name__ == "__main__":
    unittest.main()
