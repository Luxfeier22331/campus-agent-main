from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ChatCompletionsScheduleImageOcrProvider,
    InMemoryScheduleImageOcrAttemptStore,
    PostgresScheduleImageOcrAttemptStore,
    ScheduleImageOcrAdmissionDecision,
    ScheduleImageOcrAttempt,
    ScheduleImageOcrChildDocument,
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrProviderResult,
    admit_schedule_image_ocr_child_document,
    build_schedule_image_ocr_artifact_keys,
    build_schedule_image_ocr_attempt_store_from_env,
    build_schedule_image_ocr_child_document_registry_record,
    load_schedule_image_ocr_evidence_inventory,
    run_schedule_image_ocr_dry_run,
    summarize_schedule_image_ocr_notice_review,
    write_schedule_image_ocr_child_document_artifacts,
    write_schedule_image_ocr_source_artifacts,
)

from tests.ingestion.internal_notice_schedule_image_ocr_test_support import (
    _evidence,
    _FakeConnectionContextManager,
    _FakeHttpClient,
    _FakeOcrProvider,
    _NoWriteObjectStore,
    _PagedCursor,
)


__all__ = [name for name in globals() if not name.startswith("__")]
