from __future__ import annotations

import os
from collections.abc import Mapping

from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrAttemptStore,
)
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired


def build_schedule_image_ocr_attempt_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> ScheduleImageOcrAttemptStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("internal notice schedule image OCR attempt store")


__all__ = ["build_schedule_image_ocr_attempt_store_from_env"]
