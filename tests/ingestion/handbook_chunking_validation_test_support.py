from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.handbook_chunking_validation import (
    build_student_handbook_chunking_validation_report,
    export_student_handbook_chunk_samples,
    scan_student_handbook_chunking,
    validate_student_handbook_chunking,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key

from tests.ingestion._handbook_chunking_test_support import build_hermetic_handbook_v3_chunk_profile


class _FakeRegistry:
    def __init__(self, *records: DocumentRegistryRecord) -> None:
        self.records = records

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        return tuple(
            record
            for record in self.records
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class _CountingObjectStore(_FakeObjectStore):
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        super().__init__(objects)
        self.get_bytes_calls: list[tuple[str, str]] = []
        self.healthcheck_calls: list[str] = []

    def healthcheck(self, *, bucket: str) -> None:
        self.healthcheck_calls.append(bucket)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.get_bytes_calls.append((bucket, key))
        return super().get_bytes(bucket=bucket, key=key)


class _FailFastObjectStore(_FakeObjectStore):
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        super().__init__(objects)
        self.get_bytes_call_count = 0

    def healthcheck(self, *, bucket: str) -> None:
        raise RuntimeError(f"healthcheck failed for {bucket}")

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.get_bytes_call_count += 1
        return super().get_bytes(bucket=bucket, key=key)


def _manifest_document(*, document_id: str, title: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "title": title,
        "handbook_section": "测试章节",
        "page_start": 1,
        "page_end": 2,
        "source_uri": f"campus-agent://regulations/student_rules/docs/{document_id}",
    }


def _manifest_document_with_pages(
    *,
    document_id: str,
    title: str,
    page_start: int,
    page_end: int,
) -> dict[str, object]:
    return {
        **_manifest_document(document_id=document_id, title=title),
        "page_start": page_start,
        "page_end": page_end,
    }


def _registry_record(*, document_id: str, version_id: str, title: str) -> DocumentRegistryRecord:
    object_key = build_processed_artifact_key(
        corpus="regulations",
        collection="student_rules",
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        title=title,
        year="2018",
        filename="document-units.jsonl",
    )
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"campus-agent://regulations/student_rules/docs/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-24T00:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="provider_response_replay",
    )


def _structured_row(
    *, doc_id: str, version_id: str, unit_type: str, clean_text: str, root_unit_id: str
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": {"page_start": 1, "page_end": 1},
        "acl": {"level": "public", "allow_groups": []},
    }


__all__ = [name for name in globals() if not name.startswith("__")]
