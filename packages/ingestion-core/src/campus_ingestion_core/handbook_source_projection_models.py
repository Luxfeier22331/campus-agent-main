from __future__ import annotations

from dataclasses import dataclass

HANDBOOK_SOURCE_PROJECTIONS_SCHEMA_VERSION = "student_rules_source_projections_v1"


@dataclass(frozen=True, slots=True)
class HandbookSourceProjection:
    projection_name: str
    target_corpus: str
    target_collection: str
    projection_family: str
    replay_from_source_truth: bool
    derived_from: str
    derived_from_document_id: str | None
    parent_document_id: str | None
    attachment_kind: str | None
    attachment_role: str | None
    target_title: str | None = None
    migration_reason: str | None = None
    source_title: str | None = None
    source_handbook_section: str | None = None
    source_page_start: int | None = None
    source_page_end: int | None = None


@dataclass(frozen=True, slots=True)
class HandbookSourceProjectionsConfig:
    source_corpus: str
    source_collection: str
    raw_asset_id: str
    projections: tuple[HandbookSourceProjection, ...]


__all__ = [
    "HANDBOOK_SOURCE_PROJECTIONS_SCHEMA_VERSION",
    "HandbookSourceProjection",
    "HandbookSourceProjectionsConfig",
]
