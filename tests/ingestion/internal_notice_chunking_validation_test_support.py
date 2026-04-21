from __future__ import annotations

import json
from dataclasses import replace

from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry


def chunking_test_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
    }


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

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


class _ManifestOnlyRegistry(InMemoryDocumentRegistry):
    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        raise AssertionError("manifest-based validation must not scan the full registry scope")


class _FakeCloseoutStore:
    def __init__(self, *, run, staged_documents: tuple[dict[str, object], ...]) -> None:
        self.run = run
        self.staged_documents = staged_documents

    def get_run(self, run_id: str):
        if self.run is None or self.run.run_id != run_id:
            return None
        return self.run

    def get_staged_documents(self, run_id: str) -> tuple[dict[str, object], ...]:
        if self.run is None or self.run.run_id != run_id:
            return ()
        return self.staged_documents


def _make_notice_record(
    *, document_id: str, source_uri: str, object_key: str
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{document_id.split(':')[-1]}-version",
        source_uri=source_uri,
        content_hash=f"sha256:{document_id.split(':')[-1]}-content",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="authenticated_notice_source_projection",
    )


def _jsonl_bytes(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _make_closeout_run(*, run_id: str, state: str = "verified"):
    from campus_ingestion_core.authenticated_notice_closeout import CloseoutRun
    from campus_ingestion_core.authenticated_notice_closeout_models import CloseoutRunState

    run = CloseoutRun(
        run_id=run_id,
        bundle_path="/tmp/not-used.json",
        manifest_path=None,
        expected_notice_count=1,
        expected_document_count=1,
        operations_prefix=f"campus_notices/operations/authenticated-notice-closeout/{run_id}",
        corpus="campus_notices",
        collection="internal_notice",
    )
    if state == "verified":
        return (
            run.mark_planned()
            .mark_running()
            .mark_verifying()
            .mark_verified({"staged_document_count": 1})
        )
    return replace(run, state=CloseoutRunState(state))


def _build_staged_document(
    *,
    record: DocumentRegistryRecord,
    staged_document_units_key: str,
) -> dict[str, object]:
    return {
        "document": {
            "document_id": record.document_id,
            "revision_track": record.revision_track,
            "version_id": record.version_id,
            "source_label": record.source_uri,
            "metadata": {
                "document_id": record.document_id,
                "version_id": record.version_id,
                "source_url": record.source_uri,
                "entitlement_groups": list(record.entitlement_groups),
                "visibility_scope": record.visibility_scope,
                "visibility_level": record.visibility_level,
                "policy_projection_version": record.policy_projection_version,
            },
            "import_source": record.import_source,
            "source_channel": record.source_channel,
            "is_current": record.is_current,
            "corpus": record.corpus,
            "collection": record.collection,
            "visibility_scope": record.visibility_scope,
            "status": record.status,
            "raw_source_uri": record.source_uri,
            "raw_asset_id": None,
            "raw_version_id": None,
            "provider_response_object_key": record.provider_response_object_key,
            "layout_elements_object_key": record.layout_elements_object_key,
            "additional_processed_object_keys": [],
            "processed_object_keys": list(record.processed_object_keys),
            "title": record.document_id,
            "year": None,
            "parser_version": record.parser_version,
            "embedding_model": record.embedding_model,
            "cleaning_policy_version": record.cleaning_policy_version,
        },
        "staged_object_keys": {"document_units": staged_document_units_key},
        "final_object_keys": {"document_units": str(record.document_units_object_key)},
        "content_hash": record.content_hash,
        "staged_object_metadata": {
            "document_units": {"sha256": record.content_hash, "content_length": 128}
        },
    }


def _make_inventory_entry(
    *,
    record: DocumentRegistryRecord,
    notice_risk_label: str,
    attachment_mix_score: int,
    attachment_ref_count: int,
    has_text_table_attachment: bool = False,
    has_spatial_attachment: bool = False,
    has_reference_only_attachment: bool = False,
) -> dict[str, object]:
    notice_id = record.document_id.split(":")[2]
    return {
        "corpus": record.corpus,
        "collection": record.collection,
        "notice_id": notice_id,
        "site_id": "muc_internal_portal",
        "document_id": f"notice:muc_internal_portal:{notice_id}",
        "revision_track": "source-faithful",
        "version_id": f"sha256:{notice_id}-inventory",
        "raw_asset_id": f"raw-{notice_id}",
        "raw_version_id": "v1",
        "source_home_url": "https://portal.example.edu",
        "embedding_model": record.embedding_model,
        "notice_manifest_key": f"source-truth/{notice_id}/notice-manifest.json",
        "content_blocks_key": f"source-truth/{notice_id}/content-blocks.jsonl",
        "attachment_refs_key": f"source-truth/{notice_id}/attachment-refs.jsonl",
        "attachment_document_count": 0,
        "attachment_ref_count": attachment_ref_count,
        "text_extractable_count": 1 if has_text_table_attachment else 0,
        "ocr_required_count": 0,
        "reference_only_count": 1 if has_reference_only_attachment else 0,
        "manual_review_required_count": 1 if has_spatial_attachment else 0,
        "notice_risk_label": notice_risk_label,
        "attachment_mix_score": attachment_mix_score,
        "has_text_table_attachment": has_text_table_attachment,
        "has_spatial_attachment": has_spatial_attachment,
        "has_reference_only_attachment": has_reference_only_attachment,
        "planning_weight": 1,
        "parent_snapshot": {
            "notice_id": notice_id,
            "document_id": f"notice:muc_internal_portal:{notice_id}",
            "notice_risk_label": notice_risk_label,
            "attachment_mix_score": attachment_mix_score,
            "attachment_ref_count": attachment_ref_count,
            "has_text_table_attachment": has_text_table_attachment,
            "has_spatial_attachment": has_spatial_attachment,
            "has_reference_only_attachment": has_reference_only_attachment,
        },
    }


def _make_frozen_inventory_payload(
    *,
    run_id: str,
    notice_id: str,
    notice_risk_label: str,
    attachment_mix_score: int,
    attachment_ref_count: int,
    has_text_table_attachment: bool = False,
    has_spatial_attachment: bool = False,
    has_reference_only_attachment: bool = False,
) -> bytes:
    return json.dumps(
        {
            "run_id": run_id,
            "input_kind": "source_truth_replay",
            "selected_notice_ids": [notice_id],
            "notice_risk_counts": {notice_risk_label: 1},
            "high_risk_notice_count": 1 if has_spatial_attachment else 0,
            "site_id": "muc_internal_portal",
            "source_home_url": "https://portal.example.edu",
            "embedding_model": "Qwen3-Embedding-4B",
            "expected_notice_count": 1,
            "expected_document_count": 1,
            "expected_attachment_document_count": 0,
            "expected_ocr_candidate_count": 0,
            "expected_raw_asset_count": 1,
            "parents": [
                {
                    "notice_id": notice_id,
                    "document_id": f"notice:muc_internal_portal:{notice_id}",
                    "notice_risk_label": notice_risk_label,
                    "attachment_mix_score": attachment_mix_score,
                    "attachment_ref_count": attachment_ref_count,
                    "has_text_table_attachment": has_text_table_attachment,
                    "has_spatial_attachment": has_spatial_attachment,
                    "has_reference_only_attachment": has_reference_only_attachment,
                }
            ],
        },
        ensure_ascii=False,
    ).encode("utf-8")


def _parent_notice_rows(
    *,
    record: DocumentRegistryRecord,
    title: str,
    body_lines: tuple[str, ...],
    with_title_unit: bool = True,
    title_in_body_metadata: bool = True,
) -> bytes:
    rows: list[dict[str, object]] = []
    if with_title_unit:
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": "title-001",
                "root_unit_id": "title-001",
                "unit_type": "policy_page",
                "text": title,
                "raw_text": title,
                "clean_text": title,
                "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                "metadata": {
                    "block_role": "title",
                    **({"title": title} if title_in_body_metadata else {}),
                },
            }
        )
    for index, line in enumerate(body_lines, start=1):
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": f"body-{index:03d}",
                "root_unit_id": f"body-{index:03d}",
                "unit_type": "article_body",
                "text": line,
                "raw_text": line,
                "clean_text": line,
                "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                "metadata": {
                    "block_role": "paragraph",
                    **({"title": title} if title_in_body_metadata else {}),
                },
            }
        )
    return _jsonl_bytes(rows)


def _attachment_rows(
    *,
    record: DocumentRegistryRecord,
    title: str,
    filename: str,
    extraction_class: str,
    body_blocks: tuple[str, ...],
) -> bytes:
    shared_metadata = {
        "projection_name": "internal_notice_attachment_documents",
        "parent_document_id": "notice:muc_internal_portal:355119",
        "attachment_ref_id": "attachment-0001",
        "attachment_kind": "office_document_attachment",
        "attachment_role": "notice_attachment_document",
        "attachment_filename": filename,
        "attachment_mime_type": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            if extraction_class == "text_extractable"
            else "image/png"
        ),
        "extraction_class": extraction_class,
    }
    rows = [
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": "attachment-title",
            "root_unit_id": "attachment-title",
            "unit_type": "attachment_title",
            "text": title,
            "raw_text": title,
            "clean_text": title,
            "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
            "metadata": dict(shared_metadata),
        }
    ]
    for index, block in enumerate(body_blocks, start=1):
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": f"attachment-body-{index:04d}",
                "root_unit_id": f"attachment-body-{index:04d}",
                "unit_type": "attachment_body",
                "text": block,
                "raw_text": block,
                "clean_text": block,
                "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                "metadata": dict(shared_metadata),
            }
        )
    return _jsonl_bytes(rows)
