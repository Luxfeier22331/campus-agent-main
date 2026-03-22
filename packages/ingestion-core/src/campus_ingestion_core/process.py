from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any, Sequence
import uuid

from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.ingestion import IngestionPipeline
from llama_index.core.schema import MetadataMode, NodeRelationship, RelatedNodeInfo, TextNode
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.models import DocumentRegistryRecord


@dataclass(frozen=True, slots=True)
class StructuredUnit:
    unit_index: int
    document_id: str
    version_id: str
    text: str
    source_chunk_id: str | None
    anchor: dict[str, object]
    acl_level: str


@dataclass(frozen=True, slots=True)
class IndexableChunk:
    document_id: str
    version_id: str
    chunk_id: str
    chunk_order: int
    corpus: str
    acl_groups: tuple[str, ...]
    campus_scope: str | None
    source_uri: str
    source_chunk_id: str | None
    acl_level: str
    anchor: dict[str, object]
    text: str
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
                "version_id": self.version_id,
                "chunk_id": self.chunk_id,
                "chunk_order": self.chunk_order,
                "corpus": self.corpus,
                "acl_groups": list(self.acl_groups),
                "campus_scope": self.campus_scope,
                "source_uri": self.source_uri,
                "source_chunk_id": self.source_chunk_id,
                "acl_level": self.acl_level,
                "anchor": self.anchor,
                "parser_version": self.parser_version,
                "embedding_model": self.embedding_model,
                **self.metadata,
            },
            relationships={
                NodeRelationship.SOURCE: RelatedNodeInfo(
                    node_id=self.document_id,
                    metadata={"version_id": self.version_id, "source_uri": self.source_uri},
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
    units = _load_structured_units(record=record, structured_jsonl_bytes=structured_jsonl_bytes)
    if not units:
        return ()

    transformations: list[Any] = [(chunk_profile or ChunkProfile()).build_splitter()]
    if embedding_model is not None:
        transformations.append(embedding_model)

    chunks: list[IndexableChunk] = []
    chunk_order = 0
    for unit in units:
        pipeline = IngestionPipeline(transformations=transformations)
        nodes = pipeline.run(
            nodes=[
                TextNode(
                    id_=f"{record.document_id}:{unit.unit_index:04d}",
                    text=unit.text,
                )
            ]
        )
        for node in nodes:
            chunk_order += 1
            chunk_id = f"{record.document_id}:{record.version_id}:chunk-{chunk_order:04d}"
            embedding = tuple(float(item) for item in node.embedding) if node.embedding is not None else None
            chunks.append(
                IndexableChunk(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id=chunk_id,
                    chunk_order=chunk_order,
                    corpus=record.corpus,
                    acl_groups=record.acl_groups,
                    campus_scope=record.campus_scope,
                    source_uri=record.source_uri,
                    source_chunk_id=unit.source_chunk_id,
                    acl_level=unit.acl_level,
                    anchor=unit.anchor,
                    text=node.get_content(metadata_mode=MetadataMode.NONE).strip(),
                    parser_version=record.parser_version,
                    embedding_model=record.embedding_model,
                    embedding=embedding,
                    metadata={},
                )
            )
    return tuple(chunks)


def index_chunks_to_qdrant(
    *,
    chunks: Sequence[IndexableChunk],
    qdrant_client: QdrantClient,
    collection_name: str,
) -> tuple[str, ...]:
    if not chunks:
        return ()
    vector_store = QdrantVectorStore(collection_name=collection_name, client=qdrant_client)
    ids = vector_store.add([chunk.to_node() for chunk in chunks])
    _ensure_payload_indexes(qdrant_client=qdrant_client, collection_name=collection_name)
    return tuple(str(item) for item in ids)


def _load_structured_units(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
    units: list[StructuredUnit] = []
    for unit_index, line in enumerate(structured_jsonl_bytes.decode("utf-8").splitlines()):
        normalized = line.strip()
        if not normalized:
            continue
        raw = json.loads(normalized)
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
            )
        )
    return tuple(units)


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
    acl_level = value.get("level")
    if not isinstance(acl_level, str) or not acl_level.strip():
        return "public"
    return acl_level.strip()


def _ensure_payload_indexes(*, qdrant_client: QdrantClient, collection_name: str) -> None:
    if not qdrant_client.collection_exists(collection_name):
        return
    for field_name in ("document_id", "version_id", "corpus", "campus_scope", "acl_groups"):
        qdrant_client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=qdrant_models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
