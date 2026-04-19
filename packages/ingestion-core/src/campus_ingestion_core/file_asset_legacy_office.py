from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.file_asset_contract import (
    ArtifactProvenance,
    ExtractionOutcome,
    FileAssetArtifactRef,
    FileAssetDescriptor,
    NormalizationOutcome,
)
from campus_ingestion_core.legacy_office_conversion_client import (
    LegacyOfficeConversionClientProtocol,
    LegacyOfficeConversionRequest,
    build_legacy_office_conversion_client_from_env,
)
from campus_ingestion_core.file_asset_ooxml import (
    extract_docx_text_blocks,
    extract_xlsx_text_blocks,
)


@dataclass(frozen=True, slots=True)
class LegacyOfficeNormalizationResult(NormalizationOutcome):
    input_path: str
    output_path: str
    source_extension: str

    @property
    def source_mime_type(self) -> str | None:
        return self.descriptor.media_type

    @property
    def source_object_key(self) -> str | None:
        return self.descriptor.source_object_key

    @property
    def source_sha256(self) -> str:
        return str(self.descriptor.source_sha256 or "")

    @property
    def normalizer_name(self) -> str:
        return self.provenance.engine_name

    @property
    def normalizer_version(self) -> str:
        return self.provenance.engine_version


@dataclass(frozen=True, slots=True)
class LegacyOfficeExtractionResult(ExtractionOutcome):
    source_extension: str
    normalized_extension: str
    normalized_sha256: str


def normalize_legacy_office_asset(
    *,
    input_path: Path,
    output_dir: Path,
    source_object_key: str | None = None,
    source_sha256: str | None = None,
    source_mime_type: str | None = None,
    normalized_object_key: str | None = None,
    conversion_client: LegacyOfficeConversionClientProtocol | None = None,
) -> LegacyOfficeNormalizationResult:
    source_extension = input_path.suffix.lower()
    normalized_extension = {
        ".doc": ".docx",
        ".xls": ".xlsx",
    }.get(source_extension)
    if normalized_extension is None:
        raise ValueError("legacy Office normalizer only accepts .doc or .xls inputs")
    if not input_path.is_file():
        raise FileNotFoundError(f"legacy Office input not found: {input_path}")

    input_bytes = input_path.read_bytes()
    actual_source_sha256 = hashlib.sha256(input_bytes).hexdigest()
    if source_sha256 is not None and source_sha256 != actual_source_sha256:
        raise ValueError(
            "legacy Office source_sha256 mismatch: "
            f"expected {source_sha256}, got {actual_source_sha256}"
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}{normalized_extension}"
    conversion_client_instance = (
        conversion_client if conversion_client is not None else build_legacy_office_conversion_client_from_env()
    )
    normalized_media_type = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[normalized_extension]
    source_media_type = source_mime_type or {
        ".doc": "application/msword",
        ".xls": "application/vnd.ms-excel",
    }[source_extension]
    conversion_result = conversion_client_instance.convert(
        LegacyOfficeConversionRequest(
            source_media_type=source_media_type,
            target_format=normalized_extension.lstrip("."),
            source_sha256=actual_source_sha256,
            filename=input_path.name,
            source_bytes=input_bytes,
        )
    )
    if conversion_result.normalized_media_type != normalized_media_type:
        raise RuntimeError(
            "legacy Office conversion service returned unexpected media type: "
            f"{conversion_result.normalized_media_type}"
        )
    output_path.write_bytes(conversion_result.normalized_bytes)
    normalized_bytes = conversion_result.normalized_bytes
    normalized_media_type = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[normalized_extension]
    return LegacyOfficeNormalizationResult(
        descriptor=FileAssetDescriptor(
            asset_family="legacy_binary_office",
            filename=input_path.name,
            media_type=source_mime_type,
            source_object_key=source_object_key,
            source_sha256=actual_source_sha256,
        ),
        provenance=ArtifactProvenance(
            engine_name=conversion_result.engine_name,
            engine_version=conversion_result.engine_version,
            warnings=conversion_result.warnings,
        ),
        normalized_extension=normalized_extension,
        normalized_sha256=hashlib.sha256(normalized_bytes).hexdigest(),
        artifact_refs=(
            (
                FileAssetArtifactRef(
                    role="normalized_object",
                    object_key=normalized_object_key,
                    media_type=normalized_media_type,
                ),
            )
            if normalized_object_key is not None
            else ()
        ),
        input_path=str(input_path),
        output_path=str(output_path),
        source_extension=source_extension,
    )


def extract_legacy_office_text_blocks(
    file_bytes: bytes,
    *,
    filename: str,
    media_type: str | None = None,
    source_object_key: str | None = None,
    conversion_client: LegacyOfficeConversionClientProtocol | None = None,
) -> LegacyOfficeExtractionResult:
    source_sha256 = hashlib.sha256(file_bytes).hexdigest()
    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        input_path = temp_root / filename
        input_path.write_bytes(file_bytes)
        normalized_result = normalize_legacy_office_asset(
            input_path=input_path,
            output_dir=temp_root / "normalized",
            source_object_key=source_object_key,
            source_sha256=source_sha256,
            source_mime_type=media_type,
            conversion_client=conversion_client,
        )
        normalized_bytes = Path(normalized_result.output_path).read_bytes()

    normalized_filename = f"{Path(filename).stem}{normalized_result.normalized_extension}"
    if normalized_result.normalized_extension == ".docx":
        normalized_extraction = extract_docx_text_blocks(
            normalized_bytes,
            filename=normalized_filename,
            source_object_key=source_object_key,
        )
    elif normalized_result.normalized_extension == ".xlsx":
        normalized_extraction = extract_xlsx_text_blocks(
            normalized_bytes,
            filename=normalized_filename,
            source_object_key=source_object_key,
        )
    else:  # pragma: no cover
        raise ValueError(
            "legacy Office normalization produced unsupported extension: "
            f"{normalized_result.normalized_extension}"
        )

    warnings = tuple(
        dict.fromkeys(
            (
                "normalized_via_legacy_office_conversion",
                *normalized_result.provenance.warnings,
                *normalized_extraction.provenance.warnings,
            )
        )
    )
    return LegacyOfficeExtractionResult(
        descriptor=FileAssetDescriptor(
            asset_family="legacy_binary_office",
            filename=filename,
            media_type=media_type,
            source_object_key=source_object_key,
            source_sha256=source_sha256,
        ),
        provenance=ArtifactProvenance(
            engine_name=(
                f"{normalized_result.provenance.engine_name}"
                f"+{normalized_extraction.provenance.engine_name}"
            ),
            engine_version=";".join(
                part
                for part in (
                    normalized_result.provenance.engine_version,
                    normalized_extraction.provenance.engine_version,
                )
                if part
            ),
            warnings=warnings,
        ),
        text_blocks=normalized_extraction.text_blocks,
        extraction_strategy=(
            "legacy_office_conversion_then_"
            f"{normalized_extraction.extraction_strategy}"
        ),
        artifact_refs=tuple(
            (*normalized_result.artifact_refs, *normalized_extraction.artifact_refs)
        ),
        source_extension=normalized_result.source_extension,
        normalized_extension=normalized_result.normalized_extension,
        normalized_sha256=normalized_result.normalized_sha256,
    )
__all__ = [
    "LegacyOfficeExtractionResult",
    "LegacyOfficeNormalizationResult",
    "extract_legacy_office_text_blocks",
    "normalize_legacy_office_asset",
]
