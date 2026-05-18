from __future__ import annotations

import hashlib

import json

import unittest

from pathlib import Path

from tempfile import TemporaryDirectory

from unittest.mock import patch

from campus_ingestion_core.official_web_release_task_store import (
    InMemoryOfficialWebReleaseTaskStore,
)

from campus_ingestion_worker.official_web_handoff_consumer_reporting import (
    build_consumer_candidate_review_report,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_handoff_consumer_test_support import (
    DocumentRegistryRecord,
    FakeExecutionStatusReporter,
    FakeReplayObjectStore,
    ImportReport,
    OfficialWebHandoffConsumeResult,
    OfficialWebHandoffConsumerSettings,
    OfficialWebProjectionChunkingAuditReport,
    OfficialWebProjectionReplayReport,
    OfficialWebProjectionValidationReport,
    RawAssetRecord,
    _bundle_key,
    _bundle_payload,
    _declarations_payload,
    _handoff_record,
    _standard_bundle_objects,
    _write_json,
    consume_handoff_record,
)


def _expected_candidate_key(
    *,
    consumer_family: str,
    normalized_canonical_url: str,
    raw_version_id: str,
    selected_write_target: str,
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "consumer_family": consumer_family,
                "normalized_canonical_url": normalized_canonical_url,
                "raw_version_id": raw_version_id,
                "selected_write_target": selected_write_target,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"owcand_{digest}"


__all__ = [name for name in globals() if not name.startswith("__")]
