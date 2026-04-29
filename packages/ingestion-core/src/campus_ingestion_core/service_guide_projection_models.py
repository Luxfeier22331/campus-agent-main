from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


class ServiceGuideProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: ServiceGuideProjectionValidationReport
    manual_review_sources: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionReleaseReport:
    schema_version: str
    release_id: str
    generated_at: str
    projection_path: str
    current_projection_path: str
    release_object_key: str
    current_object_key: str
    validation_summary_path: str
    release_manifest_path: str
    manual_review_report_path: str


@dataclass(frozen=True, slots=True)
class ServiceGuideSourceTruthManifest:
    path: Path
    target_corpus: str
    target_collection: str
    upstream_corpus: str
    upstream_collection: str
    release_id_prefix: str
    effective_from: str
    effective_until: str
    expected_ready_records: int | None
    curated_flow_graph_paths: tuple[Path, ...]
    curated_service_guide_paths: tuple[Path, ...]


__all__ = [
    "ServiceGuideProjectionBuildResult",
    "ServiceGuideProjectionObjectStore",
    "ServiceGuideProjectionReleaseReport",
    "ServiceGuideProjectionValidationReport",
    "ServiceGuideSourceTruthManifest",
]
