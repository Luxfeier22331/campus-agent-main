from __future__ import annotations

import json

import unittest

from pathlib import Path

from tempfile import TemporaryDirectory

from types import SimpleNamespace

from unittest.mock import patch

from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    OfficialWebSelectedWritePreviewRuntimeCaseResult,
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
)

from scripts.official_web_service_guide_no_promotion_proof import (
    build_service_guide_quality_summary,
    build_service_guide_release_tasks_from_execution_report,
    _rewrite_preview_report_with_replay_full_impact_baseline,
    resolve_service_guide_tasks_from_seam_report,
    resolve_service_guide_task_ids_from_seam_report,
)

from campus_ingestion_worker.release_official_web_selected_write import (
    preview_official_web_selected_write,
)

__all__ = [name for name in globals() if not name.startswith("__")]
