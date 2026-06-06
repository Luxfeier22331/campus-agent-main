from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status, main


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class DoctorEnvTest(unittest.TestCase):
    def test_collect_env_doctor_status_reports_eval_surface_bootstrap_and_checked_keys(
        self,
    ) -> None:
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

    def test_collect_env_doctor_status_reports_missing_bootstrap_and_never_leaks_secret_values(
        self,
    ) -> None:
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

    def test_collect_env_doctor_status_reports_current_execution_gateway_runtime_keys(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "PROMPT_RUNTIME_API_KEY=prompt-runtime-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                        "EXECUTION_GATEWAY_QUEUE_CAPACITY=24",
                        "EXECUTION_GATEWAY_QUEUE_TIMEOUT_MS=3000",
                        "EXECUTION_GATEWAY_BRIDGE_BREAKER_FAILURE_THRESHOLD=5",
                        "EXECUTION_GATEWAY_OTEL_SAMPLE_RATIO=1",
                        "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "INTERNAL_NOTICE_READ_MODEL_TABLE=ingestion_projection.internal_notice_read_model",
                        "EXECUTION_GATEWAY_TRANSPORT_WORKER_THREADS=8",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertTrue(status["overall_ready"])
            required = status["settings"]["required"]
            optional = status["settings"]["optional"]
            self.assertNotIn("transport_worker_threads", optional)
            self.assertEqual(
                required["agent_worker_base_url"]["resolved_key"],
                "SUPERVISOR_AGENT_WORKER_BASE_URL",
            )
            self.assertEqual(
                required["agent_worker_shared_secret"]["resolved_key"],
                "SUPERVISOR_AGENT_WORKER_SHARED_SECRET",
            )
            self.assertEqual(
                optional["transport_queue_capacity"]["resolved_key"],
                "EXECUTION_GATEWAY_QUEUE_CAPACITY",
            )
            self.assertEqual(
                optional["bridge_breaker_failure_threshold"]["resolved_key"],
                "EXECUTION_GATEWAY_BRIDGE_BREAKER_FAILURE_THRESHOLD",
            )
            self.assertEqual(
                optional["internal_query_shared_secret"]["resolved_key"],
                "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET",
            )
            self.assertTrue(status["conditions"]["execution_audit_contract"]["ready"])
            self.assertFalse(status["conditions"]["execution_audit_contract"]["required"])
            self.assertTrue(status["conditions"]["structured_runtime_contract"]["ready"])
            self.assertFalse(status["conditions"]["structured_runtime_contract"]["required"])
            self.assertTrue(status["conditions"]["notice_runtime_contract"]["ready"])
            self.assertFalse(status["conditions"]["notice_runtime_contract"]["required"])
            self.assertTrue(status["conditions"]["otel_axiom_collector_endpoint_contract"]["ready"])
            self.assertFalse(
                status["conditions"]["otel_axiom_collector_endpoint_contract"]["required"]
            )

    def test_collect_env_doctor_status_execution_gateway_uses_prompt_runtime_api_key(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "PROMPT_RUNTIME_API_KEY=prompt-runtime-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertTrue(status["overall_ready"])
            self.assertEqual(
                status["providers"]["llm"]["resolved_key"],
                "PROMPT_RUNTIME_API_KEY",
            )
            self.assertEqual(
                status["providers"]["llm"]["checked_keys"],
                ["PROMPT_RUNTIME_API_KEY"],
            )

    def test_collect_env_doctor_status_execution_gateway_requires_bridge_contract(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertFalse(status["overall_ready"])
            self.assertFalse(status["settings"]["required"]["agent_worker_base_url"]["present"])
            self.assertFalse(
                status["settings"]["required"]["agent_worker_shared_secret"]["present"]
            )

    def test_collect_env_doctor_status_execution_gateway_enforces_execution_audit_when_enabled(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                        "EXECUTION_GATEWAY_EXECUTION_AUDIT_ENABLED=true",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["execution_audit_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("EXECUTION_GATEWAY_EXECUTION_AUDIT_URL", condition["error"])
            self.assertIn("EXECUTION_GATEWAY_EXECUTION_AUDIT_SHARED_SECRET", condition["error"])

    def test_collect_env_doctor_status_execution_gateway_enforces_structured_runtime_when_opened(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                        "EXECUTION_GATEWAY_OPEN_CAPABILITIES=campus_services",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["structured_runtime_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET", condition["error"])
            self.assertIn("CAMPUS_SHARED_POSTGRES_URL", condition["error"])

    def test_collect_env_doctor_status_execution_gateway_enforces_notice_runtime_when_opened(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                        "EXECUTION_GATEWAY_OPEN_CAPABILITIES=notice",
                        "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://shared.example/postgres",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["notice_runtime_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("SUPERVISOR_NOTICE_BODY_OBJECT_STORE_ENDPOINT", condition["error"])
            self.assertIn("SUPERVISOR_NOTICE_BODY_OBJECT_STORE_BUCKET", condition["error"])

    def test_collect_env_doctor_status_execution_gateway_rejects_axiom_collector_signal_path(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co/v1/traces",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["otel_axiom_collector_endpoint_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("https://us-east-1.aws.edge.axiom.co", condition["error"])

    def test_collect_env_doctor_status_execution_gateway_rejects_axiom_collector_endpoint_drift(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4",
                        "SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052",
                        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                        "AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://api.axiom.co",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-gateway",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["otel_axiom_collector_endpoint_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("must match AXIOM_ENDPOINT", condition["error"])

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
                        "SUPERVISOR_PROMPT_MODEL=gpt-5.4",
                        "AGENT_PROMPT_MODEL=gpt-5.4-mini",
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
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars",
                "\n".join(
                    [
                        "BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret",
                        "AUTH_SHELL_ORIGIN=https://hub.example.com",
                        "PUBLIC_CHAT_WEB_ORIGIN=https://chat.example.com",
                        "EXECUTION_GATEWAY_BASE_URL=https://supervisor.internal",
                        "EXECUTION_GATEWAY_SHARED_SECRET=shared-secret",
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
                        "HUB_WEB_BASE_URL=https://hub.example.com",
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
            shared_pg = status["postgres"]["shared"]
            self.assertTrue(shared_pg["present"])
            self.assertFalse(shared_pg["shell_exported"])
            self.assertTrue(shared_pg["repo_env_loaded"])
            self.assertEqual(shared_pg["source"], "repo_env")
            self.assertEqual(shared_pg["resolved_key"], "CAMPUS_SHARED_POSTGRES_URL")
            self.assertFalse(shared_pg["connectivity"]["checked"])
            self.assertTrue(status["files"]["apps/app-api/.env"]["ready"])
            self.assertTrue(status["files"]["apps/app-api/.dev.vars"]["ready"])
            self.assertTrue(status["files"]["apps/public-chat-web/.dev.vars"]["ready"])

    def test_collect_env_doctor_status_reports_shared_postgres_from_shell_without_leaking_url(
        self,
    ) -> None:
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
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:repo-secret@repo.example/postgres",
                        "SUPERVISOR_PROMPT_MODEL=gpt-5.4",
                        "AGENT_PROMPT_MODEL=gpt-5.4-mini",
                    ]
                )
                + "\n",
            )
            shell_url = "postgresql://postgres:shell-secret@shell.example/postgres"

            with patch.dict(
                os.environ,
                {
                    "LLM_API_KEY": "shared-llm-secret",
                    "EMBEDDING_API_KEY": "shared-embed-secret",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "QDRANT_URL": "https://qdrant.example.com",
                    "CAMPUS_SHARED_POSTGRES_URL": shell_url,
                    "SUPERVISOR_PROMPT_MODEL": "gpt-5.4",
                    "AGENT_PROMPT_MODEL": "gpt-5.4-mini",
                },
                clear=True,
            ):
                status = collect_env_doctor_status(repo_root=repo_root, surface="query")

            shared_pg = status["postgres"]["shared"]
            rendered = json.dumps(status, ensure_ascii=False)
            self.assertTrue(shared_pg["present"])
            self.assertTrue(shared_pg["shell_exported"])
            self.assertFalse(shared_pg["repo_env_loaded"])
            self.assertEqual(shared_pg["source"], "shell_env")
            self.assertNotIn("shell-secret", rendered)
            self.assertNotIn("repo-secret", rendered)

    def test_collect_env_doctor_status_can_probe_shared_postgres_connectivity(self) -> None:
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
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:pg-secret@127.0.0.1:5432/campus_agent",
                        "SUPERVISOR_PROMPT_MODEL=gpt-5.4",
                        "AGENT_PROMPT_MODEL=gpt-5.4-mini",
                    ]
                )
                + "\n",
            )

            with (
                patch.dict(os.environ, {}, clear=True),
                patch(
                    "scripts.doctor_env._probe_postgres_connectivity",
                    return_value={
                        "checked": True,
                        "ok": True,
                        "error": None,
                        "error_class": None,
                    },
                ) as probe,
            ):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="query",
                    check_postgres_connectivity=True,
                )

            shared_pg = status["postgres"]["shared"]
            probe.assert_called_once()
            self.assertTrue(shared_pg["connectivity"]["checked"])
            self.assertTrue(shared_pg["connectivity"]["ok"])

    def test_collect_env_doctor_status_reports_ingestion_surface_and_registry_source(
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
            self.assertEqual(
                status["settings"]["required"]["object_store_credentials"]["resolved_key"],
                "shared:OBJECT_STORE_ACCESS_KEY+OBJECT_STORE_SECRET_KEY",
            )
            self.assertTrue(
                status["settings"]["optional"]["legacy_office_conversion_base_url"]["present"]
            )
            self.assertTrue(
                status["settings"]["optional"]["legacy_office_conversion_internal_shared_secret"][
                    "present"
                ]
            )

    def test_collect_env_doctor_status_reports_internal_notice_consumption_runtime(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "PROMPT_RUNTIME_MODEL=gpt-5.4-mini",
                        "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL=postgresql://projection/postgres",
                        "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=postgresql://read-model/postgres",
                        "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL=postgresql://admission/postgres",
                        "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL=postgresql://attempt/postgres",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="internal-notice-consumption",
                )

            self.assertTrue(status["overall_ready"])
            self.assertEqual(
                status["settings"]["required"]["multimodal_api_key"]["resolved_key"],
                "LLM_API_KEY",
            )
            self.assertEqual(
                status["settings"]["required"]["multimodal_model"]["resolved_key"],
                "PROMPT_RUNTIME_MODEL",
            )
            self.assertTrue(status["settings"]["required"]["admission_database_url"]["present"])
            self.assertTrue(status["settings"]["required"]["attempt_database_url"]["present"])

    def test_collect_env_doctor_status_reports_ingestion_surface_without_legacy_office_service_contract(
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

            self.assertTrue(status["overall_ready"])
            self.assertFalse(
                status["settings"]["optional"]["legacy_office_conversion_base_url"]["present"]
            )
            self.assertFalse(
                status["settings"]["optional"]["legacy_office_conversion_internal_shared_secret"][
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
            object_store_credentials = status["settings"]["required"]["object_store_credentials"]
            self.assertTrue(object_store_credentials["present"])
            self.assertEqual(
                object_store_credentials["resolved_key"],
                (
                    "bucket_scoped:"
                    "OBJECT_STORE_SOURCE_ACCESS_KEY+OBJECT_STORE_SOURCE_SECRET_KEY;"
                    "OBJECT_STORE_DERIVED_ACCESS_KEY+OBJECT_STORE_DERIVED_SECRET_KEY"
                ),
            )


if __name__ == "__main__":
    unittest.main()
