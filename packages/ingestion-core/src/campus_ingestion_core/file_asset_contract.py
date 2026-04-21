from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class FileAssetDescriptor:
    asset_family: str
    filename: str
    media_type: str | None = None
    source_object_key: str | None = None
    source_sha256: str | None = None


@dataclass(frozen=True, slots=True)
class FileAssetArtifactRef:
    role: str
    object_key: str
    media_type: str | None = None


@dataclass(frozen=True, slots=True)
class ArtifactProvenance:
    engine_name: str
    engine_version: str
    warnings: tuple[str, ...] = ()
    failure_reason: str | None = None


@dataclass(frozen=True, slots=True)
class NormalizationOutcome:
    descriptor: FileAssetDescriptor
    provenance: ArtifactProvenance
    normalized_extension: str
    normalized_sha256: str
    artifact_refs: tuple[FileAssetArtifactRef, ...] = field(default=(), kw_only=True)


@dataclass(frozen=True, slots=True)
class ExtractionOutcome:
    descriptor: FileAssetDescriptor
    provenance: ArtifactProvenance
    text_blocks: tuple[str, ...]
    extraction_strategy: str
    artifact_refs: tuple[FileAssetArtifactRef, ...] = field(default=(), kw_only=True)


@dataclass(frozen=True, slots=True)
class FileAssetExtractionRecord:
    outcome: ExtractionOutcome
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TerminalOutcome:
    descriptor: FileAssetDescriptor
    provenance: ArtifactProvenance
    outcome: str
    artifact_refs: tuple[FileAssetArtifactRef, ...] = field(default=(), kw_only=True)


def serialize_file_asset_descriptor(descriptor: FileAssetDescriptor) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "asset_family": descriptor.asset_family,
        "filename": descriptor.filename,
    }
    if descriptor.media_type is not None:
        payload["media_type"] = descriptor.media_type
    if descriptor.source_object_key is not None:
        payload["source_object_key"] = descriptor.source_object_key
    if descriptor.source_sha256 is not None:
        payload["source_sha256"] = descriptor.source_sha256
    return payload


def serialize_file_asset_artifact_ref(artifact_ref: FileAssetArtifactRef) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "role": artifact_ref.role,
        "object_key": artifact_ref.object_key,
    }
    if artifact_ref.media_type is not None:
        payload["media_type"] = artifact_ref.media_type
    return payload


def serialize_artifact_provenance(provenance: ArtifactProvenance) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "engine_name": provenance.engine_name,
        "engine_version": provenance.engine_version,
        "warnings": list(provenance.warnings),
    }
    if provenance.failure_reason is not None:
        payload["failure_reason"] = provenance.failure_reason
    return payload


def serialize_normalization_outcome(outcome: NormalizationOutcome) -> dict[str, Any]:
    return {
        "outcome_type": "normalization",
        "descriptor": serialize_file_asset_descriptor(outcome.descriptor),
        "provenance": serialize_artifact_provenance(outcome.provenance),
        "normalized_extension": outcome.normalized_extension,
        "normalized_sha256": outcome.normalized_sha256,
        "artifact_refs": [serialize_file_asset_artifact_ref(ref) for ref in outcome.artifact_refs],
    }


def serialize_extraction_outcome(outcome: ExtractionOutcome) -> dict[str, Any]:
    return {
        "outcome_type": "extraction",
        "descriptor": serialize_file_asset_descriptor(outcome.descriptor),
        "provenance": serialize_artifact_provenance(outcome.provenance),
        "text_blocks": list(outcome.text_blocks),
        "extraction_strategy": outcome.extraction_strategy,
        "artifact_refs": [serialize_file_asset_artifact_ref(ref) for ref in outcome.artifact_refs],
    }


def serialize_file_asset_extraction_record(record: FileAssetExtractionRecord) -> dict[str, Any]:
    return {
        "schema_version": "file_asset_extraction_record_v1",
        "metadata": dict(record.metadata),
        "outcome": serialize_extraction_outcome(record.outcome),
    }


def serialize_terminal_outcome(outcome: TerminalOutcome) -> dict[str, Any]:
    return {
        "outcome_type": "terminal",
        "descriptor": serialize_file_asset_descriptor(outcome.descriptor),
        "provenance": serialize_artifact_provenance(outcome.provenance),
        "outcome": outcome.outcome,
        "artifact_refs": [serialize_file_asset_artifact_ref(ref) for ref in outcome.artifact_refs],
    }


def serialize_file_asset_outcome(
    outcome: NormalizationOutcome | ExtractionOutcome | TerminalOutcome,
) -> dict[str, Any]:
    if isinstance(outcome, NormalizationOutcome):
        return serialize_normalization_outcome(outcome)
    if isinstance(outcome, ExtractionOutcome):
        return serialize_extraction_outcome(outcome)
    if isinstance(outcome, TerminalOutcome):
        return serialize_terminal_outcome(outcome)
    raise TypeError(f"unsupported file asset outcome type: {type(outcome)!r}")


def parse_file_asset_descriptor(payload: Mapping[str, Any]) -> FileAssetDescriptor:
    return FileAssetDescriptor(
        asset_family=str(payload.get("asset_family") or ""),
        filename=str(payload.get("filename") or ""),
        media_type=str(payload["media_type"]) if payload.get("media_type") is not None else None,
        source_object_key=(
            str(payload["source_object_key"])
            if payload.get("source_object_key") is not None
            else None
        ),
        source_sha256=(
            str(payload["source_sha256"]) if payload.get("source_sha256") is not None else None
        ),
    )


def parse_file_asset_artifact_ref(payload: Mapping[str, Any]) -> FileAssetArtifactRef:
    return FileAssetArtifactRef(
        role=str(payload.get("role") or ""),
        object_key=str(payload.get("object_key") or ""),
        media_type=str(payload["media_type"]) if payload.get("media_type") is not None else None,
    )


def parse_artifact_provenance(payload: Mapping[str, Any]) -> ArtifactProvenance:
    return ArtifactProvenance(
        engine_name=str(payload.get("engine_name") or ""),
        engine_version=str(payload.get("engine_version") or ""),
        warnings=tuple(str(item) for item in payload.get("warnings") or ()),
        failure_reason=(
            str(payload["failure_reason"]) if payload.get("failure_reason") is not None else None
        ),
    )


def parse_normalization_outcome(payload: Mapping[str, Any]) -> NormalizationOutcome:
    return NormalizationOutcome(
        descriptor=parse_file_asset_descriptor(dict(payload.get("descriptor") or {})),
        provenance=parse_artifact_provenance(dict(payload.get("provenance") or {})),
        normalized_extension=str(payload.get("normalized_extension") or ""),
        normalized_sha256=str(payload.get("normalized_sha256") or ""),
        artifact_refs=tuple(
            parse_file_asset_artifact_ref(item)
            for item in payload.get("artifact_refs") or ()
            if isinstance(item, Mapping)
        ),
    )


def parse_extraction_outcome(payload: Mapping[str, Any]) -> ExtractionOutcome:
    return ExtractionOutcome(
        descriptor=parse_file_asset_descriptor(dict(payload.get("descriptor") or {})),
        provenance=parse_artifact_provenance(dict(payload.get("provenance") or {})),
        text_blocks=tuple(str(item) for item in payload.get("text_blocks") or ()),
        extraction_strategy=str(payload.get("extraction_strategy") or ""),
        artifact_refs=tuple(
            parse_file_asset_artifact_ref(item)
            for item in payload.get("artifact_refs") or ()
            if isinstance(item, Mapping)
        ),
    )


def parse_file_asset_extraction_record(payload: Mapping[str, Any]) -> FileAssetExtractionRecord:
    schema_version = str(payload.get("schema_version") or "")
    if schema_version != "file_asset_extraction_record_v1":
        raise ValueError(
            f"unsupported file asset extraction record schema_version: {schema_version!r}"
        )
    metadata_payload = payload.get("metadata") or {}
    outcome_payload = payload.get("outcome") or {}
    if not isinstance(metadata_payload, Mapping):
        raise ValueError("file asset extraction record metadata must be a mapping")
    if not isinstance(outcome_payload, Mapping):
        raise ValueError("file asset extraction record outcome must be a mapping")
    return FileAssetExtractionRecord(
        outcome=parse_extraction_outcome(outcome_payload),
        metadata={str(key): value for key, value in metadata_payload.items()},
    )


def parse_terminal_outcome(payload: Mapping[str, Any]) -> TerminalOutcome:
    return TerminalOutcome(
        descriptor=parse_file_asset_descriptor(dict(payload.get("descriptor") or {})),
        provenance=parse_artifact_provenance(dict(payload.get("provenance") or {})),
        outcome=str(payload.get("outcome") or ""),
        artifact_refs=tuple(
            parse_file_asset_artifact_ref(item)
            for item in payload.get("artifact_refs") or ()
            if isinstance(item, Mapping)
        ),
    )


def parse_file_asset_outcome(
    payload: Mapping[str, Any],
) -> NormalizationOutcome | ExtractionOutcome | TerminalOutcome:
    outcome_type = str(payload.get("outcome_type") or "")
    if outcome_type == "normalization":
        return parse_normalization_outcome(payload)
    if outcome_type == "extraction":
        return parse_extraction_outcome(payload)
    if outcome_type == "terminal":
        return parse_terminal_outcome(payload)
    raise ValueError(f"unsupported file asset outcome_type: {outcome_type!r}")


__all__ = [
    "ArtifactProvenance",
    "ExtractionOutcome",
    "FileAssetArtifactRef",
    "FileAssetDescriptor",
    "FileAssetExtractionRecord",
    "NormalizationOutcome",
    "TerminalOutcome",
    "serialize_artifact_provenance",
    "serialize_extraction_outcome",
    "serialize_file_asset_extraction_record",
    "serialize_file_asset_artifact_ref",
    "serialize_file_asset_descriptor",
    "serialize_file_asset_outcome",
    "serialize_normalization_outcome",
    "serialize_terminal_outcome",
    "parse_artifact_provenance",
    "parse_extraction_outcome",
    "parse_file_asset_extraction_record",
    "parse_file_asset_artifact_ref",
    "parse_file_asset_descriptor",
    "parse_file_asset_outcome",
    "parse_normalization_outcome",
    "parse_terminal_outcome",
]
