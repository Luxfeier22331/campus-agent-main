from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any, Protocol

from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask

DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS = 300
DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE = "ingestion_queue.official_web_release_tasks"
OFFICIAL_WEB_RELEASE_TASK_DATABASE_ENV_KEY = "OFFICIAL_WEB_RELEASE_TASK_DATABASE_URL"
OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_ENV_KEY = (
    "OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_URL"
)


class OfficialWebReleaseTaskStoreError(RuntimeError):
    pass


class OfficialWebReleaseTaskConflictError(OfficialWebReleaseTaskStoreError):
    pass


class OfficialWebReleaseTaskLeaseError(OfficialWebReleaseTaskStoreError):
    pass


class OfficialWebReleaseTaskNotFoundError(OfficialWebReleaseTaskStoreError):
    pass


class OfficialWebReleaseTaskStore(Protocol):
    def create_or_get_task(self, task: OfficialWebReleaseTask) -> OfficialWebReleaseTask: ...

    def get_task(self, task_id: str) -> OfficialWebReleaseTask | None: ...

    def claim_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask | None: ...

    def claim_next_task(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
        task_types: Sequence[str] = (),
    ) -> OfficialWebReleaseTask | None: ...

    def heartbeat_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_running(
        self,
        task_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_materialized(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_published(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_indexed(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def fail_task_retryable(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def fail_task_terminal(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def list_tasks(
        self,
        *,
        limit: int = 100,
        include_terminal: bool = True,
    ) -> tuple[OfficialWebReleaseTask, ...]: ...
