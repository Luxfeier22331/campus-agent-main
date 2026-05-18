from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout_operations_retention import (
    AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
    AuthenticatedNoticeCloseoutOperationsAuditRequest,
    AuthenticatedNoticeCloseoutOperationsS3ObjectStore,
    audit_authenticated_notice_closeout_operations_retention,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.authenticated_notice_closeout_operations_retention_sources import (
    load_closeout_db_run_states,
    load_registry_referenced_closeout_run_ids,
    load_repo_referenced_closeout_run_ids,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit authenticated notice closeout operations retention candidates"
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--repo-root", default=".")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = AuthenticatedNoticeCloseoutOperationsS3ObjectStore(settings)
    objects = object_store.list_objects(
        bucket=settings.bucket_derived,
        prefix=AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
    )
    candidate_run_ids = {item.run_id for item in objects}
    result = audit_authenticated_notice_closeout_operations_retention(
        request=AuthenticatedNoticeCloseoutOperationsAuditRequest(
            output_dir=Path(args.output_dir),
        ),
        objects=objects,
        db_runs=load_closeout_db_run_states(),
        repo_referenced_run_ids=load_repo_referenced_closeout_run_ids(
            candidate_run_ids=candidate_run_ids,
            repo_root=str(args.repo_root),
        ),
        registry_referenced_run_ids=load_registry_referenced_closeout_run_ids(),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeCloseoutOperationsAuditRequest",
    "audit_authenticated_notice_closeout_operations_retention",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
