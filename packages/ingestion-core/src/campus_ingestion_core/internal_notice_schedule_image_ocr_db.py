from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import asdict

from campus_ingestion_core.internal_notice_schedule_image_ocr_constants import (
    DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrAttempt,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)


class InMemoryScheduleImageOcrAttemptStore:
    def __init__(self) -> None:
        self.attempts: list[ScheduleImageOcrAttempt] = []

    def record(self, attempt: ScheduleImageOcrAttempt) -> None:
        self.attempts.append(attempt)


class PostgresScheduleImageOcrAttemptStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice schedule image OCR attempt database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, attempt: ScheduleImageOcrAttempt) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    attachment_ref_id,
                    image_index,
                    attempt_number,
                    admission_batch_id,
                    provider,
                    model,
                    status,
                    confidence,
                    provider_response_key,
                    layout_elements_key,
                    ocr_manifest_key,
                    run_id,
                    error,
                    created_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                on conflict (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    attachment_ref_id,
                    image_index,
                    attempt_number
                )
                do update set
                    admission_batch_id = excluded.admission_batch_id,
                    provider = excluded.provider,
                    model = excluded.model,
                    status = excluded.status,
                    confidence = excluded.confidence,
                    provider_response_key = excluded.provider_response_key,
                    layout_elements_key = excluded.layout_elements_key,
                    ocr_manifest_key = excluded.ocr_manifest_key,
                    run_id = excluded.run_id,
                    error = excluded.error,
                    created_at = excluded.created_at,
                    record = excluded.record
                """,
                (
                    attempt.source_corpus,
                    attempt.source_collection,
                    attempt.source_notice_id,
                    attempt.attachment_ref_id,
                    attempt.image_index,
                    attempt.attempt_number,
                    attempt.admission_batch_id,
                    attempt.provider,
                    attempt.model,
                    attempt.status,
                    attempt.confidence,
                    attempt.provider_response_key,
                    attempt.layout_elements_key,
                    attempt.ocr_manifest_key,
                    attempt.run_id,
                    attempt.error,
                    attempt.created_at,
                    json.dumps(asdict(attempt), ensure_ascii=False),
                ),
            )

    def list_by_image(
        self,
        *,
        source_notice_id: str,
        attachment_ref_id: str,
        image_index: int,
    ) -> tuple[ScheduleImageOcrAttempt, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record from {table_sql}
                where source_notice_id = %s
                  and attachment_ref_id = %s
                  and image_index = %s
                order by attempt_number asc
                """,
                (source_notice_id, attachment_ref_id, image_index),
            )
            rows = cursor.fetchall()
        attempts: list[ScheduleImageOcrAttempt] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["image_index"] = int(payload.get("image_index") or 0)
            payload["attempt_number"] = int(payload.get("attempt_number") or 1)
            attempts.append(ScheduleImageOcrAttempt(**payload))
        return tuple(attempts)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    source_corpus text not null,
                    source_collection text not null,
                    source_notice_id text not null,
                    attachment_ref_id text not null,
                    image_index integer not null,
                    attempt_number integer not null,
                    admission_batch_id text not null default '',
                    provider text not null,
                    model text not null,
                    status text not null,
                    confidence text not null,
                    provider_response_key text not null,
                    layout_elements_key text not null,
                    ocr_manifest_key text not null,
                    run_id text not null default '',
                    error text not null default '',
                    created_at timestamptz not null,
                    record jsonb not null,
                    primary key (
                        source_corpus,
                        source_collection,
                        source_notice_id,
                        attachment_ref_id,
                        image_index,
                        attempt_number
                    )
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_notice
                on {table_sql} (source_corpus, source_collection, source_notice_id)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_admission
                on {table_sql} (source_corpus, source_collection, admission_batch_id)
                """
            )


def build_schedule_image_ocr_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresScheduleImageOcrAttemptStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = _schedule_ocr_operator_database_url(source)
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} "
                "is required when prefer_operator=True"
            )
        return PostgresScheduleImageOcrAttemptStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = _schedule_ocr_runtime_database_url(source)
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY} or "
            f"{SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresScheduleImageOcrAttemptStore(database_url=database_url)


def _schedule_ocr_operator_database_url(source: Mapping[str, str]) -> str:
    return (
        source.get(DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_OPERATOR_ENV_KEY)
        or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or ""
    ).strip()


def _schedule_ocr_runtime_database_url(source: Mapping[str, str]) -> str:
    return (
        source.get(DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
