from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Protocol, Sequence
import uuid

from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.schema import NodeRelationship, RelatedNodeInfo, TextNode
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_ingestion_core.chunking import (
    ChunkProfile,
    StructuredUnitChunkInput,
    build_student_handbook_chunk_profile,
    chunk_structured_unit,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.curriculum_chunk_units import build_curriculum_structured_units, chunk_curriculum_unit
from campus_ingestion_core.models import DocumentRegistryRecord


class ProcessArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class StructuredUnit:
    unit_index: int
    document_id: str
    version_id: str
    text: str
    source_chunk_id: str | None
    anchor: dict[str, object]
    acl_level: str
    unit_type: str
    root_unit_id: str
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IndexableChunk:
    document_id: str
    revision_track: str
    version_id: str
    chunk_id: str
    chunk_order: int
    corpus: str
    collection: str
    acl_groups: tuple[str, ...]
    campus_scope: str | None
    source_uri: str
    source_chunk_id: str | None
    acl_level: str
    anchor: dict[str, object]
    text: str
    source_channel: str
    is_current: bool
    parser_version: str
    embedding_model: str
    embedding: tuple[float, ...] | None = None
    metadata: dict[str, object] = field(default_factory=dict)

    def to_node(self) -> TextNode:
        node = TextNode(
            id_=str(uuid.uuid5(uuid.NAMESPACE_URL, self.chunk_id)),
            text=self.text,
            metadata={
                "document_id": self.document_id,
                "revision_track": self.revision_track,
                "representation": self.revision_track,
                "version_id": self.version_id,
                "chunk_id": self.chunk_id,
                "chunk_order": self.chunk_order,
                "corpus": self.corpus,
                "collection": self.collection,
                "acl_groups": list(self.acl_groups),
                "campus_scope": self.campus_scope,
                "source_uri": self.source_uri,
                "source_chunk_id": self.source_chunk_id,
                "acl_level": self.acl_level,
                "anchor": self.anchor,
                "source_channel": self.source_channel,
                "is_current": self.is_current,
                "parser_version": self.parser_version,
                "embedding_model": self.embedding_model,
                **self.metadata,
            },
            relationships={
                NodeRelationship.SOURCE: RelatedNodeInfo(
                    node_id=self.document_id,
                    metadata={
                        "revision_track": self.revision_track,
                        "representation": self.revision_track,
                        "version_id": self.version_id,
                        "source_uri": self.source_uri,
                    },
                )
            },
        )
        if self.embedding is not None:
            node.embedding = list(self.embedding)
        return node


def build_indexable_chunks_from_jsonl(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
) -> tuple[IndexableChunk, ...]:
    runtime_profile = _resolve_chunk_profile(record=record, chunk_profile=chunk_profile)
    units = _load_structured_units(record=record, structured_jsonl_bytes=structured_jsonl_bytes)
    if not units:
        return ()
    table_roots_with_rows = {
        unit.root_unit_id
        for unit in units
        if unit.unit_type == "table_row"
    }

    chunks: list[IndexableChunk] = []
    chunk_order = 0
    for unit in units:
        if unit.unit_type == "table" and unit.root_unit_id in table_roots_with_rows:
            continue
        if record.collection == "curriculum_plan":
            pieces = chunk_curriculum_unit(unit=unit, chunk_profile=runtime_profile)
        else:
            pieces = chunk_structured_unit(
                unit=StructuredUnitChunkInput(
                    unit_type=unit.unit_type,
                    root_unit_id=unit.root_unit_id,
                    text=unit.text,
                ),
                chunk_profile=runtime_profile,
            )
        for piece in pieces:
            chunk_order += 1
            chunk_id = (
                f"{record.document_id}:{record.revision_track}:{record.version_id}:chunk-{chunk_order:04d}"
            )
            retrieval_text = _build_chunk_text(unit=unit, piece=piece, chunk_profile=runtime_profile)
            embedding = _embed_text(retrieval_text, embedding_model)
            chunks.append(
                IndexableChunk(
                    document_id=record.document_id,
                    revision_track=record.revision_track,
                    version_id=record.version_id,
                    chunk_id=chunk_id,
                    chunk_order=chunk_order,
                    corpus=record.corpus,
                    collection=record.collection,
                    acl_groups=record.acl_groups,
                    campus_scope=record.campus_scope,
                    source_uri=record.source_uri,
                    source_chunk_id=unit.source_chunk_id,
                    acl_level=_resolve_effective_acl_level(
                        unit_acl_level=unit.acl_level,
                        document_acl_groups=record.acl_groups,
                    ),
                    anchor=unit.anchor,
                    text=retrieval_text,
                    source_channel=record.source_channel,
                    is_current=record.is_current,
                    parser_version=record.parser_version,
                    embedding_model=record.embedding_model,
                    embedding=embedding,
                    metadata={
                        "unit_type": piece.unit_type,
                        "root_unit_id": piece.root_unit_id,
                        "segment_index": piece.segment_index,
                        "segment_total": piece.segment_total,
                        "split_reason": piece.split_reason,
                        "boundary_rule": piece.boundary_rule,
                        "strategy_name": runtime_profile.strategy_name,
                        "split_strategy": runtime_profile.split_strategy,
                        "chunk_policy_version": runtime_profile.chunk_policy_version,
                        "cleaning_policy_version": runtime_profile.cleaning_policy_version,
                        **unit.metadata,
                        "display_text": piece.text,
                        "contextualized_text": retrieval_text != piece.text,
                    },
                )
            )
    return tuple(chunks)


def build_indexable_chunks_from_record(
    *,
    record: DocumentRegistryRecord,
    object_store: ProcessArtifactReader,
    bucket: str,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
) -> tuple[IndexableChunk, ...]:
    document_units_key = record.document_units_object_key
    if not document_units_key:
        raise ValueError("document_units_object_key is required to build indexable chunks")
    structured_jsonl_bytes = object_store.get_bytes(bucket=bucket, key=document_units_key)
    return build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=structured_jsonl_bytes,
        chunk_profile=chunk_profile,
        embedding_model=embedding_model,
    )


def index_chunks_to_qdrant(
    *,
    chunks: Sequence[IndexableChunk],
    qdrant_client: QdrantClient,
    collection_name: str,
) -> tuple[str, ...]:
    if not chunks:
        return ()
    vector_store = QdrantVectorStore(
        collection_name=collection_name,
        client=qdrant_client,
        index_doc_id=not _is_local_qdrant_backend(qdrant_client),
    )
    ids = vector_store.add([chunk.to_node() for chunk in chunks])
    _ensure_payload_indexes(qdrant_client=qdrant_client, collection_name=collection_name)
    return tuple(str(item) for item in ids)


def _load_structured_units(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
    if record.collection == "curriculum_plan":
        return tuple(build_curriculum_structured_units(record=record, structured_jsonl_bytes=structured_jsonl_bytes))
    units: list[StructuredUnit] = []
    for unit_index, line in enumerate(structured_jsonl_bytes.decode("utf-8").splitlines()):
        normalized = line.strip()
        if not normalized:
            continue
        raw = json.loads(normalized)
        if str(raw.get("chunk_id") or "").strip() == "document-0000":
            raise ValueError("structured input must not contain synthetic document-0000 rows")
        doc_id = str(raw.get("doc_id") or "").strip()
        version_id = str(raw.get("version_id") or "").strip()
        if doc_id != record.document_id:
            raise ValueError(
                f"structured doc_id {doc_id!r} does not match registry document_id {record.document_id!r}"
            )
        if version_id != record.version_id:
            raise ValueError(
                f"structured version_id {version_id!r} does not match registry version_id {record.version_id!r}"
            )
        text = _resolve_structured_text(raw)
        units.append(
            StructuredUnit(
                unit_index=unit_index,
                document_id=doc_id,
                version_id=version_id,
                text=text,
                source_chunk_id=_normalize_optional_text(raw.get("chunk_id")),
                anchor=_normalize_anchor(raw.get("anchor")),
                acl_level=_normalize_acl_level(raw.get("acl")),
                unit_type=_normalize_unit_type(raw.get("unit_type")),
                root_unit_id=_normalize_root_unit_id(raw),
                metadata=_normalize_unit_metadata(raw),
            )
        )
    return tuple(units)


def _resolve_chunk_profile(
    *,
    record: DocumentRegistryRecord,
    chunk_profile: ChunkProfile | None,
) -> ChunkProfile:
    if chunk_profile is not None:
        return chunk_profile
    if record.collection == "curriculum_plan":
        raise ValueError("curriculum_plan chunking requires explicit chunk_profile")
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    if record.collection == "student_handbook":
        return build_student_handbook_chunk_profile(
            profile_version=runtime_profile.chunk_profile_version,
            model_name=record.embedding_model,
        )
    return ChunkProfile()


def _resolve_structured_text(raw: dict[str, object]) -> str:
    for field_name in ("clean_text", "raw_text", "text"):
        value = raw.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise ValueError("structured unit must contain clean_text, raw_text, or text")


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_anchor(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_acl_level(value: object) -> str:
    if not isinstance(value, dict):
        return "public"
    allow_groups = value.get("allow_groups")
    if isinstance(allow_groups, list) and any(isinstance(item, str) and item.strip() for item in allow_groups):
        return "restricted"
    acl_level = value.get("level")
    if not isinstance(acl_level, str) or not acl_level.strip():
        return "public"
    return acl_level.strip()


def _resolve_effective_acl_level(
    *,
    unit_acl_level: str,
    document_acl_groups: tuple[str, ...],
) -> str:
    if document_acl_groups and unit_acl_level == "public":
        return "restricted"
    return unit_acl_level


def _normalize_unit_type(value: object) -> str:
    if not isinstance(value, str):
        return "policy_page"
    normalized = value.strip()
    return normalized or "policy_page"


def _normalize_root_unit_id(raw: dict[str, object]) -> str:
    root_unit_id = raw.get("root_unit_id")
    if isinstance(root_unit_id, str) and root_unit_id.strip():
        return root_unit_id.strip()
    source_chunk_id = raw.get("chunk_id")
    if isinstance(source_chunk_id, str) and source_chunk_id.strip():
        return source_chunk_id.strip()
    return f"{raw.get('doc_id', '')}:{raw.get('version_id', '')}:root"


def _normalize_unit_metadata(raw: dict[str, object]) -> dict[str, object]:
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    normalized: dict[str, object] = {}
    for key, value in metadata.items():
        if isinstance(key, str) and key.strip():
            normalized[key.strip()] = value
    return normalized


def _build_chunk_text(
    *,
    unit: StructuredUnit,
    piece: StructuredUnitChunkInput | object,
    chunk_profile: ChunkProfile,
) -> str:
    display_text = getattr(piece, "text", "")
    if not isinstance(display_text, str) or not display_text.strip():
        return ""

    title = unit.metadata.get("title")
    policy_doc_no = unit.metadata.get("policy_doc_no")
    preface_text = unit.metadata.get("preface_text")
    has_document_context = any(
        isinstance(value, str) and value.strip()
        for value in (title, policy_doc_no, preface_text)
    )
    if not has_document_context:
        return display_text

    section_path = unit.anchor.get("section_path")
    normalized_section_path = (
        [str(item).strip() for item in section_path if str(item).strip()]
        if isinstance(section_path, list)
        else []
    )
    article_label = unit.anchor.get("article_label")
    provision_label = unit.anchor.get("provision_label")
    table_context = unit.anchor.get("table_context")
    title_text = title.strip() if isinstance(title, str) and title.strip() else None
    doc_no_text = policy_doc_no.strip() if isinstance(policy_doc_no, str) and policy_doc_no.strip() else None
    article_text = article_label.strip() if isinstance(article_label, str) and article_label.strip() else None
    provision_text = provision_label.strip() if isinstance(provision_label, str) and provision_label.strip() else None
    table_text = table_context.strip() if isinstance(table_context, str) and table_context.strip() else None

    header_candidates: list[str] = []
    full_header_parts: list[str] = []
    if title_text:
        full_header_parts.append(f"标题：{title_text}")
    if normalized_section_path:
        full_header_parts.append(f"章节：{' > '.join(normalized_section_path)}")
    if article_text:
        full_header_parts.append(f"条款：{article_text}")
    elif provision_text:
        full_header_parts.append(f"款项：{provision_text}")
    elif table_text:
        full_header_parts.append(f"表格：{table_text}")
    if full_header_parts:
        header_candidates.append(" | ".join(full_header_parts))

    compact_header_parts: list[str] = []
    if title_text:
        compact_header_parts.append(f"标题：{title_text}")
    if normalized_section_path:
        compact_header_parts.append(f"章节：{normalized_section_path[-1]}")
    if article_text:
        compact_header_parts.append(f"条款：{article_text}")
    elif provision_text:
        compact_header_parts.append(f"款项：{provision_text}")
    elif table_text:
        compact_header_parts.append(f"表格：{table_text}")
    compact_header = " | ".join(compact_header_parts)
    if compact_header and compact_header not in header_candidates:
        header_candidates.append(compact_header)

    compact_identity_parts: list[str] = []
    if title_text:
        compact_identity_parts.append(title_text)
    if normalized_section_path:
        compact_identity_parts.append(normalized_section_path[-1])
    if article_text:
        compact_identity_parts.append(article_text)
    elif provision_text:
        compact_identity_parts.append(provision_text)
    elif table_text:
        compact_identity_parts.append(table_text)
    compact_identity = " / ".join(compact_identity_parts)
    if compact_identity and compact_identity not in header_candidates:
        header_candidates.append(compact_identity)

    if not normalized_section_path and title_text and title_text not in header_candidates:
        header_candidates.append(title_text)

    optional_lines = [f"文号：{doc_no_text}"] if doc_no_text else []
    for header_line in header_candidates:
        candidate_lines = [header_line, *optional_lines, display_text]
        candidate_text = "\n".join(line for line in candidate_lines if line)
        if chunk_profile.count_tokens(candidate_text) <= chunk_profile.max_chunk_size:
            return candidate_text
        if optional_lines:
            fallback_text = "\n".join([header_line, display_text])
            if chunk_profile.count_tokens(fallback_text) <= chunk_profile.max_chunk_size:
                return fallback_text
    return "\n".join([header_candidates[-1], display_text]) if header_candidates else display_text


def _embed_text(text: str, embedding_model: BaseEmbedding | None) -> tuple[float, ...] | None:
    if embedding_model is None:
        return None
    return tuple(float(item) for item in embedding_model.get_text_embedding(text))


def _ensure_payload_indexes(*, qdrant_client: QdrantClient, collection_name: str) -> None:
    if not qdrant_client.collection_exists(collection_name):
        return
    if _is_local_qdrant_backend(qdrant_client):
        return
    for field_name in (
        "document_id",
        "revision_track",
        "representation",
        "version_id",
        "corpus",
        "collection",
        "campus_scope",
        "acl_groups",
        "acl_level",
        "source_channel",
        "is_current",
    ):
        qdrant_client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=qdrant_models.PayloadSchemaType.KEYWORD,
            wait=True,
        )


def _is_local_qdrant_backend(qdrant_client: QdrantClient) -> bool:
    client = getattr(qdrant_client, "_client", None)
    return client is not None and type(client).__module__.startswith("qdrant_client.local.")
