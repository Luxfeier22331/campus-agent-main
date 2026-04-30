from __future__ import annotations

import json

from campus_ingestion_core.models import DocumentRegistryRecord

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.reads: list[tuple[str, str]] = []
        self.uploads: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
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
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


class CloseoutOnlyRegistry(InMemoryDocumentRegistry):
    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        raise AssertionError("closeout-run preparation must not scan current registry scope")


class FakeCloseoutStore:
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


def make_internal_notice_record(*, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice:muc_internal_portal:355119",
        revision_track="source-faithful",
        version_id="sha256:test-version",
        source_uri="https://portal.example.edu/notice/355119",
        content_hash="sha256:test-content",
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


def make_internal_notice_attachment_record(*, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
        revision_track="source-faithful",
        version_id="sha256:test-attachment-version",
        source_uri="https://portal.example.edu/notice/355119/attachments/1",
        content_hash="sha256:test-attachment-content",
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


def make_verified_closeout_run(*, run_id: str):
    from campus_ingestion_core.authenticated_notice_closeout import CloseoutRun

    return (
        CloseoutRun(
            run_id=run_id,
            bundle_path="/tmp/not-used.json",
            manifest_path=None,
            expected_notice_count=1,
            expected_document_count=1,
            operations_prefix=f"campus_notices/operations/authenticated-notice-closeout/{run_id}",
            corpus="campus_notices",
            collection="internal_notice",
        )
        .mark_planned()
        .mark_running()
        .mark_verifying()
        .mark_verified({"staged_document_count": 1})
    )


def build_staged_document(
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
            "document_units": {"sha256": record.content_hash, "content_length": 256}
        },
    }


def make_internal_notice_document_units_bytes(
    *,
    document_id: str,
    version_id: str,
) -> bytes:
    row = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": "body-001",
        "root_unit_id": "body-001",
        "unit_type": "paragraph",
        "clean_text": "请同学们于4月10日前完成报名，并按照通知要求提交材料。",
        "anchor": {
            "source_uri": f"https://portal.example.edu/notice/{document_id.split(':')[-1]}",
        },
        "metadata": {
            "title": "关于开放2025年度拔尖创新人才证书项目第二轮报名的通知",
            "block_role": "paragraph",
        },
    }
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")
