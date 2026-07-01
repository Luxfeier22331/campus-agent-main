from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.notice_consumption_projection import normalize_notice_ids
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired

DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY = (
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE = (
    "ingestion_projection.internal_notice_consumption_admission"
)
DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE = (
    "ingestion_projection.internal_notice_consumption_admission_event"
)


@dataclass(frozen=True, slots=True)
class InternalNoticeConsumptionAdmissionRecord:
    batch_id: str
    source_corpus: str
    source_collection: str
    command: str
    selected_notice_ids: tuple[str, ...]
    status: str
    result_counts: dict[str, int]
    created_at: str
    error: str = ""
    selection_source: str = ""
    selection_path: str = ""
    selection_sha256: str = ""
    command_args: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class InternalNoticeConsumptionAdmissionEventRecord:
    event_id: str
    batch_id: str
    source_corpus: str
    source_collection: str
    command: str
    selected_notice_ids: tuple[str, ...]
    status: str
    result_counts: dict[str, int]
    created_at: str
    event_created_at: str
    error: str = ""
    selection_source: str = ""
    selection_path: str = ""
    selection_sha256: str = ""
    command_args: dict[str, object] = field(default_factory=dict)


class InternalNoticeConsumptionAdmissionStore(Protocol):
    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None: ...


class InMemoryInternalNoticeConsumptionAdmissionStore:
    def __init__(
        self,
        records: Sequence[InternalNoticeConsumptionAdmissionRecord] = (),
        events: Sequence[InternalNoticeConsumptionAdmissionEventRecord] = (),
    ) -> None:
        self._records_by_batch = {record.batch_id: record for record in records}
        self._events = list(events) or [
            build_internal_notice_consumption_admission_event_record(
                record,
                event_created_at=record.created_at,
            )
            for record in records
        ]

    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None:
        self._records_by_batch[record.batch_id] = record
        self._events.append(build_internal_notice_consumption_admission_event_record(record))

    def list_records(
        self,
        *,
        source_corpus: str | None = None,
        source_collection: str | None = None,
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
        statuses: Sequence[str] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionRecord, ...]:
        normalized_notice_ids = set(normalize_notice_ids(notice_ids))
        normalized_commands = {item.strip() for item in commands if item.strip()}
        normalized_statuses = {item.strip() for item in statuses if item.strip()}
        records = [
            record
            for record in self._records_by_batch.values()
            if (source_corpus is None or record.source_corpus == source_corpus)
            and (source_collection is None or record.source_collection == source_collection)
            and (
                not normalized_notice_ids
                or bool(normalized_notice_ids.intersection(record.selected_notice_ids))
            )
            and (not normalized_commands or record.command in normalized_commands)
            and (not normalized_statuses or record.status in normalized_statuses)
        ]
        return tuple(records[: max(1, int(limit))])

    def list_events(
        self,
        *,
        source_corpus: str | None = None,
        source_collection: str | None = None,
        batch_ids: Sequence[str] = (),
        notice_ids: Sequence[str] = (),
        commands: Sequence[str] = (),
        statuses: Sequence[str] = (),
        limit: int = 100,
    ) -> tuple[InternalNoticeConsumptionAdmissionEventRecord, ...]:
        normalized_batch_ids = {item.strip() for item in batch_ids if item.strip()}
        normalized_notice_ids = set(normalize_notice_ids(notice_ids))
        normalized_commands = {item.strip() for item in commands if item.strip()}
        normalized_statuses = {item.strip() for item in statuses if item.strip()}
        events = [
            event
            for event in self._events
            if (source_corpus is None or event.source_corpus == source_corpus)
            and (source_collection is None or event.source_collection == source_collection)
            and (not normalized_batch_ids or event.batch_id in normalized_batch_ids)
            and (
                not normalized_notice_ids
                or bool(normalized_notice_ids.intersection(event.selected_notice_ids))
            )
            and (not normalized_commands or event.command in normalized_commands)
            and (not normalized_statuses or event.status in normalized_statuses)
        ]
        return tuple(events[: max(1, int(limit))])


def build_internal_notice_consumption_admission_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> InternalNoticeConsumptionAdmissionStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("internal notice consumption admission")


def record_internal_notice_consumption_admission(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    command: str,
    notice_ids: Sequence[str],
    result_counts: Mapping[str, int] | None = None,
    status: str = "completed",
    batch_id: str | None = None,
    created_at: str | None = None,
    error: str = "",
    selection_source: str = "",
    selection_path: str = "",
    selection_sha256: str = "",
    command_args: Mapping[str, object] | None = None,
    store: InternalNoticeConsumptionAdmissionStore | None = None,
) -> str:
    record = build_internal_notice_consumption_admission_record(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        notice_ids=notice_ids,
        result_counts=result_counts,
        status=status,
        batch_id=batch_id,
        created_at=created_at,
        error=error,
        selection_source=selection_source,
        selection_path=selection_path,
        selection_sha256=selection_sha256,
        command_args=command_args,
    )
    if store is not None:
        store.record(record)
    return record.batch_id


def build_internal_notice_consumption_admission_record(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    command: str,
    notice_ids: Sequence[str],
    result_counts: Mapping[str, int] | None = None,
    status: str = "completed",
    batch_id: str | None = None,
    created_at: str | None = None,
    error: str = "",
    selection_source: str = "",
    selection_path: str = "",
    selection_sha256: str = "",
    command_args: Mapping[str, object] | None = None,
) -> InternalNoticeConsumptionAdmissionRecord:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    normalized_created_at = created_at or utc_now()
    normalized_batch_id = batch_id or _build_batch_id(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        notice_ids=normalized_notice_ids,
        created_at=normalized_created_at,
    )
    return InternalNoticeConsumptionAdmissionRecord(
        batch_id=normalized_batch_id,
        source_corpus=source_corpus,
        source_collection=source_collection,
        command=command,
        selected_notice_ids=normalized_notice_ids,
        status=status,
        result_counts=dict(result_counts or {}),
        created_at=normalized_created_at,
        error=error,
        selection_source=str(selection_source or ""),
        selection_path=str(selection_path or ""),
        selection_sha256=str(selection_sha256 or ""),
        command_args=dict(command_args or {}),
    )


def build_internal_notice_consumption_admission_event_record(
    record: InternalNoticeConsumptionAdmissionRecord,
    *,
    event_created_at: str | None = None,
) -> InternalNoticeConsumptionAdmissionEventRecord:
    normalized_event_created_at = event_created_at or utc_now()
    event_payload = {
        "batch_id": record.batch_id,
        "source_corpus": record.source_corpus,
        "source_collection": record.source_collection,
        "command": record.command,
        "selected_notice_ids": list(record.selected_notice_ids),
        "status": record.status,
        "result_counts": record.result_counts,
        "created_at": record.created_at,
        "event_created_at": normalized_event_created_at,
        "error": record.error,
        "selection_source": record.selection_source,
        "selection_path": record.selection_path,
        "selection_sha256": record.selection_sha256,
        "command_args": record.command_args,
    }
    digest = hashlib.sha256(
        json.dumps(event_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    return InternalNoticeConsumptionAdmissionEventRecord(
        event_id=f"{record.batch_id}:event:{digest}",
        batch_id=record.batch_id,
        source_corpus=record.source_corpus,
        source_collection=record.source_collection,
        command=record.command,
        selected_notice_ids=record.selected_notice_ids,
        status=record.status,
        result_counts=dict(record.result_counts),
        created_at=record.created_at,
        event_created_at=normalized_event_created_at,
        error=record.error,
        selection_source=record.selection_source,
        selection_path=record.selection_path,
        selection_sha256=record.selection_sha256,
        command_args=dict(record.command_args),
    )


def _build_batch_id(
    *,
    source_corpus: str,
    source_collection: str,
    command: str,
    notice_ids: Sequence[str],
    created_at: str,
) -> str:
    digest = hashlib.sha256(
        "|".join(
            (source_corpus, source_collection, command, ",".join(notice_ids), created_at)
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"internal_notice_consumption:{command}:{digest}"


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_EVENT_TABLE",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_CONSUMPTION_ADMISSION_TABLE",
    "InMemoryInternalNoticeConsumptionAdmissionStore",
    "InternalNoticeConsumptionAdmissionEventRecord",
    "InternalNoticeConsumptionAdmissionRecord",
    "InternalNoticeConsumptionAdmissionStore",
    "build_internal_notice_consumption_admission_event_record",
    "build_internal_notice_consumption_admission_record",
    "build_internal_notice_consumption_admission_store_from_env",
    "record_internal_notice_consumption_admission",
]
