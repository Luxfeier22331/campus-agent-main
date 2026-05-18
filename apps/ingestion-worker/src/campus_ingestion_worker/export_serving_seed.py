from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import utc_now
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.serving_seed_package import (
    ServingSeedExportRequest,
    export_serving_seed_manifest,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.publish_document_reader_assets import DEFAULT_MANIFEST_OBJECT_KEY


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export serving seed manifest.")
    parser.add_argument(
        "--manifest-object-key",
        action="append",
        default=[],
        help="Derived bucket docs reader manifest object key.",
    )
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--repo-revision")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    report = export_serving_seed_manifest(
        request=ServingSeedExportRequest(
            manifest_object_keys=tuple(args.manifest_object_key or [DEFAULT_MANIFEST_OBJECT_KEY]),
            output_path=Path(args.output_path),
        ),
        bucket_derived=settings.bucket_derived,
        generated_at=utc_now(),
        object_store=S3ObjectStoreAdmin(settings),
        repo_revision=args.repo_revision or _git_revision(),
    )
    print(json.dumps(report.manifest, ensure_ascii=False, indent=2, sort_keys=True))


def _git_revision() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


if __name__ == "__main__":
    main()
