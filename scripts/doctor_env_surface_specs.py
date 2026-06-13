from __future__ import annotations

from campus_shared.provider_config import (
    EMBEDDING_API_KEY_PRECEDENCE,
    LLM_API_KEY_PRECEDENCE,
    ProviderConfigResolutionError,
    ResolvedLLMProviderConfig,
    resolve_embedding_provider_config,
    resolve_llm_provider_config,
)

from scripts.doctor_env_worker_staging_specs import WORKER_STAGING_SURFACE_SPECS

PROMPT_RUNTIME_API_KEY_PRECEDENCE = ("PROMPT_RUNTIME_API_KEY",)
PROMPT_RUNTIME_BASE_URL_PRECEDENCE = ("PROMPT_RUNTIME_BASE_URL",)


def resolve_prompt_runtime_provider_config(
    surface_name: str,
    *,
    env: dict[str, str],
) -> ResolvedLLMProviderConfig:
    normalized_surface_name = surface_name.strip()
    if not normalized_surface_name:
        raise ValueError("surface_name must not be empty")
    api_key = env.get("PROMPT_RUNTIME_API_KEY", "").strip()
    if not api_key:
        raise ProviderConfigResolutionError(
            surface_name=normalized_surface_name,
            logical_name="prompt_runtime_api_key",
            checked_keys=PROMPT_RUNTIME_API_KEY_PRECEDENCE,
        )
    base_url = env.get("PROMPT_RUNTIME_BASE_URL", "").strip()
    return ResolvedLLMProviderConfig(
        surface_name=normalized_surface_name,
        api_key=api_key,
        api_key_source="PROMPT_RUNTIME_API_KEY",
        base_url=base_url or None,
        base_url_source="PROMPT_RUNTIME_BASE_URL" if base_url else None,
    )


SURFACE_SPECS = {
    "evals": {
        "providers": {
            "llm": {
                "checked_keys": LLM_API_KEY_PRECEDENCE,
                "resolver": resolve_llm_provider_config,
                "surface_name": "eval.ragas",
            },
            "embedding": {
                "checked_keys": EMBEDDING_API_KEY_PRECEDENCE,
                "resolver": resolve_embedding_provider_config,
                "surface_name": "eval.ragas",
            },
        },
        "required_settings": {
            "embedding_model": ("EVAL_EMBEDDING_MODEL", "EMBEDDING_MODEL"),
            "ragas_model": ("EVAL_RAGAS_MODEL",),
        },
        "optional_settings": {
            "judge_model": ("EVAL_JUDGE_MODEL", "EVAL_RAGAS_MODEL"),
        },
        "files": {},
    },
    "ingestion": {
        "providers": {
            "embedding": {
                "checked_keys": EMBEDDING_API_KEY_PRECEDENCE,
                "resolver": resolve_embedding_provider_config,
                "surface_name": "ingestion.worker",
            },
        },
        "required_settings": {
            "embedding_model": ("INGESTION_EMBEDDING_MODEL", "EMBEDDING_MODEL"),
            "object_store_endpoint": ("OBJECT_STORE_ENDPOINT",),
            "object_store_credentials": (),
            "ocr_base_url": ("OCR_BASE_URL",),
            "ocr_api_key": ("OCR_API_KEY",),
            "ocr_provider_mode": ("OCR_PROVIDER_MODE",),
            "qdrant_url": ("QDRANT_URL",),
            "registry_database_url": (
                "RAW_ASSET_REGISTRY_DATABASE_URL",
                "DOCUMENT_REGISTRY_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
            ),
        },
        "optional_settings": {
            "object_store_bucket_source": ("OBJECT_STORE_BUCKET_SOURCE",),
            "object_store_bucket_derived": ("OBJECT_STORE_BUCKET_DERIVED",),
            "ocr_model": ("OCR_MODEL",),
            "legacy_office_conversion_base_url": ("LEGACY_OFFICE_CONVERSION_BASE_URL",),
            "legacy_office_conversion_internal_shared_secret": (
                "LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET",
            ),
            "legacy_office_conversion_timeout_seconds": (
                "LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS",
            ),
        },
        "files": {},
    },
    "internal-notice-consumption": {
        "providers": {},
        "required_settings": {
            "projection_database_url": (
                "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
                "DOCUMENT_REGISTRY_DATABASE_URL",
            ),
            "read_model_database_url": (
                "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
                "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
            ),
            "admission_database_url": (
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL",
                "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
            ),
            "attempt_database_url": (
                "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL",
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL",
                "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
            ),
            "multimodal_api_key": (
                "INTERNAL_NOTICE_MULTIMODAL_API_KEY",
                "PROMPT_RUNTIME_API_KEY",
                "LLM_API_KEY",
            ),
            "multimodal_model": (
                "INTERNAL_NOTICE_MULTIMODAL_MODEL",
                "PROMPT_RUNTIME_MODEL",
            ),
        },
        "optional_settings": {
            "projection_operator_database_url": (
                "NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
            ),
            "admission_operator_database_url": (
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
                "NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL",
            ),
            "attempt_operator_database_url": (
                "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL",
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
            ),
            "multimodal_base_url": (
                "INTERNAL_NOTICE_MULTIMODAL_BASE_URL",
                "PROMPT_RUNTIME_BASE_URL",
                "LLM_BASE_URL",
            ),
            "multimodal_max_output_tokens": (
                "INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS",
                "PROMPT_RUNTIME_MAX_OUTPUT_TOKENS",
            ),
        },
        "files": {},
    },
    "query": {
        "providers": {
            "llm": {
                "checked_keys": LLM_API_KEY_PRECEDENCE,
                "resolver": resolve_llm_provider_config,
                "surface_name": "query.runtime",
            },
            "embedding": {
                "checked_keys": EMBEDDING_API_KEY_PRECEDENCE,
                "resolver": resolve_embedding_provider_config,
                "surface_name": "query.runtime",
            },
        },
        "required_settings": {
            "embedding_model": ("EMBEDDING_MODEL",),
            "qdrant_url": ("QDRANT_URL",),
            "shared_postgres_url": ("CAMPUS_SHARED_POSTGRES_URL",),
            "execution_prompt_model": ("EXECUTION_PROMPT_MODEL", "PROMPT_RUNTIME_MODEL"),
            "agent_prompt_model": ("AGENT_PROMPT_MODEL", "PROMPT_RUNTIME_MODEL"),
        },
        "optional_settings": {
            "document_registry_database_url": (
                "DOCUMENT_REGISTRY_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
            ),
        },
        "files": {
            "apps/app-api/.env": {
                "required_keys": (
                    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
                    "APP_API_OPERATOR_DATABASE_URL",
                ),
                "optional_keys": (
                    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH",
                ),
            },
            "apps/app-api/.dev.vars": {
                "required_keys": (
                    "BETTER_AUTH_SECRET",
                    "AUTH_SHELL_ORIGIN",
                    "PUBLIC_CHAT_WEB_ORIGIN",
                    "EXECUTION_CONTROL_BASE_URL",
                    "EXECUTION_CONTROL_SHARED_SECRET",
                    "APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
                    "APP_API_OPERATOR_EMAIL_ALLOWLIST",
                    "APP_API_INTERNAL_SHARED_SECRET",
                ),
                "optional_keys": (
                    "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN",
                    "SENTRY_DSN",
                    "AXIOM_TOKEN",
                ),
            },
            "apps/public-chat-web/.dev.vars": {
                "required_keys": ("APP_API_BASE_URL", "PUBLIC_CHAT_HOSTNAME", "HUB_WEB_BASE_URL"),
                "optional_keys": ("SENTRY_DSN",),
            },
        },
    },
    "execution-control": {
        "providers": {
            "llm": {
                "checked_keys": PROMPT_RUNTIME_API_KEY_PRECEDENCE,
                "resolver": resolve_prompt_runtime_provider_config,
                "surface_name": "execution-control",
            },
        },
        "required_settings": {
            "execution_prompt_model": ("EXECUTION_PROMPT_MODEL", "PROMPT_RUNTIME_MODEL"),
            "agent_prompt_model": ("AGENT_PROMPT_MODEL", "PROMPT_RUNTIME_MODEL"),
            "execution_control_shared_secret": ("EXECUTION_CONTROL_SHARED_SECRET",),
            "metrics_bearer_token": ("EXECUTION_CONTROL_METRICS_BEARER_TOKEN",),
            "run_projection_database_url": ("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",),
            "temporal_address": ("EXECUTION_CONTROL_TEMPORAL_ADDRESS",),
            "temporal_namespace": ("EXECUTION_CONTROL_TEMPORAL_NAMESPACE",),
            "temporal_task_queue": ("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",),
            "temporal_worker_identity": ("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",),
            "temporal_workflow_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
            ),
            "temporal_context_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY",
            ),
            "temporal_agent_worker_identity": ("EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",),
            "temporal_knowledge_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY",
            ),
            "temporal_campus_services_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY",
            ),
            "temporal_notice_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY",
            ),
            "temporal_navigation_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY",
            ),
            "temporal_finalization_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
            ),
            "temporal_workflow_id_salt": ("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",),
            "temporal_start_timeout_ms": ("EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",),
        },
        "optional_settings": {
            "agent_runtime_base_url": ("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL",),
            "agent_runtime_shared_secret": ("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET",),
            "agent_runtime_timeout_ms": ("EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS",),
            "prompt_runtime_transport": ("PROMPT_RUNTIME_TRANSPORT",),
            "prompt_runtime_base_url": ("PROMPT_RUNTIME_BASE_URL", "LLM_BASE_URL"),
            "prompt_runtime_connect_timeout_seconds": ("PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS",),
            "prompt_runtime_read_timeout_seconds": ("PROMPT_RUNTIME_READ_TIMEOUT_SECONDS",),
            "prompt_runtime_write_timeout_seconds": ("PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS",),
            "prompt_runtime_pool_timeout_seconds": ("PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS",),
            "prompt_runtime_max_connections": ("PROMPT_RUNTIME_MAX_CONNECTIONS",),
            "prompt_runtime_max_keepalive_connections": (
                "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS",
            ),
            "prompt_runtime_keepalive_expiry_seconds": ("PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS",),
            "audit_log_path": ("AUDIT_LOG_PATH",),
            "audit_queue_capacity": ("AUDIT_QUEUE_CAPACITY",),
            "transport_max_concurrent_answers": ("EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS",),
            "transport_queue_capacity": ("EXECUTION_CONTROL_QUEUE_CAPACITY",),
            "transport_queue_timeout_ms": ("EXECUTION_CONTROL_QUEUE_TIMEOUT_MS",),
            "request_timeout_ms": ("EXECUTION_CONTROL_REQUEST_TIMEOUT_MS",),
            "request_body_limit_bytes": ("EXECUTION_CONTROL_REQUEST_BODY_LIMIT_BYTES",),
            "shutdown_grace_ms": ("EXECUTION_CONTROL_SHUTDOWN_GRACE_MS",),
            "lane_rag_max_concurrent": ("EXECUTION_CONTROL_LANE_RAG_MAX_CONCURRENT",),
            "lane_navigation_max_concurrent": ("EXECUTION_CONTROL_LANE_NAVIGATION_MAX_CONCURRENT",),
            "lane_campus_services_max_concurrent": (
                "EXECUTION_CONTROL_LANE_CAMPUS_SERVICES_MAX_CONCURRENT",
            ),
            "lane_notice_max_concurrent": ("EXECUTION_CONTROL_LANE_NOTICE_MAX_CONCURRENT",),
            "otel_enabled": ("EXECUTION_CONTROL_OTEL_ENABLED",),
            "otel_exporter_otlp_endpoint": ("EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_ENDPOINT",),
            "otel_sample_ratio": ("EXECUTION_CONTROL_OTEL_SAMPLE_RATIO",),
            "execution_audit_enabled": ("EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED",),
            "execution_audit_url": ("EXECUTION_CONTROL_EXECUTION_AUDIT_URL",),
            "execution_audit_shared_secret": ("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET",),
            "execution_audit_batch_size": ("EXECUTION_CONTROL_EXECUTION_AUDIT_BATCH_SIZE",),
            "execution_audit_spool_dir": ("EXECUTION_CONTROL_EXECUTION_AUDIT_SPOOL_DIR",),
            "internal_query_base_url": ("EXECUTION_CONTROL_INTERNAL_QUERY_BASE_URL",),
            "internal_query_shared_secret": ("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",),
            "structured_query_timeout_ms": ("EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS",),
            "structured_query_timeout_seconds": (
                "EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_SECONDS",
            ),
            "internal_notice_read_model_database_url": ("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",),
            "internal_notice_read_model_table": ("INTERNAL_NOTICE_READ_MODEL_TABLE",),
            "notice_object_store_endpoint": (
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT",
            ),
            "notice_object_store_access_key": (
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY",
            ),
            "notice_object_store_secret_key": (
                "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY",
            ),
            "notice_object_store_bucket": ("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET",),
        },
        "files": {},
    },
    **WORKER_STAGING_SURFACE_SPECS,
}
