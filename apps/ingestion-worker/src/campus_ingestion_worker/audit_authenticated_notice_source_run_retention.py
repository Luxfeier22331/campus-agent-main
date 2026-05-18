from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_source_run_retention import (
    AuthenticatedNoticeSourceRunRetentionAuditRequest,
    AuthenticatedNoticeSourceRunS3ObjectStore,
    audit_authenticated_notice_source_run_retention,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.authenticated_notice_source_run_retention_sources import (
    load_db_referenced_source_run_ids,
    load_repo_referenced_source_run_ids,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit authenticated notice source run retention.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--skip-db-references", action="store_true")
    parser.add_argument("--skip-repo-references", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = AuthenticatedNoticeSourceRunS3ObjectStore(settings)
    objects = object_store.list_objects(
        bucket=settings.bucket_source,
        prefix="authenticated_notice_portal/runs/",
    )
    candidate_run_ids = {item.run_id for item in objects}
    db_refs = (
        frozenset()
        if args.skip_db_references
        else load_db_referenced_source_run_ids(candidate_run_ids=candidate_run_ids)
    )
    repo_refs = (
        frozenset()
        if args.skip_repo_references
        else load_repo_referenced_source_run_ids(candidate_run_ids=candidate_run_ids)
    )
    summary = audit_authenticated_notice_source_run_retention(
        request=AuthenticatedNoticeSourceRunRetentionAuditRequest(
            output_dir=Path(args.output_dir),
        ),
        object_store=object_store,
        objects=objects,
        db_referenced_run_ids=db_refs,
        repo_referenced_run_ids=repo_refs,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
