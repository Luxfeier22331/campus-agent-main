from __future__ import annotations

import io
import json
import subprocess
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.restore_local_postgres_dev import (
    APP_API_DEV_VARS_BACKUP_PATH,
    APP_API_ENV_BACKUP_PATH,
    DEFAULT_NORMALIZED_BATCH_DIRS,
    ROOT_ENV_BACKUP_PATH,
    LOCAL_POSTGRES_DATABASE_URL,
    execute_local_postgres_recovery,
    main,
    prepare_local_postgres_recovery,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_json(path: Path, payload: object) -> None:
    _write(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _sample_record(notice_id: str, notice_type: str) -> dict[str, object]:
    return {
        "notice": {
            "notice_id": notice_id,
            "categories": [{"notice_type": notice_type}],
        }
    }


def _sample_manifest(
    *,
    export_scope: str,
    selected_notice_ids: list[str],
    notice_type_policy: list[dict[str, object]],
    site_id: str = "muc_internal_portal",
    source_home_url: str = "https://my.muc.edu.cn",
) -> dict[str, object]:
    return {
        "schema_version": "authenticated_notice_legacy_bootstrap_normalized_v1",
        "exported_at": "2026-04-09T08:41:21.459943+00:00",
        "export_date": "20260409",
        "export_scope": export_scope,
        "source_channel": "authenticated_notice_portal",
        "site_id": site_id,
        "source_home_url": source_home_url,
        "collector": {
            "runtime_shell": "legacy_external_collector",
            "export_contract_version": "legacy_authenticated_notice_export_v3",
            "link_collection_mode": "legacy_bundle_preserved",
            "attachment_collection_mode": "legacy_bundle_preserved",
            "attachment_storage_mode": "blob_store_reference",
        },
        "filters": {
            "notice_types": [item["type"] for item in notice_type_policy],
            "max_notices": len(selected_notice_ids),
            "selected_notice_ids": selected_notice_ids,
        },
        "notice_type_policy": notice_type_policy,
        "run": {
            "mode": "legacy_normalized_selection",
            "status": "success",
            "started_at": "2026-04-02T23:50:17.023Z",
            "finished_at": "2026-04-09T08:41:21.459943+00:00",
            "pages_fetched": 337,
            "items_seen": 6694,
            "items_inserted": len(selected_notice_ids),
            "detail_fetched": len(selected_notice_ids),
            "errors": 0,
        },
        "legacy_source": {
            "schema_version": "v3",
            "exported_at": "2026-04-02T23:59:19.838Z",
            "export_scope": "run-14",
            "filters": {"run_id": 14},
            "run": {
                "id": 14,
                "mode": "backfill",
                "status": "success",
                "started_at": "2026-04-02T23:50:17.023Z",
                "finished_at": "2026-04-02T23:57:57.563Z",
                "pages_fetched": 337,
                "items_seen": 6694,
                "items_inserted": 6454,
                "errors": 0,
            },
            "counts": {
                "notices": 6694,
                "notice_links": 558,
                "attachments": 270,
                "notice_attachments": 271,
                "bundles": 6694,
            },
            "files": {
                "bundles": "notices-bundle-20260403-run-14.json",
                "manifest": "export-manifest-20260403-run-14.json",
            },
        },
    }


def _seed_repo_with_default_batches(repo_root: Path) -> None:
    notice_type_policy = [
        {
            "type": "6",
            "name": "教学通知",
            "enabled": True,
            "incremental": {"pages": 3, "page_size": 20},
            "backfill": {"pages": 120, "page_size": 20},
        },
        {
            "type": "32",
            "name": "学工通知",
            "enabled": True,
            "incremental": {"pages": 3, "page_size": 20},
            "backfill": {"pages": 66, "page_size": 20},
        },
    ]
    batches = {
        "run14-policy-regulation-expanded": {
            "records": [
                _sample_record("355282", "6"),
                _sample_record("354006", "32"),
            ],
            "manifest": _sample_manifest(
                export_scope="run14-policy-regulation-expanded",
                selected_notice_ids=["355282", "354006"],
                notice_type_policy=notice_type_policy,
            ),
        },
        "run14-attachment-routing-probe": {
            "records": [
                _sample_record("355119", "6"),
            ],
            "manifest": _sample_manifest(
                export_scope="run14-attachment-routing-probe",
                selected_notice_ids=["355119"],
                notice_type_policy=[notice_type_policy[0]],
            ),
        },
        "run14-policy-regulation-core": {
            "records": [
                _sample_record("355282", "6"),
            ],
            "manifest": _sample_manifest(
                export_scope="run14-policy-regulation-core",
                selected_notice_ids=["355282"],
                notice_type_policy=[notice_type_policy[0]],
            ),
        },
    }
    for relative_dir in DEFAULT_NORMALIZED_BATCH_DIRS:
        batch_dir = repo_root / relative_dir
        payload = batches[batch_dir.parent.name]
        _write_json(batch_dir / "notices-bundle.normalized.json", payload["records"])
        _write_json(batch_dir / "export-manifest.normalized.json", payload["manifest"])


class RestoreLocalPostgresDevTest(unittest.TestCase):
    def test_prepare_local_postgres_recovery_captures_pre_local_env_backups_once(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            original_root_env = "\n".join(
                [
                    "KEEP_ME=1",
                    "CAMPUS_SHARED_POSTGRES_URL=postgres://remote/runtime",
                    "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgres://remote/management",
                ]
            ) + "\n"
            original_app_env = "\n".join(
                [
                    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgres://remote/runtime",
                    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=postgres://remote/runtime",
                    "APP_API_MANAGEMENT_DATABASE_URL=postgres://remote/management",
                ]
            ) + "\n"
            original_dev_vars = "\n".join(
                [
                    "APP_API_DATABASE_SSLMODE=prefer",
                    "APP_API_INTERNAL_SHARED_SECRET=test-secret",
                ]
            ) + "\n"
            _write(repo_root / ".env", original_root_env)
            _write(repo_root / "apps" / "app-api" / ".env", original_app_env)
            _write(repo_root / "apps" / "app-api" / ".dev.vars", original_dev_vars)
            _seed_repo_with_default_batches(repo_root)

            prepare_local_postgres_recovery(repo_root=repo_root)
            prepare_local_postgres_recovery(repo_root=repo_root)

            self.assertEqual(
                (repo_root / ROOT_ENV_BACKUP_PATH).read_text(encoding="utf-8"),
                original_root_env,
            )
            self.assertEqual(
                (repo_root / APP_API_ENV_BACKUP_PATH).read_text(encoding="utf-8"),
                original_app_env,
            )
            self.assertEqual(
                (repo_root / APP_API_DEV_VARS_BACKUP_PATH).read_text(encoding="utf-8"),
                original_dev_vars,
            )

    def test_prepare_local_postgres_recovery_rewrites_envs_and_builds_union_bundle(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "KEEP_ME=1",
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://remote/runtime",
                        "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgres://remote/management",
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
                        "APP_API_OTHER=1",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "\n".join(
                    [
                        "APP_API_DATABASE_SSLMODE=prefer",
                        "APP_API_INTERNAL_SHARED_SECRET=test-secret",
                    ]
                )
                + "\n",
            )
            _seed_repo_with_default_batches(repo_root)

            plan = prepare_local_postgres_recovery(repo_root=repo_root)

            root_env = (repo_root / ".env").read_text(encoding="utf-8")
            self.assertIn(f"CAMPUS_SHARED_POSTGRES_URL={LOCAL_POSTGRES_DATABASE_URL}\n", root_env)
            self.assertIn(
                f"CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL={LOCAL_POSTGRES_DATABASE_URL}\n",
                root_env,
            )
            self.assertIn(f"DOCUMENT_REGISTRY_DATABASE_URL={LOCAL_POSTGRES_DATABASE_URL}\n", root_env)
            self.assertIn(
                f"DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL={LOCAL_POSTGRES_DATABASE_URL}\n",
                root_env,
            )
            self.assertIn(f"RAW_ASSET_REGISTRY_DATABASE_URL={LOCAL_POSTGRES_DATABASE_URL}\n", root_env)
            self.assertIn(
                f"RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL={LOCAL_POSTGRES_DATABASE_URL}\n",
                root_env,
            )
            self.assertIn("KEEP_ME=1\n", root_env)

            app_api_env = (repo_root / "apps" / "app-api" / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB="
                f"{LOCAL_POSTGRES_DATABASE_URL}\n",
                app_api_env,
            )
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH="
                f"{LOCAL_POSTGRES_DATABASE_URL}\n",
                app_api_env,
            )
            self.assertIn(
                f"APP_API_MANAGEMENT_DATABASE_URL={LOCAL_POSTGRES_DATABASE_URL}\n",
                app_api_env,
            )
            self.assertIn("APP_API_OTHER=1\n", app_api_env)

            dev_vars = (repo_root / "apps" / "app-api" / ".dev.vars").read_text(encoding="utf-8")
            self.assertIn("APP_API_DATABASE_SSLMODE=disable\n", dev_vars)
            self.assertIn("APP_API_INTERNAL_SHARED_SECRET=test-secret\n", dev_vars)

            bundle_payload = json.loads(Path(plan["paths"]["union_bundle_path"]).read_text(encoding="utf-8"))
            manifest_payload = json.loads(
                Path(plan["paths"]["union_manifest_path"]).read_text(encoding="utf-8")
            )
            selected_notice_ids = Path(plan["paths"]["selected_notice_ids_path"]).read_text(
                encoding="utf-8"
            ).splitlines()
            self.assertEqual(
                [record["notice"]["notice_id"] for record in bundle_payload],
                ["355282", "354006", "355119"],
            )
            self.assertEqual(selected_notice_ids, ["355282", "354006", "355119"])
            self.assertEqual(
                manifest_payload["filters"]["selected_notice_ids"],
                ["355282", "354006", "355119"],
            )
            self.assertEqual(manifest_payload["filters"]["notice_types"], ["6", "32"])
            self.assertEqual(manifest_payload["legacy_source"]["export_scope"], "run-14")

            self.assertEqual(
                [command["label"] for command in plan["commands"]],
                [
                    "docker_postgres_up",
                    "app_api_db_bootstrap",
                    "app_api_db_reconcile_shared_drift",
                    "authenticated_notice_import",
                    "authenticated_notice_inventory_rebuild",
                ],
            )
            self.assertEqual(plan["expected_inventory"]["notice_count"], 20)
            self.assertEqual(plan["expected_inventory"]["expected_document_count"], 21)

    def test_execute_local_postgres_recovery_runs_commands_in_order_and_validates_json_steps(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(repo_root / ".env", "KEEP_ME=1\n")
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=\n"
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=\n"
                "APP_API_MANAGEMENT_DATABASE_URL=\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "APP_API_DATABASE_SSLMODE=prefer\n",
            )
            _seed_repo_with_default_batches(repo_root)
            plan = prepare_local_postgres_recovery(repo_root=repo_root)

            calls: list[tuple[str, ...]] = []

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
                                "created_document_ids": ["notice:muc_internal_portal:355119"],
                                "errors": [],
                            }
                        ),
                        stderr="",
                    )
                if "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory" in argv:
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
                raise AssertionError(f"unexpected command: {argv}")

            report = execute_local_postgres_recovery(plan, runner=fake_runner)

            self.assertTrue(report["ok"])
            self.assertEqual(report["validated_inventory"], plan["expected_inventory"])
            self.assertEqual(
                [argv[0] for argv in calls],
                ["docker", "pnpm", "pnpm", "uv", "uv"],
            )

    def test_main_supports_dry_run_json_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(repo_root / ".env", "KEEP_ME=1\n")
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=\n"
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=\n"
                "APP_API_MANAGEMENT_DATABASE_URL=\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "APP_API_DATABASE_SSLMODE=prefer\n",
            )
            _seed_repo_with_default_batches(repo_root)

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = main(["--repo-root", str(repo_root), "--json"])

            payload = json.loads(buffer.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["mode"], "dry_run")
            self.assertEqual(payload["expected_inventory"]["notice_count"], 20)
            self.assertEqual(payload["commands"][0]["label"], "docker_postgres_up")


if __name__ == "__main__":
    unittest.main()
