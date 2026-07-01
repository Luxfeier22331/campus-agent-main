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

from campus_ingestion_core.split_manifest import (
    SplitManifest,
    SplitManifestDocument,
    load_split_manifest,
)
from tests.ingestion._handbook_chunking_test_support import (
    build_hermetic_curriculum_chunk_profile,
)

SYNTHETIC_PUBLIC_AFFAIRS_TITLE = "示例公共事务本科人才培养方案"
SYNTHETIC_DATA_SYSTEMS_TITLE = "示例数据系统本科人才培养方案"
SYNTHETIC_PUBLIC_AFFAIRS_ID = f"curriculum:{SYNTHETIC_PUBLIC_AFFAIRS_TITLE}"
SYNTHETIC_DATA_SYSTEMS_ID = f"curriculum:{SYNTHETIC_DATA_SYSTEMS_TITLE}"


def _synthetic_curriculum_split_manifest() -> SplitManifest:
    return SplitManifest(
        manifest_version="curriculum_plan_split_manifest_synthetic_fixture_v1",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_asset_id="asset:synthetic-curriculum-plan",
        documents=(
            SplitManifestDocument(
                document_id=SYNTHETIC_PUBLIC_AFFAIRS_ID,
                title=SYNTHETIC_PUBLIC_AFFAIRS_TITLE,
                page_start=278,
                page_end=288,
            ),
            SplitManifestDocument(
                document_id=SYNTHETIC_DATA_SYSTEMS_ID,
                title=SYNTHETIC_DATA_SYSTEMS_TITLE,
                page_start=289,
                page_end=297,
            ),
        ),
    )


def _make_curriculum_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:test-001",
        revision_track="source-faithful",
        version_id="sha256:test-001:split:test-001:abc123",
        source_uri="campus-agent://source/curriculum/synthetic-curriculum-plan/sha256/test/capture/pages/20-21",
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
        source_uri="campus-agent://source/curriculum/test-public/pages/1-1",
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
    manifest = _synthetic_curriculum_split_manifest()
    layout_rows = _load_layout_elements_rows(
        Path(
            "packages/ingestion-core/testdata/curriculum_plan/layout-elements.synthetic.jsonl"
        ).read_bytes()
    )
    target_document = next(item for item in manifest.documents if item.document_id == document_id)
    raw_version_id = "sha256:synthetic-curriculum-plan-fixture"
    document_input = _build_split_manifest_document_input(
        raw_asset_record=type(
            "RawAssetRecordProxy",
            (),
            {
                "raw_asset_id": "asset:synthetic-curriculum-plan",
                "raw_version_id": raw_version_id,
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "raw_source_uri": "file:///tmp/synthetic-curriculum-plan.pdf",
                "content_hash": raw_version_id.removeprefix("sha256:"),
                "source_filename": "synthetic-curriculum-plan.pdf",
                "object_key": "official_pdf/curriculum-plan/synthetic/sha256/test/capture/synthetic-curriculum-plan.pdf",
                "ingestion_timestamp": "2026-03-24T10:00:00+00:00",
                "import_source": "raw_online_ocr",
            },
        )(),
        manifest_version=manifest.manifest_version,
        manifest_document=target_document,
        structured_rows=layout_rows,
        provider_response_key="official_pdf/curriculum-plan/synthetic/sha256/test/provider/vlm/provider-response.jsonl",
        layout_elements_key="official_pdf/curriculum-plan/synthetic/sha256/test/source-truth/layout-elements.jsonl",
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
        chunk_profile=build_hermetic_curriculum_chunk_profile(),
    )
    return document.record, chunks


__all__ = [name for name in globals() if not name.startswith("__")]
