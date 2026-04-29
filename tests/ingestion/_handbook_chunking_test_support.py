from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.chunking import (
    ChunkProfile,
    RegexApproxTokenCounter,
    build_student_handbook_chunk_profile,
)


def build_hermetic_handbook_v3_chunk_profile() -> ChunkProfile:
    profile = build_student_handbook_chunk_profile(
        profile_version="student_rules_semantic_v3",
        model_name="Qwen3-Embedding-4B",
    )
    return replace(
        profile,
        token_counter=RegexApproxTokenCounter(name=profile.tokenizer_name),
    )
