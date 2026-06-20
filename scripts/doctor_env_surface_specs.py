from __future__ import annotations

from campus_shared.provider_config import (
    EMBEDDING_API_KEY_PRECEDENCE,
    LLM_API_KEY_PRECEDENCE,
    resolve_embedding_provider_config,
    resolve_llm_provider_config,
)

from scripts.doctor_env_worker_staging_specs import WORKER_STAGING_SURFACE_SPECS

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
        "required_settings": {},
        "optional_settings": {},
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
            "object_store_endpoint": ("OBJECT_STORE_ENDPOINT",),
            "object_store_credentials": (),
            "ocr_base_url": ("OCR_BASE_URL",),
            "ocr_api_key": ("OCR_API_KEY",),
            "registry_database_url": (
                "RAW_ASSET_REGISTRY_DATABASE_URL",
                "DOCUMENT_REGISTRY_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_URL",
            ),
        },
        "optional_settings": {
            "object_store_bucket_source": ("OBJECT_STORE_BUCKET_SOURCE",),
            "object_store_bucket_derived": ("OBJECT_STORE_BUCKET_DERIVED",),
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
            "multimodal_api_key": ("INTERNAL_NOTICE_MULTIMODAL_API_KEY",),
            "multimodal_model": ("INTERNAL_NOTICE_MULTIMODAL_MODEL",),
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
            "shared_postgres_url": ("CAMPUS_SHARED_POSTGRES_URL",),
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
                    "EXECUTION_CONTROL_BASE_URL",
                    "EXECUTION_CONTROL_SHARED_SECRET",
                    "APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
                    "APP_API_OPERATOR_EMAIL_ALLOWLIST",
                    "APP_API_INTERNAL_SHARED_SECRET",
                ),
                "optional_keys": (
                    "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN",
                    "SENTRY_DSN",
                    "APP_API_OTEL_INGEST_ENDPOINT",
                    "APP_API_OTEL_INGEST_SHARED_SECRET",
                ),
            },
        },
    },
    "execution-control": {
        "providers": {},
        "required_settings": {
            "runtime_config_path": ("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH",),
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
            "audit_log_path": ("AUDIT_LOG_PATH",),
            "audit_queue_capacity": ("AUDIT_QUEUE_CAPACITY",),
            "execution_audit_url": ("EXECUTION_CONTROL_EXECUTION_AUDIT_URL",),
            "execution_audit_shared_secret": ("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET",),
            "internal_query_base_url": ("EXECUTION_CONTROL_INTERNAL_QUERY_BASE_URL",),
            "internal_query_shared_secret": ("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",),
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
