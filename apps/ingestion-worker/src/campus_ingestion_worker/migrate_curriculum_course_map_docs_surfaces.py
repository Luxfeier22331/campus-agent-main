from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.campusrag_ingestion_support import utc_now
from campus_ingestion_core.curriculum_course_map_docs_surface_migration import (
    migrate_legacy_curriculum_course_map_docs_surfaces,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Migrate legacy curriculum course-map reader artifacts into docs surface artifacts.",
    )
    parser.add_argument("--bucket")
    parser.add_argument("--prefix", default="curriculum/documents/curriculum_plan/")
    parser.add_argument("--legacy-surface-key", action="append", default=[])
    parser.add_argument("--generated-at")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    report = migrate_legacy_curriculum_course_map_docs_surfaces(
        bucket=args.bucket or settings.bucket_derived,
        generated_at=args.generated_at or utc_now(),
        object_store=object_store,
        legacy_surface_keys=tuple(args.legacy_surface_key) or None,
        prefix=args.prefix,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
