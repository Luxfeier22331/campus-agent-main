from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.chunking import ChunkProfile, ChunkTextAssembly, SemanticChunkPiece
from campus_ingestion_core.models import DocumentRegistryRecord


class ProcessArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class IndexableChunkNode:
    id_: str
    text: str
    metadata: dict[str, object]
    relationships: dict[str, object]
    embedding: list[float] | None = None

    def model_dump_json(self) -> str:
        return json.dumps(
            {
                "id_": self.id_,
                "text": self.text,
                "metadata": self.metadata,
                "relationships": self.relationships,
                "embedding": self.embedding,
            },
            ensure_ascii=False,
            sort_keys=True,
        )


@dataclass(frozen=True, slots=True)
class StructuredUnit:
    unit_index: int
    document_id: str
    version_id: str
    text: str
    source_chunk_id: str | None
    anchor: dict[str, object]
    visibility_level: str
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
    source_uri: str
    source_chunk_id: str | None
    anchor: dict[str, object]
    text: str
    source_channel: str
    is_current: bool
    parser_version: str
    embedding_model: str
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    visibility_level: str = ""
    acl_level: str = ""
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    campus_scope: str | None = None
    canonical_url: str = ""
    latest_url: str = ""
    status: str = "active"
    embedding: tuple[float, ...] | None = None
    sparse_indices: tuple[int, ...] = ()
    sparse_values: tuple[float, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        entitlement_groups = self.entitlement_groups or self.acl_groups
        acl_groups = self.acl_groups or self.entitlement_groups
        visibility_scope = self.visibility_scope or self.campus_scope
        campus_scope = self.campus_scope or self.visibility_scope
        visibility_level = self.visibility_level.strip() or self.acl_level.strip()
        if not visibility_level and entitlement_groups:
            visibility_level = "restricted"
        if not visibility_level:
            visibility_level = "public"
        acl_level = self.acl_level.strip() or visibility_level
        policy_projection_version = (
            self.policy_projection_version.strip() or DEFAULT_POLICY_PROJECTION_VERSION
        )

        if entitlement_groups != self.entitlement_groups:
            object.__setattr__(self, "entitlement_groups", entitlement_groups)
        if acl_groups != self.acl_groups:
            object.__setattr__(self, "acl_groups", acl_groups)
        if visibility_scope != self.visibility_scope:
            object.__setattr__(self, "visibility_scope", visibility_scope)
        if campus_scope != self.campus_scope:
            object.__setattr__(self, "campus_scope", campus_scope)
        if visibility_level != self.visibility_level:
            object.__setattr__(self, "visibility_level", visibility_level)
        if acl_level != self.acl_level:
            object.__setattr__(self, "acl_level", acl_level)
        if policy_projection_version != self.policy_projection_version:
            object.__setattr__(self, "policy_projection_version", policy_projection_version)

    def to_node(self) -> IndexableChunkNode:
        return IndexableChunkNode(
            id_=str(uuid.uuid5(uuid.NAMESPACE_URL, self.chunk_id)),
            text=self.text,
            metadata={
                "document_id": self.document_id,
                "revision_track": self.revision_track,
                "version_id": self.version_id,
                "chunk_id": self.chunk_id,
                "chunk_order": self.chunk_order,
                "corpus": self.corpus,
                "collection": self.collection,
                "entitlement_groups": list(self.entitlement_groups),
                "visibility_scope": self.visibility_scope,
                "visibility_level": self.visibility_level,
                "policy_projection_version": self.policy_projection_version,
                "source_uri": self.source_uri,
                "canonical_url": self.canonical_url or self.source_uri,
                "latest_url": self.latest_url or self.canonical_url or self.source_uri,
                "source_chunk_id": self.source_chunk_id,
                "status": self.status,
                "anchor": self.anchor,
                "source_channel": self.source_channel,
                "is_current": self.is_current,
                "parser_version": self.parser_version,
                "embedding_model": self.embedding_model,
                **self.metadata,
            },
            relationships={
                "source": {
                    "node_id": self.document_id,
                    "metadata": {
                        "revision_track": self.revision_track,
                        "version_id": self.version_id,
                        "source_uri": self.source_uri,
                    },
                }
            },
            embedding=list(self.embedding) if self.embedding is not None else None,
        )


_SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD = 72
_SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD = 0.4
_SHORT_TEXTUAL_TARGET_DISPLAY_TOKENS = 120
_SHORT_TEXTUAL_MAX_MEMBER_COUNT = 4


@dataclass(frozen=True, slots=True)
class _ChunkMember:
    unit: StructuredUnit
    piece: SemanticChunkPiece


@dataclass(frozen=True, slots=True)
class _ChunkCandidate:
    unit_type: str
    root_unit_id: str
    source_chunk_id: str | None
    visibility_level: str
    anchor: dict[str, object]
    metadata: dict[str, object]
    piece: SemanticChunkPiece
    chunk_assembly: ChunkTextAssembly
    members: tuple[_ChunkMember, ...]


@dataclass(frozen=True, slots=True)
class _CollectionChunkStrategy:
    build_chunk_profile: Callable[[DocumentRegistryRecord], ChunkProfile]
    load_structured_units: Callable[[DocumentRegistryRecord, bytes], tuple[StructuredUnit, ...]]
    build_unit_pieces: Callable[[StructuredUnit, ChunkProfile], tuple[SemanticChunkPiece, ...]]
    resolve_unit_chunk_profile: Callable[
        [DocumentRegistryRecord, ChunkProfile, StructuredUnit, bool], ChunkProfile
    ]
    should_skip_unit: Callable[[StructuredUnit, set[str]], bool]
    postprocess_candidates: Callable[
        [tuple[_ChunkCandidate, ...], DocumentRegistryRecord, ChunkProfile, bool],
        tuple[_ChunkCandidate, ...],
    ]


__all__ = [
    "_SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD",
    "_SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD",
    "_SHORT_TEXTUAL_MAX_MEMBER_COUNT",
    "_SHORT_TEXTUAL_TARGET_DISPLAY_TOKENS",
    "IndexableChunk",
    "IndexableChunkNode",
    "ProcessArtifactReader",
    "StructuredUnit",
    "_ChunkCandidate",
    "_ChunkMember",
    "_CollectionChunkStrategy",
]
