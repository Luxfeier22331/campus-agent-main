from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from campus_ingestion_core.authenticated_notice_legacy_export import (
    build_authenticated_notice_legacy_normalized_manifest,
)

from scripts.env_sync import load_target_seed, parse_env_file, replace_or_append_env_values
from scripts.sync_app_api_local_db_env import sync_app_api_local_db_env

LOCAL_POSTGRES_DATABASE_URL_BASE = "postgresql://postgres:postgres@127.0.0.1:5432/campus_agent"
LOCAL_POSTGRES_DATABASE_URL = (
    f"{LOCAL_POSTGRES_DATABASE_URL_BASE}?sslmode=disable&gssencmode=disable"
)
DEFAULT_EXPORT_SCOPE = "run14-accepted-union-local-postgres"
DEFAULT_RECOVERY_ROOT = Path(".tmp/local-postgres-recovery")
DEFAULT_NORMALIZED_BATCH_DIRS = (
    Path(".tmp/historical-intake/run14-policy-regulation-expanded/normalized"),
    Path(".tmp/historical-intake/run14-attachment-routing-probe/normalized"),
    Path(".tmp/historical-intake/run14-policy-regulation-core/normalized"),
)
DEFAULT_UNION_OUTPUT_DIR = DEFAULT_RECOVERY_ROOT / "accepted-union"
DEFAULT_BACKUP_DIR = DEFAULT_RECOVERY_ROOT / "backups"
DEFAULT_DOCKER_COMPOSE_FILE = Path("infra/local/docker-compose.postgres.yml")
ROOT_ENV_BACKUP_PATH = DEFAULT_BACKUP_DIR / "env.root.before-local-postgres"
APP_API_ENV_BACKUP_PATH = DEFAULT_BACKUP_DIR / "env.app-api.before-local-postgres"
APP_API_DEV_VARS_BACKUP_PATH = DEFAULT_BACKUP_DIR / "devvars.app-api.before-local-postgres"
APP_API_ENV_PATH = Path("apps/app-api/.env")
APP_API_DEV_VARS_PATH = Path("apps/app-api/.dev.vars")

_ROOT_LOCAL_POSTGRES_ENV_KEYS = (
    "CAMPUS_SHARED_POSTGRES_URL",
    "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
    "DOCUMENT_REGISTRY_DATABASE_URL",
    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
    "RAW_ASSET_REGISTRY_DATABASE_URL",
    "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
)


def prepare_local_postgres_recovery(
    *,
    repo_root: Path,
    normalized_batch_dirs: Sequence[Path] | None = None,
    union_output_dir: Path | None = None,
    local_postgres_url: str = LOCAL_POSTGRES_DATABASE_URL,
    export_scope: str = DEFAULT_EXPORT_SCOPE,
    corpus: str = "campus_notices",
    collection: str = "internal_notice",
    expected_inventory: dict[str, int] | None = None,
) -> dict[str, Any]:
    resolved_repo_root = repo_root.resolve()
    resolved_batch_dirs = tuple(
        _resolve_repo_path(resolved_repo_root, path)
        for path in (normalized_batch_dirs or DEFAULT_NORMALIZED_BATCH_DIRS)
    )
    resolved_union_output_dir = _resolve_repo_path(
        resolved_repo_root,
        union_output_dir or DEFAULT_UNION_OUTPUT_DIR,
    )
    runtime_expectations = dict(
        expected_inventory
        or {
            "notice_count": 20,
            "expected_document_count": 21,
            "expected_attachment_document_count": 1,
            "expected_ocr_candidate_count": 5,
        }
    )
    backup_paths = capture_pre_local_postgres_backups(
        repo_root=resolved_repo_root,
        local_postgres_url=local_postgres_url,
    )

    root_env_path = _rewrite_root_env_for_local_postgres(
        repo_root=resolved_repo_root,
        local_postgres_url=local_postgres_url,
    )
    sync_app_api_local_db_env(repo_root=resolved_repo_root)
    app_api_env_path = _rewrite_app_api_env_for_local_postgres(
        repo_root=resolved_repo_root,
        local_postgres_url=local_postgres_url,
    )
    app_api_dev_vars_path = _rewrite_app_api_dev_vars_for_local_postgres(
        repo_root=resolved_repo_root
    )
    union_result = merge_authenticated_notice_normalized_batches(
        batch_dirs=resolved_batch_dirs,
        output_dir=resolved_union_output_dir,
        export_scope=export_scope,
    )
    union_bundle_path = Path(union_result["bundle_path"]).resolve()
    union_manifest_path = Path(union_result["manifest_path"]).resolve()
    selected_notice_ids_path = Path(union_result["selected_notice_ids_path"]).resolve()

    commands = [
        {
            "label": "docker_postgres_up",
            "argv": [
                "docker",
                "compose",
                "-f",
                str(DEFAULT_DOCKER_COMPOSE_FILE),
                "up",
                "-d",
            ],
        },
        {
            "label": "app_api_db_bootstrap",
            "argv": ["pnpm", "--dir", "apps/app-api", "db:bootstrap"],
        },
        {
            "label": "app_api_db_reconcile_shared_drift",
            "argv": [
                "pnpm",
                "--dir",
                "apps/app-api",
                "db:reconcile-shared-drift",
                "--",
                "--json",
            ],
            "expects_json": True,
        },
        {
            "label": "authenticated_notice_import",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.import_authenticated_notice_export",
                "--bundle-path",
                _display_path(resolved_repo_root, union_bundle_path),
                "--manifest-path",
                _display_path(resolved_repo_root, union_manifest_path),
                "--site-id",
                str(union_result["site_id"]),
                "--source-home-url",
                str(union_result["source_home_url"]),
                "--corpus",
                corpus,
                "--collection",
                collection,
            ],
            "expects_json": True,
        },
        {
            "label": "authenticated_notice_inventory_rebuild",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory",
                "--corpus",
                corpus,
                "--collection",
                collection,
            ],
            "expects_json": True,
        },
    ]
    return {
        "repo_root": str(resolved_repo_root),
        "local_postgres_url": local_postgres_url,
        "corpus": corpus,
        "collection": collection,
        "expected_inventory": runtime_expectations,
        "merged_notice_ids": list(union_result["selected_notice_ids"]),
        "batch_dirs": [_display_path(resolved_repo_root, path) for path in resolved_batch_dirs],
        "paths": {
            "root_env_path": str(root_env_path),
            "app_api_env_path": str(app_api_env_path),
            "app_api_dev_vars_path": str(app_api_dev_vars_path),
            "root_env_backup_path": str(backup_paths["root_env"]),
            "app_api_env_backup_path": str(backup_paths["app_api_env"]),
            "app_api_dev_vars_backup_path": str(backup_paths["app_api_dev_vars"]),
            "union_output_dir": str(resolved_union_output_dir),
            "union_bundle_path": str(union_bundle_path),
            "union_manifest_path": str(union_manifest_path),
            "selected_notice_ids_path": str(selected_notice_ids_path),
        },
        "commands": commands,
    }


def merge_authenticated_notice_normalized_batches(
    *,
    batch_dirs: Sequence[Path],
    output_dir: Path,
    export_scope: str,
) -> dict[str, Any]:
    if not batch_dirs:
        raise ValueError("at least one normalized batch directory is required")

    merged_by_notice_id: dict[str, dict[str, Any]] = {}
    manifests: list[dict[str, Any]] = []
    for batch_dir in batch_dirs:
        bundle_path = batch_dir / "notices-bundle.normalized.json"
        manifest_path = batch_dir / "export-manifest.normalized.json"
        bundle_payload = _load_json(bundle_path)
        if not isinstance(bundle_payload, list):
            raise ValueError(f"expected JSON array: {bundle_path}")
        manifest_payload = _load_json(manifest_path)
        if not isinstance(manifest_payload, dict):
            raise ValueError(f"expected JSON object: {manifest_path}")
        manifests.append(manifest_payload)
        for raw_record in bundle_payload:
            if not isinstance(raw_record, dict):
                raise ValueError(f"expected object records in {bundle_path}")
            notice_id = _notice_id(raw_record)
            if not notice_id:
                raise ValueError(f"missing notice_id in {bundle_path}")
            merged_by_notice_id.setdefault(notice_id, raw_record)

    if not merged_by_notice_id:
        raise ValueError("normalized batches were empty")

    site_id, source_home_url = _require_consistent_manifest_identity(manifests)
    merged_records = list(merged_by_notice_id.values())
    selected_notice_ids = tuple(merged_by_notice_id.keys())
    selected_notice_type_ids = _selected_notice_type_ids(merged_records)
    merged_manifest = build_authenticated_notice_legacy_normalized_manifest(
        legacy_manifest=dict(manifests[0].get("legacy_source") or {}),
        site_id=site_id,
        source_home_url=source_home_url,
        notice_type_policy=_merge_notice_type_policy(manifests),
        selected_notice_type_ids=selected_notice_type_ids,
        selected_notice_ids=selected_notice_ids,
        filtered_notice_count=len(merged_records),
        original_notice_count=_resolve_original_notice_count(manifests[0]),
        export_scope=export_scope,
        exported_at=datetime.now(UTC).isoformat(),
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = output_dir / "notices-bundle.accepted-union.json"
    manifest_path = output_dir / "export-manifest.accepted-union.json"
    selected_notice_ids_path = output_dir / "selected-notice-ids.accepted-union.txt"
    _write_json(bundle_path, merged_records)
    _write_json(manifest_path, merged_manifest)
    selected_notice_ids_path.write_text(
        "\n".join(selected_notice_ids) + "\n",
        encoding="utf-8",
    )
    return {
        "bundle_path": str(bundle_path),
        "manifest_path": str(manifest_path),
        "selected_notice_ids_path": str(selected_notice_ids_path),
        "selected_notice_ids": list(selected_notice_ids),
        "selected_notice_type_ids": list(selected_notice_type_ids),
        "site_id": site_id,
        "source_home_url": source_home_url,
    }


def execute_local_postgres_recovery(
    plan: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    repo_root = Path(str(plan["repo_root"]))
    executed_steps: list[dict[str, Any]] = []
    reconcile_report: dict[str, Any] | None = None
    import_report: dict[str, Any] | None = None
    inventory_report: dict[str, Any] | None = None

    for command in plan["commands"]:
        completed = runner(
            list(command["argv"]),
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
        step_report: dict[str, Any] = {
            "label": command["label"],
            "argv": list(command["argv"]),
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
        if command.get("expects_json"):
            payload = _parse_command_json(
                label=str(command["label"]),
                raw_stdout=completed.stdout,
            )
            step_report["json"] = payload
            if command["label"] == "app_api_db_reconcile_shared_drift":
                _validate_reconcile_report(payload)
                reconcile_report = payload
            elif command["label"] == "authenticated_notice_import":
                _validate_import_report(payload, expected_inventory=plan["expected_inventory"])
                import_report = payload
            elif command["label"] == "authenticated_notice_inventory_rebuild":
                _validate_inventory_report(payload, expected_inventory=plan["expected_inventory"])
                inventory_report = payload
        executed_steps.append(step_report)

    return {
        "ok": True,
        "repo_root": str(repo_root),
        "executed_steps": executed_steps,
        "reconcile_report": reconcile_report,
        "import_report": import_report,
        "inventory_report": inventory_report,
        "validated_inventory": dict(plan["expected_inventory"]),
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rewrite the current worktree to local Docker Postgres, rebuild the accepted "
            "authenticated-notice union import bundle, and optionally execute the local "
            "bootstrap/import/rebuild command chain."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--normalized-batch-dir",
        action="append",
        dest="normalized_batch_dirs",
        type=Path,
        default=None,
        help=(
            "Optional normalized batch directory containing notices-bundle.normalized.json and "
            "export-manifest.normalized.json. Repeat to override the default run14 accepted batch set."
        ),
    )
    parser.add_argument(
        "--union-output-dir",
        type=Path,
        default=None,
        help="Optional output directory for the merged accepted-union artifacts.",
    )
    parser.add_argument(
        "--local-postgres-url",
        default=LOCAL_POSTGRES_DATABASE_URL,
        help="Local Postgres DSN to write into repo root and app-api local env files.",
    )
    parser.add_argument(
        "--export-scope",
        default=DEFAULT_EXPORT_SCOPE,
        help="Export scope to write into the merged accepted-union manifest.",
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--expected-notice-count", type=int, default=20)
    parser.add_argument("--expected-document-count", type=int, default=21)
    parser.add_argument("--expected-attachment-document-count", type=int, default=1)
    parser.add_argument("--expected-ocr-candidate-count", type=int, default=5)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Run the prepared docker/pnpm/uv command chain instead of printing a dry-run plan.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the result as JSON.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    plan = prepare_local_postgres_recovery(
        repo_root=args.repo_root.resolve(),
        normalized_batch_dirs=args.normalized_batch_dirs,
        union_output_dir=args.union_output_dir,
        local_postgres_url=args.local_postgres_url,
        export_scope=args.export_scope,
        corpus=args.corpus,
        collection=args.collection,
        expected_inventory={
            "notice_count": args.expected_notice_count,
            "expected_document_count": args.expected_document_count,
            "expected_attachment_document_count": args.expected_attachment_document_count,
            "expected_ocr_candidate_count": args.expected_ocr_candidate_count,
        },
    )
    result = (
        {
            "mode": "execute",
            **execute_local_postgres_recovery(plan),
        }
        if args.execute
        else {
            "mode": "dry_run",
            **plan,
        }
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        _print_text_report(result)
    return 0


def capture_pre_local_postgres_backups(
    *,
    repo_root: Path,
    local_postgres_url: str = LOCAL_POSTGRES_DATABASE_URL,
) -> dict[str, Path]:
    backup_targets = {
        "root_env": repo_root / ROOT_ENV_BACKUP_PATH,
        "app_api_env": repo_root / APP_API_ENV_BACKUP_PATH,
        "app_api_dev_vars": repo_root / APP_API_DEV_VARS_BACKUP_PATH,
    }
    root_env_path = repo_root / ".env"
    current_root_values = parse_env_file(root_env_path) if root_env_path.exists() else {}
    current_runtime_url = current_root_values.get("CAMPUS_SHARED_POSTGRES_URL", "").strip()
    if current_runtime_url and not is_local_postgres_database_url(current_runtime_url):
        _write_backup_snapshot(
            source_path=root_env_path,
            target_path=backup_targets["root_env"],
        )
        _write_backup_snapshot(
            source_path=repo_root / APP_API_ENV_PATH,
            target_path=backup_targets["app_api_env"],
        )
        _write_backup_snapshot(
            source_path=repo_root / APP_API_DEV_VARS_PATH,
            target_path=backup_targets["app_api_dev_vars"],
        )
    return backup_targets


def _rewrite_root_env_for_local_postgres(
    *,
    repo_root: Path,
    local_postgres_url: str,
) -> Path:
    target_path = repo_root / ".env"
    content = replace_or_append_env_values(
        load_target_seed(target_path),
        dict.fromkeys(_ROOT_LOCAL_POSTGRES_ENV_KEYS, local_postgres_url),
        drop_keys=(
            "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL",
            "DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL",
            "RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL",
        ),
    )
    target_path.write_text(content, encoding="utf-8")
    return target_path


def _rewrite_app_api_env_for_local_postgres(*, repo_root: Path, local_postgres_url: str) -> Path:
    target_path = repo_root / APP_API_ENV_PATH
    content = replace_or_append_env_values(
        load_target_seed(target_path),
        {
            "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB": local_postgres_url,
            "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH": local_postgres_url,
            "APP_API_OPERATOR_DATABASE_URL": local_postgres_url,
        },
        drop_keys=("APP_API_MANAGEMENT_DATABASE_URL",),
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    return target_path


def is_local_postgres_database_url(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return False
    parsed = urlparse(normalized)
    if parsed.scheme not in {"postgresql", "postgres"}:
        return False
    if (parsed.hostname or "").strip().lower() not in {"127.0.0.1", "localhost"}:
        return False
    if parsed.port not in {None, 5432}:
        return False
    return parsed.path.strip("/") == "campus_agent"


def _rewrite_app_api_dev_vars_for_local_postgres(*, repo_root: Path) -> Path:
    target_path = repo_root / APP_API_DEV_VARS_PATH
    content = replace_or_append_env_values(
        load_target_seed(target_path),
        {"APP_API_DATABASE_SSLMODE": "disable"},
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    return target_path


def _require_consistent_manifest_identity(
    manifests: Sequence[dict[str, Any]],
) -> tuple[str, str]:
    first_manifest = manifests[0]
    site_id = str(first_manifest.get("site_id") or "").strip()
    source_home_url = str(first_manifest.get("source_home_url") or "").strip()
    if not site_id or not source_home_url:
        raise ValueError("normalized manifest is missing site_id or source_home_url")
    for manifest in manifests[1:]:
        current_site_id = str(manifest.get("site_id") or "").strip()
        current_source_home_url = str(manifest.get("source_home_url") or "").strip()
        if current_site_id != site_id or current_source_home_url != source_home_url:
            raise ValueError("normalized manifests must share the same site_id and source_home_url")
    return site_id, source_home_url


def _merge_notice_type_policy(
    manifests: Sequence[dict[str, Any]],
) -> tuple[dict[str, Any], ...]:
    merged_by_type: dict[str, dict[str, Any]] = {}
    for manifest in manifests:
        for raw_item in list(manifest.get("notice_type_policy") or ()):
            item = dict(raw_item)
            type_id = str(item.get("type") or "").strip()
            if not type_id or type_id in merged_by_type:
                continue
            merged_by_type[type_id] = item
    return tuple(merged_by_type.values())


def _selected_notice_type_ids(
    records: Sequence[dict[str, Any]],
) -> tuple[str, ...]:
    selected: list[str] = []
    seen: set[str] = set()
    for record in records:
        notice = dict(record.get("notice") or {})
        for category in list(notice.get("categories") or ()):
            type_id = str(dict(category).get("notice_type") or "").strip()
            if not type_id or type_id in seen:
                continue
            seen.add(type_id)
            selected.append(type_id)
    return tuple(selected)


def _resolve_original_notice_count(manifest: dict[str, Any]) -> int:
    legacy_source = dict(manifest.get("legacy_source") or {})
    counts = dict(legacy_source.get("counts") or {})
    return int(counts.get("notices") or manifest.get("filters", {}).get("max_notices") or 0)


def _display_path(repo_root: Path, path: Path) -> str:
    resolved_path = path.resolve()
    try:
        return str(resolved_path.relative_to(repo_root))
    except ValueError:
        return str(resolved_path)


def _resolve_repo_path(repo_root: Path, path: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def _write_backup_snapshot(*, source_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(load_target_seed(source_path), encoding="utf-8")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _notice_id(record: dict[str, Any]) -> str:
    notice = dict(record.get("notice") or {})
    return str(notice.get("notice_id") or record.get("notice_id") or "").strip()


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _parse_command_json(*, label: str, raw_stdout: str) -> dict[str, Any]:
    first_brace = raw_stdout.find("{")
    last_brace = raw_stdout.rfind("}")
    if first_brace == -1 or last_brace == -1 or first_brace > last_brace:
        raise ValueError(f"{label} did not return a JSON object payload")
    try:
        payload = json.loads(raw_stdout[first_brace : last_brace + 1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} did not return valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{label} returned a non-object JSON payload")
    return payload


def _validate_reconcile_report(payload: dict[str, Any]) -> None:
    plan = dict(payload.get("plan") or payload)
    if plan.get("driftDetected"):
        raise ValueError("app-api shared drift reconcile reported driftDetected=true")
    blocked_reasons = list(plan.get("blockedReasons") or ())
    if blocked_reasons:
        raise ValueError(
            "app-api shared drift reconcile reported blockedReasons: "
            + ", ".join(str(item) for item in blocked_reasons)
        )


def _validate_import_report(
    payload: dict[str, Any],
    *,
    expected_inventory: dict[str, int],
) -> None:
    errors = list(payload.get("errors") or ())
    if errors:
        raise ValueError(
            "authenticated notice import reported errors: "
            + ", ".join(str(item) for item in errors)
        )
    notice_count = int(payload.get("notice_count") or 0)
    if notice_count != int(expected_inventory["notice_count"]):
        raise ValueError(
            "authenticated notice import returned unexpected notice_count: "
            f"{notice_count} != {expected_inventory['notice_count']}"
        )


def _validate_inventory_report(
    payload: dict[str, Any],
    *,
    expected_inventory: dict[str, int],
) -> None:
    for key, expected_value in expected_inventory.items():
        actual_value = int(payload.get(key) or 0)
        if actual_value != int(expected_value):
            raise ValueError(
                "authenticated notice inventory rebuild returned unexpected "
                f"{key}: {actual_value} != {expected_value}"
            )


def _print_text_report(result: dict[str, Any]) -> None:
    print(f"mode={result['mode']}")
    if result["mode"] == "dry_run":
        print(f"repo_root={result['repo_root']}")
        print("commands=")
        for command in result["commands"]:
            print("  " + " ".join(str(token) for token in command["argv"]))
        return

    print(f"repo_root={result['repo_root']}")
    print(f"validated_inventory={json.dumps(result['validated_inventory'], ensure_ascii=False)}")


if __name__ == "__main__":
    raise SystemExit(main())
