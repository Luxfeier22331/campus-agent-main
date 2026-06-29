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
from campus_shared.provider_config import ProviderConfigResolutionError

from scripts.doctor_env_surface_specs import SURFACE_SPECS
from scripts.env_sync import parse_env_file


def _collect_env_doctor_status(
    *,
    repo_root: Path,
    surface: str,
    check_postgres_connectivity: bool,
) -> dict[str, object]:
    normalized_surface = surface.strip().lower()
    if normalized_surface not in SURFACE_SPECS:
        raise ValueError(
            f"unsupported surface {surface!r}; expected one of {', '.join(sorted(SURFACE_SPECS))}"
        )

    original_env = dict(os.environ)
    reset_repo_env_bootstrap_state()
    try:
        load_repo_env(repo_root=repo_root.resolve())
        bootstrap_state = get_repo_env_bootstrap_state()
        current_env = dict(os.environ)
        spec = SURFACE_SPECS[normalized_surface]

        providers = (
            {}
            if normalized_surface == "evals"
            else {
                provider_name: _collect_provider_status(
                    env=current_env,
                    checked_keys=provider_spec["checked_keys"],
                    resolver=provider_spec["resolver"],
                    surface_name=provider_spec["surface_name"],
                )
                for provider_name, provider_spec in spec["providers"].items()
            }
        )
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
        runtime_profile = _collect_execution_control_runtime_profile_status(
            repo_root=repo_root,
            env=current_env,
            surface=normalized_surface,
        )
        conditions = _collect_surface_conditions(
            surface=normalized_surface,
            env=current_env,
            settings={
                "required": required_settings,
                "optional": optional_settings,
            },
            postgres=postgres,
            runtime_profile=runtime_profile,
        )

        postgres_ready = _postgres_diagnostics_ready(
            postgres=postgres,
            check_connectivity=check_postgres_connectivity,
        )
        overall_ready = (
            all(status["present"] for status in providers.values())
            and all(status["present"] for status in required_settings.values())
            and all(status["ready"] for status in files.values())
            and postgres_ready
            and all(condition["ready"] for condition in conditions.values())
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
            "provider_projection": {},
            "settings": {
                "required": required_settings,
                "optional": optional_settings,
            },
            "conditions": conditions,
            "runtime_profile": runtime_profile,
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


def _collect_surface_conditions(
    *,
    surface: str,
    env: dict[str, str],
    settings: dict[str, dict[str, dict[str, object]]],
    postgres: dict[str, object],
    runtime_profile: dict[str, object],
) -> dict[str, dict[str, object]]:
    if surface != "execution-control":
        return {}

    conditions: dict[str, dict[str, object]] = {}
    optional_settings = settings.get("optional", {})
    shared_postgres_status = postgres.get("shared")
    shared_postgres_present = bool(
        isinstance(shared_postgres_status, dict) and shared_postgres_status.get("present")
    )

    conditions["runtime_profile_contract"] = {
        "required": True,
        "ready": bool(runtime_profile.get("ready")),
        "error": runtime_profile.get("error"),
    }

    profile = runtime_profile.get("profile")
    profile_payload = profile if isinstance(profile, dict) else {}
    execution_audit = profile_payload.get("execution_audit")
    execution_audit_enabled = bool(
        isinstance(execution_audit, dict) and execution_audit.get("enabled") is True
    )
    audit_missing: list[str] = []
    if execution_audit_enabled:
        if not _setting_present(optional_settings, "execution_audit_url"):
            audit_missing.append("EXECUTION_CONTROL_EXECUTION_AUDIT_URL")
        if not _setting_present(optional_settings, "execution_audit_shared_secret"):
            audit_missing.append("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET")
    conditions["execution_audit_contract"] = {
        "required": execution_audit_enabled,
        "ready": len(audit_missing) == 0,
        "error": (
            "execution audit enabled but missing " + " / ".join(audit_missing)
            if audit_missing
            else None
        ),
    }

    opened_tools = _runtime_profile_open_tools(profile_payload)
    tool_read_model_required = bool(_tool_read_model_tools(opened_tools))
    tool_read_model_missing: list[str] = []
    if tool_read_model_required:
        if not _setting_present(optional_settings, "internal_query_shared_secret"):
            tool_read_model_missing.append("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET")
        if not shared_postgres_present:
            tool_read_model_missing.append("CAMPUS_SHARED_POSTGRES_URL")
    conditions["tool_read_model_runtime_contract"] = {
        "required": tool_read_model_required,
        "open_tools": sorted(opened_tools),
        "ready": len(tool_read_model_missing) == 0,
        "error": (
            "tool read model tools opened but missing " + " / ".join(tool_read_model_missing)
            if tool_read_model_missing
            else None
        ),
    }

    notice_tools_open = bool(_notice_tools(opened_tools))
    notice_missing: list[str] = []
    notice_read_model_present = (
        _setting_present(
            optional_settings,
            "internal_notice_read_model_database_url",
        )
        or shared_postgres_present
    )
    if notice_tools_open:
        if not notice_read_model_present:
            notice_missing.append(
                "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL"
            )
        if not _setting_present(optional_settings, "notice_object_store_endpoint"):
            notice_missing.append("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT")
        if not _setting_present(optional_settings, "notice_object_store_access_key"):
            notice_missing.append("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY")
        if not _setting_present(optional_settings, "notice_object_store_secret_key"):
            notice_missing.append("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY")
        if not _setting_present(optional_settings, "notice_object_store_bucket"):
            notice_missing.append("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET")
    conditions["notice_runtime_contract"] = {
        "required": notice_tools_open,
        "open_tools": sorted(_notice_tools(opened_tools)),
        "ready": len(notice_missing) == 0,
        "error": (
            "notice tools opened but missing " + " / ".join(notice_missing)
            if notice_missing
            else None
        ),
    }

    axiom_collector_endpoint = env.get("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT", "").strip()
    axiom_collector_endpoint_ready = (
        not axiom_collector_endpoint or axiom_collector_endpoint.startswith(("http://", "https://"))
    ) and "/" not in axiom_collector_endpoint.removeprefix("https://").removeprefix("http://")
    conditions["otel_axiom_collector_endpoint_contract"] = {
        "required": bool(axiom_collector_endpoint),
        "ready": axiom_collector_endpoint_ready,
        "error": (
            "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must be a base domain like "
            "https://us-east-1.aws.edge.axiom.co; do not include /v1/traces, /v1/logs, or /v1/metrics"
            if axiom_collector_endpoint and not axiom_collector_endpoint_ready
            else None
        ),
    }

    return conditions


def _collect_execution_control_runtime_profile_status(
    *,
    repo_root: Path,
    env: dict[str, str],
    surface: str,
) -> dict[str, object]:
    if surface != "execution-control":
        return {}
    raw_path = env.get("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", "").strip()
    if not raw_path:
        return {
            "required": True,
            "present": False,
            "ready": False,
            "path": None,
            "profile": None,
            "error": "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH is required",
        }
    path = Path(raw_path)
    if not path.is_absolute():
        path = repo_root / path
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "required": True,
            "present": True,
            "ready": False,
            "path": str(path),
            "profile": None,
            "error": f"runtime profile is not readable: {exc}",
        }
    if profile.get("schema_version") != "campus_execution_control_runtime_profile.v1":
        return {
            "required": True,
            "present": True,
            "ready": False,
            "path": str(path),
            "profile": None,
            "error": "runtime profile schema_version must be campus_execution_control_runtime_profile.v1",
        }
    return {
        "required": True,
        "present": True,
        "ready": True,
        "path": str(path),
        "profile": profile,
        "error": None,
    }


def _runtime_profile_open_tools(profile: dict[str, object]) -> set[str]:
    raw_value = profile.get("open_tools")
    if not isinstance(raw_value, list):
        return set()
    return {item.strip() for item in raw_value if isinstance(item, str) and item.strip()}


def _tool_read_model_tools(open_tools: set[str]) -> set[str]:
    return {
        tool
        for tool in open_tools
        if tool.startswith("campus_notice_") or tool == "transport_schedule_lookup"
    }


def _notice_tools(open_tools: set[str]) -> set[str]:
    return {tool for tool in open_tools if tool.startswith("campus_notice_")}


def _setting_present(
    settings: dict[str, dict[str, object]],
    setting_name: str,
) -> bool:
    setting = settings.get(setting_name)
    return bool(isinstance(setting, dict) and setting.get("present"))


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
    checked_keys = [*shared_keys, *source_keys, *derived_keys]

    if all(env.get(key, "").strip() for key in shared_keys):
        return {
            "required": True,
            "present": True,
            "checked_keys": checked_keys,
            "resolved_key": "shared:OBJECT_STORE_ACCESS_KEY+OBJECT_STORE_SECRET_KEY",
            "error": None,
        }

    if all(env.get(key, "").strip() for key in source_keys) and all(
        env.get(key, "").strip() for key in derived_keys
    ):
        return {
            "required": True,
            "present": True,
            "checked_keys": checked_keys,
            "resolved_key": (
                "bucket_scoped:OBJECT_STORE_SOURCE_ACCESS_KEY+OBJECT_STORE_SOURCE_SECRET_KEY;"
                "OBJECT_STORE_DERIVED_ACCESS_KEY+OBJECT_STORE_DERIVED_SECRET_KEY"
            ),
            "error": None,
        }

    return {
        "required": True,
        "present": False,
        "checked_keys": checked_keys,
        "resolved_key": None,
        "error": (
            "missing object-store credentials; ingestion requires either shared "
            "OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY credentials or both bucket-scoped "
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
        choices=tuple(sorted(SURFACE_SPECS)),
        help="Logical surface to diagnose, for example evals or execution-control.",
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
    provider_projection = status.get("provider_projection")
    if isinstance(provider_projection, dict) and provider_projection:
        print(
            "provider_projection.ready="
            f"{provider_projection['ready']} path={provider_projection.get('path')}"
        )
        print(
            "provider_projection.required_roles="
            + ",".join(provider_projection.get("required_roles", []))
        )
        for role, profile_status in dict(provider_projection.get("profiles", {})).items():
            print(
                f"provider_projection.profile.{role}.provider={profile_status['provider']} "
                f"model={profile_status['model']} revision={profile_status['revision']} "
                f"secret_configured={profile_status['secret_configured']}"
            )
        if provider_projection.get("error"):
            print(f"provider_projection.error={provider_projection['error']}")
    settings = status["settings"]
    for requirement_group in ("required", "optional"):
        for setting_name, setting_status in settings[requirement_group].items():
            print(
                f"setting.{setting_name}.present={setting_status['present']} "
                f"resolved_key={setting_status['resolved_key']}"
            )
            if setting_status["error"] and setting_status["required"]:
                print(f"setting.{setting_name}.error={setting_status['error']}")
    for condition_name, condition_status in status.get("conditions", {}).items():
        print(
            f"condition.{condition_name}.required={condition_status['required']} "
            f"ready={condition_status['ready']}"
        )
        if condition_status.get("error"):
            print(f"condition.{condition_name}.error={condition_status['error']}")
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
