from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.audit_regulation_rag_release_manifests")


class AuditRegulationRagReleaseManifestsWorkerCliTest(unittest.TestCase):
    def test_main_prints_and_optionally_writes_manifest_audit_report(self) -> None:
        report = {
            "schema_version": "regulation_rag_release_manifest_field_audit.v1",
            "overall_status": "passed",
            "release_manifest_object_key": "regulations/releases/student_rules/r1/index-release.json",
            "admission_manifest_object_key": (
                "regulations/operations/regulation-rag-release-admission/adm-1/"
                "student_rules/release-admission.json"
            ),
        }

        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "student_rules_release_manifest_audit.json"
            with (
                patch(
                    "campus_ingestion_worker.audit_regulation_rag_release_manifests.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.audit_regulation_rag_release_manifests.ObjectStoreSettings.from_env"
                ) as settings_from_env,
                patch(
                    "campus_ingestion_worker.audit_regulation_rag_release_manifests.S3ObjectStoreAdmin"
                ) as object_store_admin,
                patch(
                    "campus_ingestion_worker.audit_regulation_rag_release_manifests.audit_regulation_rag_release_manifests"
                ) as audit_manifests,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                settings_from_env.return_value = type(
                    "Settings",
                    (),
                    {"bucket_derived": "campus-rag-derived"},
                )()
                object_store_admin.return_value = object()
                audit_manifests.return_value = report

                worker.main(
                    [
                        "--corpus",
                        "regulations",
                        "--collection",
                        "student_rules",
                        "--release-id",
                        "r1",
                        "--output-path",
                        str(output_path),
                    ]
                )

            audit_manifests.assert_called_once()
            self.assertEqual(audit_manifests.call_args.kwargs["bucket"], "campus-rag-derived")
            self.assertEqual(audit_manifests.call_args.kwargs["corpus"], "regulations")
            self.assertEqual(audit_manifests.call_args.kwargs["collection"], "student_rules")
            self.assertEqual(audit_manifests.call_args.kwargs["release_id"], "r1")
            self.assertEqual(json.loads(stdout.getvalue())["overall_status"], "passed")
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8"))["release_manifest_object_key"],
                "regulations/releases/student_rules/r1/index-release.json",
            )


if __name__ == "__main__":
    unittest.main()
