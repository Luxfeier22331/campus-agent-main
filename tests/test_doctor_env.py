from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status
from scripts.doctor_env_surface_specs import SURFACE_SPECS


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _execution_control_required_env() -> list[str]:
    return [
        "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH=configs/runtime/execution-control/runtime-profile.staging.json",
        "EXECUTION_CONTROL_SHARED_SECRET=control-secret",
        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://runtime.example/campus_agent",
        "EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233",
        "EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging",
        "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow",
        "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001",
        "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:001",
        "EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY=staging:activity-core:001",
        "EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY=staging:activity-agent:001",
        "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY=staging:activity-knowledge:001",
        "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt",
        "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000",
    ]


def _write_execution_control_runtime_profile(
    repo_root: Path,
    *,
    open_tools: list[str] | None = None,
    execution_audit_enabled: bool = False,
) -> None:
    _write(
        repo_root / "configs/runtime/execution-control/runtime-profile.staging.json",
        json.dumps(
            {
                "schema_version": "campus_execution_control_runtime_profile.v1",
                "open_tools": open_tools or [],
                "execution_audit": {"enabled": execution_audit_enabled},
            }
        )
        + "\n",
    )


class DoctorEnvTest(unittest.TestCase):
    def test_surface_specs_do_not_expose_retired_prompt_runtime_keys(self) -> None:
        rendered = json.dumps(SURFACE_SPECS, default=str, ensure_ascii=False)

        self.assertNotIn("PROMPT_RUNTIME_", rendered)
        self.assertNotIn("EXECUTION_PROMPT_MODEL", rendered)

    def test_root_env_example_only_owns_local_provider_seed_inputs(self) -> None:
        root_env_example = Path(__file__).resolve().parents[1] / ".env.example"
        rendered = root_env_example.read_text(encoding="utf-8")

        retired_root_profile_keys = (
            "EMBEDDING_PROVIDER",
            "EMBEDDING_TIMEOUT_SECONDS",
            "EMBEDDING_BATCH_SIZE",
            "SPARSE_PROVIDER",
            "SPARSE_MODEL",
            "SPARSE_TOKENIZER",
            "SPARSE_LANGUAGE",
            "QDRANT_TIMEOUT_SECONDS",
            "INGESTION_QDRANT_TIMEOUT_SECONDS",
            "QDRANT_UPSERT_BATCH_SIZE",
            "OCR_MODEL",
            "OCR_PROVIDER_MODE",
            "EVAL_RAGAS_MODEL",
            "EVAL_JUDGE_MODEL",
            "RAGAS_REASONING_EFFORT",
            "RAGAS_TEXT_VERBOSITY",
            "RAGAS_MAX_OUTPUT_TOKENS",
            "RAGAS_ADAPT_INSTRUCTION",
        )
        for key in retired_root_profile_keys:
            self.assertNotIn(f"{key}=", rendered, key)

    def test_doctor_specs_do_not_require_model_profile_env(self) -> None:
        rendered = json.dumps(SURFACE_SPECS, default=str, ensure_ascii=False)

        retired_doctor_keys = (
            "EMBEDDING_MODEL",
            "INGESTION_EMBEDDING_MODEL",
            "OCR_MODEL",
            "OCR_PROVIDER_MODE",
            "EVAL_RAGAS_MODEL",
            "EVAL_JUDGE_MODEL",
        )
        for key in retired_doctor_keys:
            self.assertNotIn(key, rendered, key)

    def test_internal_notice_doctor_contract_only_keeps_required_multimodal_env(self) -> None:
        spec = SURFACE_SPECS["internal-notice-consumption"]
        rendered_required = json.dumps(spec["required_settings"], default=str, ensure_ascii=False)
        rendered_optional = json.dumps(spec["optional_settings"], default=str, ensure_ascii=False)

        self.assertIn("INTERNAL_NOTICE_MULTIMODAL_API_KEY", rendered_required)
        self.assertIn("INTERNAL_NOTICE_MULTIMODAL_MODEL", rendered_required)
        self.assertNotIn("LLM_API_KEY", rendered_required)
        self.assertNotIn("INTERNAL_NOTICE_MULTIMODAL_BASE_URL", rendered_optional)
        self.assertNotIn("LLM_BASE_URL", rendered_optional)
        self.assertNotIn("INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS", rendered_optional)

    def test_collect_env_doctor_status_reports_current_execution_control_runtime_keys(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        *_execution_control_required_env(),
                        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "INTERNAL_NOTICE_READ_MODEL_TABLE=ingestion_projection.internal_notice_read_model",
                        "EXECUTION_CONTROL_TRANSPORT_WORKER_THREADS=8",
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertTrue(status["overall_ready"])
            required = status["settings"]["required"]
            optional = status["settings"]["optional"]
            self.assertNotIn("transport_worker_threads", optional)
            self.assertNotIn("transport_queue_capacity", optional)
            self.assertNotIn("transport_queue_timeout_ms", optional)
            self.assertNotIn("otel_sample_ratio", optional)
            self.assertNotIn("agent_worker_base_url", required)
            self.assertNotIn("agent_worker_shared_secret", required)
            self.assertNotIn("agent_runtime_base_url", required)
            self.assertNotIn("agent_runtime_shared_secret", required)
            self.assertFalse(optional["agent_runtime_base_url"]["present"])
            self.assertFalse(optional["agent_runtime_shared_secret"]["present"])
            self.assertNotIn("bridge_breaker_failure_threshold", optional)
            self.assertEqual(
                required["run_projection_database_url"]["resolved_key"],
                "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
            )
            self.assertEqual(
                required["temporal_address"]["resolved_key"],
                "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
            )
            self.assertEqual(
                required["temporal_knowledge_worker_identity"]["resolved_key"],
                "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY",
            )
            self.assertEqual(
                required["temporal_core_worker_identity"]["resolved_key"],
                "EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY",
            )
            self.assertEqual(
                optional["internal_query_shared_secret"]["resolved_key"],
                "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
            )
            self.assertEqual(status["providers"], {})
            self.assertTrue(status["conditions"]["execution_audit_contract"]["ready"])
            self.assertFalse(status["conditions"]["execution_audit_contract"]["required"])
            self.assertTrue(status["conditions"]["tool_read_model_runtime_contract"]["ready"])
            self.assertFalse(status["conditions"]["tool_read_model_runtime_contract"]["required"])
            self.assertTrue(status["conditions"]["notice_runtime_contract"]["ready"])
            self.assertFalse(status["conditions"]["notice_runtime_contract"]["required"])
            self.assertTrue(status["conditions"]["otel_axiom_collector_endpoint_contract"]["ready"])
            self.assertFalse(
                status["conditions"]["otel_axiom_collector_endpoint_contract"]["required"]
            )

    def test_collect_env_doctor_status_execution_control_ignores_retired_prompt_runtime_api_key(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "PROMPT_RUNTIME_API_KEY=prompt-runtime-secret",
                        *_execution_control_required_env(),
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["providers"], {})

    def test_collect_env_doctor_status_execution_control_requires_temporal_projection_contract(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertFalse(status["overall_ready"])
            self.assertFalse(
                status["settings"]["required"]["run_projection_database_url"]["present"]
            )
            self.assertFalse(status["settings"]["required"]["temporal_address"]["present"])
            self.assertFalse(
                status["settings"]["required"]["temporal_knowledge_worker_identity"]["present"]
            )

    def test_collect_env_doctor_status_execution_control_enforces_execution_audit_when_enabled(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        *_execution_control_required_env(),
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(repo_root, execution_audit_enabled=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["execution_audit_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("EXECUTION_CONTROL_EXECUTION_AUDIT_URL", condition["error"])
            self.assertIn("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET", condition["error"])

    def test_collect_env_doctor_status_execution_control_enforces_tool_read_model_runtime_when_opened(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        *_execution_control_required_env(),
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(
                repo_root, open_tools=["transport_schedule_lookup"]
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["tool_read_model_runtime_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET", condition["error"])
            self.assertIn("CAMPUS_SHARED_POSTGRES_URL", condition["error"])

    def test_collect_env_doctor_status_execution_control_enforces_notice_runtime_when_opened(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        *_execution_control_required_env(),
                        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://shared.example/postgres",
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(
                repo_root,
                open_tools=["campus_notice_discover"],
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["notice_runtime_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", condition["error"])
            self.assertIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET", condition["error"])

    def test_collect_env_doctor_status_execution_control_rejects_axiom_collector_signal_path(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        *_execution_control_required_env(),
                        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co/v1/traces",
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            self.assertFalse(status["overall_ready"])
            condition = status["conditions"]["otel_axiom_collector_endpoint_contract"]
            self.assertTrue(condition["required"])
            self.assertFalse(condition["ready"])
            self.assertIn("https://us-east-1.aws.edge.axiom.co", condition["error"])

    def test_collect_env_doctor_status_execution_control_accepts_collector_axiom_without_worker_axiom(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        *_execution_control_required_env(),
                        "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                    ]
                )
                + "\n",
            )
            _write_execution_control_runtime_profile(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="execution-control",
                )

            condition = status["conditions"]["otel_axiom_collector_endpoint_contract"]
            self.assertTrue(condition["required"])
            self.assertTrue(condition["ready"])
            self.assertIsNone(condition["error"])

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
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://session.example/postgres",
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
                        "AUTH_SHELL_ORIGIN=https://campus.example.com",
                        "EXECUTION_CONTROL_BASE_URL=https://execution-control.internal",
                        "EXECUTION_CONTROL_SHARED_SECRET=shared-secret",
                        "APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST=example.edu",
                        "APP_API_OPERATOR_EMAIL_ALLOWLIST=ops@example.com",
                        "APP_API_INTERNAL_SHARED_SECRET=internal-secret",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="query")

            self.assertTrue(status["overall_ready"])
            self.assertTrue(status["providers"]["llm"]["present"])
            self.assertTrue(status["providers"]["embedding"]["present"])
            self.assertNotIn("qdrant_url", status["settings"]["required"])
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
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:repo-secret@repo.example/postgres",
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
                    "CAMPUS_SHARED_POSTGRES_URL": shell_url,
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

    def test_collect_env_doctor_status_reports_retired_shared_postgres_connectivity_probe(
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
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:pg-secret@127.0.0.1:5432/campus_agent",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(
                    repo_root=repo_root,
                    surface="query",
                    check_postgres_connectivity=True,
                )

            shared_pg = status["postgres"]["shared"]
            self.assertTrue(shared_pg["connectivity"]["checked"])
            self.assertFalse(shared_pg["connectivity"]["ok"])
            self.assertEqual(
                shared_pg["connectivity"]["error_class"],
                "PythonPostgresProbeRetired",
            )

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
                        "INTERNAL_NOTICE_MULTIMODAL_API_KEY=notice-multimodal-secret",
                        "INTERNAL_NOTICE_MULTIMODAL_MODEL=gpt-5.4-mini",
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
                "INTERNAL_NOTICE_MULTIMODAL_API_KEY",
            )
            self.assertEqual(
                status["settings"]["required"]["multimodal_model"]["resolved_key"],
                "INTERNAL_NOTICE_MULTIMODAL_MODEL",
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
