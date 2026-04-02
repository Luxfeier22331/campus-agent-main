from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Callable, Iterable, Protocol, Sequence
import uuid

from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.schema import NodeRelationship, RelatedNodeInfo, TextNode
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.chunking import (
    ChunkProfile,
    ChunkTextAssembly,
    ChunkTextContextPlan,
    CURRICULUM_V2_CHUNK_POLICY_VERSION,
    CURRICULUM_V1_CHUNK_POLICY_VERSION,
    SemanticChunkPiece,
    StructuredUnitChunkInput,
    TABLE_UNIT_TYPES,
    TEXTUAL_UNIT_TYPES,
    assemble_chunk_text,
    build_curriculum_chunk_profile,
    build_student_handbook_chunk_profile,
    build_chunk_text_context,
    chunk_table_unit,
    chunk_structured_unit,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.curriculum_chunk_units import (
    _is_curriculum_course_map_placeholder_unit,
    _is_curriculum_course_map_title_line,
    _leading_curriculum_heading_lines,
    _looks_like_curriculum_structure_heading,
    _normalize_curriculum_structural_path,
    build_curriculum_structured_units,
    chunk_curriculum_unit,
)
from campus_ingestion_core.handbook_semantics import derive_handbook_semantic_metadata
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.sparse import (
    SparseEmbeddingModel,
    SparseEmbeddingSettings,
    build_sparse_embedding_model,
)

_NESTED_NUMBERED_LINE_RE = re.compile(r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])")
_CURRICULUM_TOP_LEVEL_HEADING_RE = re.compile(
    r"^(?:[一二三四五六七八九十]+、|第[一二三四五六七八九十百千万〇零两0-9]+[章节部分])"
)


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
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    visibility_level: str = ""
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION
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
        visibility_level = self.visibility_level.strip() or self.acl_level.strip() or "public"
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
        if policy_projection_version != self.policy_projection_version:
            object.__setattr__(self, "policy_projection_version", policy_projection_version)

    def to_node(self) -> TextNode:
        node = TextNode(
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
                "acl_groups": list(self.acl_groups),
                "campus_scope": self.campus_scope,
                "source_uri": self.source_uri,
                "canonical_url": self.canonical_url or self.source_uri,
                "latest_url": self.latest_url or self.canonical_url or self.source_uri,
                "source_chunk_id": self.source_chunk_id,
                "acl_level": self.acl_level,
                "status": self.status,
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
                        "version_id": self.version_id,
                        "source_uri": self.source_uri,
                    },
                )
            },
        )
        if self.embedding is not None:
            node.embedding = list(self.embedding)
        return node


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
    acl_level: str
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
    resolve_unit_chunk_profile: Callable[[DocumentRegistryRecord, ChunkProfile, str, bool], ChunkProfile]
    should_skip_unit: Callable[[StructuredUnit, set[str]], bool]
    postprocess_candidates: Callable[
        [Sequence[_ChunkCandidate], DocumentRegistryRecord, ChunkProfile, bool],
        tuple[_ChunkCandidate, ...],
    ]


def _build_handbook_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    return build_student_handbook_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
        model_name=record.embedding_model,
    )


def _build_curriculum_runtime_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    return build_curriculum_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
        model_name=record.embedding_model,
    )


def _build_generic_runtime_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    return ChunkProfile(
        chunk_policy_version=runtime_profile.chunk_profile_version,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        strategy_name=f"{record.collection}_generic",
        strategy=None,
    )


def _load_default_structured_units(
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
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


def _load_curriculum_runtime_structured_units(
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
    return tuple(build_curriculum_structured_units(record=record, structured_jsonl_bytes=structured_jsonl_bytes))


def _build_default_unit_pieces(unit: StructuredUnit, chunk_profile: ChunkProfile) -> tuple[SemanticChunkPiece, ...]:
    if unit.unit_type == "table_unit":
        return chunk_table_unit(
            unit=StructuredUnitChunkInput(
                unit_type=unit.unit_type,
                root_unit_id=unit.root_unit_id,
                text=unit.text,
                anchor=unit.anchor,
                metadata=unit.metadata,
            ),
            chunk_profile=chunk_profile,
        )
    return chunk_structured_unit(
        unit=StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=unit.text,
            anchor=unit.anchor,
            metadata=unit.metadata,
        ),
        chunk_profile=chunk_profile,
    )


def _build_curriculum_unit_pieces(unit: StructuredUnit, chunk_profile: ChunkProfile) -> tuple[SemanticChunkPiece, ...]:
    return chunk_curriculum_unit(unit=unit, chunk_profile=chunk_profile)


def _resolve_default_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit_type: str,
    use_collection_unit_profiles: bool,
) -> ChunkProfile:
    del record, unit_type, use_collection_unit_profiles
    return runtime_profile


def _resolve_curriculum_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit_type: str,
    use_collection_unit_profiles: bool,
) -> ChunkProfile:
    if not use_collection_unit_profiles:
        return runtime_profile
    if runtime_profile.chunk_policy_version not in {
        CURRICULUM_V1_CHUNK_POLICY_VERSION,
        CURRICULUM_V2_CHUNK_POLICY_VERSION,
    }:
        return runtime_profile
    return build_curriculum_chunk_profile(
        profile_version=runtime_profile.chunk_policy_version,
        model_name=record.embedding_model,
        unit_type=unit_type,
    )


def _should_skip_generic_unit(unit: StructuredUnit, table_roots_with_semantic_units: set[str]) -> bool:
    return unit.unit_type == "table" and unit.root_unit_id in table_roots_with_semantic_units


def _should_skip_handbook_unit(unit: StructuredUnit, table_roots_with_semantic_units: set[str]) -> bool:
    if unit.unit_type == "table":
        return True
    return _should_skip_generic_unit(unit, table_roots_with_semantic_units)


def _should_skip_curriculum_unit(unit: StructuredUnit, table_roots_with_semantic_units: set[str]) -> bool:
    if _should_skip_generic_unit(unit, table_roots_with_semantic_units):
        return True
    return _is_curriculum_course_map_noise_unit(unit)


def _postprocess_default_chunk_candidates(
    chunk_candidates: Sequence[_ChunkCandidate],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    return _merge_adjacent_short_textual_candidates(
        chunk_candidates=chunk_candidates,
        chunk_profile=_resolve_default_unit_chunk_profile(
            record=record,
            runtime_profile=runtime_profile,
            unit_type="section_text",
            use_collection_unit_profiles=use_collection_unit_profiles,
        ),
    )


def _postprocess_curriculum_chunk_candidates(
    chunk_candidates: Sequence[_ChunkCandidate],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    section_chunk_profile = _resolve_curriculum_unit_chunk_profile(
        record=record,
        runtime_profile=runtime_profile,
        unit_type="section_text",
        use_collection_unit_profiles=use_collection_unit_profiles,
    )
    table_chunk_profile = _resolve_curriculum_unit_chunk_profile(
        record=record,
        runtime_profile=runtime_profile,
        unit_type="table_unit",
        use_collection_unit_profiles=use_collection_unit_profiles,
    )
    merged_candidates = _merge_adjacent_short_textual_candidates(
        chunk_candidates=chunk_candidates,
        chunk_profile=section_chunk_profile,
    )
    merged_candidates = _merge_adjacent_curriculum_section_context_candidates(
        chunk_candidates=merged_candidates,
        section_chunk_profile=section_chunk_profile,
        table_chunk_profile=table_chunk_profile,
    )
    return _merge_adjacent_curriculum_table_candidates(
        chunk_candidates=merged_candidates,
        chunk_profile=table_chunk_profile,
    )


_DEFAULT_COLLECTION_CHUNK_STRATEGY = _CollectionChunkStrategy(
    build_chunk_profile=_build_generic_runtime_chunk_profile,
    load_structured_units=_load_default_structured_units,
    build_unit_pieces=_build_default_unit_pieces,
    resolve_unit_chunk_profile=_resolve_default_unit_chunk_profile,
    should_skip_unit=_should_skip_generic_unit,
    postprocess_candidates=_postprocess_default_chunk_candidates,
)

_COLLECTION_CHUNK_STRATEGIES: dict[tuple[str, str], _CollectionChunkStrategy] = {
    ("regulations", "student_handbook"): _CollectionChunkStrategy(
        build_chunk_profile=_build_handbook_chunk_profile,
        load_structured_units=_load_default_structured_units,
        build_unit_pieces=_build_default_unit_pieces,
        resolve_unit_chunk_profile=_resolve_default_unit_chunk_profile,
        should_skip_unit=_should_skip_handbook_unit,
        postprocess_candidates=_postprocess_default_chunk_candidates,
    ),
    ("curriculum", "curriculum_plan"): _CollectionChunkStrategy(
        build_chunk_profile=_build_curriculum_runtime_chunk_profile,
        load_structured_units=_load_curriculum_runtime_structured_units,
        build_unit_pieces=_build_curriculum_unit_pieces,
        resolve_unit_chunk_profile=_resolve_curriculum_unit_chunk_profile,
        should_skip_unit=_should_skip_curriculum_unit,
        postprocess_candidates=_postprocess_curriculum_chunk_candidates,
    ),
}


def _resolve_collection_chunk_strategy(record: DocumentRegistryRecord) -> _CollectionChunkStrategy:
    return _COLLECTION_CHUNK_STRATEGIES.get((record.corpus, record.collection), _DEFAULT_COLLECTION_CHUNK_STRATEGY)


def build_indexable_chunks_from_jsonl(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
    sparse_embedding_model: SparseEmbeddingModel | None = None,
) -> tuple[IndexableChunk, ...]:
    collection_chunk_strategy = _resolve_collection_chunk_strategy(record)
    runtime_profile = _resolve_chunk_profile(record=record, chunk_profile=chunk_profile)
    use_collection_unit_profiles = chunk_profile is None
    units = collection_chunk_strategy.load_structured_units(record, structured_jsonl_bytes)
    if not units:
        return ()
    table_roots_with_semantic_units = {
        unit.root_unit_id
        for unit in units
        if unit.unit_type in {"table_row", "table_unit"}
    }
    chunk_candidates = _build_chunk_candidates(
        record=record,
        units=units,
        chunk_profile=runtime_profile,
        table_roots_with_semantic_units=table_roots_with_semantic_units,
        use_collection_unit_profiles=use_collection_unit_profiles,
        collection_chunk_strategy=collection_chunk_strategy,
    )
    chunk_candidates = collection_chunk_strategy.postprocess_candidates(
        chunk_candidates,
        record,
        runtime_profile,
        use_collection_unit_profiles,
    )
    dense_embeddings = _embed_texts(
        [candidate.chunk_assembly.text for candidate in chunk_candidates],
        embedding_model,
    )

    chunks: list[IndexableChunk] = []
    document_entitlement_groups = record.entitlement_groups or record.acl_groups
    document_visibility_scope = record.visibility_scope or record.campus_scope
    chunk_order = 0
    for candidate, embedding in zip(chunk_candidates, dense_embeddings, strict=True):
        chunk_order += 1
        chunk_id = (
            f"{record.document_id}:{record.revision_track}:{record.version_id}:chunk-{chunk_order:04d}"
        )
        effective_visibility_level = _resolve_effective_acl_level(
            unit_acl_level=candidate.acl_level,
            document_acl_groups=document_entitlement_groups,
        )
        chunks.append(
            IndexableChunk(
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                chunk_id=chunk_id,
                chunk_order=chunk_order,
                corpus=record.corpus,
                collection=record.collection,
                acl_groups=document_entitlement_groups,
                campus_scope=document_visibility_scope,
                source_uri=record.source_uri,
                canonical_url=record.source_uri,
                latest_url=record.source_uri,
                source_chunk_id=candidate.source_chunk_id,
                acl_level=effective_visibility_level,
                status=record.status,
                anchor=candidate.anchor,
                text=candidate.chunk_assembly.text,
                source_channel=record.source_channel,
                is_current=record.is_current,
                parser_version=record.parser_version,
                embedding_model=record.embedding_model,
                entitlement_groups=document_entitlement_groups,
                visibility_scope=document_visibility_scope,
                visibility_level=effective_visibility_level,
                policy_projection_version=record.policy_projection_version,
                embedding=embedding,
                metadata={
                    "unit_type": candidate.piece.unit_type,
                    "root_unit_id": candidate.piece.root_unit_id,
                    "segment_index": candidate.piece.segment_index,
                    "segment_total": candidate.piece.segment_total,
                    "split_reason": candidate.piece.split_reason,
                    "boundary_rule": candidate.piece.boundary_rule,
                    "strategy_name": runtime_profile.strategy_name,
                    "split_strategy": runtime_profile.split_strategy,
                    "chunk_policy_version": runtime_profile.chunk_policy_version,
                    "cleaning_policy_version": runtime_profile.cleaning_policy_version,
                    **candidate.metadata,
                    "display_text": candidate.piece.text,
                    "contextualized_text": candidate.chunk_assembly.header_token_count > 0,
                    "header_mode": candidate.chunk_assembly.header_mode,
                    "header_token_count": candidate.chunk_assembly.header_token_count,
                    "display_token_count": candidate.chunk_assembly.display_token_count,
                    "final_token_count": candidate.chunk_assembly.total_token_count,
                    **_build_collection_semantic_metadata(
                        record=record,
                        unit_type=candidate.piece.unit_type,
                        anchor=candidate.anchor,
                        metadata=candidate.metadata,
                        text=candidate.piece.text,
                    ),
                },
            )
        )
    return tuple(chunks)


def _build_chunk_candidates(
    *,
    record: DocumentRegistryRecord,
    units: Sequence[StructuredUnit],
    chunk_profile: ChunkProfile,
    table_roots_with_semantic_units: set[str],
    use_collection_unit_profiles: bool,
    collection_chunk_strategy: _CollectionChunkStrategy,
) -> tuple[_ChunkCandidate, ...]:
    candidates: list[_ChunkCandidate] = []
    for unit in units:
        resolved_chunk_profile = collection_chunk_strategy.resolve_unit_chunk_profile(
            record,
            chunk_profile,
            unit.unit_type,
            use_collection_unit_profiles,
        )
        if collection_chunk_strategy.should_skip_unit(unit, table_roots_with_semantic_units):
            continue
        pieces = collection_chunk_strategy.build_unit_pieces(unit, resolved_chunk_profile)
        context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
        for piece in pieces:
            chunk_assembly = _build_chunk_text(
                unit=unit,
                piece=piece,
                chunk_profile=resolved_chunk_profile,
                context_plan=context_plan,
            )
            _validate_chunk_budget(piece=piece, chunk_assembly=chunk_assembly, chunk_profile=resolved_chunk_profile)
            candidates.append(
                _ChunkCandidate(
                    unit_type=piece.unit_type,
                    root_unit_id=piece.root_unit_id,
                    source_chunk_id=unit.source_chunk_id,
                    acl_level=unit.acl_level,
                    anchor=dict(unit.anchor),
                    metadata={
                        "strategy_name": resolved_chunk_profile.strategy_name,
                        "split_strategy": resolved_chunk_profile.split_strategy,
                        "chunk_policy_version": resolved_chunk_profile.chunk_policy_version,
                        "cleaning_policy_version": resolved_chunk_profile.cleaning_policy_version,
                        **dict(unit.metadata),
                    },
                    piece=piece,
                    chunk_assembly=chunk_assembly,
                    members=(_ChunkMember(unit=unit, piece=piece),),
                )
            )
    return tuple(candidates)


def _build_collection_semantic_metadata(
    *,
    record: DocumentRegistryRecord,
    unit_type: str,
    anchor: dict[str, object],
    metadata: dict[str, object],
    text: str,
) -> dict[str, object]:
    if record.collection != "student_handbook":
        return {}
    semantics = derive_handbook_semantic_metadata(
        unit_type=unit_type,
        anchor=anchor,
        metadata=metadata,
        text=text,
    )
    return {
        "content_kind": semantics.content_kind,
        "content_role": semantics.content_role,
        "detail_label": semantics.detail_label,
        "is_answer_bearing": semantics.is_answer_bearing,
    }


def _merge_adjacent_short_textual_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    merged: list[_ChunkCandidate] = []
    pending: _ChunkCandidate | None = None

    for candidate in chunk_candidates:
        if not _is_short_textual_merge_eligible(candidate):
            if pending is not None:
                merged.append(pending)
                pending = None
            merged.append(candidate)
            continue
        if pending is None:
            if _is_short_textual_candidate(candidate):
                pending = candidate
                continue
            merged.append(candidate)
            continue
        if not _is_short_textual_candidate(candidate):
            merged.append(pending)
            pending = None
            merged.append(candidate)
            continue
        next_candidate = _try_merge_short_textual_candidates(
            current=pending,
            incoming=candidate,
            chunk_profile=chunk_profile,
        )
        if next_candidate is None:
            merged.append(pending)
            pending = candidate
            continue
        pending = next_candidate
        if _short_textual_group_is_satisfied(pending):
            merged.append(pending)
            pending = None

    if pending is not None:
        merged.append(pending)
    return _absorb_short_textual_candidates(
        chunk_candidates=tuple(merged),
        chunk_profile=chunk_profile,
    )


def _absorb_short_textual_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    absorbed = list(chunk_candidates)
    changed = True
    while changed:
        changed = False
        index = 0
        while index < len(absorbed):
            candidate = absorbed[index]
            if not _is_absorbable_short_textual_candidate(candidate):
                index += 1
                continue
            if index > 0:
                merged_with_previous = _try_merge_short_textual_candidates(
                    current=absorbed[index - 1],
                    incoming=candidate,
                    chunk_profile=chunk_profile,
                    enforce_member_limit=False,
                )
                if merged_with_previous is not None:
                    absorbed[index - 1] = merged_with_previous
                    del absorbed[index]
                    changed = True
                    index = max(index - 1, 0)
                    continue
            if index + 1 < len(absorbed):
                merged_with_next = _try_merge_short_textual_candidates(
                    current=candidate,
                    incoming=absorbed[index + 1],
                    chunk_profile=chunk_profile,
                    enforce_member_limit=False,
                )
                if merged_with_next is not None:
                    absorbed[index] = merged_with_next
                    del absorbed[index + 1]
                    changed = True
                    continue
            index += 1
    return tuple(absorbed)


def _merge_adjacent_curriculum_table_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    if not chunk_candidates:
        return ()
    merged: list[_ChunkCandidate] = []
    index = 0
    while index < len(chunk_candidates):
        current = chunk_candidates[index]
        if index + 1 < len(chunk_candidates):
            incoming = chunk_candidates[index + 1]
            next_candidate = _try_merge_curriculum_table_candidates(
                current=current,
                incoming=incoming,
                chunk_profile=chunk_profile,
            )
            if next_candidate is not None:
                merged.append(next_candidate)
                index += 2
                continue
        merged.append(current)
        index += 1
    return tuple(merged)


def _merge_adjacent_curriculum_section_context_candidates(
    *,
    chunk_candidates: Sequence[_ChunkCandidate],
    section_chunk_profile: ChunkProfile,
    table_chunk_profile: ChunkProfile,
) -> tuple[_ChunkCandidate, ...]:
    absorbed = list(chunk_candidates)
    changed = True
    while changed:
        changed = False
        index = 0
        while index < len(absorbed):
            candidate = absorbed[index]
            if not _is_absorbable_curriculum_section_candidate(candidate):
                index += 1
                continue
            if index + 1 < len(absorbed):
                merged_with_next = _try_merge_curriculum_section_context_candidates(
                    current=candidate,
                    incoming=absorbed[index + 1],
                    chunk_profile=(
                        table_chunk_profile if absorbed[index + 1].unit_type == "table_unit" else section_chunk_profile
                    ),
                )
                if merged_with_next is not None:
                    absorbed[index] = merged_with_next
                    del absorbed[index + 1]
                    changed = True
                    continue
            if index > 0 and absorbed[index - 1].unit_type == "section_text":
                merged_with_previous = _try_merge_curriculum_section_context_candidates(
                    current=absorbed[index - 1],
                    incoming=candidate,
                    chunk_profile=section_chunk_profile,
                )
                if merged_with_previous is not None:
                    absorbed[index - 1] = merged_with_previous
                    del absorbed[index]
                    changed = True
                    index = max(index - 1, 0)
                    continue
            index += 1
    return tuple(absorbed)


def _try_merge_curriculum_table_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
) -> _ChunkCandidate | None:
    if current.unit_type != "table_unit" or incoming.unit_type != "table_unit":
        return None
    if current.acl_level != incoming.acl_level:
        return None
    if not _curriculum_table_section_paths_are_compatible(current=current, incoming=incoming):
        return None
    if current.metadata.get("title") != incoming.metadata.get("title"):
        return None
    if not _is_weak_curriculum_table_candidate(current) and not _is_weak_curriculum_table_candidate(incoming):
        return None
    members = (*current.members, *incoming.members)
    aggregated_anchor = _build_aggregated_anchor(members)
    aggregated_metadata = _build_aggregated_metadata(current=current, members=members)
    aggregated_metadata["aggregation_mode"] = "adjacent_curriculum_table_context"
    aggregated_display_text = "\n".join(
        piece
        for piece in (current.piece.text.strip(), incoming.piece.text.strip())
        if piece
    ).strip()
    chunk_assembly = assemble_chunk_text(
        display_text=aggregated_display_text,
        context_plan=build_chunk_text_context(anchor=aggregated_anchor, metadata=aggregated_metadata),
        chunk_profile=chunk_profile,
    )
    if chunk_assembly.total_token_count > chunk_profile.max_chunk_size:
        return None
    return _ChunkCandidate(
        unit_type=current.unit_type,
        root_unit_id=current.root_unit_id,
        source_chunk_id=current.source_chunk_id,
        acl_level=current.acl_level,
        anchor=aggregated_anchor,
        metadata=aggregated_metadata,
        piece=SemanticChunkPiece(
            unit_type=current.piece.unit_type,
            root_unit_id=current.piece.root_unit_id,
            text=aggregated_display_text,
        ),
        chunk_assembly=chunk_assembly,
        members=members,
    )


def _try_merge_curriculum_section_context_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
) -> _ChunkCandidate | None:
    if not _curriculum_section_context_candidates_are_compatible(current=current, incoming=incoming):
        return None
    members = (*current.members, *incoming.members)
    base_candidate = _select_curriculum_context_base_candidate(current=current, incoming=incoming)
    aggregated_anchor = _build_curriculum_context_aggregated_anchor(
        current=current,
        incoming=incoming,
        members=members,
    )
    aggregated_metadata = _build_aggregated_metadata(current=base_candidate, members=members)
    aggregated_metadata["aggregation_mode"] = _resolve_curriculum_context_aggregation_mode(
        current=current,
        incoming=incoming,
    )
    aggregated_display_text = _build_curriculum_aggregated_display_text(members)
    chunk_assembly = assemble_chunk_text(
        display_text=aggregated_display_text,
        context_plan=build_chunk_text_context(anchor=aggregated_anchor, metadata=aggregated_metadata),
        chunk_profile=chunk_profile,
    )
    if chunk_assembly.total_token_count > chunk_profile.max_chunk_size:
        return None
    return _ChunkCandidate(
        unit_type=base_candidate.unit_type,
        root_unit_id=base_candidate.root_unit_id,
        source_chunk_id=base_candidate.source_chunk_id,
        acl_level=base_candidate.acl_level,
        anchor=aggregated_anchor,
        metadata=aggregated_metadata,
        piece=SemanticChunkPiece(
            unit_type=base_candidate.piece.unit_type,
            root_unit_id=base_candidate.piece.root_unit_id,
            text=aggregated_display_text,
        ),
        chunk_assembly=chunk_assembly,
        members=members,
    )


def _curriculum_table_section_paths_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_path = _normalize_section_path(current.anchor)
    incoming_path = _normalize_section_path(incoming.anchor)
    if current_path == incoming_path:
        return True
    if not current_path or not incoming_path:
        return False
    if current_path[: len(incoming_path)] == incoming_path:
        return True
    if incoming_path[: len(current_path)] == current_path:
        return True
    return False


def _curriculum_section_context_candidates_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    if current.unit_type != "section_text":
        return False
    if incoming.unit_type not in {"section_text", "table_unit"}:
        return False
    if current.acl_level != incoming.acl_level:
        return False
    current_path = _normalize_section_path(current.anchor)
    incoming_path = _normalize_section_path(incoming.anchor)
    if incoming.unit_type == "table_unit":
        return _curriculum_section_to_table_candidates_are_compatible(
            current=current,
            incoming=incoming,
            current_path=current_path,
            incoming_path=incoming_path,
        )
    if current_path == incoming_path:
        return True
    if _curriculum_candidate_is_title_only(current) and incoming_path:
        return True
    if (
        current_path
        and len(incoming_path) == len(current_path) + 1
        and incoming_path[: len(current_path)] == current_path
        and _curriculum_candidate_has_structural_continuation_beyond_anchor(current)
        and _curriculum_candidate_has_explicit_leaf_item(incoming)
    ):
        return True
    if (
        current_path
        and len(incoming_path) == len(current_path) + 1
        and incoming_path[: len(current_path)] == current_path
        and _is_short_textual_candidate(current)
        and not _curriculum_candidate_is_heading_only(current)
        and (
            not _curriculum_candidate_has_explicit_leaf_item(current)
            or _curriculum_candidate_has_short_parent_intro_body(current)
        )
    ):
        return True
    if not current_path or not incoming_path:
        return False
    if current_path[:-1] != incoming_path[:-1]:
        return False
    if _curriculum_candidate_leaf_is_top_level_heading(current) or _curriculum_candidate_leaf_is_top_level_heading(incoming):
        return False
    if _curriculum_candidate_is_heading_only(current):
        return True
    return _curriculum_candidate_has_explicit_leaf_item(current) and _curriculum_candidate_has_explicit_leaf_item(
        incoming
    )


def _curriculum_section_to_table_candidates_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    current_path: tuple[str, ...],
    incoming_path: tuple[str, ...],
) -> bool:
    if not _curriculum_candidate_is_heading_only(current) and not _curriculum_candidate_is_title_only(current):
        return False
    if current_path and current_path == incoming_path:
        return True
    if (
        current_path
        and incoming_path
        and current_path[:-1] == incoming_path[:-1]
        and _curriculum_candidate_is_heading_only(current)
    ):
        if _curriculum_path_leaf_is_top_level_heading(current_path) or _curriculum_path_leaf_is_top_level_heading(
            incoming_path
        ):
            return False
        return True
    if _curriculum_candidate_is_title_only(current) and incoming_path:
        return True
    return False


def _try_merge_short_textual_candidates(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    chunk_profile: ChunkProfile,
    enforce_member_limit: bool = True,
) -> _ChunkCandidate | None:
    if not _short_textual_candidates_are_compatible(current, incoming):
        return None
    if enforce_member_limit and len(current.members) >= _SHORT_TEXTUAL_MAX_MEMBER_COUNT:
        return None

    members = (*current.members, *incoming.members)
    aggregated_anchor = _build_aggregated_anchor(members)
    aggregated_metadata = _build_aggregated_metadata(current=current, members=members)
    aggregated_display_text = _build_aggregated_display_text(members)
    chunk_assembly = assemble_chunk_text(
        display_text=aggregated_display_text,
        context_plan=build_chunk_text_context(anchor=aggregated_anchor, metadata=aggregated_metadata),
        chunk_profile=chunk_profile,
    )
    if chunk_assembly.total_token_count > chunk_profile.max_chunk_size:
        return None

    return _ChunkCandidate(
        unit_type=current.unit_type,
        root_unit_id=current.root_unit_id,
        source_chunk_id=current.source_chunk_id,
        acl_level=current.acl_level,
        anchor=aggregated_anchor,
        metadata=aggregated_metadata,
        piece=SemanticChunkPiece(
            unit_type=current.piece.unit_type,
            root_unit_id=current.piece.root_unit_id,
            text=aggregated_display_text,
        ),
        chunk_assembly=chunk_assembly,
        members=members,
    )


def _short_textual_candidates_are_compatible(
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    if current.unit_type != incoming.unit_type:
        return False
    if current.acl_level != incoming.acl_level:
        return False
    if current.unit_type == "policy_page" and _policy_page_label_shape_conflicts(current=current, incoming=incoming):
        return False
    if not _short_textual_section_paths_are_compatible(current=current, incoming=incoming):
        return False
    for field_name in ("title", "policy_doc_no"):
        if current.metadata.get(field_name) != incoming.metadata.get(field_name):
            return False
    return True


def _policy_page_label_shape_conflicts(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_has_label = _candidate_has_explicit_member_label(current)
    incoming_has_label = _candidate_has_explicit_member_label(incoming)
    if current_has_label == incoming_has_label:
        return False
    unlabeled = current if not current_has_label else incoming
    labeled = incoming if unlabeled is current else current
    if _normalize_anchor_label(labeled.anchor, "provision_label") is None:
        return False
    return _candidate_contains_nested_numbered_items(unlabeled)


def _candidate_contains_nested_numbered_items(candidate: _ChunkCandidate) -> bool:
    match_count = 0
    for member in candidate.members:
        for line in member.piece.text.splitlines():
            if _NESTED_NUMBERED_LINE_RE.match(line.strip()):
                match_count += 1
                if match_count >= 2:
                    return True
    return False


def _short_textual_section_paths_are_compatible(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> bool:
    current_path = _normalize_section_path(current.anchor)
    incoming_path = _normalize_section_path(incoming.anchor)
    if current_path == incoming_path:
        return True
    if (
        current.unit_type == "policy_page"
        and not _candidate_has_explicit_member_label(current)
        and not _candidate_has_explicit_member_label(incoming)
    ):
        return _policy_page_section_paths_are_compatible(current_path=current_path, incoming_path=incoming_path)
    return False


def _candidate_has_explicit_member_label(candidate: _ChunkCandidate) -> bool:
    return _normalize_anchor_label(candidate.anchor, "article_label") is not None or _normalize_anchor_label(
        candidate.anchor,
        "provision_label",
    ) is not None


def _policy_page_section_paths_are_compatible(
    *,
    current_path: tuple[str, ...],
    incoming_path: tuple[str, ...],
) -> bool:
    if not current_path or not incoming_path:
        return False
    if len(current_path) >= 2 and incoming_path[: len(current_path)] == current_path:
        return True
    if len(incoming_path) >= 2 and current_path[: len(incoming_path)] == incoming_path:
        return True
    current_parent = current_path[:-1]
    incoming_parent = incoming_path[:-1]
    if len(current_parent) < 2 or len(incoming_parent) < 2:
        return False
    return current_parent == incoming_parent


def _is_short_textual_merge_eligible(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type not in TEXTUAL_UNIT_TYPES:
        return False
    if candidate.piece.split_reason is not None:
        return False
    if candidate.piece.segment_total != 1:
        return False
    return True


def _is_short_textual_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.chunk_assembly.display_token_count < _SHORT_TEXTUAL_DISPLAY_TOKEN_THRESHOLD:
        return True
    return _header_ratio(candidate.chunk_assembly) >= _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD


def _is_absorbable_curriculum_section_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    if candidate.piece.split_reason is not None:
        return False
    if candidate.piece.segment_total != 1:
        return False
    return _is_short_textual_candidate(candidate)


def _is_absorbable_short_textual_candidate(candidate: _ChunkCandidate) -> bool:
    if not _is_short_textual_merge_eligible(candidate):
        return False
    return _is_short_textual_candidate(candidate)


def _is_weak_curriculum_table_candidate(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "table_unit":
        return False
    caption_lines = tuple(str(item).strip() for item in list(candidate.metadata.get("caption_lines") or ()) if str(item).strip())
    row_lines = tuple(str(item).strip() for item in list(candidate.metadata.get("table_row_lines") or ()) if str(item).strip())
    header_line = str(candidate.metadata.get("table_header_line") or "").strip()
    if caption_lines:
        return False
    if row_lines:
        return False
    if not header_line:
        return True
    return not _looks_like_table_header_line(header_line)


def _looks_like_table_header_line(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    return any(
        token in normalized
        for token in (
            "课程号",
            "课程名称",
            "学分",
            "学时",
            "修读学期",
            "开设学期",
            "备注",
            "类别",
            "培养阶段",
            "板块名称",
            "课程类",
            "专业名称",
        )
    )


def _short_textual_group_is_satisfied(candidate: _ChunkCandidate) -> bool:
    if len(candidate.members) >= _SHORT_TEXTUAL_MAX_MEMBER_COUNT:
        return True
    if _header_ratio(candidate.chunk_assembly) >= _SHORT_TEXTUAL_HEADER_RATIO_THRESHOLD:
        return False
    return candidate.chunk_assembly.display_token_count >= _SHORT_TEXTUAL_TARGET_DISPLAY_TOKENS


def _header_ratio(chunk_assembly: ChunkTextAssembly) -> float:
    if chunk_assembly.total_token_count <= 0:
        return 0.0
    return chunk_assembly.header_token_count / chunk_assembly.total_token_count


def _build_aggregated_anchor(members: Sequence[_ChunkMember]) -> dict[str, object]:
    aggregated_anchor = dict(members[0].unit.anchor)
    page_starts = [value for value in (_as_int(member.unit.anchor.get("page_start")) for member in members) if value is not None]
    page_ends = [value for value in (_as_int(member.unit.anchor.get("page_end")) for member in members) if value is not None]
    if page_starts:
        aggregated_anchor["page_start"] = min(page_starts)
    if page_ends:
        aggregated_anchor["page_end"] = max(page_ends)
    common_section_path = _common_section_path(
        _normalize_section_path(member.unit.anchor)
        for member in members
    )
    if common_section_path:
        aggregated_anchor["section_path"] = list(common_section_path)
    else:
        aggregated_anchor.pop("section_path", None)

    article_labels = _collect_member_labels(members, "article_label")
    provision_labels = _collect_member_labels(members, "provision_label")
    if article_labels:
        aggregated_anchor["article_label"] = _collapse_label_range(article_labels)
    else:
        aggregated_anchor.pop("article_label", None)
    if provision_labels:
        aggregated_anchor["provision_label"] = _collapse_label_range(provision_labels)
    else:
        aggregated_anchor.pop("provision_label", None)
    return aggregated_anchor


def _build_aggregated_metadata(
    *,
    current: _ChunkCandidate,
    members: Sequence[_ChunkMember],
) -> dict[str, object]:
    aggregated_metadata = dict(current.metadata)
    for field_name in ("title", "policy_doc_no", "preface_text"):
        shared_value = _shared_metadata_text(members, field_name)
        if shared_value is None:
            aggregated_metadata.pop(field_name, None)
        else:
            aggregated_metadata[field_name] = shared_value
    aggregated_metadata["aggregation_mode"] = "adjacent_short_textual_units"
    aggregated_metadata["member_unit_count"] = len(members)
    aggregated_metadata["member_root_unit_ids"] = [member.piece.root_unit_id for member in members]
    aggregated_metadata["member_source_chunk_ids"] = [
        member.unit.source_chunk_id
        for member in members
        if member.unit.source_chunk_id is not None
    ]
    article_labels = _collect_member_labels(members, "article_label")
    if article_labels:
        aggregated_metadata["member_article_labels"] = article_labels
    provision_labels = _collect_member_labels(members, "provision_label")
    if provision_labels:
        aggregated_metadata["member_provision_labels"] = provision_labels
    return aggregated_metadata


def _build_aggregated_display_text(members: Sequence[_ChunkMember]) -> str:
    return "\n\n".join(_build_member_display_text(member) for member in members).strip()


def _build_curriculum_aggregated_display_text(members: Sequence[_ChunkMember]) -> str:
    if not members:
        return ""
    common_path = _common_section_path(_normalize_section_path(member.unit.anchor) for member in members)
    parts: list[str] = []
    first_text = members[0].piece.text.strip()
    if first_text:
        parts.append(first_text)
    for member in members[1:]:
        contribution = _build_curriculum_member_display_text(member, common_path=common_path)
        if contribution:
            parts.append(contribution)
    return "\n\n".join(parts).strip()


def _build_curriculum_member_display_text(member: _ChunkMember, *, common_path: tuple[str, ...]) -> str:
    return _strip_curriculum_common_path_prefix(member.piece.text, common_path=common_path)


def _strip_curriculum_common_path_prefix(text: str, *, common_path: tuple[str, ...]) -> str:
    text = text.strip()
    if not text:
        return ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    prefix = _normalize_curriculum_structural_path(list(common_path))
    strip_count = 0
    for expected in prefix:
        if strip_count < len(lines) and lines[strip_count] == expected:
            strip_count += 1
            continue
        break
    if strip_count <= 0:
        return text
    remaining_lines = lines[strip_count:]
    if remaining_lines:
        return "\n".join(remaining_lines).strip()
    return text


def _build_member_display_text(member: _ChunkMember) -> str:
    text = member.piece.text.strip()
    label = _resolve_member_label(member)
    if not label or text.startswith(label):
        return text
    separator = " " if not text.startswith(("：", ":")) else ""
    return f"{label}{separator}{text}".strip()


def _resolve_member_label(member: _ChunkMember) -> str | None:
    for field_name in ("article_label", "provision_label"):
        label = _normalize_anchor_label(member.unit.anchor, field_name)
        if label is not None:
            return label
    return None


def _collect_member_labels(members: Sequence[_ChunkMember], field_name: str) -> list[str]:
    labels: list[str] = []
    for member in members:
        value = member.unit.anchor.get(field_name)
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                labels.append(normalized)
    return labels


def _collapse_label_range(labels: Sequence[str]) -> str:
    distinct_labels: list[str] = []
    for label in labels:
        if not distinct_labels or distinct_labels[-1] != label:
            distinct_labels.append(label)
    if not distinct_labels:
        return ""
    if len(distinct_labels) == 1:
        return distinct_labels[0]
    return f"{distinct_labels[0]}-{distinct_labels[-1]}"


def _normalize_section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


def _normalize_anchor_label(anchor: dict[str, object], field_name: str) -> str | None:
    value = anchor.get(field_name)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _select_curriculum_context_base_candidate(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> _ChunkCandidate:
    if incoming.unit_type == "table_unit":
        return incoming
    if _curriculum_candidate_is_title_only(current):
        return incoming
    return current


def _build_curriculum_context_aggregated_anchor(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
    members: Sequence[_ChunkMember],
) -> dict[str, object]:
    aggregated_anchor = _build_aggregated_anchor(members)
    if _normalize_section_path(aggregated_anchor):
        return aggregated_anchor
    incoming_path = _normalize_section_path(incoming.anchor)
    if _curriculum_candidate_is_title_only(current) and incoming_path:
        aggregated_anchor["section_path"] = list(incoming_path)
        return aggregated_anchor
    current_path = _normalize_section_path(current.anchor)
    if (
        current_path
        and incoming_path
        and current_path[:-1] == incoming_path[:-1]
        and _curriculum_candidate_is_heading_only(current)
    ):
        aggregated_anchor["section_path"] = list(current_path)
    return aggregated_anchor


def _resolve_curriculum_context_aggregation_mode(
    *,
    current: _ChunkCandidate,
    incoming: _ChunkCandidate,
) -> str:
    if incoming.unit_type == "table_unit":
        return "adjacent_curriculum_section_table_context"
    return "adjacent_curriculum_section_context"


def _curriculum_candidate_is_heading_only(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    lines = [line.strip() for line in candidate.piece.text.splitlines() if line.strip()]
    if not lines:
        return False
    return len(_leading_curriculum_heading_lines(lines)) == len(lines)


def _curriculum_candidate_is_title_only(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    if _normalize_section_path(candidate.anchor):
        return False
    lines = [line.strip() for line in candidate.piece.text.splitlines() if line.strip()]
    return len(lines) == 1


def _curriculum_candidate_has_explicit_leaf_item(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    section_path = _normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    text = _strip_curriculum_common_path_prefix(
        candidate.piece.text,
        common_path=section_path[:-1],
    )
    contribution_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not contribution_lines:
        return False
    return contribution_lines[0] == section_path[-1]


def _curriculum_candidate_has_short_parent_intro_body(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    section_path = _normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    text = _strip_curriculum_common_path_prefix(
        candidate.piece.text,
        common_path=section_path[:-1],
    )
    contribution_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(contribution_lines) < 2:
        return False
    if contribution_lines[0] != section_path[-1]:
        return False
    first_body_line = contribution_lines[1]
    if _CURRICULUM_TOP_LEVEL_HEADING_RE.match(first_body_line) or _NESTED_NUMBERED_LINE_RE.match(first_body_line):
        return False
    return True


def _curriculum_candidate_has_structural_continuation_beyond_anchor(candidate: _ChunkCandidate) -> bool:
    if candidate.unit_type != "section_text":
        return False
    section_path = _normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    text = _strip_curriculum_common_path_prefix(candidate.piece.text, common_path=section_path)
    continuation_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not continuation_lines:
        return False
    return bool(_CURRICULUM_TOP_LEVEL_HEADING_RE.match(continuation_lines[0]) or _NESTED_NUMBERED_LINE_RE.match(continuation_lines[0]))


def _curriculum_candidate_leaf_is_top_level_heading(candidate: _ChunkCandidate) -> bool:
    section_path = _normalize_section_path(candidate.anchor)
    if not section_path:
        return False
    return _curriculum_path_leaf_is_top_level_heading(section_path)


def _curriculum_path_leaf_is_top_level_heading(section_path: tuple[str, ...]) -> bool:
    if not section_path:
        return False
    return bool(_CURRICULUM_TOP_LEVEL_HEADING_RE.match(section_path[-1]))


def _is_curriculum_course_map_noise_unit(unit: StructuredUnit) -> bool:
    section_path = _normalize_curriculum_structural_path(list(_normalize_section_path(unit.anchor)))
    lines = [line.strip() for line in unit.text.splitlines() if line.strip()]
    if not lines:
        return False
    title_line_count = sum(1 for line in lines if _is_curriculum_course_map_title_line(line))
    if title_line_count == 0:
        return False
    if not all(
        _looks_like_curriculum_structure_heading(line) or _is_curriculum_course_map_title_line(line)
        for line in lines
    ):
        return False
    if "六、课程地图" not in section_path:
        return True
    non_root_heading_count = sum(
        1
        for line in lines
        if _looks_like_curriculum_structure_heading(line) and line != "六、课程地图"
    )
    return non_root_heading_count > 0 or title_line_count > 1


def _shared_metadata_text(members: Sequence[_ChunkMember], field_name: str) -> str | None:
    sentinel = object()
    shared_value: str | None | object = sentinel
    for member in members:
        value = member.unit.metadata.get(field_name)
        normalized = value.strip() if isinstance(value, str) and value.strip() else None
        if shared_value is sentinel:
            shared_value = normalized
            continue
        if shared_value != normalized:
            return None
    return shared_value if isinstance(shared_value, str) else None


def _common_section_path(paths: Iterable[tuple[str, ...]]) -> tuple[str, ...]:
    normalized_paths = [path for path in paths if path]
    if not normalized_paths:
        return ()
    common = list(normalized_paths[0])
    for path in normalized_paths[1:]:
        limit = min(len(common), len(path))
        index = 0
        while index < limit and common[index] == path[index]:
            index += 1
        common = common[:index]
        if not common:
            return ()
    return tuple(common)


def _as_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _validate_chunk_budget(
    *,
    piece: SemanticChunkPiece,
    chunk_assembly: ChunkTextAssembly,
    chunk_profile: ChunkProfile,
) -> None:
    if piece.unit_type in TABLE_UNIT_TYPES:
        return
    if chunk_assembly.total_token_count <= chunk_profile.max_chunk_size:
        return
    raise ValueError(
        "chunk text exceeds max_chunk_size after contextualization: "
        f"{chunk_assembly.total_token_count} > {chunk_profile.max_chunk_size}"
    )


def build_indexable_chunks_from_record(
    *,
    record: DocumentRegistryRecord,
    object_store: ProcessArtifactReader,
    bucket: str,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
    sparse_embedding_model: SparseEmbeddingModel | None = None,
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
        sparse_embedding_model=sparse_embedding_model,
    )


def index_chunks_to_qdrant(
    *,
    chunks: Sequence[IndexableChunk],
    qdrant_client: QdrantClient,
    collection_name: str,
    sparse_embedding_model: SparseEmbeddingModel | None = None,
    recreate_collection_on_schema_mismatch: bool = False,
    ensure_collection: bool = True,
    ensure_payload_indexes: bool = True,
    extra_payload: dict[str, object] | None = None,
) -> tuple[str, ...]:
    if not chunks:
        return ()
    runtime_sparse_embedding_model = sparse_embedding_model or build_sparse_embedding_model(SparseEmbeddingSettings())
    runtime_profile = load_runtime_profile(chunks[0].corpus, chunks[0].collection)
    runtime_extra_payload = dict(extra_payload or {})
    if ensure_collection:
        _ensure_collection(
            qdrant_client=qdrant_client,
            collection_name=collection_name,
            dense_vector_size=_resolve_dense_vector_size(chunks),
            dense_vector_name=runtime_profile.qdrant_index_binding.dense_vector_name,
            sparse_vector_name=runtime_profile.qdrant_index_binding.sparse_vector_name,
            recreate_on_mismatch=recreate_collection_on_schema_mismatch,
        )
    points: list[qdrant_models.PointStruct] = []
    for chunk in chunks:
        node = chunk.to_node()
        if runtime_extra_payload:
            node.metadata.update(runtime_extra_payload)
        if chunk.embedding is None:
            raise ValueError(f"chunk {chunk.chunk_id} is missing dense embedding")
        sparse_vector = _resolve_sparse_vector(
            chunk=chunk,
            sparse_embedding_model=runtime_sparse_embedding_model,
        )
        points.append(
            qdrant_models.PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.chunk_id)),
                vector={
                    runtime_profile.qdrant_index_binding.dense_vector_name: list(chunk.embedding),
                    runtime_profile.qdrant_index_binding.sparse_vector_name: sparse_vector,
                },
                payload={
                    "_node_content": node.model_dump_json(),
                    **node.metadata,
                },
            )
        )
    qdrant_client.upsert(
        collection_name=collection_name,
        points=points,
        wait=True,
    )
    if ensure_payload_indexes:
        _ensure_payload_indexes(qdrant_client=qdrant_client, collection_name=collection_name)
    return tuple(str(point.id) for point in points)


def _resolve_chunk_profile(
    *,
    record: DocumentRegistryRecord,
    chunk_profile: ChunkProfile | None,
) -> ChunkProfile:
    if chunk_profile is not None:
        return chunk_profile
    return _resolve_collection_chunk_strategy(record).build_chunk_profile(record)


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
    context_plan: ChunkTextContextPlan | None = None,
) -> ChunkTextAssembly:
    display_text = getattr(piece, "text", "")
    if not isinstance(display_text, str) or not display_text.strip():
        return assemble_chunk_text(
            display_text="",
            context_plan=build_chunk_text_context(),
            chunk_profile=chunk_profile,
        )
    runtime_context_plan = (
        context_plan
        if context_plan is not None
        else build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
    )
    return assemble_chunk_text(
        display_text=display_text,
        context_plan=runtime_context_plan,
        chunk_profile=chunk_profile,
    )


def _embed_text(text: str, embedding_model: BaseEmbedding | None) -> tuple[float, ...] | None:
    if embedding_model is None:
        return None
    return tuple(float(item) for item in embedding_model.get_text_embedding(text))


def _embed_texts(
    texts: Sequence[str],
    embedding_model: BaseEmbedding | object | None,
) -> tuple[tuple[float, ...] | None, ...]:
    if not texts:
        return ()
    if embedding_model is None:
        return tuple(None for _ in texts)
    batch_embed = getattr(embedding_model, "get_text_embedding_batch", None)
    if callable(batch_embed):
        embeddings = batch_embed(list(texts))
        if len(embeddings) != len(texts):
            raise ValueError("embedding batch result count does not match input count")
        return tuple(tuple(float(item) for item in embedding) for embedding in embeddings)
    return tuple(_embed_text(text, embedding_model) for text in texts)


def _ensure_payload_indexes(*, qdrant_client: QdrantClient, collection_name: str) -> None:
    if not qdrant_client.collection_exists(collection_name):
        return
    if _is_local_qdrant_backend(qdrant_client):
        return
    for field_name, field_schema in (
        ("document_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("revision_track", qdrant_models.PayloadSchemaType.KEYWORD),
        ("version_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("corpus", qdrant_models.PayloadSchemaType.KEYWORD),
        ("collection", qdrant_models.PayloadSchemaType.KEYWORD),
        ("canonical_course_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("canonical_course_family_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("visibility_scope", qdrant_models.PayloadSchemaType.KEYWORD),
        ("entitlement_groups", qdrant_models.PayloadSchemaType.KEYWORD),
        ("visibility_level", qdrant_models.PayloadSchemaType.KEYWORD),
        ("policy_projection_version", qdrant_models.PayloadSchemaType.KEYWORD),
        ("campus_scope", qdrant_models.PayloadSchemaType.KEYWORD),
        ("acl_groups", qdrant_models.PayloadSchemaType.KEYWORD),
        ("acl_level", qdrant_models.PayloadSchemaType.KEYWORD),
        ("status", qdrant_models.PayloadSchemaType.KEYWORD),
        ("source_channel", qdrant_models.PayloadSchemaType.KEYWORD),
        ("is_current", qdrant_models.PayloadSchemaType.BOOL),
    ):
        qdrant_client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=field_schema,
            wait=True,
        )


def _ensure_collection(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    dense_vector_name: str,
    sparse_vector_name: str,
    dense_vector_size: int,
    recreate_on_mismatch: bool,
) -> None:
    if not qdrant_client.collection_exists(collection_name):
        _create_collection(
            qdrant_client=qdrant_client,
            collection_name=collection_name,
            dense_vector_name=dense_vector_name,
            sparse_vector_name=sparse_vector_name,
            dense_vector_size=dense_vector_size,
        )
        return
    if _collection_schema_matches(
        qdrant_client=qdrant_client,
        collection_name=collection_name,
        dense_vector_name=dense_vector_name,
        sparse_vector_name=sparse_vector_name,
        dense_vector_size=dense_vector_size,
    ):
        return
    if not recreate_on_mismatch:
        raise ValueError(f"collection {collection_name} does not match dense+sparse schema")
    qdrant_client.delete_collection(collection_name=collection_name)
    _create_collection(
        qdrant_client=qdrant_client,
        collection_name=collection_name,
        dense_vector_name=dense_vector_name,
        sparse_vector_name=sparse_vector_name,
        dense_vector_size=dense_vector_size,
    )


def _create_collection(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    dense_vector_name: str,
    sparse_vector_name: str,
    dense_vector_size: int,
) -> None:
    qdrant_client.create_collection(
        collection_name=collection_name,
        vectors_config={
            dense_vector_name: qdrant_models.VectorParams(
                size=dense_vector_size,
                distance=qdrant_models.Distance.COSINE,
            )
        },
        sparse_vectors_config={
            sparse_vector_name: qdrant_models.SparseVectorParams(modifier=qdrant_models.Modifier.IDF),
        },
    )


def _collection_schema_matches(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    dense_vector_name: str,
    sparse_vector_name: str,
    dense_vector_size: int,
) -> bool:
    info = qdrant_client.get_collection(collection_name=collection_name)
    params = info.config.params
    vectors = params.vectors
    if not isinstance(vectors, dict):
        return False
    dense = vectors.get(dense_vector_name)
    sparse = (params.sparse_vectors or {}).get(sparse_vector_name)
    return (
        dense is not None
        and getattr(dense, "size", None) == dense_vector_size
        and getattr(dense, "distance", None) == qdrant_models.Distance.COSINE
        and sparse is not None
        and getattr(sparse, "modifier", None) == qdrant_models.Modifier.IDF
    )


def _resolve_sparse_vector(
    *,
    chunk: IndexableChunk,
    sparse_embedding_model: SparseEmbeddingModel,
) -> qdrant_models.Document | qdrant_models.SparseVector:
    if bool(chunk.sparse_indices) != bool(chunk.sparse_values):
        raise ValueError(f"chunk {chunk.chunk_id} sparse vector is incomplete")
    if len(chunk.sparse_indices) != len(chunk.sparse_values):
        raise ValueError(f"chunk {chunk.chunk_id} sparse vector length mismatch")
    if chunk.sparse_indices:
        return qdrant_models.SparseVector(indices=list(chunk.sparse_indices), values=list(chunk.sparse_values))
    return sparse_embedding_model.build_document(chunk.text)


def _resolve_dense_vector_size(chunks: Sequence[IndexableChunk]) -> int:
    first_embedding = next((chunk.embedding for chunk in chunks if chunk.embedding is not None), None)
    if first_embedding is None:
        raise ValueError("chunk embedding is required for qdrant indexing")
    return len(first_embedding)


def _is_local_qdrant_backend(qdrant_client: QdrantClient) -> bool:
    client = getattr(qdrant_client, "_client", None)
    return client is not None and type(client).__module__.startswith("qdrant_client.local.")
