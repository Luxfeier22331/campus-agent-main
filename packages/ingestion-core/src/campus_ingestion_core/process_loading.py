from __future__ import annotations

import json

from campus_ingestion_core.chunking import (
    CURRICULUM_V1_CHUNK_POLICY_VERSION,
    CURRICULUM_V2_CHUNK_POLICY_VERSION,
    ChunkProfile,
    StructuredUnitChunkInput,
    build_curriculum_chunk_profile,
    build_official_web_chunk_profile,
    build_student_handbook_chunk_profile,
    chunk_structured_unit,
    chunk_table_unit,
)
from campus_ingestion_core.corpus_profiles import load_chunk_profile, load_runtime_profile
from campus_ingestion_core.curriculum_chunk_units import (
    _is_curriculum_course_map_title_line,
    _looks_like_curriculum_structure_heading,
    _normalize_curriculum_structural_path,
    build_curriculum_structured_units,
    chunk_curriculum_unit,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.regulation_chunking import build_regulation_unit_pieces

_OFFICIAL_WEB_SKIPPED_CONTENT_ROLES = frozenset(
    {"source_attribution", "boilerplate", "media_caption"}
)
_INTERNAL_NOTICE_NOTICE_BODY_LANE = "notice_body"
_INTERNAL_NOTICE_ATTACHMENT_TEXT_LANE = "attachment_text_extractable"
_INTERNAL_NOTICE_ATTACHMENT_OCR_LANE = "attachment_ocr_required"
_CURRICULUM_COURSE_MAP_HEADING = "六、课程地图"


def build_handbook_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    return build_student_handbook_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
        model_name=record.embedding_model,
    )


def build_curriculum_runtime_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    return build_curriculum_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
        model_name=record.embedding_model,
    )


def build_official_web_runtime_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    return build_official_web_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
    )


def build_generic_runtime_chunk_profile(record: DocumentRegistryRecord) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    chunk_profile = load_chunk_profile(record.corpus, record.collection)
    if chunk_profile.chunk_profile_version != runtime_profile.chunk_profile_version:
        raise ValueError(
            "chunk-profile version does not match runtime-profile for "
            f"{record.corpus}/{record.collection}: "
            f"{chunk_profile.chunk_profile_version} != {runtime_profile.chunk_profile_version}"
        )
    if chunk_profile.cleaning_policy_version != runtime_profile.cleaning_policy_version:
        raise ValueError(
            "chunk-profile cleaning policy does not match runtime-profile for "
            f"{record.corpus}/{record.collection}: "
            f"{chunk_profile.cleaning_policy_version} != {runtime_profile.cleaning_policy_version}"
        )
    return ChunkProfile(
        chunk_size=chunk_profile.runtime_defaults.chunk_size,
        max_chunk_size=chunk_profile.runtime_defaults.max_chunk_size,
        chunk_overlap=chunk_profile.runtime_defaults.chunk_overlap,
        min_chunk_size=chunk_profile.runtime_defaults.min_chunk_size,
        chunk_policy_version=runtime_profile.chunk_profile_version,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        strategy_name=chunk_profile.runtime_defaults.strategy_name,
        strategy=None,
    )


def load_default_structured_units(
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
        units.append(
            StructuredUnit(
                unit_index=unit_index,
                document_id=doc_id,
                version_id=version_id,
                text=resolve_structured_text(raw),
                source_chunk_id=normalize_optional_text(raw.get("chunk_id")),
                anchor=normalize_anchor(raw.get("anchor")),
                visibility_level=resolve_structured_visibility_level(raw),
                unit_type=normalize_unit_type(raw.get("unit_type")),
                root_unit_id=normalize_root_unit_id(raw),
                metadata=normalize_unit_metadata(raw),
            )
        )
    return tuple(units)


def load_curriculum_runtime_structured_units(
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
    return tuple(
        build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_jsonl_bytes
        )
    )


def load_internal_notice_structured_units(
    record: DocumentRegistryRecord,
    structured_jsonl_bytes: bytes,
) -> tuple[StructuredUnit, ...]:
    units = load_default_structured_units(record, structured_jsonl_bytes)
    if not units:
        return ()
    title = derive_internal_notice_document_title(units)
    enriched_units: list[StructuredUnit] = []
    for unit in units:
        metadata = dict(unit.metadata)
        if title is not None and not str(metadata.get("title") or "").strip():
            metadata["title"] = title
        metadata["internal_notice_lane"] = resolve_internal_notice_lane(record=record, unit=unit)
        enriched_units.append(
            StructuredUnit(
                unit_index=unit.unit_index,
                document_id=unit.document_id,
                version_id=unit.version_id,
                text=unit.text,
                source_chunk_id=unit.source_chunk_id,
                anchor=dict(unit.anchor),
                visibility_level=unit.visibility_level,
                unit_type=unit.unit_type,
                root_unit_id=unit.root_unit_id,
                metadata=metadata,
            )
        )
    return tuple(enriched_units)


def build_default_unit_pieces(unit: StructuredUnit, chunk_profile: ChunkProfile):
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


def build_student_rules_unit_pieces(unit: StructuredUnit, chunk_profile: ChunkProfile):
    return build_regulation_unit_pieces(
        unit,
        chunk_profile,
        require_regulation_body_role=False,
        answer_ready_roles=True,
    )


def build_institutional_rules_unit_pieces(unit: StructuredUnit, chunk_profile: ChunkProfile):
    return build_regulation_unit_pieces(
        unit,
        chunk_profile,
        require_regulation_body_role=True,
        answer_ready_roles=True,
    )


def build_curriculum_unit_pieces(unit: StructuredUnit, chunk_profile: ChunkProfile):
    return chunk_curriculum_unit(unit=unit, chunk_profile=chunk_profile)


def resolve_default_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit: StructuredUnit,
    use_collection_unit_profiles: bool,
) -> ChunkProfile:
    del record, unit, use_collection_unit_profiles
    return runtime_profile


def resolve_curriculum_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit: StructuredUnit,
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
        unit_type=unit.unit_type,
    )


def should_skip_generic_unit(
    unit: StructuredUnit, table_roots_with_semantic_units: set[str]
) -> bool:
    return unit.unit_type == "table" and unit.root_unit_id in table_roots_with_semantic_units


def should_skip_handbook_unit(
    unit: StructuredUnit, table_roots_with_semantic_units: set[str]
) -> bool:
    if unit.unit_type == "table":
        return True
    return should_skip_generic_unit(unit, table_roots_with_semantic_units)


def should_skip_curriculum_unit(
    unit: StructuredUnit, table_roots_with_semantic_units: set[str]
) -> bool:
    if should_skip_generic_unit(unit, table_roots_with_semantic_units):
        return True
    if is_curriculum_course_map_section_unit(unit):
        return True
    return is_curriculum_course_map_noise_unit(unit)


def should_skip_official_web_unit(
    unit: StructuredUnit, table_roots_with_semantic_units: set[str]
) -> bool:
    if should_skip_generic_unit(unit, table_roots_with_semantic_units):
        return True
    return (
        str(unit.metadata.get("content_role") or "").strip() in _OFFICIAL_WEB_SKIPPED_CONTENT_ROLES
    )


def should_skip_internal_notice_unit(
    unit: StructuredUnit, table_roots_with_semantic_units: set[str]
) -> bool:
    if unit.unit_type == "attachment_ref":
        return True
    return should_skip_generic_unit(unit, table_roots_with_semantic_units)


def derive_internal_notice_document_title(units: tuple[StructuredUnit, ...]) -> str | None:
    for unit in units:
        title = str(unit.metadata.get("title") or "").strip()
        if title:
            return title
    for unit in units:
        if unit.unit_type in {"policy_page", "attachment_title"}:
            title = unit.text.strip()
            if title:
                return title
    for unit in units:
        title = unit.text.strip()
        if title:
            return title
    return None


def resolve_internal_notice_lane(*, record: DocumentRegistryRecord, unit: StructuredUnit) -> str:
    if not record.document_id.startswith("notice_attachment:"):
        return _INTERNAL_NOTICE_NOTICE_BODY_LANE
    extraction_class = str(unit.metadata.get("extraction_class") or "").strip()
    if extraction_class == "text_extractable":
        return _INTERNAL_NOTICE_ATTACHMENT_TEXT_LANE
    if extraction_class == "ocr_required":
        return _INTERNAL_NOTICE_ATTACHMENT_OCR_LANE
    raise ValueError(
        "internal_notice attachment document requires extraction_class for lane resolution: "
        f"{record.document_id}#{unit.source_chunk_id or unit.root_unit_id}"
    )


def build_collection_lane_chunk_profile(
    *,
    record: DocumentRegistryRecord,
    lane: str,
) -> ChunkProfile:
    runtime_profile = load_runtime_profile(record.corpus, record.collection)
    chunk_profile = load_chunk_profile(record.corpus, record.collection)
    if chunk_profile.chunk_profile_version != runtime_profile.chunk_profile_version:
        raise ValueError(
            "chunk-profile version does not match runtime-profile for "
            f"{record.corpus}/{record.collection}: "
            f"{chunk_profile.chunk_profile_version} != {runtime_profile.chunk_profile_version}"
        )
    if chunk_profile.cleaning_policy_version != runtime_profile.cleaning_policy_version:
        raise ValueError(
            "chunk-profile cleaning policy does not match runtime-profile for "
            f"{record.corpus}/{record.collection}: "
            f"{chunk_profile.cleaning_policy_version} != {runtime_profile.cleaning_policy_version}"
        )
    lane_defaults = chunk_profile.lane_defaults.get(lane)
    if lane_defaults is None:
        raise ValueError(
            f"chunk-profile lane_defaults missing {lane!r} for {record.corpus}/{record.collection}"
        )
    return ChunkProfile(
        chunk_size=lane_defaults.chunk_size,
        max_chunk_size=lane_defaults.max_chunk_size,
        chunk_overlap=lane_defaults.chunk_overlap,
        min_chunk_size=lane_defaults.min_chunk_size,
        chunk_policy_version=runtime_profile.chunk_profile_version,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        strategy_name=lane_defaults.strategy_name,
        strategy=None,
        final_text_aware=True,
        safety_margin=8,
    )


def resolve_internal_notice_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit: StructuredUnit,
    use_collection_unit_profiles: bool,
) -> ChunkProfile:
    if not use_collection_unit_profiles:
        return runtime_profile
    if record.collection != "internal_notice":
        return runtime_profile
    return build_collection_lane_chunk_profile(
        record=record,
        lane=resolve_internal_notice_lane(record=record, unit=unit),
    )


def resolve_institutional_regulation_lane(
    *, record: DocumentRegistryRecord, unit: StructuredUnit
) -> str:
    promotion_class = str(unit.metadata.get("promotion_class") or "").strip()
    if promotion_class:
        return promotion_class
    raise ValueError(
        "institutional_rules unit requires promotion_class for lane resolution: "
        f"{record.document_id}#{unit.source_chunk_id or unit.root_unit_id}"
    )


def resolve_institutional_regulation_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit: StructuredUnit,
    use_collection_unit_profiles: bool,
) -> ChunkProfile:
    if not use_collection_unit_profiles:
        return runtime_profile
    if (record.corpus, record.collection) != ("regulations", "institutional_rules"):
        return runtime_profile
    return build_collection_lane_chunk_profile(
        record=record,
        lane=resolve_institutional_regulation_lane(record=record, unit=unit),
    )


def resolve_scoped_rule_lane(*, record: DocumentRegistryRecord, unit: StructuredUnit) -> str:
    document_nature = str(unit.metadata.get("document_nature") or "").strip()
    if document_nature:
        return document_nature
    raise ValueError(
        "scoped_rules unit requires document_nature for lane resolution: "
        f"{record.document_id}#{unit.source_chunk_id or unit.root_unit_id}"
    )


def resolve_scoped_rule_unit_chunk_profile(
    record: DocumentRegistryRecord,
    runtime_profile: ChunkProfile,
    unit: StructuredUnit,
    use_collection_unit_profiles: bool,
) -> ChunkProfile:
    if not use_collection_unit_profiles:
        return runtime_profile
    if (record.corpus, record.collection) != ("regulations", "scoped_rules"):
        return runtime_profile
    return build_collection_lane_chunk_profile(
        record=record,
        lane=resolve_scoped_rule_lane(record=record, unit=unit),
    )


def resolve_structured_text(raw: dict[str, object]) -> str:
    for field_name in ("clean_text", "raw_text", "text"):
        value = raw.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise ValueError("structured unit must contain clean_text, raw_text, or text")


def normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def normalize_anchor(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def resolve_structured_visibility_level(raw: dict[str, object]) -> str:
    visibility_level = raw.get("visibility_level")
    if isinstance(visibility_level, str) and visibility_level.strip():
        return visibility_level.strip()
    entitlement_groups = raw.get("entitlement_groups")
    if isinstance(entitlement_groups, list) and any(
        isinstance(item, str) and item.strip() for item in entitlement_groups
    ):
        return "restricted"
    return "public"


def resolve_effective_visibility_level(
    *,
    unit_visibility_level: str,
    document_entitlement_groups: tuple[str, ...],
) -> str:
    if document_entitlement_groups and unit_visibility_level == "public":
        return "restricted"
    return unit_visibility_level


def normalize_unit_type(value: object) -> str:
    if not isinstance(value, str):
        return "policy_page"
    normalized = value.strip()
    return normalized or "policy_page"


def normalize_root_unit_id(raw: dict[str, object]) -> str:
    root_unit_id = raw.get("root_unit_id")
    if isinstance(root_unit_id, str) and root_unit_id.strip():
        return root_unit_id.strip()
    source_chunk_id = raw.get("chunk_id")
    if isinstance(source_chunk_id, str) and source_chunk_id.strip():
        return source_chunk_id.strip()
    return f"{raw.get('doc_id', '')}:{raw.get('version_id', '')}:root"


def normalize_unit_metadata(raw: dict[str, object]) -> dict[str, object]:
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    normalized: dict[str, object] = {}
    for key, value in metadata.items():
        if isinstance(key, str) and key.strip():
            normalized[key.strip()] = value
    return normalized


def is_curriculum_course_map_noise_unit(unit: StructuredUnit) -> bool:
    section_path = normalize_section_path(unit.anchor)
    normalized_path = _normalize_curriculum_structural_path(list(section_path))
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
    if "六、课程地图" not in normalized_path:
        return True
    non_root_heading_count = sum(
        1
        for line in lines
        if _looks_like_curriculum_structure_heading(line) and line != "六、课程地图"
    )
    return non_root_heading_count > 0 or title_line_count > 1


def is_curriculum_course_map_section_unit(unit: StructuredUnit) -> bool:
    normalized_path = _normalize_curriculum_structural_path(
        list(normalize_section_path(unit.anchor))
    )
    return _CURRICULUM_COURSE_MAP_HEADING in normalized_path


def normalize_section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


__all__ = [
    "build_collection_lane_chunk_profile",
    "build_curriculum_runtime_chunk_profile",
    "build_curriculum_unit_pieces",
    "build_default_unit_pieces",
    "build_generic_runtime_chunk_profile",
    "build_handbook_chunk_profile",
    "build_official_web_runtime_chunk_profile",
    "build_regulation_unit_pieces",
    "build_student_rules_unit_pieces",
    "derive_internal_notice_document_title",
    "is_curriculum_course_map_section_unit",
    "load_curriculum_runtime_structured_units",
    "load_default_structured_units",
    "load_internal_notice_structured_units",
    "resolve_curriculum_unit_chunk_profile",
    "resolve_default_unit_chunk_profile",
    "resolve_effective_visibility_level",
    "resolve_institutional_regulation_lane",
    "resolve_institutional_regulation_unit_chunk_profile",
    "resolve_internal_notice_lane",
    "resolve_internal_notice_unit_chunk_profile",
    "resolve_scoped_rule_lane",
    "resolve_scoped_rule_unit_chunk_profile",
    "should_skip_curriculum_unit",
    "should_skip_generic_unit",
    "should_skip_handbook_unit",
    "should_skip_internal_notice_unit",
    "should_skip_official_web_unit",
]
