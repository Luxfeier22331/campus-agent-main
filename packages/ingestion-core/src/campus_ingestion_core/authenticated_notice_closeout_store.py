from __future__ import annotations

import os

from campus_ingestion_core.authenticated_notice_closeout_store_memory import (
    InMemoryCloseoutStore,
)
from campus_ingestion_core.authenticated_notice_closeout_store_shared import (
    DEFAULT_BATCH_TABLE,
    DEFAULT_CLOSEOUT_SCHEMA,
    DEFAULT_CLOSEOUT_STORE_ENV_KEY,
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
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired


def build_authenticated_notice_closeout_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> CloseoutStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("authenticated notice closeout store")


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
    "build_authenticated_notice_closeout_store_from_env",
]
