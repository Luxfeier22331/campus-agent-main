from __future__ import annotations

import os

from campus_ingestion_core.authenticated_notice_closeout_store_memory import (
    InMemoryCloseoutStore,
)
from campus_ingestion_core.authenticated_notice_closeout_store_postgres import (
    PostgresAuthenticatedNoticeCloseoutStore,
)
from campus_ingestion_core.authenticated_notice_closeout_store_shared import (
    DEFAULT_BATCH_TABLE,
    DEFAULT_CLOSEOUT_SCHEMA,
    DEFAULT_CLOSEOUT_STORE_ENV_KEY,
    DEFAULT_CLOSEOUT_STORE_MANAGEMENT_ENV_KEY,
    DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY,
    DEFAULT_DOCUMENT_STAGE_TABLE,
    DEFAULT_MILESTONE_TABLE,
    DEFAULT_NOTICE_STAGE_TABLE,
    DEFAULT_PROMOTION_BATCH_TABLE,
    DEFAULT_PROMOTION_TABLE,
    DEFAULT_RAW_ASSET_STAGE_TABLE,
    DEFAULT_RUN_TABLE,
    DEFAULT_SHARD_TABLE,
    DEFAULT_WORKER_TABLE,
    CloseoutStore,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)


def build_authenticated_notice_closeout_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeCloseoutStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_CLOSEOUT_STORE_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_CLOSEOUT_STORE_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} is required when "
                "prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeCloseoutStore(
            build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_CLOSEOUT_STORE_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_CLOSEOUT_STORE_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeCloseoutStore(database_url)


__all__ = [
    "DEFAULT_BATCH_TABLE",
    "DEFAULT_CLOSEOUT_SCHEMA",
    "DEFAULT_CLOSEOUT_STORE_ENV_KEY",
    "DEFAULT_DOCUMENT_STAGE_TABLE",
    "DEFAULT_MILESTONE_TABLE",
    "DEFAULT_NOTICE_STAGE_TABLE",
    "DEFAULT_PROMOTION_BATCH_TABLE",
    "DEFAULT_PROMOTION_TABLE",
    "DEFAULT_RAW_ASSET_STAGE_TABLE",
    "DEFAULT_RUN_TABLE",
    "DEFAULT_SHARD_TABLE",
    "DEFAULT_WORKER_TABLE",
    "CloseoutStore",
    "InMemoryCloseoutStore",
    "PostgresAuthenticatedNoticeCloseoutStore",
    "build_authenticated_notice_closeout_store_from_env",
]
