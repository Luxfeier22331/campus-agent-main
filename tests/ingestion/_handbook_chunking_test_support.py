from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.chunking import (
    ChunkProfile,
    RegexApproxTokenCounter,
    build_curriculum_chunk_profile,
    build_student_handbook_chunk_profile,
)


def build_hermetic_handbook_v3_chunk_profile() -> ChunkProfile:
    profile = build_student_handbook_chunk_profile(
        profile_version="student_rules_semantic_v3",
        model_name="Qwen3-Embedding-4B",
    )
    return replace(
        profile,
        token_counter=RegexApproxTokenCounter(name="regex_test"),
        tokenizer_name="regex_test",
    )


def build_hermetic_curriculum_chunk_profile() -> ChunkProfile:
    profile = build_curriculum_chunk_profile(model_name="Qwen3-Embedding-4B")
    return replace(
        profile,
        token_counter=RegexApproxTokenCounter(name="regex_test"),
        tokenizer_name="regex_test",
    )
