from __future__ import annotations

import os

from campus_ingestion_core.internal_notice_read_model_shared import (
    InternalNoticeReadModelStore,
)
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired


def build_internal_notice_read_model_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> InternalNoticeReadModelStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("internal notice read model store")


__all__ = ("build_internal_notice_read_model_store_from_env",)
