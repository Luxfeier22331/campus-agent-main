from __future__ import annotations

import unittest

import json

from pathlib import Path

from tempfile import TemporaryDirectory

from unittest.mock import patch

from scripts.official_web_source_pack_artifact_consumer import (
    ArtifactBackedOfficialWebSourceObjectStore,
)
from scripts.official_web_source_pack_no_promotion import (
    assert_source_pack_seam_report,
    build_collector_command,
    build_local_artifact_backed_consumer_result,
    build_source_pack_seam_report,
    build_source_pack_seed_plan,
    load_source_pack_execution_plan,
    rebuild_source_pack_seam_report_from_output_root,
    write_source_pack_lineage_overrides,
)


def json_dumps(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


__all__ = [name for name in globals() if not name.startswith("__")]
