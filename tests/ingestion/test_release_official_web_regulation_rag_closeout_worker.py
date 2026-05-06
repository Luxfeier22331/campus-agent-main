from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

_MODULE_NAME = "campus_ingestion_worker.release_official_web_regulation_rag_closeout"


class ReleaseOfficialWebRegulationRagCloseoutWorkerCliTest(unittest.TestCase):
    def test_main_runs_prepare_admit_and_process_from_materialization_report(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            materialization_report_path = root / "materialization-report.json"
            materialization_report_path.write_text(
                json.dumps(
                    {
                        "materialized_documents": [
                            {
                                "target_collection": "institutional_rules",
                                "target_document_id": "official_web_regulation:doc-001",
                            },
                            {
                                "target_collection": "institutional_rules",
                                "target_document_id": "official_web_regulation:doc-002",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output_path = root / "closeout-report.json"

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.prepare_registry_scope_chunks") as prepare_chunks,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_admission_manifest"
                ) as build_manifest,
                patch(
                    f"{_MODULE_NAME}.write_regulation_rag_release_admission_manifest"
                ) as write_manifest,
                patch(
                    f"{_MODULE_NAME}.enqueue_regulation_rag_release_candidates_for_registry_delta"
                ) as enqueue_candidates,
                patch(
                    f"{_MODULE_NAME}.build_registry_scope_rag_release_executor"
                ) as build_release_executor,
                patch(
                    f"{_MODULE_NAME}.process_pending_regulation_rag_release_candidates"
                ) as process_candidates,
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
                ) as build_store,
                patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as object_store_settings,
                patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
                patch(f"{_MODULE_NAME}.load_runtime_profile") as load_runtime_profile,
                patch(f"{_MODULE_NAME}.load_chunk_preparation_manifest") as load_preparation,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                registry = SimpleNamespace(
                    current_version=lambda document_id, preferred_revision_tracks: SimpleNamespace(
                        corpus="regulations",
                        collection="institutional_rules",
                        document_id=document_id,
                    )
                )
                store = object()
                object_store = object()
                runtime_profile = SimpleNamespace(serving_revision_tracks=("current-effective",))
                preparation_report = type(
                    "_PreparationReport",
                    (),
                    {
                        "preparation_run_id": "owreg-release-001",
                        "manifest_object_key": (
                            "regulations/operations/registry-scope-chunk-preparation/"
                            "owreg-release-001/institutional_rules/chunk-preparation.json"
                        ),
                        "document_count": 2,
                        "chunk_count": 8,
                    },
                )()
                admission_manifest = object()
                release_executor = object()
                enqueue_report = type(
                    "_EnqueueReport",
                    (),
                    {
                        "created_count": 2,
                        "skipped_unchanged_count": 0,
                        "forced_reenqueue_count": 0,
                        "candidate_ids": ("candidate-001", "candidate-002"),
                    },
                )()
                process_report = type(
                    "_ProcessReport",
                    (),
                    {
                        "processed_count": 2,
                        "candidate_ids": ("candidate-001", "candidate-002"),
                        "status_counts": {"indexed": 2},
                        "admission_blocked_count": 0,
                    },
                )()

                build_registry.return_value = registry
                build_store.return_value = store
                object_store_settings.return_value = type(
                    "_Settings", (), {"bucket_derived": "campus-rag-derived"}
                )()
                object_store_admin.return_value = object_store
                load_runtime_profile.return_value = runtime_profile
                prepare_chunks.return_value = preparation_report
                load_preparation.return_value = object()
                build_manifest.return_value = admission_manifest
                write_manifest.return_value = (
                    "regulations/operations/regulation-rag-release-admission/"
                    "owreg-release-001/institutional_rules/release-admission.json"
                )
                enqueue_candidates.return_value = enqueue_report
                build_release_executor.return_value = release_executor
                process_candidates.return_value = process_report

                worker.main(
                    [
                        "--from-materialization-report",
                        str(materialization_report_path),
                        "--preparation-run-id",
                        "owreg-release-001",
                        "--admission-run-id",
                        "owreg-release-001",
                        "--acceptance-case-path",
                        "packages/evals/fixtures/institutional_rules_release_acceptance.v1.json",
                        "--no-publish-alias",
                        "--output",
                        str(output_path),
                    ]
                )

                written_payload = json.loads(output_path.read_text(encoding="utf-8"))
                self.assertEqual(written_payload["processed_count"], 2)

        prepare_chunks.assert_called_once_with(
            corpus="regulations",
            collection="institutional_rules",
            preparation_run_id="owreg-release-001",
            closeout_run_id=None,
        )
        enqueue_candidates.assert_called_once_with(
            store=store,
            registry=registry,
            corpus="regulations",
            collection="institutional_rules",
            changed_document_ids=(
                "official_web_regulation:doc-001",
                "official_web_regulation:doc-002",
            ),
            runtime_profile=runtime_profile,
            force=False,
        )
        process_candidates.assert_called_once()
        build_release_executor.assert_called_once_with(
            acceptance_case_path="packages/evals/fixtures/institutional_rules_release_acceptance.v1.json",
            release_admission_manifest_key=(
                "regulations/operations/regulation-rag-release-admission/"
                "owreg-release-001/institutional_rules/release-admission.json"
            ),
            publish_alias=False,
            reset_index=False,
        )
        process_kwargs = process_candidates.call_args.kwargs
        self.assertEqual(process_kwargs["store"], store)
        self.assertEqual(process_kwargs["candidate_ids"], ("candidate-001", "candidate-002"))
        self.assertIs(process_kwargs["release_executor"], release_executor)

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["processed_count"], 2)
        self.assertEqual(payload["preparation_run_id"], "owreg-release-001")
        self.assertEqual(
            payload["release_admission_manifest_key"],
            "regulations/operations/regulation-rag-release-admission/"
            "owreg-release-001/institutional_rules/release-admission.json",
        )

    def test_main_supports_student_rules_collection(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            materialization_report_path = root / "materialization-report.json"
            materialization_report_path.write_text(
                json.dumps(
                    {
                        "materialized_documents": [
                            {
                                "target_collection": "student_rules",
                                "target_document_id": "official_web_regulation:doc-student-001",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output_path = root / "closeout-report.json"

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.prepare_registry_scope_chunks") as prepare_chunks,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_admission_manifest"
                ) as build_manifest,
                patch(
                    f"{_MODULE_NAME}.write_regulation_rag_release_admission_manifest"
                ) as write_manifest,
                patch(
                    f"{_MODULE_NAME}.enqueue_regulation_rag_release_candidates_for_registry_delta"
                ) as enqueue_candidates,
                patch(
                    f"{_MODULE_NAME}.build_registry_scope_rag_release_executor"
                ) as build_release_executor,
                patch(
                    f"{_MODULE_NAME}.process_pending_regulation_rag_release_candidates"
                ) as process_candidates,
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
                ) as build_store,
                patch(f"{_MODULE_NAME}.ObjectStoreSettings.from_env") as object_store_settings,
                patch(f"{_MODULE_NAME}.S3ObjectStoreAdmin") as object_store_admin,
                patch(f"{_MODULE_NAME}.load_runtime_profile") as load_runtime_profile,
                patch(f"{_MODULE_NAME}.load_chunk_preparation_manifest") as load_preparation,
            ):
                registry = SimpleNamespace(
                    current_version=lambda document_id, preferred_revision_tracks: SimpleNamespace(
                        corpus="regulations",
                        collection="student_rules",
                        document_id=document_id,
                    )
                )
                build_registry.return_value = registry
                build_store.return_value = object()
                object_store_settings.return_value = type(
                    "_Settings", (), {"bucket_derived": "campus-rag-derived"}
                )()
                object_store_admin.return_value = object()
                load_runtime_profile.return_value = SimpleNamespace(
                    serving_revision_tracks=("current-effective",)
                )
                prepare_chunks.return_value = type(
                    "_PreparationReport",
                    (),
                    {
                        "preparation_run_id": "owreg-release-student-001",
                        "manifest_object_key": (
                            "regulations/operations/registry-scope-chunk-preparation/"
                            "owreg-release-student-001/student_rules/chunk-preparation.json"
                        ),
                        "document_count": 1,
                        "chunk_count": 4,
                    },
                )()
                load_preparation.return_value = object()
                build_manifest.return_value = object()
                write_manifest.return_value = (
                    "regulations/operations/regulation-rag-release-admission/"
                    "owreg-release-student-001/student_rules/release-admission.json"
                )
                enqueue_candidates.return_value = type(
                    "_EnqueueReport",
                    (),
                    {
                        "created_count": 1,
                        "skipped_unchanged_count": 0,
                        "forced_reenqueue_count": 0,
                        "candidate_ids": ("candidate-student-001",),
                    },
                )()
                build_release_executor.return_value = object()
                process_candidates.return_value = type(
                    "_ProcessReport",
                    (),
                    {
                        "processed_count": 1,
                        "candidate_ids": ("candidate-student-001",),
                        "status_counts": {"indexed": 1},
                        "admission_blocked_count": 0,
                    },
                )()

                worker.main(
                    [
                        "--from-materialization-report",
                        str(materialization_report_path),
                        "--preparation-run-id",
                        "owreg-release-student-001",
                        "--admission-run-id",
                        "owreg-release-student-001",
                        "--acceptance-case-path",
                        "packages/evals/fixtures/student_rules_release_acceptance.v1.json",
                        "--no-publish-alias",
                        "--output",
                        str(output_path),
                    ]
                )

                written_payload = json.loads(output_path.read_text(encoding="utf-8"))
                self.assertEqual(written_payload["collection"], "student_rules")
                self.assertEqual(written_payload["processed_count"], 1)

        prepare_chunks.assert_called_once_with(
            corpus="regulations",
            collection="student_rules",
            preparation_run_id="owreg-release-student-001",
            closeout_run_id=None,
        )


if __name__ == "__main__":
    unittest.main()
