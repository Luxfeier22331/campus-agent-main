from __future__ import annotations

import json
from pathlib import Path

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk


class _FakeObjectStore:
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
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data


class _OrderedObjectStore(_FakeObjectStore):
    def __init__(self, *, events: list[tuple[str, str | None]]) -> None:
        super().__init__()
        self.events = events
        self.manifest_payloads: list[bytes] = []

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        super().put_bytes(bucket=bucket, key=key, data=data, content_type=content_type)
        self.events.append(("put", key))
        if key.endswith("index-release.json"):
            self.manifest_payloads.append(data)


def _make_document_units_bytes(*, document_id: str, version_id: str, text: str) -> bytes:
    row = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"{document_id}:legacy:0001",
        "clean_text": text,
        "anchor": {
            "section_path": ["Official Web", "News"],
            "page_start": 1,
            "page_end": 1,
        },
        "acl": {"level": "public", "allow_groups": []},
        "metadata": {
            "page_family": "article_detail",
            "unit_type": "page_content",
            "serving_intent": "promotable",
            "content_role": "primary_content",
        },
    }
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


def _make_record(
    *,
    document_id: str,
    version_id: str,
    object_key: str,
    status: str = "active",
    is_current: bool = True,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"https://www.muc.edu.cn/{document_id.split(':')[-1]}.htm",
        content_hash=f"sha256:{document_id}",
        corpus="official_web",
        collection="muc_public_pages",
        cleaning_policy_version="official_web_cleaning_v1",
        entitlement_groups=(),
        visibility_scope=None,
        status=status,
        ingestion_timestamp="2026-04-02T10:00:00+00:00",
        parser_version="official_web_projection_v1",
        embedding_model="mock-embedding-8d",
        source_channel="official_web",
        is_current=is_current,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="official_web_sync",
    )


def _make_regulation_record(
    *,
    document_id: str = "institutional-rule:001",
    version_id: str = "regver:001",
    object_key: str = (
        "regulations/documents/institutional_rules/rule-001/"
        "current-effective/2026/document-units.jsonl"
    ),
    source_channel: str = "authenticated_notice_portal",
    import_source: str = "authenticated_notice_regulation_materialization",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=version_id,
        source_uri=f"authenticated_notice:policy-regulation:{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-05-02T10:00:00+00:00",
        parser_version="institutional_regulation_materialization_v1",
        embedding_model="mock-embedding-8d",
        source_channel=source_channel,
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source=import_source,
    )


def _make_indexable_chunk(
    *,
    record: DocumentRegistryRecord,
    chunk_id: str,
    text: str,
) -> IndexableChunk:
    return IndexableChunk(
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        chunk_id=chunk_id,
        chunk_order=1,
        corpus=record.corpus,
        collection=record.collection,
        entitlement_groups=record.entitlement_groups,
        visibility_scope=record.visibility_scope,
        visibility_level="public",
        source_uri=record.source_uri,
        source_chunk_id=None,
        anchor={"section_path": ["News"]},
        text=text,
        source_channel=record.source_channel,
        is_current=True,
        parser_version=record.parser_version,
        embedding_model="mock-embedding-8d",
        embedding=(0.1, 0.2, 0.3),
        metadata={
            "unit_type": "page_content",
            "final_token_count": 32,
            "page_family": "article_detail",
            "serving_intent": "promotable",
        },
    )


__all__ = [
    "_FakeObjectStore",
    "_OrderedObjectStore",
    "_make_document_units_bytes",
    "_make_indexable_chunk",
    "_make_record",
    "_make_regulation_record",
]
