from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
from typing import Sequence

from campus_ingestion_core.file_asset_contract import serialize_file_asset_outcome
from campus_ingestion_core.file_asset_legacy_office import (
    LegacyOfficeNormalizationResult,
    normalize_legacy_office_asset,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize a legacy authenticated notice Office attachment into an OOXML artifact."
    )
    parser.add_argument("--input-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-object-key")
    parser.add_argument("--source-sha256")
    parser.add_argument("--source-mime-type")
    parser.add_argument("--normalized-object-key")
    return parser


def normalize_authenticated_notice_legacy_office_attachment(
    *,
    input_path: Path,
    output_dir: Path,
    source_object_key: str | None = None,
    source_sha256: str | None = None,
    source_mime_type: str | None = None,
    normalized_object_key: str | None = None,
) -> LegacyOfficeNormalizationResult:
    return normalize_legacy_office_asset(
        input_path=input_path,
        output_dir=output_dir,
        source_object_key=source_object_key,
        source_sha256=source_sha256,
        source_mime_type=source_mime_type,
        normalized_object_key=normalized_object_key,
        which=shutil.which,
        run=subprocess.run,
    )


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    result = normalize_authenticated_notice_legacy_office_attachment(
        input_path=Path(args.input_path),
        output_dir=Path(args.output_dir),
        source_object_key=(str(args.source_object_key).strip() or None)
        if args.source_object_key is not None
        else None,
        source_sha256=(str(args.source_sha256).strip() or None)
        if args.source_sha256 is not None
        else None,
        source_mime_type=(str(args.source_mime_type).strip() or None)
        if args.source_mime_type is not None
        else None,
        normalized_object_key=(str(args.normalized_object_key).strip() or None)
        if args.normalized_object_key is not None
        else None,
    )
    print(json.dumps(serialize_file_asset_outcome(result), ensure_ascii=False, indent=2))
__all__ = [
    "LegacyOfficeNormalizationResult",
    "build_parser",
    "main",
    "normalize_authenticated_notice_legacy_office_attachment",
]


if __name__ == "__main__":
    main()
