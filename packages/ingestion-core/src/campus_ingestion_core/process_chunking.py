from __future__ import annotations

from llama_index.core.base.embeddings.base import BaseEmbedding

from campus_ingestion_core.chunking import (
    TABLE_UNIT_TYPES,
    ChunkProfile,
    ChunkTextAssembly,
    ChunkTextContextPlan,
    assemble_chunk_text,
    build_chunk_text_context,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process_candidate_aggregation import build_collection_semantic_metadata
from campus_ingestion_core.process_candidate_postprocess import (
    postprocess_curriculum_chunk_candidates,
    postprocess_default_chunk_candidates,
    postprocess_internal_notice_chunk_candidates,
    postprocess_scoped_rule_chunk_candidates,
)
from campus_ingestion_core.process_loading import (
    build_curriculum_runtime_chunk_profile,
    build_curriculum_unit_pieces,
    build_default_unit_pieces,
    build_generic_runtime_chunk_profile,
    build_handbook_chunk_profile,
    build_official_web_runtime_chunk_profile,
    load_curriculum_runtime_structured_units,
    load_default_structured_units,
    load_internal_notice_structured_units,
    resolve_curriculum_unit_chunk_profile,
    resolve_default_unit_chunk_profile,
    resolve_effective_visibility_level,
    resolve_internal_notice_unit_chunk_profile,
    resolve_scoped_rule_unit_chunk_profile,
    should_skip_curriculum_unit,
    should_skip_generic_unit,
    should_skip_handbook_unit,
    should_skip_internal_notice_unit,
    should_skip_official_web_unit,
)
from campus_ingestion_core.process_shared import (
    IndexableChunk,
    StructuredUnit,
    _ChunkCandidate,
    _ChunkMember,
    _CollectionChunkStrategy,
)
from campus_ingestion_core.sparse import SparseEmbeddingModel

_DEFAULT_COLLECTION_CHUNK_STRATEGY = _CollectionChunkStrategy(
    build_chunk_profile=build_generic_runtime_chunk_profile,
    load_structured_units=load_default_structured_units,
    build_unit_pieces=build_default_unit_pieces,
    resolve_unit_chunk_profile=resolve_default_unit_chunk_profile,
    should_skip_unit=should_skip_generic_unit,
    postprocess_candidates=postprocess_default_chunk_candidates,
)

_COLLECTION_CHUNK_STRATEGIES: dict[tuple[str, str], _CollectionChunkStrategy] = {
    ("regulations", "student_handbook"): _CollectionChunkStrategy(
        build_chunk_profile=build_handbook_chunk_profile,
        load_structured_units=load_default_structured_units,
        build_unit_pieces=build_default_unit_pieces,
        resolve_unit_chunk_profile=resolve_default_unit_chunk_profile,
        should_skip_unit=should_skip_handbook_unit,
        postprocess_candidates=postprocess_default_chunk_candidates,
    ),
    ("curriculum", "curriculum_plan"): _CollectionChunkStrategy(
        build_chunk_profile=build_curriculum_runtime_chunk_profile,
        load_structured_units=load_curriculum_runtime_structured_units,
        build_unit_pieces=build_curriculum_unit_pieces,
        resolve_unit_chunk_profile=resolve_curriculum_unit_chunk_profile,
        should_skip_unit=should_skip_curriculum_unit,
        postprocess_candidates=postprocess_curriculum_chunk_candidates,
    ),
    ("official_web", "muc_public_pages"): _CollectionChunkStrategy(
        build_chunk_profile=build_official_web_runtime_chunk_profile,
        load_structured_units=load_default_structured_units,
        build_unit_pieces=build_default_unit_pieces,
        resolve_unit_chunk_profile=resolve_default_unit_chunk_profile,
        should_skip_unit=should_skip_official_web_unit,
        postprocess_candidates=postprocess_default_chunk_candidates,
    ),
    ("campus_notices", "internal_notice"): _CollectionChunkStrategy(
        build_chunk_profile=build_generic_runtime_chunk_profile,
        load_structured_units=load_internal_notice_structured_units,
        build_unit_pieces=build_default_unit_pieces,
        resolve_unit_chunk_profile=resolve_internal_notice_unit_chunk_profile,
        should_skip_unit=should_skip_internal_notice_unit,
        postprocess_candidates=postprocess_internal_notice_chunk_candidates,
    ),
    ("regulations", "scoped_rules"): _CollectionChunkStrategy(
        build_chunk_profile=build_generic_runtime_chunk_profile,
        load_structured_units=load_default_structured_units,
        build_unit_pieces=build_default_unit_pieces,
        resolve_unit_chunk_profile=resolve_scoped_rule_unit_chunk_profile,
        should_skip_unit=should_skip_generic_unit,
        postprocess_candidates=postprocess_scoped_rule_chunk_candidates,
    ),
}


def resolve_collection_chunk_strategy(record: DocumentRegistryRecord) -> _CollectionChunkStrategy:
    if record.corpus == "official_web":
        return _COLLECTION_CHUNK_STRATEGIES[("official_web", "muc_public_pages")]
    return _COLLECTION_CHUNK_STRATEGIES.get(
        (record.corpus, record.collection), _DEFAULT_COLLECTION_CHUNK_STRATEGY
    )


def resolve_chunk_profile(
    *,
    record: DocumentRegistryRecord,
    chunk_profile: ChunkProfile | None,
) -> ChunkProfile:
    if chunk_profile is not None:
        return chunk_profile
    return resolve_collection_chunk_strategy(record).build_chunk_profile(record)


def build_indexable_chunks_from_jsonl(
    *,
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
    chunk_profile: ChunkProfile | None = None,
    embedding_model: BaseEmbedding | None = None,
    sparse_embedding_model: SparseEmbeddingModel | None = None,
) -> tuple[IndexableChunk, ...]:
    del sparse_embedding_model
    collection_chunk_strategy = resolve_collection_chunk_strategy(record)
    runtime_profile = resolve_chunk_profile(record=record, chunk_profile=chunk_profile)
    use_collection_unit_profiles = chunk_profile is None
    units = collection_chunk_strategy.load_structured_units(record, structured_jsonl_bytes)
    if not units:
        return ()
    table_roots_with_semantic_units = {
        unit.root_unit_id for unit in units if unit.unit_type in {"table_row", "table_unit"}
    }
    chunk_candidates = build_chunk_candidates(
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
    dense_embeddings = embed_texts(
        [candidate.chunk_assembly.text for candidate in chunk_candidates],
        embedding_model,
    )

    chunks: list[IndexableChunk] = []
    document_entitlement_groups = record.entitlement_groups
    document_visibility_scope = record.visibility_scope
    chunk_order = 0
    for candidate, embedding in zip(chunk_candidates, dense_embeddings, strict=True):
        chunk_order += 1
        chunk_id = f"{record.document_id}:{record.revision_track}:{record.version_id}:chunk-{chunk_order:04d}"
        effective_visibility_level = resolve_effective_visibility_level(
            unit_visibility_level=candidate.visibility_level,
            document_entitlement_groups=document_entitlement_groups,
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
                source_uri=record.source_uri,
                canonical_url=record.source_uri,
                latest_url=record.source_uri,
                source_chunk_id=candidate.source_chunk_id,
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
                    **build_collection_semantic_metadata(
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


def build_chunk_candidates(
    *,
    record: DocumentRegistryRecord,
    units: tuple[StructuredUnit, ...],
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
            unit,
            use_collection_unit_profiles,
        )
        if collection_chunk_strategy.should_skip_unit(unit, table_roots_with_semantic_units):
            continue
        pieces = collection_chunk_strategy.build_unit_pieces(unit, resolved_chunk_profile)
        context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
        for piece in pieces:
            chunk_assembly = build_chunk_text(
                unit=unit,
                piece=piece,
                chunk_profile=resolved_chunk_profile,
                context_plan=context_plan,
            )
            validate_chunk_budget(
                piece=piece, chunk_assembly=chunk_assembly, chunk_profile=resolved_chunk_profile
            )
            candidates.append(
                _ChunkCandidate(
                    unit_type=piece.unit_type,
                    root_unit_id=piece.root_unit_id,
                    source_chunk_id=unit.source_chunk_id,
                    visibility_level=unit.visibility_level,
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


def validate_chunk_budget(
    *,
    piece,
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


def build_chunk_text(
    *,
    unit: StructuredUnit,
    piece,
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


def embed_text(text: str, embedding_model: BaseEmbedding | None) -> tuple[float, ...] | None:
    if embedding_model is None:
        return None
    return tuple(float(item) for item in embedding_model.get_text_embedding(text))


def embed_texts(
    texts: list[str],
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
    return tuple(embed_text(text, embedding_model) for text in texts)


__all__ = [
    "build_chunk_text",
    "build_indexable_chunks_from_jsonl",
    "resolve_chunk_profile",
]
