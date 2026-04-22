from __future__ import annotations

from campus_ingestion_core.chunking import (
    CURRICULUM_V1_CHUNK_POLICY_VERSION,
    CURRICULUM_V2_CHUNK_POLICY_VERSION,
    ChunkProfile,
    build_curriculum_chunk_profile,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process_candidate_merging import (
    merge_adjacent_curriculum_section_context_candidates,
    merge_adjacent_curriculum_table_candidates,
    merge_adjacent_short_textual_candidates,
)
from campus_ingestion_core.process_loading import build_collection_lane_chunk_profile
from campus_ingestion_core.process_shared import _ChunkCandidate


def postprocess_default_chunk_candidates(
    chunk_candidates: tuple[_ChunkCandidate, ...],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    del record, use_collection_unit_profiles
    return merge_adjacent_short_textual_candidates(
        chunk_candidates=chunk_candidates,
        chunk_profile=runtime_profile,
    )


def postprocess_curriculum_chunk_candidates(
    chunk_candidates: tuple[_ChunkCandidate, ...],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    section_chunk_profile = runtime_profile
    table_chunk_profile = runtime_profile
    if use_collection_unit_profiles and runtime_profile.chunk_policy_version in {
        CURRICULUM_V1_CHUNK_POLICY_VERSION,
        CURRICULUM_V2_CHUNK_POLICY_VERSION,
    }:
        section_chunk_profile = build_curriculum_chunk_profile(
            profile_version=runtime_profile.chunk_policy_version,
            model_name=record.embedding_model,
            unit_type="section_text",
        )
        table_chunk_profile = build_curriculum_chunk_profile(
            profile_version=runtime_profile.chunk_policy_version,
            model_name=record.embedding_model,
            unit_type="table_unit",
        )
    merged_candidates = merge_adjacent_short_textual_candidates(
        chunk_candidates=chunk_candidates,
        chunk_profile=section_chunk_profile,
    )
    merged_candidates = merge_adjacent_curriculum_section_context_candidates(
        chunk_candidates=merged_candidates,
        section_chunk_profile=section_chunk_profile,
        table_chunk_profile=table_chunk_profile,
    )
    return merge_adjacent_curriculum_table_candidates(
        chunk_candidates=merged_candidates,
        chunk_profile=table_chunk_profile,
    )


def postprocess_internal_notice_chunk_candidates(
    chunk_candidates: tuple[_ChunkCandidate, ...],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    if not chunk_candidates:
        return ()
    if not use_collection_unit_profiles:
        return merge_adjacent_short_textual_candidates(
            chunk_candidates=chunk_candidates,
            chunk_profile=runtime_profile,
        )
    merged: list[_ChunkCandidate] = []
    current_lane: str | None = None
    current_group: list[_ChunkCandidate] = []
    for candidate in chunk_candidates:
        candidate_lane = str(candidate.metadata.get("internal_notice_lane") or "").strip()
        if not candidate_lane:
            raise ValueError(
                f"internal_notice chunk candidate missing lane metadata: {record.document_id}"
            )
        if current_lane is None:
            current_lane = candidate_lane
        if candidate_lane != current_lane:
            merged.extend(
                merge_adjacent_short_textual_candidates(
                    chunk_candidates=tuple(current_group),
                    chunk_profile=build_collection_lane_chunk_profile(
                        record=record,
                        lane=current_lane,
                    ),
                )
            )
            current_group = []
            current_lane = candidate_lane
        current_group.append(candidate)
    if current_group and current_lane is not None:
        merged.extend(
            merge_adjacent_short_textual_candidates(
                chunk_candidates=tuple(current_group),
                chunk_profile=build_collection_lane_chunk_profile(
                    record=record,
                    lane=current_lane,
                ),
            )
        )
    return tuple(merged)


def postprocess_institutional_regulation_chunk_candidates(
    chunk_candidates: tuple[_ChunkCandidate, ...],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    if not chunk_candidates:
        return ()
    if not use_collection_unit_profiles:
        return merge_adjacent_short_textual_candidates(
            chunk_candidates=chunk_candidates,
            chunk_profile=runtime_profile,
        )
    merged: list[_ChunkCandidate] = []
    current_lane: str | None = None
    current_group: list[_ChunkCandidate] = []
    for candidate in chunk_candidates:
        candidate_lane = str(candidate.metadata.get("promotion_class") or "").strip()
        if not candidate_lane:
            raise ValueError(
                "institutional_rules chunk candidate missing promotion_class metadata: "
                f"{record.document_id}"
            )
        if current_lane is None:
            current_lane = candidate_lane
        if candidate_lane != current_lane:
            merged.extend(
                merge_adjacent_short_textual_candidates(
                    chunk_candidates=tuple(current_group),
                    chunk_profile=build_collection_lane_chunk_profile(
                        record=record,
                        lane=current_lane,
                    ),
                )
            )
            current_group = []
            current_lane = candidate_lane
        current_group.append(candidate)
    if current_group and current_lane is not None:
        merged.extend(
            merge_adjacent_short_textual_candidates(
                chunk_candidates=tuple(current_group),
                chunk_profile=build_collection_lane_chunk_profile(
                    record=record,
                    lane=current_lane,
                ),
            )
        )
    return tuple(merged)


def postprocess_scoped_rule_chunk_candidates(
    chunk_candidates: tuple[_ChunkCandidate, ...],
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    use_collection_unit_profiles: bool,
) -> tuple[_ChunkCandidate, ...]:
    if not chunk_candidates:
        return ()
    if not use_collection_unit_profiles:
        return merge_adjacent_short_textual_candidates(
            chunk_candidates=chunk_candidates,
            chunk_profile=runtime_profile,
        )
    merged: list[_ChunkCandidate] = []
    current_lane: str | None = None
    current_group: list[_ChunkCandidate] = []
    for candidate in chunk_candidates:
        candidate_lane = str(candidate.metadata.get("document_nature") or "").strip()
        if not candidate_lane:
            raise ValueError(
                f"scoped_rules chunk candidate missing document_nature metadata: {record.document_id}"
            )
        if current_lane is None:
            current_lane = candidate_lane
        if candidate_lane != current_lane:
            merged.extend(
                merge_adjacent_short_textual_candidates(
                    chunk_candidates=tuple(current_group),
                    chunk_profile=build_collection_lane_chunk_profile(
                        record=record,
                        lane=current_lane,
                    ),
                )
            )
            current_group = []
            current_lane = candidate_lane
        current_group.append(candidate)
    if current_group and current_lane is not None:
        merged.extend(
            merge_adjacent_short_textual_candidates(
                chunk_candidates=tuple(current_group),
                chunk_profile=build_collection_lane_chunk_profile(
                    record=record,
                    lane=current_lane,
                ),
            )
        )
    return tuple(merged)


__all__ = [
    "postprocess_curriculum_chunk_candidates",
    "postprocess_default_chunk_candidates",
    "postprocess_institutional_regulation_chunk_candidates",
    "postprocess_internal_notice_chunk_candidates",
    "postprocess_scoped_rule_chunk_candidates",
]
