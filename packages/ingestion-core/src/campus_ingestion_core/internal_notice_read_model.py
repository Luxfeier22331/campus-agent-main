from __future__ import annotations

from campus_ingestion_core.internal_notice_read_model_consistency import (
    InternalNoticeReadModelConsistencyReport,
    InternalNoticeReadModelRepairReport,
    check_internal_notice_read_model_consistency,
    rebuild_internal_notice_read_model,
    repair_internal_notice_read_model_consistency,
)
from campus_ingestion_core.internal_notice_read_model_entries import (
    InternalNoticeReadModelObjectStore,
    build_internal_notice_read_model_entries,
)
from campus_ingestion_core.internal_notice_read_model_env import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model_memory import (
    InMemoryInternalNoticeReadModelStore,
)
from campus_ingestion_core.internal_notice_read_model_postgres import (
    PostgresInternalNoticeReadModelStore,
)
from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_SCHEMA,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
    InternalNoticeReadModelStore,
    normalize_notice_ids,
)
from campus_ingestion_core.registry import _postgres_connection

__all__ = [
    "DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_SCHEMA",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE",
    "DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS",
    "InMemoryInternalNoticeReadModelStore",
    "InternalNoticeReadModelConsistencyReport",
    "InternalNoticeReadModelEntry",
    "InternalNoticeReadModelObjectStore",
    "InternalNoticeReadModelRepairReport",
    "InternalNoticeReadModelStore",
    "PostgresInternalNoticeReadModelStore",
    "_postgres_connection",
    "build_internal_notice_read_model_entries",
    "build_internal_notice_read_model_store_from_env",
    "check_internal_notice_read_model_consistency",
    "normalize_notice_ids",
    "rebuild_internal_notice_read_model",
    "repair_internal_notice_read_model_consistency",
]
