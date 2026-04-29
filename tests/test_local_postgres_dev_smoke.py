from __future__ import annotations

import io
import json
import subprocess
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.local_postgres_dev_smoke import (
    execute_local_postgres_smoke,
    main,
    prepare_local_postgres_smoke,
)
from tests.test_restore_local_postgres_dev import _seed_repo_with_default_batches, _write


class LocalPostgresDevSmokeTest(unittest.TestCase):
    def test_prepare_local_postgres_smoke_builds_minio_and_bounded_replay_plan(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://remote/runtime",
                        "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgres://remote/management",
                        "OBJECT_STORE_ENDPOINT=http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY=minioadmin",
                        "OBJECT_STORE_SECRET_KEY=minioadmin",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=",
                        "APP_API_MANAGEMENT_DATABASE_URL=",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "APP_API_DATABASE_SSLMODE=prefer\n",
            )
            _seed_repo_with_default_batches(repo_root)

            plan = prepare_local_postgres_smoke(
                repo_root=repo_root,
                run_id="local-postgres-wave-d-355119-test",
                preparation_run_id="prep-local-postgres-wave-d-355119-test",
            )

            self.assertEqual(
                [command["label"] for command in plan["commands"]],
                [
                    "docker_minio_up",
                    "ensure_object_store_buckets",
                    "docker_postgres_up",
                    "app_api_db_bootstrap",
                    "app_api_db_reconcile_shared_drift",
                    "authenticated_notice_import",
                    "authenticated_notice_inventory_rebuild",
                    "current_scope_validation",
                    "bounded_replay_plan",
                    "bounded_replay_worker",
                    "bounded_replay_show",
                    "bounded_closeout_validation",
                    "bounded_chunk_preparation",
                    "bounded_preparation_validation",
                ],
            )
            self.assertEqual(plan["bounded_notice_id"], "355119")
            self.assertEqual(plan["run_id"], "local-postgres-wave-d-355119-test")
            self.assertEqual(plan["preparation_run_id"], "prep-local-postgres-wave-d-355119-test")

    def test_execute_local_postgres_smoke_runs_bucket_setup_and_validates_reports(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://remote/runtime",
                        "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgres://remote/management",
                        "OBJECT_STORE_ENDPOINT=http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY=minioadmin",
                        "OBJECT_STORE_SECRET_KEY=minioadmin",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=",
                        "APP_API_MANAGEMENT_DATABASE_URL=",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "APP_API_DATABASE_SSLMODE=prefer\n",
            )
            _seed_repo_with_default_batches(repo_root)
            plan = prepare_local_postgres_smoke(
                repo_root=repo_root,
                run_id="local-postgres-wave-d-355119-test",
                preparation_run_id="prep-local-postgres-wave-d-355119-test",
            )

            ensured_bucket_roots: list[str] = []
            calls: list[tuple[str, ...]] = []

            def fake_bucket_ensurer(*, repo_root: Path) -> dict[str, object]:
                ensured_bucket_roots.append(str(repo_root))
                return {
                    "bucket_source": "campus-rag-source",
                    "bucket_derived": "campus-rag-derived",
                    "created": ["campus-rag-source", "campus-rag-derived"],
                }

            def fake_runner(
                argv: list[str],
                *,
                cwd: Path,
                check: bool,
                capture_output: bool,
                text: bool,
            ) -> subprocess.CompletedProcess[str]:
                self.assertEqual(cwd, repo_root)
                self.assertTrue(check)
                self.assertTrue(capture_output)
                self.assertTrue(text)
                calls.append(tuple(argv))
                if argv[:2] == ["docker", "compose"]:
                    return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")
                if "db:bootstrap" in argv:
                    return subprocess.CompletedProcess(argv, 0, stdout="bootstrap ok\n", stderr="")
                if "db:reconcile-shared-drift" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=(
                            "> app-api@0.1.0 db:reconcile-shared-drift /tmp/campus-agent/apps/app-api\n"
                            "> node ./scripts/run-with-local-env.mjs node ./scripts/reconcile-shared-db-drift.mjs -- --json\n\n"
                            + json.dumps(
                                {
                                    "applied": False,
                                    "backupPath": None,
                                    "plan": {
                                        "driftDetected": False,
                                        "blockedReasons": [],
                                    },
                                }
                            )
                        ),
                        stderr="",
                    )
                if "campus_ingestion_worker.import_authenticated_notice_export" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "notice_count": 20,
                                "created_document_ids": [],
                                "updated_document_ids": [],
                                "skipped_document_ids": [],
                                "raw_uploaded_count": 0,
                                "raw_reused_count": 20,
                                "errors": [],
                            }
                        ),
                        stderr="",
                    )
                if (
                    "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory"
                    in argv
                ):
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "notice_count": 20,
                                "expected_document_count": 21,
                                "expected_attachment_document_count": 1,
                                "expected_ocr_candidate_count": 5,
                            }
                        ),
                        stderr="",
                    )
                if (
                    "campus_ingestion_worker.validate_internal_notice_chunking" in argv
                    and "--closeout-run-id" not in argv
                    and "--preparation-run-id" not in argv
                ):
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "passed": True,
                                "selection_mode": "current_scope",
                                "registry_record_count": 20,
                                "validated_document_count": 20,
                            }
                        ),
                        stderr="",
                    )
                if "campus_ingestion_worker.plan_authenticated_notice_source_truth_replay" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "state": "planned",
                                "expected_notice_count": 1,
                                "expected_document_count": 2,
                                "expected_attachment_document_count": 1,
                                "expected_ocr_candidate_count": 0,
                            }
                        ),
                        stderr="",
                    )
                if "campus_ingestion_worker.run_authenticated_notice_closeout_worker" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "state": "verified",
                                "completed_shard_count": 1,
                                "completed_batch_count": 1,
                                "verification": {
                                    "ok": True,
                                    "expected_attachment_document_count": 1,
                                },
                            }
                        ),
                        stderr="",
                    )
                if "campus_ingestion_worker.show_authenticated_notice_closeout" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "state": "verified",
                                "completed_shard_count": 1,
                                "completed_batch_count": 1,
                            }
                        ),
                        stderr="",
                    )
                if (
                    "campus_ingestion_worker.validate_internal_notice_chunking" in argv
                    and "--closeout-run-id" in argv
                ):
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "passed": True,
                                "selection_mode": "verified_closeout_run",
                                "validated_document_count": 2,
                            }
                        ),
                        stderr="",
                    )
                if "campus_ingestion_worker.prepare_registry_scope_chunks" in argv:
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "validation_status": "passed",
                                "document_count": 2,
                                "chunk_count": 13,
                                "selection_mode": "verified_closeout_run",
                                "closeout_run_id": "local-postgres-wave-d-355119-test",
                            }
                        ),
                        stderr="",
                    )
                if (
                    "campus_ingestion_worker.validate_internal_notice_chunking" in argv
                    and "--preparation-run-id" in argv
                ):
                    return subprocess.CompletedProcess(
                        argv,
                        0,
                        stdout=json.dumps(
                            {
                                "passed": True,
                                "selection_mode": "preparation_manifest",
                                "closeout_run_id": "local-postgres-wave-d-355119-test",
                                "validated_document_count": 2,
                            }
                        ),
                        stderr="",
                    )
                raise AssertionError(f"unexpected command: {argv}")

            report = execute_local_postgres_smoke(
                plan,
                runner=fake_runner,
                bucket_ensurer=fake_bucket_ensurer,
            )

            self.assertTrue(report["ok"])
            self.assertEqual(ensured_bucket_roots, [str(repo_root)])
            self.assertEqual(report["current_scope_validation"]["selection_mode"], "current_scope")
            self.assertEqual(report["bounded_replay_show"]["state"], "verified")
            self.assertEqual(
                report["bounded_preparation_validation"]["selection_mode"],
                "preparation_manifest",
            )
            self.assertEqual(
                [argv[0] for argv in calls],
                [
                    "docker",
                    "docker",
                    "pnpm",
                    "pnpm",
                    "uv",
                    "uv",
                    "uv",
                    "uv",
                    "uv",
                    "uv",
                    "uv",
                    "uv",
                    "uv",
                ],
            )

    def test_main_supports_json_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://remote/runtime",
                        "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgres://remote/management",
                        "OBJECT_STORE_ENDPOINT=http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY=minioadmin",
                        "OBJECT_STORE_SECRET_KEY=minioadmin",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=",
                        "APP_API_MANAGEMENT_DATABASE_URL=",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "APP_API_DATABASE_SSLMODE=prefer\n",
            )
            _seed_repo_with_default_batches(repo_root)

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = main(
                    [
                        "--repo-root",
                        str(repo_root),
                        "--run-id",
                        "local-postgres-wave-d-355119-test",
                        "--preparation-run-id",
                        "prep-local-postgres-wave-d-355119-test",
                        "--json",
                    ]
                )

            payload = json.loads(buffer.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["mode"], "dry_run")
            self.assertEqual(payload["commands"][0]["label"], "docker_minio_up")


if __name__ == "__main__":
    unittest.main()
