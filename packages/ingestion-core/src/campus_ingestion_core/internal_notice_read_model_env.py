from __future__ import annotations

import os

from campus_ingestion_core.internal_notice_read_model_postgres import (
    PostgresInternalNoticeReadModelStore,
)
from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.postgres_runtime import build_operator_postgres_connection_url
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)


def build_internal_notice_read_model_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresInternalNoticeReadModelStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresInternalNoticeReadModelStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresInternalNoticeReadModelStore(database_url=database_url)


__all__ = ("build_internal_notice_read_model_store_from_env",)
