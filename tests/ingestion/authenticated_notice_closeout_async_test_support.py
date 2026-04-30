from __future__ import annotations

import hashlib
import json
import threading
import time
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
    CloseoutBatch,
    CloseoutBatchState,
    CloseoutPlanner,
    CloseoutRun,
    CloseoutRunState,
    CloseoutShard,
    CloseoutVerifier,
    CloseoutWorker,
    InMemoryCloseoutStore,
)

from campus_ingestion_core.authenticated_notice_closeout_models import (
    document_stage_slug,
)

from campus_ingestion_core.authenticated_notice_closeout_store import (
    PostgresAuthenticatedNoticeCloseoutStore,
)

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    load_authenticated_notice_source_truth_replay_inventory_from_store,
)

from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    AuthenticatedNoticeSourceTruthReplayRequest,
)

from campus_ingestion_core.object_store import build_operations_artifact_key

from campus_ingestion_core.settings import ObjectStoreSettings

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .authenticated_notice_source_projection_test_support import *

_sample_projection_notice_bundle = _sample_notice_bundle

import campus_ingestion_core.authenticated_notice_closeout_planning as _closeout_planning_module

if not hasattr(
    _closeout_planning_module,
    "load_authenticated_notice_source_truth_replay_inventory_from_store",
):
    _closeout_planning_module.load_authenticated_notice_source_truth_replay_inventory_from_store = (
        load_authenticated_notice_source_truth_replay_inventory_from_store
    )


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _passed_media_gate_audit() -> dict[str, object]:
    return {
        "schema_version": "notice_media_closeout_target_admission_state_machine_audit.v1",
        "verdict": "passed",
        "strict_gate": True,
        "finding_count": 0,
        "finding_counts_by_severity": {},
        "candidate_count": 0,
        "attempt_count": 0,
    }


def _sample_notice_bundle() -> list[dict[str, object]]:
    return [
        {
            "notice_id": 355119,
            "notice": {
                "notice_id": 355119,
                "notice_title": "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
                "organization_name": "教务处",
                "organization_id": "00001",
                "notice_release_time": "2026-04-02 18:49",
                "notice_create_time": "2026-04-02 18:40",
                "notice_first_time": "2026-04-02 18:40",
                "notice_content": (
                    "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                    "<p>请同学们于4月10日前完成报名。</p>"
                    "<p>附件1：报名表.docx</p>"
                ),
                "notice_link": "https://portal.example.edu/notice/355119",
                "notice_source": 1,
                "notice_link_state": 0,
                "notice_state": 1,
                "notice_stick": 0,
                "categories": [
                    {
                        "notice_id": 355119,
                        "notice_type": "6",
                        "notice_type_name": "教学通知",
                        "category_first_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_run_id": 14,
                    }
                ],
            },
            "links": [
                {
                    "id": 34,
                    "notice_id": 355119,
                    "run_id": 14,
                    "source": "content",
                    "content_kind": "attachment_list",
                    "url": "https://portal.example.edu/files/application.docx",
                    "url_scheme": "https",
                    "link_host": "portal.example.edu",
                    "link_scope": "internal",
                    "collect_policy": "fetch",
                    "skip_reason": None,
                    "link_text": "报名表.docx",
                    "final_url": "https://portal.example.edu/files/application.docx",
                    "title": None,
                    "status_code": 200,
                    "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "downloaded": True,
                    "download_path": None,
                    "file_size": 15905,
                    "fetched_at": "2026-04-02T23:58:26.053Z",
                    "error_message": None,
                }
            ],
            "notice_attachments": [
                {
                    "notice_id": 355119,
                    "attachment_id": 1,
                    "link_id": 34,
                    "relation_source": "content",
                    "resource_role": "attachment",
                    "anchor_text": "报名表.docx",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                }
            ],
            "attachments": [
                {
                    "attachment_id": 1,
                    "source_url": "https://portal.example.edu/files/application.docx",
                    "normalized_source_url": "https://portal.example.edu/files/application.docx",
                    "final_url": "https://portal.example.edu/files/application.docx",
                    "original_filename": "application.docx",
                    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "byte_size": 15905,
                    "sha256": "5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152",
                    "storage_provider": "local",
                    "bucket": None,
                    "object_key": "5e/5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152/application.docx",
                    "etag": None,
                    "version_id": None,
                    "origin_url_scheme": "https",
                    "origin_host": "portal.example.edu",
                    "origin_scope": "internal",
                    "provenance_status": "collected_internal",
                    "ingest_status": "downloaded",
                    "local_path": None,
                    "downloaded_at": "2026-04-02T23:58:26.053Z",
                    "uploaded_at": None,
                    "last_error": None,
                    "created_at": "2026-04-02T23:58:26.053Z",
                    "updated_at": "2026-04-02T23:58:26.053Z",
                }
            ],
        }
    ]


def _sample_export_manifest() -> dict[str, object]:
    return {
        "schema_version": "v3",
        "exported_at": "2026-04-02T23:59:19.838Z",
        "export_date": "20260403",
        "export_scope": "run-14",
        "filters": {
            "run_id": 14,
            "since": None,
            "until": None,
        },
        "run": {
            "id": 14,
            "mode": "backfill",
            "status": "success",
            "started_at": "2026-04-02T23:50:17.023Z",
            "finished_at": "2026-04-02T23:57:57.563Z",
            "pages_fetched": 337,
            "items_seen": 6694,
            "items_inserted": 6454,
            "items_updated": 0,
            "errors": 0,
            "error_message": None,
        },
    }


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.objects: dict[tuple[str, str], dict[str, object]] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "content_type": content_type,
                "metadata": dict(metadata or {}),
            }
        )
        self.objects[(bucket, key)] = {
            "data": data,
            "content_type": content_type,
            "metadata": dict(metadata or {}),
        }

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]["data"]  # type: ignore[index]

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        stored = self.objects[(bucket, key)]
        data = stored["data"]
        assert isinstance(data, bytes)
        metadata = stored["metadata"]
        assert isinstance(metadata, dict)
        return {
            "content_length": len(data),
            "metadata": dict(metadata),
            "etag": f"fake-etag:{bucket}:{key}",
        }

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None:
        stored = dict(self.objects[(source_bucket, source_key)])
        self.uploads.append(
            {
                "bucket": target_bucket,
                "key": target_key,
                "content_type": stored["content_type"],
                "metadata": dict(stored["metadata"]),  # type: ignore[arg-type]
                "copy_source": {"bucket": source_bucket, "key": source_key},
            }
        )
        self.objects[(target_bucket, target_key)] = stored


def _build_notice_bundle(count: int) -> list[dict[str, object]]:
    bundle: list[dict[str, object]] = []
    for offset in range(count):
        item = json.loads(json.dumps(_sample_notice_bundle()[0], ensure_ascii=False))
        notice_id = 355119 + offset
        item["notice_id"] = notice_id
        notice = item["notice"]
        assert isinstance(notice, dict)
        notice["notice_id"] = notice_id
        notice["notice_title"] = f"测试通知 {notice_id}"
        notice["notice_content"] = (
            f"<h1>测试通知 {notice_id}</h1>"
            f"<p>这是第 {offset + 1} 条通知。</p>"
            f"<p>附件1：附件-{notice_id}.docx</p>"
        )
        notice["notice_link"] = f"https://portal.example.edu/notice/{notice_id}"
        categories = notice["categories"]
        assert isinstance(categories, list) and categories
        categories[0]["notice_id"] = notice_id
        item["links"][0]["notice_id"] = notice_id
        item["links"][0]["url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["links"][0]["final_url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["links"][0]["link_text"] = f"附件-{notice_id}.docx"
        item["notice_attachments"][0]["notice_id"] = notice_id
        item["attachments"][0]["attachment_id"] = notice_id
        item["attachments"][0]["source_url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["attachments"][0]["normalized_source_url"] = (
            f"https://portal.example.edu/files/{notice_id}.docx"
        )
        item["attachments"][0]["final_url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["attachments"][0]["original_filename"] = f"{notice_id}.docx"
        item["attachments"][0]["object_key"] = f"objects/{notice_id}.docx"
        bundle.append(item)
    return bundle


class _SlowTrackingObjectStore(_FakeObjectStore):
    def __init__(self, *, delay_seconds: float = 0.02) -> None:
        super().__init__()
        self.delay_seconds = delay_seconds
        self.max_put_inflight = 0
        self._put_inflight = 0
        self._lock = threading.Lock()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        with self._lock:
            self._put_inflight += 1
            self.max_put_inflight = max(self.max_put_inflight, self._put_inflight)
        try:
            time.sleep(self.delay_seconds)
            super().put_bytes(
                bucket=bucket,
                key=key,
                data=data,
                content_type=content_type,
                metadata=metadata,
            )
        finally:
            with self._lock:
                self._put_inflight -= 1


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _ClaimCursor:
    def __init__(self, row: tuple[object, ...]) -> None:
        self._row = row
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def fetchone(self) -> tuple[object, ...] | None:
        if self._row is None:
            return None
        row = self._row
        self._row = None
        return row


class _BulkCursor:
    def __init__(self) -> None:
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.executemany_calls: list[tuple[str, list[tuple[object, ...]]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def executemany(self, query: str, params_seq) -> None:
        self.executemany_calls.append((query, list(params_seq)))


def _build_service(
    *,
    root: Path,
    ocr_client: object | None = None,
    object_store: _FakeObjectStore | None = None,
) -> tuple[AuthenticatedNoticeCloseoutService, _FakeObjectStore]:
    runtime_object_store = object_store or _FakeObjectStore()
    service = AuthenticatedNoticeCloseoutService(
        closeout_store=InMemoryCloseoutStore(),
        object_store=runtime_object_store,
        object_store_settings=ObjectStoreSettings(
            endpoint="http://localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
        ),
        document_registry=InMemoryDocumentRegistry(
            backing_path=root / "registry" / "documents.json"
        ),
        raw_asset_registry=InMemoryRawAssetRegistry(
            backing_path=root / "registry" / "raw-assets.json"
        ),
        planner=CloseoutPlanner(shard_size=2, batch_size=1, max_shards=4),
        ocr_client=ocr_client,
    )
    return service, runtime_object_store


def _bootstrap_source_truth_scope(
    *,
    root: Path,
    object_store: _FakeObjectStore,
    document_registry: InMemoryDocumentRegistry,
    raw_asset_registry: InMemoryRawAssetRegistry,
    source_truth_inventory_store=None,
    bundle: list[dict[str, object]] | None = None,
    attachment_payloads: dict[str, tuple[bytes, str]] | None = None,
) -> None:
    bundle_path = root / "source-truth-bundle.json"
    manifest_path = root / "source-truth-manifest.json"
    docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
    png_bytes = _build_minimal_png_bytes()
    bundle = bundle or _sample_projection_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)
    _write_json(bundle_path, bundle)
    _write_json(manifest_path, _sample_export_manifest())
    import_authenticated_notice_export(
        request=AuthenticatedNoticeImportRequest(
            bundle_path=bundle_path,
            export_manifest_path=manifest_path,
            site_id="muc_internal_portal",
            source_home_url="https://portal.example.edu/home",
            allow_local_fixture_import=True,
            mode="admit_and_materialize",
        ),
        env={
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
        },
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=source_truth_inventory_store,
    )
    payloads = attachment_payloads or {
        str(bundle[0]["attachments"][0]["object_key"]): (
            docx_bytes,
            str(bundle[0]["attachments"][0]["mime_type"]),
        ),
        str(bundle[0]["attachments"][1]["object_key"]): (
            png_bytes,
            str(bundle[0]["attachments"][1]["mime_type"]),
        ),
    }
    for object_key, (data, content_type) in payloads.items():
        object_store.put_bytes(
            bucket="campus-rag-source",
            key=object_key,
            data=data,
            content_type=content_type,
        )


def _build_second_source_truth_notice(
    *,
    docx_bytes: bytes,
    png_bytes: bytes,
) -> tuple[dict[str, object], dict[str, tuple[bytes, str]]]:
    bundle = json.loads(
        json.dumps(
            _sample_projection_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)[0],
            ensure_ascii=False,
        )
    )
    bundle["notice_id"] = 355120
    notice = bundle["notice"]
    assert isinstance(notice, dict)
    notice["notice_id"] = 355120
    notice["notice_title"] = "第二条 authenticated notice 测试通知"
    notice["notice_link"] = "https://portal.example.edu/notice/355120"
    notice["notice_content"] = (
        "<h1>第二条 authenticated notice 测试通知</h1>"
        "<p>第二条通知正文。</p>"
        "<p>附件1：application-355120.docx</p>"
        "<p>附件2：notice-355120.png</p>"
        "<p>附件3：supplement-355120.pdf</p>"
    )
    categories = notice["categories"]
    assert isinstance(categories, list)
    for index, category in enumerate(categories):
        assert isinstance(category, dict)
        category["notice_id"] = 355120
        category["category_last_run_id"] = 140 + index

    links = bundle["links"]
    assert isinstance(links, list) and len(links) == 3
    links[0]["id"] = 134
    links[0]["notice_id"] = 355120
    links[0]["url"] = "https://portal.example.edu/files/application-355120.docx"
    links[0]["final_url"] = "https://portal.example.edu/files/application-355120.docx"
    links[0]["link_text"] = "application-355120.docx"
    links[0]["file_size"] = len(docx_bytes)
    links[1]["id"] = 135
    links[1]["notice_id"] = 355120
    links[1]["url"] = "https://portal.example.edu/files/notice-355120.png"
    links[1]["final_url"] = "https://portal.example.edu/files/notice-355120.png"
    links[1]["link_text"] = "notice-355120.png"
    links[1]["file_size"] = len(png_bytes)
    links[2]["id"] = 136
    links[2]["notice_id"] = 355120
    links[2]["url"] = "https://portal.example.edu/files/supplement-355120.pdf"
    links[2]["final_url"] = "https://portal.example.edu/files/supplement-355120.pdf"
    links[2]["link_text"] = "supplement-355120.pdf"

    notice_attachments = bundle["notice_attachments"]
    assert isinstance(notice_attachments, list) and len(notice_attachments) == 3
    notice_attachments[0]["notice_id"] = 355120
    notice_attachments[0]["attachment_id"] = 101
    notice_attachments[0]["link_id"] = 134
    notice_attachments[1]["notice_id"] = 355120
    notice_attachments[1]["attachment_id"] = 102
    notice_attachments[1]["link_id"] = 135
    notice_attachments[2]["notice_id"] = 355120
    notice_attachments[2]["attachment_id"] = 103
    notice_attachments[2]["link_id"] = 136

    attachments = bundle["attachments"]
    assert isinstance(attachments, list) and len(attachments) == 3
    second_docx_sha256 = hashlib.sha256(docx_bytes).hexdigest()
    second_png_sha256 = hashlib.sha256(png_bytes).hexdigest()
    second_docx_key = _attachment_object_key(second_docx_sha256, "application-355120.docx")
    second_png_key = _attachment_object_key(second_png_sha256, "notice-355120.png")
    attachments[0]["attachment_id"] = 101
    attachments[0]["source_url"] = "https://portal.example.edu/files/application-355120.docx"
    attachments[0]["normalized_source_url"] = (
        "https://portal.example.edu/files/application-355120.docx"
    )
    attachments[0]["final_url"] = "https://portal.example.edu/files/application-355120.docx"
    attachments[0]["original_filename"] = "application-355120.docx"
    attachments[0]["byte_size"] = len(docx_bytes)
    attachments[0]["sha256"] = second_docx_sha256
    attachments[0]["object_key"] = second_docx_key
    attachments[1]["attachment_id"] = 102
    attachments[1]["source_url"] = "https://portal.example.edu/files/notice-355120.png"
    attachments[1]["normalized_source_url"] = "https://portal.example.edu/files/notice-355120.png"
    attachments[1]["final_url"] = "https://portal.example.edu/files/notice-355120.png"
    attachments[1]["original_filename"] = "notice-355120.png"
    attachments[1]["byte_size"] = len(png_bytes)
    attachments[1]["sha256"] = second_png_sha256
    attachments[1]["object_key"] = second_png_key
    attachments[2]["attachment_id"] = 103
    attachments[2]["source_url"] = "https://portal.example.edu/files/supplement-355120.pdf"
    attachments[2]["normalized_source_url"] = (
        "https://portal.example.edu/files/supplement-355120.pdf"
    )
    attachments[2]["final_url"] = "https://portal.example.edu/files/supplement-355120.pdf"
    attachments[2]["original_filename"] = "supplement-355120.pdf"

    return bundle, {
        second_docx_key: (
            docx_bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        second_png_key: (png_bytes, "image/png"),
    }


__all__ = [name for name in globals() if not name.startswith("__")]
