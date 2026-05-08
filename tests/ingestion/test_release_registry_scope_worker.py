from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.registry_scope_release import RegistryScopeReleaseReport

worker = importlib.import_module("campus_ingestion_worker.release_registry_scope")


class ReleaseRegistryScopeWorkerCliTest(unittest.TestCase):
    def test_main_requires_component_eval_summary_for_query_enabled_regulation_publish(
        self,
    ) -> None:
        with (
            patch("campus_ingestion_worker.release_registry_scope.load_worker_env"),
            patch(
                "campus_ingestion_worker.release_registry_scope.release_registry_scope"
            ) as release_scope,
        ):
            release_scope.side_effect = lambda **_kwargs: self.fail(
                "component eval summary must be checked before release execution"
            )
            with self.assertRaisesRegex(
                ValueError,
                "component eval summary is required before query-enabled regulation release",
            ):
                worker.main(
                    [
                        "--corpus",
                        "regulations",
                        "--collection",
                        "student_rules",
                    ]
                )

        release_scope.assert_not_called()

    def test_main_passes_cli_args_into_registry_scope_release(self) -> None:
        report = RegistryScopeReleaseReport(
            corpus="official_web",
            collection="muc_public_pages",
            release_id="r20260402_120000",
            serving_alias="muc_public_pages",
            physical_collection_name="muc_public_pages__r20260402_120000",
            previous_physical_collection_name=None,
            manifest_object_key=(
                "official_web/releases/muc_public_pages/r20260402_120000/index-release.json"
            ),
            validation_summary_object_key=(
                "official_web/releases/muc_public_pages/r20260402_120000/validation-summary.json"
            ),
            validation_status="passed",
            document_count=2,
            point_count=6,
            indexed_at="2026-04-02T12:00:00+00:00",
            published_at=None,
            retrieval_acceptance_status="skipped",
            retrieval_acceptance_summary_object_key=None,
        )
        with (
            patch("campus_ingestion_worker.release_registry_scope.load_worker_env"),
            patch(
                "campus_ingestion_worker.release_registry_scope.release_registry_scope"
            ) as release_scope,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            release_scope.return_value = report
            worker.main(
                [
                    "--corpus",
                    "official_web",
                    "--collection",
                    "muc_public_pages",
                    "--release-admission-manifest-key",
                    "official_web/operations/admit/release-admission.json",
                    "--reset-index",
                    "--no-publish-alias",
                ]
            )

        self.assertEqual(release_scope.call_args.kwargs["corpus"], "official_web")
        self.assertEqual(release_scope.call_args.kwargs["collection"], "muc_public_pages")
        self.assertEqual(
            release_scope.call_args.kwargs["release_admission_manifest_key"],
            "official_web/operations/admit/release-admission.json",
        )
        self.assertTrue(release_scope.call_args.kwargs["reset_index"])
        self.assertFalse(release_scope.call_args.kwargs["publish_alias"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["physical_collection_name"], "muc_public_pages__r20260402_120000")

    def test_main_loads_component_eval_summary_and_passes_it_into_registry_scope_release(
        self,
    ) -> None:
        report = RegistryScopeReleaseReport(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260507_120000",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260507_120000",
            previous_physical_collection_name=None,
            manifest_object_key=(
                "regulations/releases/student_rules/r20260507_120000/index-release.json"
            ),
            validation_summary_object_key=(
                "regulations/releases/student_rules/r20260507_120000/validation-summary.json"
            ),
            validation_status="passed",
            document_count=1,
            point_count=3,
            indexed_at="2026-05-07T12:00:00+00:00",
            published_at="2026-05-07T12:01:00+00:00",
            retrieval_acceptance_status="passed",
            retrieval_acceptance_summary_object_key=(
                "regulations/releases/student_rules/r20260507_120000/retrieval-acceptance-summary.json"
            ),
            component_eval_status="passed",
            component_eval_summary_object_key=(
                "regulations/releases/student_rules/r20260507_120000/component-eval-summary.json"
            ),
            fallback_primary_signal_count=0,
            semantic_oracle_pass_count=9,
            semantic_oracle_fail_count=0,
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
                patch("campus_ingestion_worker.release_registry_scope.load_worker_env"),
                patch(
                    "campus_ingestion_worker.release_registry_scope.release_registry_scope"
                ) as release_scope,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                release_scope.return_value = report
                worker.main(
                    [
                        "--corpus",
                        "regulations",
                        "--collection",
                        "student_rules",
                        "--component-eval-summary-path",
                        str(summary_path),
                    ]
                )

        self.assertEqual(
            release_scope.call_args.kwargs["component_eval_summary"],
            {
                "schema_version": 1,
                "case_family": "answer_ready_component_eval.v1",
                "summary": {"overall_passed": True, "failed": 0},
                "results": [],
            },
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["component_eval_status"], "passed")
        self.assertEqual(payload["fallback_primary_signal_count"], 0)
        self.assertEqual(payload["semantic_oracle_pass_count"], 9)
        self.assertEqual(payload["semantic_oracle_fail_count"], 0)


if __name__ == "__main__":
    unittest.main()
