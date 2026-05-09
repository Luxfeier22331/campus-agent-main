from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest

AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION = "authenticated_notice_run_queue_consume.v1"
AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_TRACE_SCHEMA_VERSION = (
    "authenticated_notice_run_queue_consume_trace.v1"
)
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID = "authenticated-notice-run-queue-consumer"
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT = 10
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS = 300


class AuthenticatedNoticeRunQueueImportCallable(Protocol):
    def __call__(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        env: dict[str, str] | None = None,
        object_store: object | None = None,
    ) -> Mapping[str, Any]: ...


class AuthenticatedNoticeTypedDownstreamMaterializer(Protocol):
    def __call__(
        self,
        *,
        import_result: Mapping[str, Any],
        env: dict[str, str],
        object_store: object,
        operations_dir: Path,
        consumer_admission_manifest_path: Path,
        source_corpus: str,
        source_collection: str,
        run_id: str,
        job_id: str,
        generated_at: str,
    ) -> Mapping[str, Any]: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRunQueueConsumeResult:
    queue_consume: dict[str, Any]
    trace: dict[str, Any]
    failed_report: dict[str, Any]

    def to_output_files(self) -> dict[str, dict[str, Any]]:
        main_filename = (
            "authenticated-notice-run-queue-consume.execute.json"
            if self.queue_consume.get("mode") == "execute"
            else "authenticated-notice-run-queue-consume.dry-run.json"
        )
        return {
            main_filename: self.queue_consume,
            "authenticated-notice-run-queue-consume.trace.json": self.trace,
            "authenticated-notice-run-queue-consume-failed-report.json": self.failed_report,
        }
