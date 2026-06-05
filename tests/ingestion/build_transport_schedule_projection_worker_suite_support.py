from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.build_transport_schedule_projection_worker_support import (
    _notice_projection_runtime,
    _write_consumer_manifest,
    _write_json,
    _write_jsonl,
    _write_transport_preview_gate,
)

worker = importlib.import_module("campus_ingestion_worker.build_transport_schedule_projection")


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class _FakeStructuredProjectionPublisher:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> object:
        self.calls.append(dict(kwargs))
        return {"current": kwargs.get("promote_current", True)}


class _FakeProjectionStore:
    def __init__(self, entries: tuple[NoticeConsumptionProjectionEntry, ...]) -> None:
        self.entries = entries
        self.list_notice_ids: tuple[str, ...] | None = None

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: tuple[str, ...] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]:
        self.list_notice_ids = tuple(notice_ids)
        return self.entries


__all__ = [name for name in globals() if not name.startswith("__")]
