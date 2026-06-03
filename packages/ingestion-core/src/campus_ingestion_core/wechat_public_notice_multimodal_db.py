from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict

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
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY,
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeMultimodalAttempt,
)


class InMemoryWeChatPublicNoticeMultimodalAttemptStore:
    def __init__(
        self,
        records: Sequence[WeChatPublicNoticeMultimodalAttempt] = (),
    ) -> None:
        self._records = list(records)

    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None:
        self._records.append(attempt)

    def list_by_image(
        self,
        *,
        source_corpus: str = "",
        source_collection: str = "",
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]:
        return tuple(
            item
            for item in self._records
            if (not source_corpus or item.source_corpus == source_corpus)
            and (not source_collection or item.source_collection == source_collection)
            and item.source_notice_id == source_notice_id
            and item.media_ref_id == media_ref_id
        )


class PostgresWeChatPublicNoticeMultimodalAttemptStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("wechat public notice multimodal attempt database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    unit_id,
                    media_ref_id,
                    attempt_number,
                    admission_batch_id,
                    status,
                    provider,
                    model,
                    fetch_manifest_key,
                    ocr_manifest_key,
                    provider_response_key,
                    layout_elements_key,
                    error,
                    created_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                on conflict (
                    source_corpus,
                    source_collection,
                    source_notice_id,
                    media_ref_id,
                    attempt_number
                )
                do update set
                    unit_id = excluded.unit_id,
                    admission_batch_id = excluded.admission_batch_id,
                    status = excluded.status,
                    provider = excluded.provider,
                    model = excluded.model,
                    fetch_manifest_key = excluded.fetch_manifest_key,
                    ocr_manifest_key = excluded.ocr_manifest_key,
                    provider_response_key = excluded.provider_response_key,
                    layout_elements_key = excluded.layout_elements_key,
                    error = excluded.error,
                    created_at = excluded.created_at,
                    record = excluded.record
                """,
                (
                    attempt.source_corpus,
                    attempt.source_collection,
                    attempt.source_notice_id,
                    attempt.unit_id,
                    attempt.media_ref_id,
                    attempt.attempt_number,
                    attempt.admission_batch_id,
                    attempt.status,
                    attempt.provider,
                    attempt.model,
                    attempt.fetch_manifest_key,
                    attempt.ocr_manifest_key,
                    attempt.provider_response_key,
                    attempt.layout_elements_key,
                    attempt.error,
                    attempt.created_at,
                    json.dumps(asdict(attempt), ensure_ascii=False),
                ),
            )

    def list_by_image(
        self,
        *,
        source_corpus: str = "",
        source_collection: str = "",
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        where_sql = "source_notice_id = %s and media_ref_id = %s"
        params: tuple[object, ...] = (source_notice_id, media_ref_id)
        if source_corpus:
            where_sql = f"source_corpus = %s and {where_sql}"
            params = (source_corpus, *params)
        if source_collection:
            where_sql = f"source_collection = %s and {where_sql}"
            params = (source_collection, *params)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record from {table_sql}
                where {where_sql}
                order by attempt_number asc
                """,
                params,
            )
            rows = cursor.fetchall()
        attempts: list[WeChatPublicNoticeMultimodalAttempt] = []
        for row in rows:
            payload = _coerce_json_payload(row[0])
            payload["attempt_number"] = int(payload.get("attempt_number") or 1)
            attempts.append(WeChatPublicNoticeMultimodalAttempt(**payload))
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
                    unit_id text not null,
                    media_ref_id text not null,
                    attempt_number integer not null,
                    admission_batch_id text not null default '',
                    status text not null,
                    provider text not null default '',
                    model text not null default '',
                    fetch_manifest_key text not null default '',
                    ocr_manifest_key text not null default '',
                    provider_response_key text not null default '',
                    layout_elements_key text not null default '',
                    error text not null default '',
                    created_at timestamptz not null,
                    record jsonb not null,
                    primary key (
                        source_corpus,
                        source_collection,
                        source_notice_id,
                        media_ref_id,
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


def build_wechat_public_notice_multimodal_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresWeChatPublicNoticeMultimodalAttemptStore:
    source = dict(env if env is not None else os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresWeChatPublicNoticeMultimodalAttemptStore(
            build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY} or "
            f"{SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresWeChatPublicNoticeMultimodalAttemptStore(database_url=database_url)
