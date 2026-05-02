from __future__ import annotations

import importlib
import io
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

preflight = importlib.import_module("campus_ingestion_worker.deployment_preflight")


class IngestionWorkerDeploymentPreflightTest(unittest.TestCase):
    def test_static_preflight_passes_for_internal_notice_drain_minimal_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report_dir = root / "reports"
            lock_dir = root / "locks"
            env = {
                "CAMPUS_SHARED_POSTGRES_URL": "postgresql://localhost:5432/campus_dev",
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL": "postgresql://localhost:5432/campus_dev",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
            }

            report = preflight.run_deployment_preflight(
                batch_kinds=("internal-notice-multimodal-drain",),
                env=env,
                live=False,
                lock_dir=lock_dir,
                report_dir=report_dir,
            )

        self.assertEqual(report["status"], "passed")
        check_by_name = {check["name"]: check for check in report["checks"]}
        self.assertEqual(check_by_name["report_dir_writable"]["status"], "passed")
        self.assertEqual(check_by_name["lock_dir_writable"]["status"], "passed")
        self.assertEqual(check_by_name["object_store_config"]["status"], "passed")
        self.assertEqual(check_by_name["postgres_config"]["status"], "passed")
        self.assertEqual(check_by_name["batch_resource_policy"]["status"], "passed")
        self.assertEqual(check_by_name["report_retention_policy"]["status"], "passed")
        self.assertEqual(report["batch_kinds"], ["internal-notice-multimodal-drain"])

    def test_static_preflight_passes_for_wechat_multimodal_drain_with_ocr_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report = preflight.run_deployment_preflight(
                batch_kinds=("wechat-public-notice-multimodal-drain",),
                env={
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://localhost:5432/campus_dev",
                    "CAMPUS_SHARED_POSTGRES_OPERATOR_URL": "postgresql://localhost:5432/campus_dev",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY": "key",
                    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_MODEL": "gpt-4.1-mini",
                },
                live=False,
                lock_dir=root / "locks",
                report_dir=root / "reports",
            )

        self.assertEqual(report["status"], "passed")
        check_by_name = {check["name"]: check for check in report["checks"]}
        self.assertEqual(
            check_by_name["wechat_public_notice_multimodal_runtime"]["status"], "passed"
        )

    def test_static_preflight_passes_for_official_web_release_tasks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            work_dir = root / "official-web-release-tasks"
            report = preflight.run_deployment_preflight(
                batch_kinds=("official-web-release-tasks",),
                env={
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://localhost:5432/campus_dev",
                    "CAMPUS_SHARED_POSTGRES_OPERATOR_URL": (
                        "postgresql://localhost:5432/campus_dev"
                    ),
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "INGESTION_WORKER_OFFICIAL_WEB_RELEASE_TASK_WORK_DIR": str(work_dir),
                },
                live=False,
                lock_dir=root / "locks",
                report_dir=root / "reports",
            )

        self.assertEqual(report["status"], "passed")
        check_by_name = {check["name"]: check for check in report["checks"]}
        self.assertEqual(
            check_by_name["official_web_release_task_work_dir_writable"]["status"], "passed"
        )

    def test_static_preflight_fails_when_required_batch_env_is_missing(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report = preflight.run_deployment_preflight(
                batch_kinds=("official-web-handoffs",),
                env={
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://localhost:5432/campus_dev",
                },
                live=False,
                lock_dir=Path(temp_dir) / "locks",
                report_dir=Path(temp_dir) / "reports",
            )

        self.assertEqual(report["status"], "failed")
        failed = [check for check in report["checks"] if check["status"] == "failed"]
        self.assertTrue(any("OBJECT_STORE_ENDPOINT" in check["message"] for check in failed))
        self.assertTrue(
            any("CAMPUS_SHARED_POSTGRES_OPERATOR_URL" in check["message"] for check in failed)
        )

    def test_static_preflight_fails_for_invalid_resource_policy(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report = preflight.run_deployment_preflight(
                batch_kinds=("internal-notice-multimodal-drain",),
                env={
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://localhost:5432/campus_dev",
                    "CAMPUS_SHARED_POSTGRES_OPERATOR_URL": "postgresql://localhost:5432/campus_dev",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "INGESTION_ON_DEMAND_PEAK_RSS_WARN_KB": "1024",
                    "INGESTION_ON_DEMAND_PEAK_RSS_HARD_KB": "512",
                },
                live=False,
                lock_dir=Path(temp_dir) / "locks",
                report_dir=Path(temp_dir) / "reports",
            )

        self.assertEqual(report["status"], "failed")
        check_by_name = {check["name"]: check for check in report["checks"]}
        self.assertEqual(check_by_name["batch_resource_policy"]["status"], "failed")

    def test_static_preflight_fails_for_wechat_multimodal_drain_without_runtime_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report = preflight.run_deployment_preflight(
                batch_kinds=("wechat-public-notice-multimodal-drain",),
                env={
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://localhost:5432/campus_dev",
                    "CAMPUS_SHARED_POSTGRES_OPERATOR_URL": "postgresql://localhost:5432/campus_dev",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                },
                live=False,
                lock_dir=Path(temp_dir) / "locks",
                report_dir=Path(temp_dir) / "reports",
            )

        self.assertEqual(report["status"], "failed")
        check_by_name = {check["name"]: check for check in report["checks"]}
        self.assertEqual(
            check_by_name["wechat_public_notice_multimodal_runtime"]["status"], "failed"
        )

    def test_cli_prints_json_and_exits_nonzero_on_failed_preflight(self) -> None:
        with (
            patch("campus_ingestion_worker.deployment_preflight.load_worker_env"),
            patch.dict(os.environ, {}, clear=True),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
            self.assertRaises(SystemExit) as raised,
        ):
            preflight.main(["--batch-kind", "internal-notice-multimodal-drain"])

        self.assertEqual(raised.exception.code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["schema_version"], preflight.PREFLIGHT_SCHEMA_VERSION)
        self.assertEqual(payload["status"], "failed")


if __name__ == "__main__":
    unittest.main()
