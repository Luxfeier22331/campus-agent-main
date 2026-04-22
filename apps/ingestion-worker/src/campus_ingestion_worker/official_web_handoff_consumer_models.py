from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol
from urllib import error as urllib_error
from urllib import request as urllib_request

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
)

OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION = "official_web_handoff_consume_report.v1"
_DEFAULT_MINIMUM_PROMOTE_PAGES = 2
_DEFAULT_MINIMUM_SEED_COVERAGE_RATIO = 0.5
_DEFAULT_MINIMUM_HOST_COVERAGE_RATIO = 0.5
_PROMOTION_DISALLOWED_PAGE_FAMILIES = frozenset(
    {"listing_page", "generic_content_page", "dynamic_shell_page", "structural_shell_page"}
)


class OfficialWebSourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class OfficialWebDerivedObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


class OfficialWebExecutionStatusReporter(Protocol):
    def report(self, *, run_id: str, payload: dict[str, object]) -> None: ...


class OfficialWebHandoffConsumeError(RuntimeError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _read_bool_env(name: str) -> bool:
    value = os.getenv(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _read_positive_int_env(name: str, *, default: int) -> int:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return parsed


def _read_ratio_env(name: str, *, default: float) -> float:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    parsed = float(value)
    if parsed < 0 or parsed > 1:
        raise ValueError(f"{name} must be between 0 and 1.")
    return parsed


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffConsumerSettings:
    app_name: str = "campus-ingestion-worker"
    inbox_dir: Path = Path("./var/official-web-handoffs")
    execution_root_dir: Path = Path("./var/official-web-handoff-executions")
    source_bucket: str = DEFAULT_BUCKET_SOURCE
    promote_import: bool = False
    minimum_promote_pages: int = _DEFAULT_MINIMUM_PROMOTE_PAGES
    minimum_seed_coverage_ratio: float = _DEFAULT_MINIMUM_SEED_COVERAGE_RATIO
    minimum_host_coverage_ratio: float = _DEFAULT_MINIMUM_HOST_COVERAGE_RATIO

    @classmethod
    def from_env(cls) -> OfficialWebHandoffConsumerSettings:
        object_store_settings = ObjectStoreSettings.from_env()
        inbox_dir = os.getenv(
            "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR",
            "./var/official-web-handoffs",
        ).strip()
        execution_root_dir = os.getenv(
            "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_EXECUTION_ROOT_DIR",
            "./var/official-web-handoff-executions",
        ).strip()
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", "campus-ingestion-worker").strip()
            or "campus-ingestion-worker",
            inbox_dir=Path(inbox_dir or "./var/official-web-handoffs"),
            execution_root_dir=Path(execution_root_dir or "./var/official-web-handoff-executions"),
            source_bucket=object_store_settings.bucket_source,
            promote_import=_read_bool_env("INGESTION_WORKER_OFFICIAL_WEB_PROMOTE_IMPORT"),
            minimum_promote_pages=_read_positive_int_env(
                "INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_PROMOTE_PAGES",
                default=_DEFAULT_MINIMUM_PROMOTE_PAGES,
            ),
            minimum_seed_coverage_ratio=_read_ratio_env(
                "INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_SEED_COVERAGE_RATIO",
                default=_DEFAULT_MINIMUM_SEED_COVERAGE_RATIO,
            ),
            minimum_host_coverage_ratio=_read_ratio_env(
                "INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_HOST_COVERAGE_RATIO",
                default=_DEFAULT_MINIMUM_HOST_COVERAGE_RATIO,
            ),
        )


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffConsumeResult:
    event_id: str
    status: Literal["staged", "promoted", "failed", "skipped"]
    attempt_count: int
    record_path: str
    execution_report_path: str | None
    projection_output_dir: str | None
    replay_input_dir: str | None
    error: dict[str, object] | None = None


class HttpOfficialWebExecutionStatusReporter:
    def __init__(self, *, base_url: str, internal_shared_secret: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret

    def report(self, *, run_id: str, payload: dict[str, object]) -> None:
        request = urllib_request.Request(
            f"{self._base_url}/api/internal/official-web/runs/{run_id}/ingestion-execution",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(request) as response:
                if response.status < 200 or response.status >= 300:
                    raise OfficialWebHandoffConsumeError(
                        code="execution_status_update_failed",
                        message=(
                            "official_web execution status callback returned "
                            f"unexpected status {response.status}."
                        ),
                    )
        except urllib_error.HTTPError as exc:
            raise OfficialWebHandoffConsumeError(
                code="execution_status_update_failed",
                message=f"official_web execution status callback failed: {exc.code}",
            ) from exc
        except urllib_error.URLError as exc:
            raise OfficialWebHandoffConsumeError(
                code="execution_status_update_failed",
                message=f"official_web execution status callback failed: {exc.reason}",
            ) from exc


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffConsumeBatchReport:
    schema_version: str
    generated_at: str
    app_name: str
    inbox_dir: str
    execution_root_dir: str
    results: list[OfficialWebHandoffConsumeResult]
    counts: dict[str, int]
