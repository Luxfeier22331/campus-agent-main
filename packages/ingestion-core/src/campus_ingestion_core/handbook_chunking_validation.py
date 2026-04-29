from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.handbook_chunking_validation_report import (
    build_student_handbook_chunking_validation_report,
)
from campus_ingestion_core.handbook_chunking_validation_samples import (
    export_student_handbook_chunk_samples,
)
from campus_ingestion_core.handbook_chunking_validation_scan import (
    scan_student_handbook_chunking,
)
from campus_ingestion_core.handbook_chunking_validation_shared import (
    DEFAULT_HANDBOOK_MANIFEST_PATH,
    ChunkValidationArtifactReader,
    ChunkValidationFailure,
    StudentHandbookChunkingScanResult,
    StudentHandbookChunkingValidationReport,
    StudentHandbookScannedDocument,
    StudentHandbookValidationInputs,
)
from campus_ingestion_core.registry import DocumentRegistry


def validate_student_handbook_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: ChunkValidationArtifactReader | None = None,
    manifest_path: Path | None = None,
    chunk_profile: ChunkProfile | None = None,
    scan_result: StudentHandbookChunkingScanResult | None = None,
) -> StudentHandbookChunkingValidationReport:
    runtime_scan = scan_result or scan_student_handbook_chunking(
        env=env,
        registry=registry,
        object_store=object_store,
        manifest_path=manifest_path,
        chunk_profile=chunk_profile,
        mode="full",
    )
    return build_student_handbook_chunking_validation_report(scan_result=runtime_scan)


__all__ = [
    "DEFAULT_HANDBOOK_MANIFEST_PATH",
    "ChunkValidationArtifactReader",
    "ChunkValidationFailure",
    "StudentHandbookChunkingScanResult",
    "StudentHandbookChunkingValidationReport",
    "StudentHandbookScannedDocument",
    "StudentHandbookValidationInputs",
    "build_student_handbook_chunking_validation_report",
    "export_student_handbook_chunk_samples",
    "scan_student_handbook_chunking",
    "validate_student_handbook_chunking",
]
