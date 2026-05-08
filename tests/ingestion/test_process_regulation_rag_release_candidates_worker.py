from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.regulation_rag_release_lane import (
    RagReleaseCandidateProcessReport,
)

_MODULE_NAME = "campus_ingestion_worker.process_regulation_rag_release_candidates"


class ProcessRegulationRagReleaseCandidatesWorkerCliTest(unittest.TestCase):
    def test_main_allows_missing_component_eval_summary_to_be_handled_by_executor(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        report = RagReleaseCandidateProcessReport(
            processed_count=0,
            candidate_ids=(),
            status_counts={},
            admission_blocked_count=0,
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
            ) as build_store,
            patch(f"{_MODULE_NAME}.build_registry_scope_rag_release_executor") as build_executor,
            patch(f"{_MODULE_NAME}.process_pending_regulation_rag_release_candidates") as process,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            build_store.return_value = object()
            build_executor.return_value = object()
            process.return_value = report

            worker.main([])

        self.assertIsNone(build_executor.call_args.kwargs["component_eval_summary"])
        self.assertEqual(json.loads(stdout.getvalue())["processed_count"], 0)

    def test_main_processes_pending_candidates_with_registry_scope_executor(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        report = RagReleaseCandidateProcessReport(
            processed_count=1,
            candidate_ids=("candidate-001",),
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
            ) as build_store,
            patch(f"{_MODULE_NAME}.build_registry_scope_rag_release_executor") as build_executor,
            patch(f"{_MODULE_NAME}.process_pending_regulation_rag_release_candidates") as process,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            build_store.return_value = object()
            build_executor.return_value = object()
            process.return_value = report

            worker.main(
                [
                    "--acceptance-case-path",
                    "/tmp/regulation-qrels.jsonl",
                    "--release-admission-manifest-key",
                    "regulations/operations/admit-001/institutional_rules/release-admission.json",
                    "--no-publish-alias",
                ]
            )

        build_store.assert_called_once()
        self.assertFalse(build_executor.call_args.kwargs["publish_alias"])
        self.assertEqual(
            build_executor.call_args.kwargs["acceptance_case_path"],
            "/tmp/regulation-qrels.jsonl",
        )
        self.assertEqual(
            build_executor.call_args.kwargs["release_admission_manifest_key"],
            "regulations/operations/admit-001/institutional_rules/release-admission.json",
        )
        process.assert_called_once_with(
            store=build_store.return_value,
            release_executor=build_executor.return_value,
            candidate_ids=(),
        )
        self.assertEqual(json.loads(stdout.getvalue())["processed_count"], 1)

    def test_main_processes_selected_candidate_ids(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        report = RagReleaseCandidateProcessReport(
            processed_count=2,
            candidate_ids=("candidate-001", "candidate-002"),
        )

        with (
            patch(f"{_MODULE_NAME}.load_worker_env"),
            patch(
                f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
            ) as build_store,
            patch(f"{_MODULE_NAME}.build_registry_scope_rag_release_executor") as build_executor,
            patch(f"{_MODULE_NAME}.process_pending_regulation_rag_release_candidates") as process,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            build_store.return_value = object()
            build_executor.return_value = object()
            process.return_value = report

            worker.main(
                [
                    "--candidate-id",
                    "candidate-001",
                    "--candidate-id",
                    "candidate-002",
                ]
            )

        process.assert_called_once_with(
            store=build_store.return_value,
            release_executor=build_executor.return_value,
            candidate_ids=("candidate-001", "candidate-002"),
        )
        self.assertEqual(json.loads(stdout.getvalue())["processed_count"], 2)

    def test_main_loads_component_eval_summary_and_passes_it_to_release_executor_builder(
        self,
    ) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        report = RagReleaseCandidateProcessReport(
            processed_count=1,
            candidate_ids=("candidate-001",),
        )

        with TemporaryDirectory() as temp_dir:
            summary_path = Path(temp_dir) / "component-eval-summary.json"
            summary_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "answer_ready_component_eval.v1",
                        "summary": {"overall_passed": True, "failed": 0},
                        "results": [],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(
                    f"{_MODULE_NAME}.build_regulation_rag_release_candidate_store_from_env"
                ) as build_store,
                patch(
                    f"{_MODULE_NAME}.build_registry_scope_rag_release_executor"
                ) as build_executor,
                patch(
                    f"{_MODULE_NAME}.process_pending_regulation_rag_release_candidates"
                ) as process,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                build_store.return_value = object()
                build_executor.return_value = object()
                process.return_value = report

                worker.main(
                    [
                        "--component-eval-summary-path",
                        str(summary_path),
                    ]
                )

        self.assertEqual(
            build_executor.call_args.kwargs["component_eval_summary"],
            {
                "schema_version": 1,
                "case_family": "answer_ready_component_eval.v1",
                "summary": {"overall_passed": True, "failed": 0},
                "results": [],
            },
        )
        self.assertEqual(json.loads(stdout.getvalue())["processed_count"], 1)


if __name__ == "__main__":
    unittest.main()
