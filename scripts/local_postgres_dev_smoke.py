from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Sequence

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreSettings

from scripts.env_sync import parse_env_file
from scripts.restore_local_postgres_dev import (
    DEFAULT_RECOVERY_ROOT,
    execute_local_postgres_recovery,
    prepare_local_postgres_recovery,
)

DEFAULT_BOUNDED_NOTICE_ID = "355119"
DEFAULT_CLOSEOUT_WORKER_ID = "local-postgres-01"
DEFAULT_MINIO_COMPOSE_FILE = Path("infra/local/docker-compose.minio.yml")


def prepare_local_postgres_smoke(
    *,
    repo_root: Path,
    run_id: str | None = None,
    preparation_run_id: str | None = None,
    bounded_notice_id: str = DEFAULT_BOUNDED_NOTICE_ID,
    sample_output_root: Path | None = None,
) -> dict[str, Any]:
    resolved_repo_root = repo_root.resolve()
    normalized_notice_id = bounded_notice_id.strip()
    if not normalized_notice_id:
        raise ValueError("bounded_notice_id is required")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    resolved_run_id = run_id or f"local-postgres-wave-d-{normalized_notice_id}-{timestamp}"
    resolved_preparation_run_id = (
        preparation_run_id or f"prep-local-postgres-wave-d-{normalized_notice_id}-{timestamp}"
    )
    resolved_sample_output_root = (
        (resolved_repo_root / sample_output_root)
        if sample_output_root is not None and not sample_output_root.is_absolute()
        else sample_output_root
    ) or (resolved_repo_root / DEFAULT_RECOVERY_ROOT / "smoke")

    recovery_plan = prepare_local_postgres_recovery(repo_root=resolved_repo_root)
    current_scope_sample_dir = resolved_sample_output_root / "current-scope-samples"
    closeout_sample_dir = resolved_sample_output_root / f"closeout-samples-{normalized_notice_id}"
    preparation_sample_dir = resolved_sample_output_root / f"prep-samples-{normalized_notice_id}"
    commands = [
        {
            "label": "docker_minio_up",
            "argv": [
                "docker",
                "compose",
                "-f",
                str(DEFAULT_MINIO_COMPOSE_FILE),
                "up",
                "-d",
            ],
        },
        {
            "label": "ensure_object_store_buckets",
            "action": "ensure_object_store_buckets",
        },
        *list(recovery_plan["commands"]),
        {
            "label": "current_scope_validation",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.validate_internal_notice_chunking",
                "--sample-dir",
                _display_path(resolved_repo_root, current_scope_sample_dir),
            ],
            "expects_json": True,
        },
        {
            "label": "bounded_replay_plan",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.plan_authenticated_notice_source_truth_replay",
                "--run-id",
                resolved_run_id,
                "--corpus",
                "campus_notices",
                "--collection",
                "internal_notice",
                "--notice-id",
                normalized_notice_id,
                "--shard-size",
                "8",
                "--batch-size",
                "4",
                "--max-concurrency",
                "1",
                "--notice-concurrency",
                "2",
                "--object-store-concurrency",
                "8",
                "--lease-seconds",
                "300",
            ],
            "expects_json": True,
        },
        {
            "label": "bounded_replay_worker",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.run_authenticated_notice_closeout_worker",
                "--run-id",
                resolved_run_id,
                "--worker-id",
                DEFAULT_CLOSEOUT_WORKER_ID,
            ],
            "expects_json": True,
        },
        {
            "label": "bounded_replay_show",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.show_authenticated_notice_closeout",
                "--run-id",
                resolved_run_id,
            ],
            "expects_json": True,
        },
        {
            "label": "bounded_closeout_validation",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.validate_internal_notice_chunking",
                "--closeout-run-id",
                resolved_run_id,
                "--sample-dir",
                _display_path(resolved_repo_root, closeout_sample_dir),
            ],
            "expects_json": True,
        },
        {
            "label": "bounded_chunk_preparation",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.prepare_registry_scope_chunks",
                "--corpus",
                "campus_notices",
                "--collection",
                "internal_notice",
                "--closeout-run-id",
                resolved_run_id,
                "--preparation-run-id",
                resolved_preparation_run_id,
            ],
            "expects_json": True,
        },
        {
            "label": "bounded_preparation_validation",
            "argv": [
                "uv",
                "run",
                "--package",
                "campus-ingestion-worker",
                "python",
                "-m",
                "campus_ingestion_worker.validate_internal_notice_chunking",
                "--preparation-run-id",
                resolved_preparation_run_id,
                "--sample-dir",
                _display_path(resolved_repo_root, preparation_sample_dir),
            ],
            "expects_json": True,
        },
    ]
    return {
        "repo_root": str(resolved_repo_root),
        "bounded_notice_id": normalized_notice_id,
        "run_id": resolved_run_id,
        "preparation_run_id": resolved_preparation_run_id,
        "paths": {
            "sample_output_root": str(resolved_sample_output_root),
            "current_scope_sample_dir": str(current_scope_sample_dir),
            "closeout_sample_dir": str(closeout_sample_dir),
            "preparation_sample_dir": str(preparation_sample_dir),
        },
        "recovery_plan": recovery_plan,
        "commands": commands,
    }


def execute_local_postgres_smoke(
    plan: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    bucket_ensurer: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    repo_root = Path(str(plan["repo_root"]))
    executed_steps: list[dict[str, Any]] = []
    bucket_ensurer_fn = bucket_ensurer or ensure_object_store_buckets

    first_command = dict(plan["commands"][0])
    minio_up = _run_command(
        first_command,
        repo_root=repo_root,
        runner=runner,
    )
    executed_steps.append(minio_up)

    bucket_report = bucket_ensurer_fn(repo_root=repo_root)
    executed_steps.append(
        {
            "label": "ensure_object_store_buckets",
            "action": "ensure_object_store_buckets",
            "json": bucket_report,
        }
    )

    recovery_report = execute_local_postgres_recovery(
        dict(plan["recovery_plan"]),
        runner=runner,
    )
    executed_steps.extend(recovery_report["executed_steps"])

    smoke_reports: dict[str, dict[str, Any]] = {}
    for command in plan["commands"][7:]:
        step_report = _run_command(
            dict(command),
            repo_root=repo_root,
            runner=runner,
        )
        executed_steps.append(step_report)
        payload = dict(step_report["json"])
        if command["label"] == "current_scope_validation":
            _validate_current_scope_report(payload)
        elif command["label"] == "bounded_replay_plan":
            _validate_bounded_replay_plan(payload)
        elif command["label"] == "bounded_replay_worker":
            _validate_bounded_replay_worker(payload)
        elif command["label"] == "bounded_replay_show":
            _validate_bounded_replay_show(payload)
        elif command["label"] == "bounded_closeout_validation":
            _validate_closeout_validation(payload)
        elif command["label"] == "bounded_chunk_preparation":
            _validate_chunk_preparation(payload, run_id=str(plan["run_id"]))
        elif command["label"] == "bounded_preparation_validation":
            _validate_preparation_validation(payload, run_id=str(plan["run_id"]))
        smoke_reports[command["label"]] = payload

    return {
        "ok": True,
        "repo_root": str(repo_root),
        "executed_steps": executed_steps,
        "bucket_report": bucket_report,
        "recovery_report": recovery_report,
        "current_scope_validation": smoke_reports["current_scope_validation"],
        "bounded_replay_plan": smoke_reports["bounded_replay_plan"],
        "bounded_replay_worker": smoke_reports["bounded_replay_worker"],
        "bounded_replay_show": smoke_reports["bounded_replay_show"],
        "bounded_closeout_validation": smoke_reports["bounded_closeout_validation"],
        "bounded_chunk_preparation": smoke_reports["bounded_chunk_preparation"],
        "bounded_preparation_validation": smoke_reports["bounded_preparation_validation"],
    }


def ensure_object_store_buckets(*, repo_root: Path) -> dict[str, Any]:
    env_values = parse_env_file(repo_root / ".env")
    settings = ObjectStoreSettings.from_env(env_values)
    client = S3ObjectStoreClientFactory(settings).create()
    created: list[str] = []
    for bucket in (settings.bucket_source, settings.bucket_derived):
        try:
            client.head_bucket(Bucket=bucket)
        except Exception:
            client.create_bucket(Bucket=bucket)
            created.append(bucket)
    return {
        "bucket_source": settings.bucket_source,
        "bucket_derived": settings.bucket_derived,
        "created": created,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the full local Postgres + MinIO smoke chain for authenticated-notice "
            "bounded replay after restoring the local dev substrate."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--preparation-run-id", default=None)
    parser.add_argument("--bounded-notice-id", default=DEFAULT_BOUNDED_NOTICE_ID)
    parser.add_argument("--sample-output-root", type=Path, default=None)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    plan = prepare_local_postgres_smoke(
        repo_root=args.repo_root.resolve(),
        run_id=args.run_id,
        preparation_run_id=args.preparation_run_id,
        bounded_notice_id=args.bounded_notice_id,
        sample_output_root=args.sample_output_root,
    )
    result = (
        {
            "mode": "execute",
            **execute_local_postgres_smoke(plan),
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


def _run_command(
    command: dict[str, Any],
    *,
    repo_root: Path,
    runner: Callable[..., subprocess.CompletedProcess[str]],
) -> dict[str, Any]:
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
        step_report["json"] = _parse_command_json(
            label=str(command["label"]),
            raw_stdout=completed.stdout,
        )
    return step_report


def _parse_command_json(*, label: str, raw_stdout: str) -> dict[str, Any]:
    first_brace = raw_stdout.find("{")
    last_brace = raw_stdout.rfind("}")
    if first_brace == -1 or last_brace == -1 or first_brace > last_brace:
        raise ValueError(f"{label} did not return a JSON object payload")
    payload = json.loads(raw_stdout[first_brace : last_brace + 1])
    if not isinstance(payload, dict):
        raise ValueError(f"{label} returned a non-object JSON payload")
    return payload


def _validate_current_scope_report(payload: dict[str, Any]) -> None:
    if not payload.get("passed"):
        raise ValueError("current scope validation did not pass")
    if str(payload.get("selection_mode") or "") != "current_scope":
        raise ValueError("current scope validation did not report selection_mode=current_scope")


def _validate_bounded_replay_plan(payload: dict[str, Any]) -> None:
    if str(payload.get("state") or "") != "planned":
        raise ValueError("bounded replay planner did not return state=planned")


def _validate_bounded_replay_worker(payload: dict[str, Any]) -> None:
    if str(payload.get("state") or "") != "verified":
        raise ValueError("bounded replay worker did not return state=verified")
    verification = dict(payload.get("verification") or {})
    if verification and not verification.get("ok"):
        raise ValueError("bounded replay worker verification.ok=false")


def _validate_bounded_replay_show(payload: dict[str, Any]) -> None:
    if str(payload.get("state") or "") != "verified":
        raise ValueError("bounded replay show did not return state=verified")


def _validate_closeout_validation(payload: dict[str, Any]) -> None:
    if not payload.get("passed"):
        raise ValueError("bounded closeout validation did not pass")
    if str(payload.get("selection_mode") or "") != "verified_closeout_run":
        raise ValueError(
            "bounded closeout validation did not report selection_mode=verified_closeout_run"
        )


def _validate_chunk_preparation(payload: dict[str, Any], *, run_id: str) -> None:
    if str(payload.get("validation_status") or "") != "passed":
        raise ValueError("bounded chunk preparation did not pass validation")
    closeout_run_id = str(payload.get("closeout_run_id") or "")
    if closeout_run_id and closeout_run_id != run_id:
        raise ValueError(
            f"bounded chunk preparation reported unexpected closeout_run_id: {closeout_run_id}"
        )


def _validate_preparation_validation(payload: dict[str, Any], *, run_id: str) -> None:
    if not payload.get("passed"):
        raise ValueError("bounded preparation validation did not pass")
    if str(payload.get("selection_mode") or "") != "preparation_manifest":
        raise ValueError(
            "bounded preparation validation did not report selection_mode=preparation_manifest"
        )
    closeout_run_id = str(payload.get("closeout_run_id") or "")
    if closeout_run_id and closeout_run_id != run_id:
        raise ValueError(
            f"bounded preparation validation reported unexpected closeout_run_id: {closeout_run_id}"
        )


def _display_path(repo_root: Path, path: Path) -> str:
    resolved_path = path.resolve()
    try:
        return str(resolved_path.relative_to(repo_root))
    except ValueError:
        return str(resolved_path)


def _print_text_report(result: dict[str, Any]) -> None:
    print(f"mode={result['mode']}")
    if result["mode"] == "dry_run":
        print(f"repo_root={result['repo_root']}")
        print("commands=")
        for command in result["commands"]:
            if "argv" in command:
                print("  " + " ".join(str(token) for token in command["argv"]))
            else:
                print(f"  {command['label']}")
        return
    print(f"repo_root={result['repo_root']}")
    print("local_postgres_smoke=ok")


if __name__ == "__main__":
    raise SystemExit(main())
