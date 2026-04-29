from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import campus_ingestion_core.tokenizer_cache as tokenizer_cache
from campus_ingestion_core.chunking import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_POLICY_VERSION,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CLEANING_POLICY_VERSION,
    DEFAULT_MAX_CHUNK_SIZE,
    DEFAULT_MIN_CHUNK_SIZE,
    HANDBOOK_V3_CHUNK_POLICY_VERSION,
    TABLE_PLACEHOLDER,
    ChunkProfile,
    RegexApproxTokenCounter,
    StructuredUnitChunkInput,
    StudentHandbookChunkingStrategy,
    StudentHandbookChunkingStrategyV2,
    assemble_chunk_text,
    build_chunk_text_context,
    build_student_handbook_chunk_profile,
    chunk_structured_unit,
    clean_structured_text,
    estimate_token_count,
)
from campus_ingestion_core.chunking_context import (
    assemble_chunk_text as assemble_chunk_text_from_context_module,
)
from campus_ingestion_core.chunking_context import (
    build_chunk_text_context as build_chunk_text_context_from_context_module,
)
from campus_ingestion_core.chunking_structure import (
    repair_article_subclause_boundary_context as repair_article_subclause_boundary_context_from_structure_module,
)
from campus_ingestion_core.chunking_tables import (
    build_table_piece_specs as build_table_piece_specs_from_table_module,
)
from campus_ingestion_core.chunking_token_windows import (
    collect_soft_boundary_indexes,
    merge_short_tail,
    split_token_windows,
    tokenize_text,
)
from campus_ingestion_core.chunking_tokenizers import (
    _load_hf_tokenizer,
    normalize_embedding_model_name as normalize_embedding_model_name_from_tokenizers_module,
)
from campus_ingestion_core.handbook_article_structure import normalize_article_body_structure


class _ChunkingPolicyTestCase(unittest.TestCase):
    def tearDown(self) -> None:
        _load_hf_tokenizer.cache_clear()


__all__ = [name for name in globals() if not name.startswith("__")]
