from __future__ import annotations

import hashlib

import json

import unittest

from pathlib import Path

from campus_ingestion_core.chunking import ChunkProfile

from campus_ingestion_core.curriculum_budget_evaluation import (
    load_default_curriculum_budget_evaluation_documents,
)

from campus_ingestion_core.curriculum_chunk_units import (
    _build_curriculum_contextual_text,
    build_curriculum_structured_units,
)

from campus_ingestion_core.models import DocumentRegistryRecord

from campus_ingestion_core.process import build_indexable_chunks_from_jsonl

from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
    CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
)

from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
)

from campus_ingestion_core.split_manifest import SplitManifestDocument, load_split_manifest


def _make_curriculum_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:test-001",
        revision_track="source-faithful",
        version_id="sha256:test-001:split:test-001:abc123",
        source_uri="campusrag://source/curriculum/curriculum-plan-2022/sha256/test/capture/pages/20-21",
        content_hash="sha256:test-001",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        parser_version="mineru-vlm-adapted-v2",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=(
            "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl",
            "official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/undated/document-units.jsonl",
        ),
        import_source="raw_online_ocr",
    )


def _make_public_curriculum_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:test-public",
        revision_track="source-faithful",
        version_id="sha256:test-public:split:test-public:abc123",
        source_uri="campusrag://source/curriculum/test-public/pages/1-1",
        content_hash="sha256:test-public",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=(),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        parser_version="mineru-vlm-adapted-v2",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=(
            "curriculum/documents/curriculum_plan/test-public--test-public/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "curriculum/documents/curriculum_plan/test-public--test-public/source-faithful/undated/document-units.jsonl",
        ),
        import_source="raw_online_ocr",
    )


def _build_real_curriculum_projection_chunks(
    document_id: str,
) -> tuple[DocumentRegistryRecord, tuple[object, ...]]:
    manifest = load_split_manifest(
        Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
        expected_corpus="curriculum",
        expected_collection="curriculum_plan",
    )
    layout_rows = _load_layout_elements_rows(
        Path("tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl").read_bytes()
    )
    target_document = next(item for item in manifest.documents if item.document_id == document_id)
    raw_version_id = "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"
    document_input = _build_split_manifest_document_input(
        raw_asset_record=type(
            "RawAssetRecordProxy",
            (),
            {
                "raw_asset_id": "asset:curriculum-plan-2022",
                "raw_version_id": raw_version_id,
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "raw_source_uri": "file:///tmp/curriculum-plan-2022.pdf",
                "content_hash": raw_version_id.removeprefix("sha256:"),
                "source_filename": "curriculum-plan-2022.pdf",
                "object_key": "official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
                "ingestion_timestamp": "2026-03-24T10:00:00+00:00",
                "import_source": "raw_online_ocr",
            },
        )(),
        manifest_version=manifest.manifest_version,
        manifest_document=target_document,
        structured_rows=layout_rows,
        provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl",
        layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
        default_visibility_scope="main",
        corpus="curriculum",
        collection="curriculum_plan",
        row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
    )
    record = DocumentRegistryRecord(
        document_id=target_document.document_id,
        revision_track="source-faithful",
        version_id=str(document_input.metadata["version_id"]),
        source_uri=str(
            document_input.metadata.get("source_url")
            or document_input.metadata.get("source_id")
            or ""
        ),
        content_hash=hashlib.sha256(document_input.document_units_bytes).hexdigest(),
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=tuple(document_input.metadata.get("entitlement_groups") or ()),
        visibility_scope=str(document_input.metadata.get("visibility_scope") or "main"),
        status=str(document_input.metadata.get("status") or "active"),
        ingestion_timestamp="2026-03-27T12:00:00+00:00",
        parser_version="mineru-vlm-adapted-v2",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        is_current=True,
        document_units_object_key="curriculum/documents/tmp/document-units.jsonl",
        import_source="raw_online_ocr",
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=document_input.document_units_bytes,
        chunk_profile=ChunkProfile(
            chunk_size=360,
            max_chunk_size=540,
            chunk_overlap=72,
            min_chunk_size=50,
            chunk_policy_version="curriculum_plan_semantic_v1",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
        ),
    )
    return record, chunks


def _build_real_curriculum_runtime_chunks(
    document_title: str,
) -> tuple[DocumentRegistryRecord, tuple[object, ...]]:
    document = next(
        item
        for item in load_default_curriculum_budget_evaluation_documents(include_historical=True)
        if item.title == document_title
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=document.record,
        structured_jsonl_bytes=document.structured_jsonl_bytes,
    )
    return document.record, chunks


__all__ = [name for name in globals() if not name.startswith("__")]
