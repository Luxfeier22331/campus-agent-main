from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.answer_ready_contract_quality import (
    evaluate_answer_ready_contract_metadata,
    is_answer_ready_contract_issue,
)
from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.process_candidate_aggregation import (
    build_collection_semantic_metadata,
)
from campus_ingestion_core.process_candidate_postprocess import (
    build_student_rules_category_overview_candidate,
    build_student_rules_category_overview_candidates,
)
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.regulation_answer_roles import decide_answer_role
from campus_ingestion_core.regulation_chunking import build_regulation_unit_pieces
from campus_ingestion_core.regulation_evidence_contract import (
    build_answer_ready_contract_metadata,
    infer_condition_group_id,
    infer_condition_polarity,
)

from tests.ingestion._handbook_chunking_test_support import (
    build_hermetic_handbook_v3_chunk_profile,
)


def _registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-doc",
        revision_track="source-faithful",
        version_id="v1:test-doc",
        source_uri="campus-agent://regulations/student_rules/docs/handbook:test-doc",
        content_hash="sha256:test-doc",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-23T12:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="student_rules",
            document_id="handbook:test-doc",
            revision_track="source-faithful",
            version_id="v1:test-doc",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(
            build_processed_artifact_key(
                corpus="regulations",
                collection="student_rules",
                document_id="handbook:test-doc",
                revision_track="source-faithful",
                version_id="v1:test-doc",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
        ),
        import_source="raw_online_ocr",
    )


def _registry_record_for_document(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"v1:{document_id}",
        source_uri=f"campus-agent://regulations/student_rules/docs/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-23T12:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        import_source="raw_online_ocr",
    )


def _institutional_registry_record(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"owregver:{document_id}",
        source_uri=f"https://www.muc.edu.cn/{document_id}.htm",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        status="active",
        ingestion_timestamp="2026-05-07T00:00:00+00:00",
        parser_version="official-web-regulation-source-truth-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="official_web",
        import_source="official_web_regulation_source_truth_materialization",
    )


def _structured_row(
    *,
    doc_id: str = "handbook:test-doc",
    version_id: str = "v1:test-doc",
    unit_type: str,
    clean_text: str,
    root_unit_id: str,
    chunk_id: str | None = None,
    anchor: dict[str, object] | None = None,
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id or root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": anchor or {"page_start": 1, "page_end": 1},
        "metadata": metadata or {},
        "acl": {"level": "public", "allow_groups": []},
    }
