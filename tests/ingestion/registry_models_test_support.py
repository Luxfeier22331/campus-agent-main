from __future__ import annotations

import json
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.authenticated_notice_closeout_store import (
    PostgresAuthenticatedNoticeCloseoutStore,
    build_authenticated_notice_closeout_store_from_env,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    build_authenticated_notice_file_release_inventory_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.models import (
    DocumentRegistryRecord,
    RawAssetRecord,
    RawAssetRef,
    SourceObservation,
)
from campus_ingestion_core.registry import (
    DEFAULT_DOCUMENT_REGISTRY_TABLE,
    DEFAULT_RAW_ASSET_REGISTRY_TABLE,
    PostgresDocumentRegistry,
    PostgresRawAssetRegistry,
    _document_record_from_dict,
    _ensure_table_schema,
    _raw_asset_record_from_dict,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

HANDBOOK_DOC_UNITS_KEY = (
    "regulations/documents/student_rules/test-001--test-001/"
    "source-faithful/undated/document-units.jsonl"
)
HANDBOOK_PROVIDER_KEY = (
    "official_pdf/student-handbook/undated/sha256/raw-001/provider/"
    "paddleocr-vl-1-5/provider-response.jsonl"
)
HANDBOOK_CANONICAL_KEY = (
    "regulations/documents/student_rules/test-001--test-001/source-faithful/undated/canonical.md"
)
CURRICULUM_DOC_UNITS_KEY = (
    "curriculum/documents/curriculum_plan/plan-001--plan-001/"
    "source-faithful/undated/document-units.jsonl"
)


def _handbook_document_record(
    *, version_id: str, content_hash: str, ingestion_timestamp: str
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-001",
        revision_track="source-faithful",
        version_id=version_id,
        source_uri="campusrag://canonical/regulations/student_rules/docs/test-001.md",
        content_hash=content_hash,
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope=None,
        status="active",
        ingestion_timestamp=ingestion_timestamp,
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        raw_asset=RawAssetRef(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            page_start=10,
            page_end=12,
        ),
        document_units_object_key=HANDBOOK_DOC_UNITS_KEY,
        provider_response_object_key=HANDBOOK_PROVIDER_KEY,
        canonical_markdown_object_key=HANDBOOK_CANONICAL_KEY,
        processed_object_keys=(
            HANDBOOK_PROVIDER_KEY,
            HANDBOOK_CANONICAL_KEY,
            HANDBOOK_DOC_UNITS_KEY,
        ),
        import_source="raw_online_ocr",
    )


def _curriculum_document_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:plan-001",
        revision_track="source-faithful",
        version_id="sha256:raw-001:split:plan-001:abcd1234",
        source_uri="https://campus.example/curriculum/plan-001",
        content_hash="sha256:doc-001",
        corpus="curriculum",
        collection="curriculum_plan",
        entitlement_groups=(),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="curriculum-plan-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        raw_asset=RawAssetRef(
            raw_asset_id="asset:curriculum-plan-master-pdf",
            raw_version_id="sha256:raw-001",
            page_start=1,
            page_end=12,
        ),
        document_units_object_key=CURRICULUM_DOC_UNITS_KEY,
        processed_object_keys=(CURRICULUM_DOC_UNITS_KEY,),
        import_source="raw_online_ocr",
    )


def _handbook_raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:student-handbook-pdf",
        raw_version_id="sha256:raw-001",
        corpus="regulations",
        collection="student_rules",
        raw_source_uri="campusrag://raw/regulations/student_rules/student-handbook.pdf",
        content_hash="raw-001",
        source_filename="student-handbook.pdf",
        object_key=(
            "official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf"
        ),
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


def _curriculum_raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:curriculum-plan-master-pdf",
        raw_version_id="sha256:raw-002",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="https://campus.example/curriculum/master.pdf",
        content_hash="raw-002",
        source_filename="curriculum-plan.pdf",
        object_key=(
            "official_pdf/curriculum-plan-master/undated/sha256/raw-002/capture/curriculum-plan.pdf"
        ),
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


__all__ = [
    "DEFAULT_DOCUMENT_REGISTRY_TABLE",
    "DEFAULT_POLICY_PROJECTION_VERSION",
    "DEFAULT_RAW_ASSET_REGISTRY_TABLE",
    "HANDBOOK_CANONICAL_KEY",
    "HANDBOOK_DOC_UNITS_KEY",
    "HANDBOOK_PROVIDER_KEY",
    "DocumentRegistryRecord",
    "InMemoryDocumentRegistry",
    "InMemoryRawAssetRegistry",
    "Path",
    "PostgresAuthenticatedNoticeCloseoutStore",
    "PostgresDocumentRegistry",
    "PostgresRawAssetRegistry",
    "RawAssetRecord",
    "RawAssetRef",
    "SourceObservation",
    "TemporaryDirectory",
    "_curriculum_document_record",
    "_curriculum_raw_asset_record",
    "_document_record_from_dict",
    "_ensure_table_schema",
    "_handbook_document_record",
    "_handbook_raw_asset_record",
    "_raw_asset_record_from_dict",
    "asdict",
    "build_authenticated_notice_closeout_store_from_env",
    "build_authenticated_notice_file_release_inventory_store_from_env",
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_document_registry_from_env",
    "build_raw_asset_registry_from_env",
    "json",
    "patch",
    "replace",
    "unittest",
]
