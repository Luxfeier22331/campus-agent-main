from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.official_web_release_task import (
    OFFICIAL_WEB_RELEASE_TASK_TYPES,
    OfficialWebReleaseTask,
)
from campus_ingestion_core.official_web_release_task_projection import (
    build_official_web_release_task_operator_snapshot,
)
from campus_ingestion_core.official_web_release_task_store import (
    DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
    OfficialWebReleaseTaskStore,
    build_official_web_release_task_store_from_env,
)
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_release_task_projection_reporting import (
    build_official_web_release_task_projection_reporter_from_env,
)
from campus_ingestion_worker.release_official_web_selected_write import (
    release_official_web_selected_write,
)
from campus_ingestion_worker.release_official_web_target import release_official_web_target


class OfficialWebReleaseTaskProjectionReporter(Protocol):
    def report(self, *, snapshots: Sequence[Mapping[str, Any]]) -> None: ...


ReleaseTargetFunc = Callable[..., object]
ReleaseSelectedWriteFunc = Callable[..., object]


@dataclass(frozen=True, slots=True)
class OfficialWebReleaseTaskRunResult:
    task_id: str
    task_type: str
    status: str
    output_ref: dict[str, Any]


TERMINAL_FAILURE_CODES = frozenset(
    {
        "invalid_json",
        "invalid_payload",
        "missing_release_projection_document",
        "missing_selected_write_candidate",
        "release_task_not_claimed",
        "unsupported_release_task_type",
        "unsupported_selected_write_target",
    }
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Claim and execute one ingestion-owned official_web release task.",
    )
    parser.add_argument("--worker-id", default="official-web-release-task-runner")
    parser.add_argument(
        "--lease-seconds", type=int, default=DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS
    )
    parser.add_argument("--work-dir", default="./var/official-web-release-tasks")
    parser.add_argument("--source-bucket", default=DEFAULT_BUCKET_SOURCE)
    parser.add_argument("--derived-bucket")
    parser.add_argument("--declarations-path")
    parser.add_argument("--reset-index", action="store_true")
    parser.add_argument("--task-id")
    parser.add_argument(
        "--task-type",
        action="append",
        choices=sorted(OFFICIAL_WEB_RELEASE_TASK_TYPES),
        default=[],
    )
    return parser


def run_official_web_release_task_once(
    *,
    release_store: OfficialWebReleaseTaskStore,
    worker_id: str,
    work_dir: Path,
    object_store: object,
    derived_object_store: object,
    projection_reporter: OfficialWebReleaseTaskProjectionReporter | None = None,
    release_target_func: ReleaseTargetFunc | None = release_official_web_target,
    release_selected_write_func: ReleaseSelectedWriteFunc
    | None = release_official_web_selected_write,
    document_registry: object | None = None,
    raw_asset_registry: object | None = None,
    structured_projection_publisher: object | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    source_bucket: str = DEFAULT_BUCKET_SOURCE,
    derived_bucket: str | None = None,
    declarations_path: Path | None = None,
    reset_index: bool = False,
    lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
    task_id: str = "",
    task_types: Sequence[str] = (),
    now: Callable[[], object] | None = None,
) -> OfficialWebReleaseTaskRunResult | None:
    normalized_task_id = str(task_id or "").strip()
    if normalized_task_id:
        task = release_store.claim_task(
            normalized_task_id,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
            now=_now(now),
        )
    else:
        task = release_store.claim_next_task(
            worker_id=worker_id,
            lease_seconds=lease_seconds,
            now=_now(now),
            task_types=task_types,
        )
    if task is None:
        return None
    _report_task(projection_reporter, task)
    try:
        running = release_store.mark_task_running(
            task.task_id,
            worker_id=worker_id,
            now=_now(now),
        )
        _report_task(projection_reporter, running)
        store_backed_reporter = _StoreBackedReleaseProjectionReporter(
            projection_reporter=projection_reporter,
            release_store=release_store,
            worker_id=worker_id,
        )
        result = _dispatch_release_task(
            task=running,
            work_dir=work_dir,
            object_store=object_store,
            derived_object_store=derived_object_store,
            release_target_func=release_target_func,
            release_selected_write_func=release_selected_write_func,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            structured_projection_publisher=structured_projection_publisher,
            projection_reporter=store_backed_reporter,
            object_store_settings=object_store_settings,
            source_bucket=source_bucket,
            derived_bucket=derived_bucket,
            declarations_path=declarations_path,
            reset_index=reset_index,
        )
        output_ref = _output_ref_from_result(result)
        final_status = _status_from_result(result)
        final_task = release_store.get_task(running.task_id)
        if final_task is None:
            raise RuntimeError(f"official web release task disappeared: {running.task_id}")
        if final_task.status not in {"indexed", "published"}:
            if final_status == "indexed":
                final_task = release_store.mark_task_indexed(
                    running.task_id,
                    output_ref=output_ref,
                    worker_id=worker_id,
                    now=_now(now),
                )
            else:
                final_task = release_store.mark_task_published(
                    running.task_id,
                    output_ref=output_ref,
                    worker_id=worker_id,
                    now=_now(now),
                )
            _report_task(projection_reporter, final_task)
        else:
            output_ref = dict(final_task.output_ref or output_ref)
        return OfficialWebReleaseTaskRunResult(
            task_id=final_task.task_id,
            task_type=final_task.task_type,
            status=final_task.status,
            output_ref=output_ref,
        )
    except Exception as exc:
        error_code = _error_code(exc)
        if _is_retryable(exc):
            failed = release_store.fail_task_retryable(
                task.task_id,
                error_code=error_code,
                error_message=str(exc),
                worker_id=worker_id,
                now=_now(now),
            )
        else:
            failed = release_store.fail_task_terminal(
                task.task_id,
                error_code=error_code,
                error_message=str(exc),
                worker_id=worker_id,
                now=_now(now),
            )
        _report_task(projection_reporter, failed)
        return OfficialWebReleaseTaskRunResult(
            task_id=failed.task_id,
            task_type=failed.task_type,
            status=failed.status,
            output_ref=dict(failed.output_ref or {}),
        )


def _dispatch_release_task(
    *,
    task: OfficialWebReleaseTask,
    work_dir: Path,
    object_store: object,
    derived_object_store: object,
    release_target_func: ReleaseTargetFunc | None,
    release_selected_write_func: ReleaseSelectedWriteFunc | None,
    document_registry: object | None,
    raw_asset_registry: object | None,
    structured_projection_publisher: object | None,
    projection_reporter: object,
    object_store_settings: ObjectStoreSettings | None,
    source_bucket: str,
    derived_bucket: str | None,
    declarations_path: Path | None,
    reset_index: bool,
) -> object:
    task_work_dir = work_dir / task.task_id
    if task.task_type == "official_web_stable_reference":
        if release_target_func is None:
            raise RuntimeError("stable-reference release function is not configured")
        return release_target_func(
            release_task=task,
            object_store=object_store,
            derived_object_store=derived_object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            projection_reporter=projection_reporter,
            work_dir=task_work_dir,
            object_store_settings=object_store_settings,
            source_bucket=source_bucket,
            declarations_path=declarations_path,
            reset_index=reset_index,
        )
    if task.task_type in {
        "official_web_selected_write_contact_directory",
        "official_web_selected_write_service_guide",
    }:
        if release_selected_write_func is None:
            raise RuntimeError("selected-write release function is not configured")
        return release_selected_write_func(
            release_task=task,
            object_store=object_store,
            derived_object_store=derived_object_store,
            structured_projection_publisher=structured_projection_publisher,
            projection_reporter=projection_reporter,
            work_dir=task_work_dir,
            object_store_settings=object_store_settings,
            source_bucket=source_bucket,
            derived_bucket=derived_bucket,
            declarations_path=declarations_path,
        )
    raise RuntimeError(f"unsupported official web release task type: {task.task_type}")


class _StoreBackedReleaseProjectionReporter:
    def __init__(
        self,
        *,
        projection_reporter: OfficialWebReleaseTaskProjectionReporter | None,
        release_store: OfficialWebReleaseTaskStore,
        worker_id: str,
    ) -> None:
        self._projection_reporter = projection_reporter
        self._release_store = release_store
        self._worker_id = worker_id

    def report(self, *, snapshot: Mapping[str, Any]) -> None:
        task_id = str(snapshot.get("taskId") or "").strip()
        status = str(snapshot.get("status") or "").strip()
        if not task_id:
            return
        task = self._release_store.get_task(task_id)
        if task is None:
            return
        try:
            if status == "materialized" and task.status != "materialized":
                task = self._release_store.mark_task_materialized(
                    task_id,
                    output_ref=_output_ref_from_snapshot(snapshot),
                    worker_id=self._worker_id,
                )
            elif status == "published" and task.status != "published":
                task = self._release_store.mark_task_published(
                    task_id,
                    output_ref=_output_ref_from_snapshot(snapshot),
                    worker_id=self._worker_id,
                )
            elif status == "indexed" and task.status != "indexed":
                task = self._release_store.mark_task_indexed(
                    task_id,
                    output_ref=_output_ref_from_snapshot(snapshot),
                    worker_id=self._worker_id,
                )
            else:
                return
        except Exception:
            return
        _report_task(self._projection_reporter, task)


def _report_task(
    projection_reporter: OfficialWebReleaseTaskProjectionReporter | None,
    task: OfficialWebReleaseTask,
) -> None:
    if projection_reporter is None:
        return
    projection_reporter.report(snapshots=(build_official_web_release_task_operator_snapshot(task),))


def _output_ref_from_snapshot(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    output_ref = {
        "releaseId": snapshot.get("releaseId"),
        "runId": snapshot.get("runId"),
        "status": snapshot.get("status"),
    }
    execution = snapshot.get("execution")
    if isinstance(execution, Mapping):
        output_ref.update(dict(execution))
    return {key: value for key, value in output_ref.items() if value not in (None, "")}


def _output_ref_from_result(result: object) -> dict[str, Any]:
    payload = _jsonable(result)
    return {
        key: value
        for key, value in payload.items()
        if key
        in {
            "collection",
            "corpus",
            "document_ids",
            "record_count",
            "release_id",
            "releaseId",
            "selected_write_id",
            "source_bundle_key",
            "status",
        }
        and value not in (None, "")
    }


def _status_from_result(result: object) -> str:
    payload = _jsonable(result)
    status = str(payload.get("status") or "").strip()
    return status if status in {"indexed", "published"} else "published"


def _jsonable(value: object) -> dict[str, Any]:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "__dict__"):
        return dict(value.__dict__)
    return {"value": str(value)}


def _error_code(exc: Exception) -> str:
    return str(getattr(exc, "code", "") or exc.__class__.__name__).strip()


def _is_retryable(exc: Exception) -> bool:
    retryable = getattr(exc, "retryable", None)
    if retryable is not None:
        return bool(retryable)
    return _error_code(exc) not in TERMINAL_FAILURE_CODES


def _now(now: Callable[[], object] | None) -> Any:
    if now is None:
        return None
    return now()


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    result = run_official_web_release_task_once(
        release_store=build_official_web_release_task_store_from_env(),
        worker_id=args.worker_id,
        lease_seconds=args.lease_seconds,
        task_types=tuple(args.task_type or ()),
        object_store=object_store,
        derived_object_store=object_store,
        document_registry=build_document_registry_from_env(prefer_operator=True),
        raw_asset_registry=build_raw_asset_registry_from_env(prefer_operator=True),
        structured_projection_publisher=build_structured_projection_publisher_from_env(),
        projection_reporter=build_official_web_release_task_projection_reporter_from_env(),
        work_dir=Path(args.work_dir).resolve(),
        object_store_settings=settings,
        source_bucket=args.source_bucket,
        derived_bucket=args.derived_bucket,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
        reset_index=args.reset_index,
        task_id=args.task_id or "",
    )
    print(json.dumps(None if result is None else asdict(result), ensure_ascii=False, indent=2))


__all__ = [
    "OfficialWebReleaseTaskProjectionReporter",
    "OfficialWebReleaseTaskRunResult",
    "build_parser",
    "main",
    "run_official_web_release_task_once",
]


if __name__ == "__main__":
    main()
