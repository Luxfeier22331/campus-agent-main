from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable, Sequence
from pathlib import Path

from campus_shared import (
    get_repo_env_bootstrap_state,
    load_repo_env,
    reset_repo_env_bootstrap_state,
)
from campus_shared.provider_config import (
    EMBEDDING_API_KEY_PRECEDENCE,
    LLM_API_KEY_PRECEDENCE,
    ProviderConfigResolutionError,
    resolve_embedding_provider_config,
    resolve_llm_provider_config,
)

from scripts.env_sync import parse_env_file

_SURFACE_SPECS = {
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
            "legacy_office_conversion_base_url": ("LEGACY_OFFICE_CONVERSION_BASE_URL",),
            "legacy_office_conversion_internal_shared_secret": (
                "LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET",
            ),
        },
        "optional_settings": {
            "object_store_bucket_source": ("OBJECT_STORE_BUCKET_SOURCE",),
            "object_store_bucket_derived": ("OBJECT_STORE_BUCKET_DERIVED",),
            "ocr_model": ("OCR_MODEL",),
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
                "NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_DATABASE_URL",
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
                "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL",
            ),
            "admission_operator_database_url": (
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_DATABASE_URL",
                "NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL",
                "NOTICE_CONSUMPTION_PROJECTION_MANAGEMENT_DATABASE_URL",
            ),
            "attempt_operator_database_url": (
                "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL",
                "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_DATABASE_URL",
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL",
                "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_MANAGEMENT_DATABASE_URL",
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
            "specialist_model": ("AGNO_SPECIALIST_MODEL",),
            "supervisor_model": ("AGNO_SUPERVISOR_MODEL",),
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
                    "APP_API_MANAGEMENT_DATABASE_URL",
                ),
            },
            "apps/app-api/.dev.vars": {
                "required_keys": (
                    "BETTER_AUTH_SECRET",
                    "PUBLIC_CHAT_WEB_ORIGIN",
                    "SUPERVISOR_API_BASE_URL",
                    "SUPERVISOR_API_SHARED_SECRET",
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
                "required_keys": ("APP_API_BASE_URL", "PUBLIC_CHAT_HOSTNAME"),
                "optional_keys": ("SENTRY_DSN",),
            },
        },
    },
    "supervisor-api": {
        "providers": {
            "llm": {
                "checked_keys": LLM_API_KEY_PRECEDENCE,
                "resolver": resolve_llm_provider_config,
                "surface_name": "supervisor.api",
            },
        },
        "required_settings": {
            "supervisor_prompt_model": ("SUPERVISOR_PROMPT_MODEL", "PROMPT_RUNTIME_MODEL"),
            "agent_prompt_model": ("AGENT_PROMPT_MODEL", "PROMPT_RUNTIME_MODEL"),
        },
        "optional_settings": {
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
            "agent_worker_threads": ("SUPERVISOR_AGENT_WORKER_THREADS",),
            "agent_worker_base_url": ("SUPERVISOR_AGENT_WORKER_BASE_URL",),
            "agent_worker_shared_secret": ("SUPERVISOR_AGENT_WORKER_SHARED_SECRET",),
            "agent_worker_timeout_ms": ("SUPERVISOR_AGENT_WORKER_TIMEOUT_MS",),
            "agent_worker_cancel_timeout_ms": ("SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS",),
            "transport_max_concurrent_answers": ("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS",),
            "transport_queue_capacity": ("SUPERVISOR_API_QUEUE_CAPACITY",),
            "transport_queue_timeout_ms": ("SUPERVISOR_API_QUEUE_TIMEOUT_MS",),
            "request_timeout_ms": ("SUPERVISOR_API_REQUEST_TIMEOUT_MS",),
            "request_body_limit_bytes": ("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES",),
            "shutdown_grace_ms": ("SUPERVISOR_API_SHUTDOWN_GRACE_MS",),
            "bridge_breaker_failure_threshold": (
                "SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD",
            ),
            "bridge_breaker_open_ms": ("SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS",),
            "lane_rag_max_concurrent": ("SUPERVISOR_API_LANE_RAG_MAX_CONCURRENT",),
            "lane_navigation_max_concurrent": ("SUPERVISOR_API_LANE_NAVIGATION_MAX_CONCURRENT",),
            "lane_campus_services_max_concurrent": (
                "SUPERVISOR_API_LANE_CAMPUS_SERVICES_MAX_CONCURRENT",
            ),
            "lane_notice_max_concurrent": ("SUPERVISOR_API_LANE_NOTICE_MAX_CONCURRENT",),
            "metrics_bearer_token": ("SUPERVISOR_API_METRICS_BEARER_TOKEN",),
            "otel_enabled": ("SUPERVISOR_API_OTEL_ENABLED",),
            "otel_exporter_otlp_endpoint": ("SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT",),
            "otel_sample_ratio": ("SUPERVISOR_API_OTEL_SAMPLE_RATIO",),
            "execution_audit_enabled": ("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED",),
            "execution_audit_url": ("SUPERVISOR_API_EXECUTION_AUDIT_URL",),
            "execution_audit_shared_secret": ("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET",),
            "execution_audit_batch_size": ("SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE",),
            "execution_audit_spool_dir": ("SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_DIR",),
            "structured_query_base_url": ("SUPERVISOR_STRUCTURED_QUERY_BASE_URL",),
            "structured_query_shared_secret": ("SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET",),
            "structured_query_timeout_ms": ("SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS",),
            "structured_query_timeout_seconds": ("SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS",),
            "internal_notice_read_model_database_url": ("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",),
            "internal_notice_read_model_table": ("INTERNAL_NOTICE_READ_MODEL_TABLE",),
        },
        "files": {},
    },
    "worker-staging": {
        "providers": {},
        "required_settings": {
            "staging_access_policy_aud": ("STAGING_ACCESS_POLICY_AUD",),
            "staging_access_team_domain": ("STAGING_ACCESS_TEAM_DOMAIN",),
            "staging_supervisor_api_base_url": ("STAGING_SUPERVISOR_API_BASE_URL",),
        },
        "optional_settings": {
            "staging_app_api_database_sslmode": ("STAGING_APP_API_DATABASE_SSLMODE",),
            "staging_app_api_operator_database_url": (
                "STAGING_APP_API_OPERATOR_DATABASE_URL",
                "STAGING_APP_API_MANAGEMENT_DATABASE_URL",
            ),
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-app-api": {
        "providers": {},
        "required_settings": {
            "staging_supervisor_api_base_url": ("STAGING_SUPERVISOR_API_BASE_URL",),
        },
        "optional_settings": {
            "staging_app_api_database_sslmode": ("STAGING_APP_API_DATABASE_SSLMODE",),
            "staging_app_api_operator_database_url": (
                "STAGING_APP_API_OPERATOR_DATABASE_URL",
                "STAGING_APP_API_MANAGEMENT_DATABASE_URL",
            ),
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-public-chat-web": {
        "providers": {},
        "required_settings": {},
        "optional_settings": {
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-protected-panel-web": {
        "providers": {},
        "required_settings": {
            "staging_access_policy_aud": ("STAGING_ACCESS_POLICY_AUD",),
            "staging_access_team_domain": ("STAGING_ACCESS_TEAM_DOMAIN",),
        },
        "optional_settings": {
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
}


def _collect_env_doctor_status(
    *,
    repo_root: Path,
    surface: str,
    check_postgres_connectivity: bool,
) -> dict[str, object]:
    normalized_surface = surface.strip().lower()
    if normalized_surface not in _SURFACE_SPECS:
        raise ValueError(
            f"unsupported surface {surface!r}; expected one of {', '.join(sorted(_SURFACE_SPECS))}"
        )

    original_env = dict(os.environ)
    reset_repo_env_bootstrap_state()
    try:
        load_repo_env(repo_root=repo_root.resolve())
        bootstrap_state = get_repo_env_bootstrap_state()
        current_env = dict(os.environ)
        spec = _SURFACE_SPECS[normalized_surface]

        providers = {
            provider_name: _collect_provider_status(
                env=current_env,
                checked_keys=provider_spec["checked_keys"],
                resolver=provider_spec["resolver"],
                surface_name=provider_spec["surface_name"],
            )
            for provider_name, provider_spec in spec["providers"].items()
        }

        required_settings = {
            name: (
                _collect_object_store_credentials_status(current_env)
                if name == "object_store_credentials"
                else _collect_setting_status(current_env, checked_keys=checked_keys, required=True)
            )
            for name, checked_keys in spec["required_settings"].items()
        }
        optional_settings = {
            name: _collect_setting_status(current_env, checked_keys=checked_keys, required=False)
            for name, checked_keys in spec["optional_settings"].items()
        }
        files = {
            relative_path: _collect_env_file_status(
                repo_root=repo_root,
                relative_path=relative_path,
                required_keys=file_spec.get("required_keys", ()),
                optional_keys=file_spec.get("optional_keys", ()),
            )
            for relative_path, file_spec in spec["files"].items()
        }
        postgres = {
            "shared": _collect_shared_postgres_status(
                original_env=original_env,
                current_env=current_env,
                bootstrap_state=bootstrap_state,
                check_connectivity=check_postgres_connectivity,
            ),
        }

        postgres_ready = _postgres_diagnostics_ready(
            postgres=postgres,
            check_connectivity=check_postgres_connectivity,
        )
        overall_ready = (
            all(status["present"] for status in providers.values())
            and all(status["present"] for status in required_settings.values())
            and all(status["ready"] for status in files.values())
            and postgres_ready
        )
        return {
            "surface": normalized_surface,
            "overall_ready": overall_ready,
            "bootstrap": {
                "ran": True,
                "candidate_path": (
                    str(bootstrap_state.candidate_path)
                    if bootstrap_state is not None
                    else str(repo_root.resolve() / ".env")
                ),
                "loaded_path": (
                    str(bootstrap_state.loaded_path)
                    if bootstrap_state is not None and bootstrap_state.loaded_path is not None
                    else None
                ),
                "file_found": bool(bootstrap_state.file_found)
                if bootstrap_state is not None
                else False,
                "loaded_keys": list(bootstrap_state.loaded_keys)
                if bootstrap_state is not None
                else [],
                "skipped_existing_keys": (
                    list(bootstrap_state.skipped_existing_keys)
                    if bootstrap_state is not None
                    else []
                ),
            },
            "providers": providers,
            "settings": {
                "required": required_settings,
                "optional": optional_settings,
            },
            "postgres": postgres,
            "files": files,
        }
    finally:
        os.environ.clear()
        os.environ.update(original_env)
        reset_repo_env_bootstrap_state()


def collect_env_doctor_status(
    *,
    repo_root: Path,
    surface: str,
    check_postgres_connectivity: bool = False,
) -> dict[str, object]:
    return _collect_env_doctor_status(
        repo_root=repo_root,
        surface=surface,
        check_postgres_connectivity=check_postgres_connectivity,
    )


def _collect_shared_postgres_status(
    *,
    original_env: dict[str, str],
    current_env: dict[str, str],
    bootstrap_state: object,
    check_connectivity: bool,
) -> dict[str, object]:
    key = "CAMPUS_SHARED_POSTGRES_URL"
    shell_exported = bool(original_env.get(key, "").strip())
    present = bool(current_env.get(key, "").strip())
    loaded_keys = set(getattr(bootstrap_state, "loaded_keys", ()) or ())
    skipped_existing_keys = set(getattr(bootstrap_state, "skipped_existing_keys", ()) or ())
    repo_env_loaded = key in loaded_keys
    repo_env_skipped_existing = key in skipped_existing_keys
    source = "missing"
    if present and shell_exported:
        source = "shell_env"
    elif present and repo_env_loaded:
        source = "repo_env"
    elif present:
        source = "process_env_after_bootstrap"

    connectivity = {
        "checked": bool(check_connectivity),
        "ok": None,
        "error": None,
        "error_class": None,
    }
    if check_connectivity:
        database_url = current_env.get(key, "").strip()
        connectivity = (
            _probe_postgres_connectivity(database_url)
            if database_url
            else {
                "checked": True,
                "ok": False,
                "error": f"{key} is not present after repo env bootstrap",
                "error_class": "MissingDatabaseURL",
            }
        )

    return {
        "present": present,
        "checked_keys": [key],
        "resolved_key": key if present else None,
        "shell_exported": shell_exported,
        "repo_env_loaded": repo_env_loaded,
        "repo_env_skipped_existing": repo_env_skipped_existing,
        "source": source,
        "connectivity": connectivity,
    }


def _probe_postgres_connectivity(database_url: str) -> dict[str, object]:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        return {
            "checked": True,
            "ok": False,
            "error": str(exc),
            "error_class": exc.__class__.__name__,
        }
    try:
        with (
            psycopg.connect(database_url, autocommit=True, connect_timeout=3) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute("select 1")
            cursor.fetchone()
    except Exception as exc:  # pragma: no cover - exercised by local doctor, not unit tests.
        return {
            "checked": True,
            "ok": False,
            "error": str(exc),
            "error_class": exc.__class__.__name__,
        }
    return {
        "checked": True,
        "ok": True,
        "error": None,
        "error_class": None,
    }


def _postgres_diagnostics_ready(
    *,
    postgres: dict[str, object],
    check_connectivity: bool,
) -> bool:
    if not check_connectivity:
        return True
    shared = postgres.get("shared")
    if not isinstance(shared, dict):
        return False
    connectivity = shared.get("connectivity")
    return isinstance(connectivity, dict) and connectivity.get("ok") is True


def _collect_provider_status(
    *,
    env: dict[str, str],
    surface_name: str,
    checked_keys: tuple[str, ...],
    resolver: Callable[..., object],
) -> dict[str, object]:
    try:
        resolved = resolver(surface_name, env=env)
    except ProviderConfigResolutionError as exc:
        return {
            "present": False,
            "surface_name": surface_name,
            "checked_keys": list(exc.checked_keys),
            "resolved_key": None,
            "error": str(exc),
        }

    return {
        "present": True,
        "surface_name": surface_name,
        "checked_keys": list(checked_keys),
        "resolved_key": getattr(resolved, "api_key_source", None),
        "error": None,
    }


def _collect_env_file_status(
    *,
    repo_root: Path,
    relative_path: str,
    required_keys: Sequence[str],
    optional_keys: Sequence[str],
) -> dict[str, object]:
    path = repo_root / relative_path
    values = parse_env_file(path) if path.exists() else {}

    missing_keys = [key for key in required_keys if not values.get(key, "").strip()]
    present_required_keys = [key for key in required_keys if values.get(key, "").strip()]
    present_optional_keys = [key for key in optional_keys if values.get(key, "").strip()]

    return {
        "path": relative_path,
        "file_found": path.exists(),
        "required_keys": list(required_keys),
        "optional_keys": list(optional_keys),
        "present_required_keys": present_required_keys,
        "present_optional_keys": present_optional_keys,
        "missing_keys": missing_keys,
        "ready": len(missing_keys) == 0,
    }


def _collect_setting_status(
    env: dict[str, str],
    *,
    checked_keys: tuple[str, ...],
    required: bool,
) -> dict[str, object]:
    for key in checked_keys:
        value = env.get(key, "").strip()
        if value:
            return {
                "required": required,
                "present": True,
                "checked_keys": list(checked_keys),
                "resolved_key": key,
                "error": None,
            }
    checked_key_list = list(checked_keys)
    return {
        "required": required,
        "present": False,
        "checked_keys": checked_key_list,
        "resolved_key": None,
        "error": f"missing setting; checked {' > '.join(checked_key_list)}",
    }


def _collect_object_store_credentials_status(env: dict[str, str]) -> dict[str, object]:
    shared_keys = ("OBJECT_STORE_ACCESS_KEY", "OBJECT_STORE_SECRET_KEY")
    source_keys = ("OBJECT_STORE_SOURCE_ACCESS_KEY", "OBJECT_STORE_SOURCE_SECRET_KEY")
    derived_keys = ("OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY")

    if all(env.get(key, "").strip() for key in shared_keys):
        return {
            "required": True,
            "present": True,
            "checked_keys": [*shared_keys, *source_keys, *derived_keys],
            "resolved_key": "OBJECT_STORE_ACCESS_KEY+OBJECT_STORE_SECRET_KEY",
            "error": None,
        }

    if all(env.get(key, "").strip() for key in source_keys) and all(
        env.get(key, "").strip() for key in derived_keys
    ):
        return {
            "required": True,
            "present": True,
            "checked_keys": [*shared_keys, *source_keys, *derived_keys],
            "resolved_key": (
                "OBJECT_STORE_SOURCE_ACCESS_KEY+OBJECT_STORE_SOURCE_SECRET_KEY;"
                "OBJECT_STORE_DERIVED_ACCESS_KEY+OBJECT_STORE_DERIVED_SECRET_KEY"
            ),
            "error": None,
        }

    return {
        "required": True,
        "present": False,
        "checked_keys": [*shared_keys, *source_keys, *derived_keys],
        "resolved_key": None,
        "error": (
            "missing object-store credentials; configure shared "
            "OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY or both bucket-scoped "
            "OBJECT_STORE_SOURCE_* and OBJECT_STORE_DERIVED_* credential pairs"
        ),
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check repo env bootstrap and surface-scoped provider/settings readiness without "
            "printing secret values."
        )
    )
    parser.add_argument(
        "surface",
        choices=tuple(sorted(_SURFACE_SPECS)),
        help="Logical surface to diagnose, for example evals or supervisor-api.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the status report as JSON.",
    )
    parser.add_argument(
        "--check-postgres-connectivity",
        action="store_true",
        help=(
            "Connect to CAMPUS_SHARED_POSTGRES_URL after repo env bootstrap and include the "
            "result in readiness."
        ),
    )
    return parser.parse_args(argv)


def _print_text_report(status: dict[str, object]) -> None:
    print(f"surface={status['surface']}")
    print(f"overall_ready={status['overall_ready']}")
    bootstrap = status["bootstrap"]
    print(f"bootstrap.file_found={bootstrap['file_found']}")
    print(f"bootstrap.loaded_path={bootstrap['loaded_path']}")
    postgres = status["postgres"]["shared"]
    print(f"postgres.shared.present={postgres['present']} resolved_key={postgres['resolved_key']}")
    print(f"postgres.shared.shell_exported={postgres['shell_exported']}")
    print(f"postgres.shared.repo_env_loaded={postgres['repo_env_loaded']}")
    print(f"postgres.shared.source={postgres['source']}")
    connectivity = postgres["connectivity"]
    print(f"postgres.shared.connectivity.checked={connectivity['checked']} ok={connectivity['ok']}")
    if connectivity["error"]:
        print(
            "postgres.shared.connectivity.error="
            f"{connectivity['error_class']}: {connectivity['error']}"
        )
    for provider_name, provider_status in status["providers"].items():
        print(
            f"provider.{provider_name}.present={provider_status['present']} "
            f"resolved_key={provider_status['resolved_key']}"
        )
        print(f"provider.{provider_name}.checked_keys=" + ",".join(provider_status["checked_keys"]))
        if provider_status["error"]:
            print(f"provider.{provider_name}.error={provider_status['error']}")
    settings = status["settings"]
    for requirement_group in ("required", "optional"):
        for setting_name, setting_status in settings[requirement_group].items():
            print(
                f"setting.{setting_name}.present={setting_status['present']} "
                f"resolved_key={setting_status['resolved_key']}"
            )
            if setting_status["error"] and setting_status["required"]:
                print(f"setting.{setting_name}.error={setting_status['error']}")
    for relative_path, file_status in status["files"].items():
        print(f"file.{relative_path}.ready={file_status['ready']}")
        print(f"file.{relative_path}.file_found={file_status['file_found']}")
        print(f"file.{relative_path}.required_keys=" + ",".join(file_status["required_keys"]))
        if file_status["missing_keys"]:
            print(f"file.{relative_path}.missing_keys=" + ",".join(file_status["missing_keys"]))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    status = collect_env_doctor_status(
        repo_root=args.repo_root.resolve(),
        surface=args.surface,
        check_postgres_connectivity=args.check_postgres_connectivity,
    )
    if args.json:
        print(json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        _print_text_report(status)
    return 0 if status["overall_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
