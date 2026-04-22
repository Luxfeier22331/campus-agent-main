from __future__ import annotations

import hashlib

import json

import types

import unittest

import zipfile

from io import BytesIO

from pathlib import Path

from tempfile import TemporaryDirectory

from unittest.mock import patch

from campus_ingestion_core.handbook_cleanup import build_handbook_doc_id

from campus_ingestion_core.models import RawAssetRecord

from campus_ingestion_core.object_store import (
    build_processed_artifact_key,
    build_processed_asset_artifact_key,
)

from campus_ingestion_core.process import build_indexable_chunks_from_record

from campus_ingestion_core.raw_ingestion import (
    RawIngestionProcessSettings,
    RawIngestionRequest,
    build_online_ocr_client,
)

from campus_ingestion_core.raw_ingestion_online_ocr import (
    MineruApiClient,
    OnlineOcrProviderContractError,
    OnlineOcrRawArtifact,
    OnlineOcrSettings,
    PaddleOcrAsyncClient,
    PaddleOcrLayoutParsingServiceClient,
    parse_online_ocr_bytes,
)

from campus_ingestion_worker.process_raw_ingestion_job import (
    OnlineOcrProviderResult,
)

from campus_ingestion_worker.process_raw_ingestion_job import (
    process_raw_ingestion_job as _process_raw_ingestion_job,
)

from tests.ingestion._handbook_chunking_test_support import build_hermetic_handbook_v3_chunk_profile

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_rules"

SOURCE_BUCKET = "campus-rag-source"

DERIVED_BUCKET = "campus-rag-derived"


def process_raw_ingestion_job(**kwargs):
    env = kwargs.get("env") or {}
    request = kwargs.pop("request", None)
    if request is None:
        request = RawIngestionRequest(
            raw_asset_id=(env.get("RAW_ASSET_ID") or "").strip(),
            raw_version_id=(env.get("RAW_VERSION_ID") or "").strip(),
            corpus=(env.get("INGESTION_CORPUS") or "").strip(),
            collection=(env.get("INGESTION_COLLECTION") or "").strip(),
            artifact_mode=(env.get("RAW_INGESTION_ARTIFACT_MODE") or "normalized").strip()
            or "normalized",
            split_manifest_path=(
                Path(env["INGESTION_SPLIT_MANIFEST_PATH"]).resolve()
                if (env.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
                else None
            ),
            report_dir=Path((env.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            default_visibility_scope=(
                (
                    env.get("INGESTION_DEFAULT_VISIBILITY_SCOPE")
                    or env.get("INGESTION_DEFAULT_CAMPUS_SCOPE")
                    or ""
                ).strip()
                or None
            ),
        )
    return _process_raw_ingestion_job(request=request, **kwargs)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


def _handbook_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    raw_source_uri: str,
    content_hash: str,
    source_filename: str,
    object_key: str,
    content_type: str | None = None,
    file_extension: str = "",
    page_count: int | None = None,
    image_width: int | None = None,
    image_height: int | None = None,
    asset_kind: str = "",
    asset_subkind: str = "",
    classification_confidence: float | None = None,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="regulations",
        collection="student_rules",
        raw_source_uri=raw_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        content_type=content_type,
        file_extension=file_extension,
        page_count=page_count,
        image_width=image_width,
        image_height=image_height,
        ingestion_timestamp="2026-03-23T00:00:00+00:00",
        import_source="seed",
        asset_kind=asset_kind,
        asset_subkind=asset_subkind,
        classification_confidence=classification_confidence,
    )


def _curriculum_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    raw_source_uri: str,
    content_hash: str,
    source_filename: str,
    object_key: str,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri=raw_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        ingestion_timestamp="2026-03-23T00:00:00+00:00",
        import_source="seed",
    )


def _student_handbook_manifest_payload(
    *, title: str = "中央民族大学奖学金评定办法"
) -> dict[str, object]:
    return {
        "manifest_version": "student_rules_split_manifest_v1",
        "corpus": "regulations",
        "collection": "student_rules",
        "raw_asset_id": "asset:student-handbook-master-pdf",
        "documents": [
            {
                "document_id": "manifest:scholarship-policy",
                "title": title,
                "handbook_section": "中央民族大学学生奖励管理规定",
                "page_start": 1,
                "page_end": 1,
                "source_uri": "https://campus.example/handbook/scholarship-policy",
            }
        ],
    }


__all__ = [name for name in globals() if not name.startswith("__")]
