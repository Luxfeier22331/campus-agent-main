from __future__ import annotations

import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status, main


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class DoctorEnvTest(unittest.TestCase):
    def test_collect_env_doctor_status_reports_eval_surface_bootstrap_and_checked_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "EVAL_RAGAS_MODEL=gpt-5.4",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["surface"], "evals")
            self.assertTrue(status["bootstrap"]["file_found"])
            self.assertEqual(status["bootstrap"]["loaded_path"], str(repo_root / ".env"))
            self.assertEqual(
                status["providers"]["llm"]["checked_keys"],
                ["EVAL_LLM_API_KEY", "LLM_API_KEY"],
            )
            self.assertEqual(
                status["providers"]["embedding"]["checked_keys"],
                ["EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"],
            )
            self.assertEqual(status["providers"]["llm"]["resolved_key"], "LLM_API_KEY")
            self.assertEqual(status["providers"]["embedding"]["resolved_key"], "EMBEDDING_API_KEY")

    def test_collect_env_doctor_status_reports_missing_bootstrap_and_never_leaks_secret_values(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")
            rendered = json.dumps(status, ensure_ascii=False)

            self.assertFalse(status["overall_ready"])
            self.assertFalse(status["bootstrap"]["file_found"])
            self.assertIsNone(status["bootstrap"]["loaded_path"])
            self.assertFalse(status["providers"]["llm"]["present"])
            self.assertFalse(status["providers"]["embedding"]["present"])
            self.assertIn("EVAL_LLM_API_KEY", status["providers"]["llm"]["error"])
            self.assertIn("EMBEDDING_API_KEY", status["providers"]["embedding"]["error"])
            self.assertNotIn("shared-llm-secret", rendered)
            self.assertNotIn("shared-embed-secret", rendered)

    def test_main_supports_json_output_for_evals_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "EVAL_RAGAS_MODEL=gpt-5.4",
                    ]
                )
                + "\n",
            )

            buffer = io.StringIO()
            with (
                patch.dict(os.environ, {}, clear=True),
                redirect_stdout(buffer),
            ):
                exit_code = main(["evals", "--repo-root", str(repo_root), "--json"])

            payload = json.loads(buffer.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["surface"], "evals")
            self.assertTrue(payload["overall_ready"])

    def test_collect_env_doctor_status_reports_query_surface_with_app_local_files(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "QDRANT_URL=https://qdrant.example.com",
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://session.example/postgres",
                        "AGNO_SUPERVISOR_MODEL=gpt-5.4",
                        "AGNO_SPECIALIST_MODEL=gpt-5.4-mini",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env",
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgresql://app-api-local/postgres",
                        "APP_API_OPERATOR_DATABASE_URL=postgresql://app-api-operator/postgres",
                        "APP_API_MANAGEMENT_DATABASE_URL=postgresql://app-api-operator/postgres",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars",
                "\n".join(
                    [
                        "BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret",
                        "PUBLIC_CHAT_WEB_ORIGIN=https://chat.example.com",
                        "SUPERVISOR_API_BASE_URL=https://supervisor.internal",
                        "SUPERVISOR_API_SHARED_SECRET=shared-secret",
                        "APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST=muc.edu.cn",
                        "APP_API_OPERATOR_EMAIL_ALLOWLIST=ops@example.com",
                        "APP_API_INTERNAL_SHARED_SECRET=internal-secret",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "public-chat-web" / ".dev.vars",
                "\n".join(
                    [
                        "APP_API_BASE_URL=https://app-api.internal",
                        "PUBLIC_CHAT_HOSTNAME=chat.example.com",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="query")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["providers"]["llm"]["present"])
            self.assertTrue(status["providers"]["embedding"]["present"])
            self.assertTrue(status["settings"]["required"]["qdrant_url"]["present"])
            self.assertTrue(status["settings"]["required"]["shared_postgres_url"]["present"])
            self.assertTrue(status["files"]["apps/app-api/.env"]["ready"])
            self.assertTrue(status["files"]["apps/app-api/.dev.vars"]["ready"])
            self.assertTrue(status["files"]["apps/public-chat-web/.dev.vars"]["ready"])

    def test_collect_env_doctor_status_reports_ingestion_surface_and_registry_fallback(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "QDRANT_URL=https://qdrant.example.com",
                        "OBJECT_STORE_ENDPOINT=http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY=minioadmin",
                        "OBJECT_STORE_SECRET_KEY=minioadmin",
                        "OCR_BASE_URL=https://ocr.example.com/api/v2/ocr/jobs",
                        "OCR_API_KEY=ocr-secret",
                        "OCR_PROVIDER_MODE=paddleocr_async_jobs",
                        "DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry.example/postgres",
                        "LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091",
                        "LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=test-secret",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="ingestion")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["providers"]["embedding"]["present"])
            self.assertTrue(status["settings"]["required"]["registry_database_url"]["present"])
            self.assertTrue(
                status["settings"]["required"]["legacy_office_conversion_base_url"]["present"]
            )
            self.assertTrue(
                status["settings"]["required"]["legacy_office_conversion_internal_shared_secret"][
                    "present"
                ]
            )

    def test_collect_env_doctor_status_reports_ingestion_surface_missing_legacy_office_service_contract(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "QDRANT_URL=https://qdrant.example.com",
                        "OBJECT_STORE_ENDPOINT=http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY=minioadmin",
                        "OBJECT_STORE_SECRET_KEY=minioadmin",
                        "OCR_BASE_URL=https://ocr.example.com/api/v2/ocr/jobs",
                        "OCR_API_KEY=ocr-secret",
                        "OCR_PROVIDER_MODE=paddleocr_async_jobs",
                        "DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry.example/postgres",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="ingestion")

            self.assertFalse(status["overall_ready"])
            self.assertFalse(
                status["settings"]["required"]["legacy_office_conversion_base_url"]["present"]
            )
            self.assertFalse(
                status["settings"]["required"]["legacy_office_conversion_internal_shared_secret"][
                    "present"
                ]
            )

    def test_collect_env_doctor_status_accepts_bucket_scoped_object_store_credentials(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EMBEDDING_MODEL=Qwen3-Embedding-4B",
                        "QDRANT_URL=https://qdrant.example.com",
                        "OBJECT_STORE_ENDPOINT=https://s3.cstcloud.cn",
                        "OBJECT_STORE_SOURCE_ACCESS_KEY=source-ak",
                        "OBJECT_STORE_SOURCE_SECRET_KEY=source-sk",
                        "OBJECT_STORE_DERIVED_ACCESS_KEY=derived-ak",
                        "OBJECT_STORE_DERIVED_SECRET_KEY=derived-sk",
                        "OCR_BASE_URL=https://ocr.example.com/api/v2/ocr/jobs",
                        "OCR_API_KEY=ocr-secret",
                        "OCR_PROVIDER_MODE=paddleocr_async_jobs",
                        "DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry.example/postgres",
                        "LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091",
                        "LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=test-secret",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="ingestion")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["settings"]["required"]["object_store_credentials"]["present"])

    def test_collect_env_doctor_status_reports_worker_staging_shell_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_SUPERVISOR_API_BASE_URL": "https://supervisor-staging.example.com",
                    "STAGING_ACCESS_TEAM_DOMAIN": "https://ayafeed.cloudflareaccess.com",
                    "STAGING_ACCESS_POLICY_AUD": "panel-staging-audience",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(repo_root=repo_root, surface="worker-staging")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(
                status["settings"]["required"]["staging_supervisor_api_base_url"]["present"]
            )
            self.assertTrue(status["settings"]["required"]["staging_access_team_domain"]["present"])
            self.assertTrue(status["settings"]["required"]["staging_access_policy_aud"]["present"])

    def test_collect_env_doctor_status_reports_app_api_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_SUPERVISOR_API_BASE_URL": "https://supervisor-staging.example.com",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-app-api"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(
                status["settings"]["required"]["staging_supervisor_api_base_url"]["present"]
            )
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_public_chat_worker_staging_without_shell_inputs(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-public-chat-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["settings"]["required"], {})
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])

    def test_collect_env_doctor_status_reports_panel_worker_staging_requirements(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(
                os.environ,
                {
                    "STAGING_ACCESS_TEAM_DOMAIN": "https://ayafeed.cloudflareaccess.com",
                    "STAGING_ACCESS_POLICY_AUD": "panel-staging-audience",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root, surface="worker-staging-protected-panel-web"
                )

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["settings"]["required"]["staging_access_team_domain"]["present"])
            self.assertTrue(status["settings"]["required"]["staging_access_policy_aud"]["present"])
            self.assertFalse(status["settings"]["optional"]["staging_sentry_release"]["present"])


if __name__ == "__main__":
    unittest.main()
