from __future__ import annotations

import copy

import json

import unittest

from campus_ingestion_core.collected_notice_regulation_first_batch_documents import (
    build_document_import_input,
)

from campus_ingestion_core.collected_notice_regulation_first_batch_promotion import (
    FIRST_BATCH_SELECTION_SCHEMA_VERSION,
    PHASE_09_ID,
    build_first_batch_regulation_selection,
    harden_first_batch_regulation_registry_provenance,
    materialize_first_batch_regulation_selection,
)

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)

from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


def _candidate_audit() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_candidate_audit.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "candidates": [
            _candidate("594", "institutional_rules", "institutional_rules_candidate"),
            _candidate("620", "scoped_rules", "scoped_rules_candidate"),
            {
                **_candidate("477", None, "needs_multimodal"),
                "consumption_class": "needs_multimodal",
                "owner_text_status": "not_ready",
            },
            {
                **_candidate("481", None, "manual_review"),
                "consumption_class": "defer",
            },
        ],
        "class_counts": {
            "institutional_rules_candidate": 1,
            "scoped_rules_candidate": 1,
            "needs_multimodal": 1,
            "manual_review": 1,
        },
    }


def _candidate(
    source_notice_id: str,
    target_collection: str | None,
    regulation_class: str,
) -> dict[str, object]:
    return {
        "source_notice_id": source_notice_id,
        "source_document_id": f"file-release:muc_internal_portal:{source_notice_id}",
        "source_url": f"https://my.muc.edu.cn/file/{source_notice_id}.pdf",
        "source_object_refs": [_source_ref(source_notice_id, "released_file")],
        "title": f"测试规章 {source_notice_id}",
        "regulation_title_normalized": f"测试规章 {source_notice_id}",
        "issuing_org": "中央民族大学",
        "consumption_class": "downstream_admitted",
        "regulation_admission_class": regulation_class,
        "target_collection": target_collection,
        "target_identity_preview": (
            f"institutional_regulation:muc:{source_notice_id}" if target_collection else None
        ),
        "owner_text_status": "ready",
        "owner_text_recovery": {
            "written_refs": {"searchable_merge_input": _source_ref(source_notice_id, "owner_text")}
        },
    }


def _consistency_report() -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_materialization_consistency.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "verdict": "passed",
        "failure_reason_codes": [],
        "counts": {
            "downstream_admitted": 2,
            "institutional_rules_document_count": 1,
            "scoped_rules_document_count": 1,
            "skipped_not_admitted": 2,
            "duplicate_target_document_id_count": 0,
            "normalization_failed_document_count": 0,
            "normalization_flagged_document_count": 0,
        },
    }


def _materialization_report(
    *,
    target_collection: str,
    documents: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "schema_version": "collected_notice_regulation_materialization_preview.v1",
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "release_publish_enabled": False,
        "query_serving_enabled": False,
        "target": "regulation",
        "target_collection": target_collection,
        "target_surface": f"regulations/{target_collection}",
        "document_count": len(documents),
        "documents": documents,
    }


def _target_document(
    *,
    source_notice_id: str,
    collection: str,
    quality_verdict: str = "passed",
    canonical_markdown: str | None = None,
) -> dict[str, object]:
    title = f"测试规章 {source_notice_id}"
    content_role_prefix = "regulation" if collection == "institutional_rules" else "scoped_rule"
    return {
        "schema_version": "collected_notice_regulation_target_document_preview.v1",
        "target": "regulation",
        "target_collection": collection,
        "target_surface": f"regulations/{collection}",
        "target_document_id": f"institutional_regulation:muc:{source_notice_id}",
        "target_identity_preview": f"institutional_regulation:muc:{source_notice_id}",
        "candidate_key": f"candidate:{source_notice_id}",
        "title": title,
        "issuing_org": "中央民族大学",
        "canonical_markdown": canonical_markdown
        or f"# {title}\n\n第一条 为测试第一批规章提升，制定本办法。\n\n第二条 本办法用于验证 selected write gate。\n",
        "normalization_quality": {
            "target_collection": collection,
            "target_document_id": f"institutional_regulation:muc:{source_notice_id}",
            "source_notice_ids": [source_notice_id],
            "title": title,
            "wrapper_removed": True,
            "suspicious_prefix": False,
            "title_occurrence_count": 2,
            "chapter_count": 0,
            "article_count": 2,
            "page_artifact_count": 0,
            "unit_count": 2,
            "soft_wrap_repair_count": 0,
            "soft_wrap_residue_count": 0,
            "readability_normalization_count": 0,
            "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
            "quality_verdict": quality_verdict,
            "reason_codes": [] if quality_verdict == "passed" else ["soft_wrap_residue"],
        },
        "source_notice_ids": [source_notice_id],
        "source_notice_release_time": "2024-11-16 18:58:28",
        "document_nature": "annual_cycle_rule" if collection == "scoped_rules" else None,
        "cycle_year": "2024" if collection == "scoped_rules" else None,
        "school_unit_name": "新闻与传播学院" if collection == "scoped_rules" else None,
        "source_document_ids": [f"file-release:muc_internal_portal:{source_notice_id}"],
        "source_urls": [f"https://my.muc.edu.cn/file/{source_notice_id}.pdf"],
        "source_scope": {
            "source_channel": "authenticated_notice_portal",
            "source_surface": "file_release",
            "source_corpus": "authenticated_documents",
            "source_collection": "file_release_source",
        },
        "source_object_refs": [_source_ref(source_notice_id, "released_file")],
        "owner_text_recovery": {
            "written_refs": {"searchable_merge_input": _source_ref(source_notice_id, "owner_text")}
        },
        "no_write_boundary": {
            "db_writes_enabled": False,
            "object_store_writes_enabled": False,
            "release_publish_enabled": False,
            "query_serving_enabled": False,
        },
        "test_content_role_prefix": content_role_prefix,
    }


def _source_ref(source_notice_id: str, role: str) -> dict[str, object]:
    return {
        "bucket": "campus-rag-source",
        "key": f"source/{source_notice_id}/{role}.json",
        "role": role,
    }


def _source_ref_objects() -> dict[tuple[str, str], bytes]:
    objects: dict[tuple[str, str], bytes] = {}
    for notice_id in ("594", "620"):
        for role in ("released_file", "owner_text"):
            ref = _source_ref(notice_id, role)
            objects[(str(ref["bucket"]), str(ref["key"]))] = b"{}"
    return objects


def _existing_scoped_rule_record(
    *,
    document_id: str = "existing:scoped-rule",
    units_key: str = "regulations/documents/scoped_rules/existing/document-units.jsonl",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id="sha256:existing",
        source_uri="campusrag://existing/scoped-rule",
        content_hash="sha256:existing",
        corpus="regulations",
        collection="scoped_rules",
        cleaning_policy_version="scoped_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-29T00:00:00+00:00",
        parser_version="collected_notice_regulation_first_batch_promotion_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="test",
    )


def _existing_regulation_record(
    *,
    document_id: str,
    collection: str,
) -> DocumentRegistryRecord:
    units_key = f"regulations/documents/{collection}/existing/document-units.jsonl"
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id="sha256:existing",
        source_uri="campusrag://manual/regulation",
        content_hash="sha256:existing",
        corpus="regulations",
        collection=collection,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-29T00:00:00+00:00",
        parser_version="collected_notice_regulation_first_batch_promotion_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="test",
    )


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        "EMBEDDING_MODEL": "mock-embedding-8d",
    }


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = copy.deepcopy(objects or {})
        self.puts: list[tuple[str, str, bytes, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.puts.append((bucket, key, data, content_type))


__all__ = [name for name in globals() if not name.startswith("__")]
