from __future__ import annotations

import os
from collections.abc import Mapping

from campus_ingestion_core.internal_notice_multimodal_processing_models import (
    InMemoryInternalNoticeMultimodalAttemptStore,
    InternalNoticeMultimodalAttemptStore,
)
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY = (
    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL"
)
DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE = (
    "ingestion_projection.internal_notice_multimodal_attempt"
)


def build_internal_notice_multimodal_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> InternalNoticeMultimodalAttemptStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("internal notice multimodal attempt store")


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE",
    "InMemoryInternalNoticeMultimodalAttemptStore",
    "build_internal_notice_multimodal_attempt_store_from_env",
]
