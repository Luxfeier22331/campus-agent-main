from __future__ import annotations

from scripts.doctor_env_worker_staging_specs import WORKER_STAGING_SURFACE_SPECS

LLM_API_KEY_PRECEDENCE = ("EVAL_LLM_API_KEY", "LLM_API_KEY")
EMBEDDING_API_KEY_PRECEDENCE = ("EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY")

SURFACE_SPECS = {
    "evals": {
        "providers": {},
        "required_settings": {},
        "optional_settings": {},
        "files": {},
    },
    "ingestion": {
        "providers": {
            "embedding": {
                "checked_keys": EMBEDDING_API_KEY_PRECEDENCE,
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
        },
        "files": {},
    },
    "query": {
        "providers": {
            "llm": {
                "checked_keys": LLM_API_KEY_PRECEDENCE,
                "surface_name": "query.runtime",
            },
            "embedding": {
                "checked_keys": EMBEDDING_API_KEY_PRECEDENCE,
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
            "temporal_core_worker_identity": ("EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY",),
            "temporal_agent_worker_identity": ("EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",),
            "temporal_knowledge_worker_identity": (
                "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY",
            ),
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
        },
        "files": {},
    },
    **WORKER_STAGING_SURFACE_SPECS,
}
