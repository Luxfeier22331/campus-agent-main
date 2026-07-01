from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_bundle,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_attachment_capture_key,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRef

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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


def _sample_normalized_blob_store_manifest() -> dict[str, object]:
    manifest = _sample_export_manifest()
    manifest["schema_version"] = "authenticated_notice_legacy_bootstrap_normalized_v1"
    manifest["collector"] = {
        "runtime_shell": "legacy_external_collector",
        "export_contract_version": "legacy_authenticated_notice_export_v3",
        "link_collection_mode": "legacy_bundle_preserved",
        "attachment_collection_mode": "legacy_bundle_preserved",
        "attachment_storage_mode": "blob_store_reference",
    }
    return manifest


def _sample_inline_image_notice_bundle(*, attachment_bytes: bytes) -> list[dict[str, object]]:
    attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    legacy_object_key = f"{attachment_sha256[:2]}/{attachment_sha256}/schedule.png"
    return [
        {
            "notice_id": 351118,
            "notice": {
                "notice_id": 351118,
                "notice_title": "关于2025-2026学年第一学期本科生网上选课的通知",
                "organization_name": "教务处",
                "organization_id": "00001",
                "notice_release_time": "2026-04-02 18:49",
                "notice_create_time": "2026-04-02 18:40",
                "notice_first_time": "2026-04-02 18:40",
                "notice_content": (
                    "<p>（三）选课时间安排</p>"
                    '<p><img src="http://portal.example.edu/files/schedule.png" '
                    'title="选课时间安排.png" alt="选课时间安排.png"/></p>'
                ),
                "notice_link": "https://portal.example.edu/notice/351118",
                "notice_source": 1,
                "notice_link_state": 0,
                "notice_state": 1,
                "notice_stick": 0,
                "categories": [
                    {
                        "notice_id": 351118,
                        "notice_type": "6",
                        "notice_type_name": "教学通知",
                        "category_first_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_run_id": 14,
                    }
                ],
            },
            "links": [],
            "notice_attachments": [
                {
                    "notice_id": 351118,
                    "attachment_id": 1,
                    "link_id": None,
                    "relation_source": "content",
                    "resource_role": "inline_image",
                    "anchor_text": "选课时间安排.png",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                }
            ],
            "attachments": [
                {
                    "attachment_id": 1,
                    "source_url": "http://portal.example.edu/files/schedule.png",
                    "normalized_source_url": "https://portal.example.edu/files/schedule.png",
                    "final_url": "https://portal.example.edu/files/schedule.png",
                    "original_filename": "schedule.png",
                    "mime_type": "image/png",
                    "byte_size": len(attachment_bytes),
                    "sha256": attachment_sha256,
                    "storage_provider": "local",
                    "bucket": None,
                    "object_key": legacy_object_key,
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

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.objects.pop((bucket, key), None)

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


def _persisted_attachment_record(
    *,
    notice_id: str = "355119",
    attachment_ref_id: str = "attachment-0001",
) -> DocumentRegistryRecord:
    document_id = f"notice_attachment:example_internal_portal:{notice_id}:{attachment_ref_id}"
    version_id = f"sha256:{attachment_ref_id}"
    document_units_key = (
        "campus_notices/documents/internal_notice/"
        f"{notice_id}/{attachment_ref_id}/source-faithful/2026/document-units.jsonl"
    )
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"https://portal.example.edu/files/{attachment_ref_id}.pdf",
        content_hash=version_id,
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        policy_projection_version=DEFAULT_POLICY_PROJECTION_VERSION,
        status="active",
        ingestion_timestamp="2026-04-10T00:00:00+00:00",
        parser_version="authenticated_notice_source_projection_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        raw_asset=RawAssetRef(
            raw_asset_id=f"asset:authenticated-notice:example_internal_portal:{notice_id}:{attachment_ref_id}",
            raw_version_id=version_id,
        ),
        document_units_object_key=document_units_key,
        processed_object_keys=(document_units_key,),
        import_source="authenticated_notice_closeout_promotion",
    )


__all__ = [name for name in globals() if not name.startswith("__")]
