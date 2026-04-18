from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FileAssetDescriptor:
    asset_family: str
    filename: str
    media_type: str | None = None
    source_object_key: str | None = None
    source_sha256: str | None = None


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


@dataclass(frozen=True, slots=True)
class ExtractionOutcome:
    descriptor: FileAssetDescriptor
    provenance: ArtifactProvenance
    text_blocks: tuple[str, ...]
    extraction_strategy: str


@dataclass(frozen=True, slots=True)
class TerminalOutcome:
    descriptor: FileAssetDescriptor
    provenance: ArtifactProvenance
    outcome: str


__all__ = [
    "ArtifactProvenance",
    "ExtractionOutcome",
    "FileAssetDescriptor",
    "NormalizationOutcome",
    "TerminalOutcome",
]
