from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from campus_ingestion_core.official_web_release_task import build_official_web_release_task
from campus_ingestion_core.official_web_release_task_store import (
    DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE,
    OfficialWebReleaseTaskStore,
    build_official_web_release_task_store_from_env,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_release_task_projection_reporting import (
    HttpOfficialWebReleaseTaskProjectionReporter,
)
from campus_ingestion_worker.run_official_web_release_task import (
    run_official_web_release_task_once,
)

SMOKE_SCHEMA_VERSION = "official_web_release_task_local_smoke.v1"
DEFAULT_SMOKE_RELEASE_TASK_TABLE = f"{DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE}_smoke"


@dataclass(frozen=True, slots=True)
class _SmokeReleaseResult:
    status: str = "published"
    release_id: str = "release_local_smoke"
    corpus: str = "campus_services"
    collection: str = "contact_directory"
    record_count: int = 1
    document_ids: tuple[str, ...] = ("official-web-release-task-local-smoke",)
    source_bundle_key: str = (
        "official_web/campus_public/runs/owrun_local_smoke/source-truth-bundle.json"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run a local official_web release-task integration smoke against app-api projection."
        )
    )
    parser.add_argument(
        "--app-api-base-url", default=os.getenv("INGESTION_WORKER_APP_API_BASE_URL")
    )
    parser.add_argument(
        "--app-api-internal-shared-secret",
        default=os.getenv("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET"),
    )
    parser.add_argument(
        "--operator-email",
        default=os.getenv("APP_API_RELEASE_TASK_SMOKE_OPERATOR_EMAIL", "ops@example.com"),
    )
    parser.add_argument("--task-id")
    parser.add_argument("--release-task-table-name", default=DEFAULT_SMOKE_RELEASE_TASK_TABLE)
    parser.add_argument("--worker-id", default="official-web-release-task-local-smoke")
    parser.add_argument("--work-dir", default="./var/official-web-release-task-local-smoke")
    return parser


def run_official_web_release_task_local_smoke(
    *,
    app_api_base_url: str,
    app_api_internal_shared_secret: str,
    operator_email: str,
    release_store: OfficialWebReleaseTaskStore,
    task_id: str | None = None,
    worker_id: str = "official-web-release-task-local-smoke",
    work_dir: Path = Path("./var/official-web-release-task-local-smoke"),
) -> dict[str, Any]:
    base_url = _required_text(app_api_base_url, "app_api_base_url").rstrip("/")
    internal_secret = _required_text(
        app_api_internal_shared_secret, "app_api_internal_shared_secret"
    )
    operator = _required_text(operator_email, "operator_email")
    resolved_task_id = task_id or _default_task_id()
    task = build_official_web_release_task(
        input_ref={
            "sourceObjectKeys": [
                "official_web/campus_public/runs/owrun_local_smoke/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/"],
        },
        inventory_id="official-web-release-task-local-smoke",
        job_id="official-web-release-task-local-smoke",
        run_id="owrun_local_smoke",
        selected_write_target="campus_services/contact_directory",
        task_id=resolved_task_id,
        task_type="official_web_selected_write_contact_directory",
        now=datetime.now(tz=UTC),
    )
    release_store.create_or_get_task(task)

    reporter = HttpOfficialWebReleaseTaskProjectionReporter(
        base_url=base_url,
        internal_shared_secret=internal_secret,
    )
    result = run_official_web_release_task_once(
        derived_object_store=object(),
        object_store=object(),
        projection_reporter=reporter,
        release_selected_write_func=_fake_selected_write_release,
        release_store=release_store,
        release_target_func=None,
        structured_projection_publisher=object(),
        worker_id=worker_id,
        work_dir=work_dir,
        task_types=("official_web_selected_write_contact_directory",),
    )
    if result is None:
        raise RuntimeError("official web release task smoke found no claimable task")
    if result.task_id != resolved_task_id:
        raise RuntimeError(
            "official web release task smoke claimed an unexpected task: "
            f"{result.task_id}; expected {resolved_task_id}"
        )

    task_projection = _fetch_task_projection(
        base_url=base_url,
        internal_secret=internal_secret,
        operator_email=operator,
        task_id=resolved_task_id,
    )
    lifecycle_status = str(task_projection.get("lifecycleStatus") or "")
    return {
        "schema_version": SMOKE_SCHEMA_VERSION,
        "status": "passed" if lifecycle_status == "published" else "failed",
        "releaseTaskRunner": asdict(result),
        "task": task_projection,
    }


def _fake_selected_write_release(**_: object) -> _SmokeReleaseResult:
    return _SmokeReleaseResult()


def _fetch_task_projection(
    *,
    base_url: str,
    internal_secret: str,
    operator_email: str,
    task_id: str,
) -> dict[str, Any]:
    encoded = urllib_parse.quote(task_id, safe="")
    request = urllib_request.Request(
        f"{base_url}/api/operator/official-web/release-tasks/{encoded}",
        headers={
            "accept": "application/json",
            "x-app-internal-auth": internal_secret,
            "x-app-operator-email": operator_email,
            "x-app-operator-id": operator_email,
            "x-app-operator-name": "Official Web Release Task Smoke",
        },
        method="GET",
    )
    with urllib_request.urlopen(request) as response:
        payload = json.loads(response.read().decode("utf-8"))
    task = payload.get("task")
    if not isinstance(task, dict):
        raise RuntimeError("app-api release task detail response did not include task object")
    return task


def _default_task_id() -> str:
    stamp = datetime.now(tz=UTC).strftime("%Y%m%d%H%M%S")
    return f"owrelease_local_smoke_{stamp}"


def _required_text(value: str | None, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def main(argv: list[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(argv)
    report = run_official_web_release_task_local_smoke(
        app_api_base_url=args.app_api_base_url,
        app_api_internal_shared_secret=args.app_api_internal_shared_secret,
        operator_email=args.operator_email,
        release_store=build_official_web_release_task_store_from_env(
            table_name=args.release_task_table_name
        ),
        task_id=args.task_id,
        worker_id=args.worker_id,
        work_dir=Path(args.work_dir).resolve(),
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
