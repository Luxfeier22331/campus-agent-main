from __future__ import annotations

import campus_ingestion_core.process_indexing as _process_indexing
from campus_ingestion_core.process_candidate_merging import (
    merge_adjacent_curriculum_table_candidates as _merge_adjacent_curriculum_table_candidates,
)
from campus_ingestion_core.process_candidate_merging import (
    merge_adjacent_short_textual_candidates as _merge_adjacent_short_textual_candidates,
)
from campus_ingestion_core.process_chunking import (
    build_chunk_text as _build_chunk_text,
)
from campus_ingestion_core.process_chunking import (
    build_indexable_chunks_from_jsonl,
)
from campus_ingestion_core.process_indexing import (
    is_local_qdrant_backend as _is_local_qdrant_backend,
)
from campus_ingestion_core.process_shared import (
    IndexableChunk,
    ProcessArtifactReader,
    StructuredUnit,
    _ChunkCandidate,
    _ChunkMember,
    _CollectionChunkStrategy,
)

build_indexable_chunks_from_record = _process_indexing.build_indexable_chunks_from_record


def index_chunks_to_qdrant(**kwargs):
    _process_indexing.is_local_qdrant_backend = _is_local_qdrant_backend
    return _process_indexing.index_chunks_to_qdrant(**kwargs)


__all__ = [
    "IndexableChunk",
    "ProcessArtifactReader",
    "StructuredUnit",
    "_ChunkCandidate",
    "_ChunkMember",
    "_CollectionChunkStrategy",
    "_build_chunk_text",
    "_is_local_qdrant_backend",
    "_merge_adjacent_curriculum_table_candidates",
    "_merge_adjacent_short_textual_candidates",
    "build_indexable_chunks_from_jsonl",
    "build_indexable_chunks_from_record",
    "index_chunks_to_qdrant",
]
