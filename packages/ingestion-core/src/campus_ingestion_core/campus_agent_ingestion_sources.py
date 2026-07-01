from __future__ import annotations

import hashlib
from dataclasses import replace

from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRef, SourceObservation

DEFAULT_SOURCE_PREFERENCE = {
    "current-effective": (
        "official_web",
        "authenticated_notice_portal",
        "manual_curated",
        "pdf_ocr",
    ),
    "source-faithful": (
        "pdf_ocr",
        "authenticated_notice_portal",
        "manual_curated",
        "official_web",
    ),
    "editorial": ("manual_curated", "official_web", "authenticated_notice_portal", "pdf_ocr"),
}
OFFICIAL_WEB_EQUIVALENT_SOURCE_CHANNELS = frozenset({"official_web"})


def build_source_observation(
    *,
    source_channel: str,
    source_uri: str,
    raw_asset: RawAssetRef | None,
    is_primary: bool,
    import_source: str,
) -> SourceObservation:
    return SourceObservation(
        source_channel=source_channel,
        source_uri=source_uri,
        raw_asset=raw_asset,
        is_primary=is_primary,
        import_source=import_source,
    )


def document_semantic_hash(
    *,
    document_units_bytes: bytes,
    semantic_content_hash: object,
) -> str:
    explicit_hash = _normalize_optional_text(semantic_content_hash)
    if explicit_hash is not None:
        return explicit_hash
    return hashlib.sha256(document_units_bytes).hexdigest()


def merge_equivalent_source_record(
    *,
    existing: DocumentRegistryRecord,
    candidate_observation: SourceObservation,
    candidate_is_current: bool,
    timestamp: str,
) -> DocumentRegistryRecord:
    observations_by_identity: dict[tuple[str, str, str, str], SourceObservation] = {}
    for observation in _record_source_observations(existing):
        observations_by_identity[_source_observation_identity(observation)] = observation
    candidate_identity = _source_observation_identity(candidate_observation)
    existing_candidate = observations_by_identity.get(candidate_identity)
    observations_by_identity[candidate_identity] = (
        _merge_source_observation(existing_candidate, candidate_observation)
        if existing_candidate is not None
        else candidate_observation
    )
    chosen_primary = _choose_primary_observation(
        revision_track=existing.revision_track,
        observations=tuple(observations_by_identity.values()),
    )
    normalized_observations = tuple(
        sorted(
            (
                replace(
                    observation,
                    is_primary=_source_observation_identity(observation)
                    == _source_observation_identity(chosen_primary),
                )
                for observation in observations_by_identity.values()
            ),
            key=_source_observation_identity,
        )
    )
    return replace(
        existing,
        source_uri=chosen_primary.source_uri,
        source_channel=chosen_primary.source_channel,
        raw_asset=chosen_primary.raw_asset,
        source_observations=normalized_observations,
        is_current=existing.is_current or candidate_is_current,
        status="active" if existing.is_current or candidate_is_current else existing.status,
        ingestion_timestamp=timestamp,
        import_source=(
            candidate_observation.import_source
            if _source_observation_identity(chosen_primary) == candidate_identity
            else existing.import_source
        ),
    )


def find_equivalent_scope_record(
    *,
    existing_records_by_lineage: dict[
        tuple[str, str],
        dict[tuple[str, str], tuple[DocumentRegistryRecord, ...]],
    ],
    scope: tuple[str, str],
    source_channel: str,
    revision_track: str,
    content_hash: str,
) -> DocumentRegistryRecord | None:
    if source_channel not in OFFICIAL_WEB_EQUIVALENT_SOURCE_CHANNELS:
        return None
    scope_records = existing_records_by_lineage.get(scope, {})
    candidates = [
        record
        for lineage_records in scope_records.values()
        for record in lineage_records
        if record.revision_track == revision_track
        and record.content_hash == content_hash
        and record.source_channel in OFFICIAL_WEB_EQUIVALENT_SOURCE_CHANNELS
    ]
    if not candidates:
        return None
    current_candidates = [record for record in candidates if record.is_current]
    ranked_candidates = current_candidates or candidates
    return max(
        ranked_candidates,
        key=lambda record: (
            record.is_current,
            record.ingestion_timestamp,
            record.document_id,
            record.version_id,
        ),
    )


def _record_source_observations(record: DocumentRegistryRecord) -> tuple[SourceObservation, ...]:
    if record.source_observations:
        return record.source_observations
    return (
        SourceObservation(
            source_channel=record.source_channel,
            source_uri=record.source_uri,
            raw_asset=record.raw_asset,
            is_primary=True,
            import_source=record.import_source,
        ),
    )


def _source_observation_identity(observation: SourceObservation) -> tuple[str, str, str, str]:
    raw_asset = observation.raw_asset
    return (
        observation.source_channel,
        observation.source_uri,
        raw_asset.raw_asset_id if raw_asset is not None else "",
        raw_asset.raw_version_id if raw_asset is not None else "",
    )


def _source_priority(*, revision_track: str, source_channel: str) -> int:
    preferences = DEFAULT_SOURCE_PREFERENCE.get(
        revision_track,
        ("manual_curated", "official_web", "pdf_ocr"),
    )
    try:
        return len(preferences) - preferences.index(source_channel)
    except ValueError:
        return 0


def _merge_source_observation(
    existing: SourceObservation | None,
    candidate: SourceObservation,
) -> SourceObservation:
    if existing is None:
        return candidate
    return SourceObservation(
        source_channel=existing.source_channel,
        source_uri=existing.source_uri,
        raw_asset=candidate.raw_asset if candidate.raw_asset is not None else existing.raw_asset,
        is_primary=existing.is_primary or candidate.is_primary,
        import_source=candidate.import_source or existing.import_source,
    )


def _choose_primary_observation(
    *,
    revision_track: str,
    observations: tuple[SourceObservation, ...],
) -> SourceObservation:
    existing_primary_identity = next(
        (
            _source_observation_identity(observation)
            for observation in observations
            if observation.is_primary
        ),
        None,
    )
    return max(
        observations,
        key=lambda observation: (
            _source_priority(
                revision_track=revision_track,
                source_channel=observation.source_channel,
            ),
            existing_primary_identity == _source_observation_identity(observation),
        ),
    )


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
