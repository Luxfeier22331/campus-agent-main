from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from pathlib import Path
import shutil
import subprocess
from typing import Callable

from campus_ingestion_core.file_asset_contract import (
    ArtifactProvenance,
    FileAssetDescriptor,
)


SubprocessRun = Callable[..., subprocess.CompletedProcess[str]]
WhichResolver = Callable[[str], str | None]


@dataclass(frozen=True, slots=True)
class LegacyOfficeNormalizationResult:
    input_path: str
    output_path: str
    source_extension: str
    source_mime_type: str | None
    source_object_key: str | None
    source_sha256: str
    normalized_extension: str
    normalized_sha256: str
    normalizer_name: str
    normalizer_version: str
    descriptor: FileAssetDescriptor = field(init=False)
    provenance: ArtifactProvenance = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "descriptor",
            FileAssetDescriptor(
                asset_family="legacy_binary_office",
                filename=Path(self.input_path).name,
                media_type=self.source_mime_type,
                source_object_key=self.source_object_key,
                source_sha256=self.source_sha256,
            ),
        )
        object.__setattr__(
            self,
            "provenance",
            ArtifactProvenance(
                engine_name=self.normalizer_name,
                engine_version=self.normalizer_version,
            ),
        )


def normalize_legacy_office_asset(
    *,
    input_path: Path,
    output_dir: Path,
    source_object_key: str | None = None,
    source_sha256: str | None = None,
    source_mime_type: str | None = None,
    which: WhichResolver | None = None,
    run: SubprocessRun | None = None,
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

    which_resolver = which or shutil.which
    run_command = run or subprocess.run

    soffice = which_resolver("soffice")
    if soffice is None:
        raise RuntimeError("LibreOffice soffice is required for legacy Office normalization")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}{normalized_extension}"
    completed = run_command(
        [
            soffice,
            "--headless",
            "--convert-to",
            normalized_extension.lstrip("."),
            "--outdir",
            str(output_dir),
            str(input_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "unknown error"
        raise RuntimeError(f"legacy Office normalization failed: {detail}")
    if not output_path.is_file():
        raise RuntimeError(
            "legacy Office normalization did not produce expected output: "
            f"{output_path}"
        )

    normalized_bytes = output_path.read_bytes()
    engine_version = _read_soffice_version(soffice, run=run_command)
    return LegacyOfficeNormalizationResult(
        input_path=str(input_path),
        output_path=str(output_path),
        source_extension=source_extension,
        source_mime_type=source_mime_type,
        source_object_key=source_object_key,
        source_sha256=actual_source_sha256,
        normalized_extension=normalized_extension,
        normalized_sha256=hashlib.sha256(normalized_bytes).hexdigest(),
        normalizer_name="libreoffice-soffice",
        normalizer_version=engine_version,
    )


def _read_soffice_version(soffice: str, *, run: SubprocessRun) -> str:
    completed = run(
        [soffice, "--version"],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return "unknown"
    version = completed.stdout.strip() or completed.stderr.strip()
    return version or "unknown"


__all__ = [
    "LegacyOfficeNormalizationResult",
    "normalize_legacy_office_asset",
]
