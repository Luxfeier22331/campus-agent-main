from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_derived_contact_candidate import (
    build_notice_derived_contact_candidate_bundle,
)
from campus_ingestion_core.registry import build_document_registry_from_env

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build notice-derived stable contact candidate artifact from selected notices.",
    )
    parser.add_argument("--consumer-admission-manifest-path", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument(
        "--output-filename",
        default="notice-stable-contact-candidates.json",
    )
    parser.add_argument("--generated-at")
    parser.add_argument("--derived-bucket")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    generated_at = args.generated_at or _default_generated_at()
    source = dict(os.environ)
    consumer_manifest = load_internal_notice_consumer_admission_manifest(
        Path(args.consumer_admission_manifest_path).resolve()
    )
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_id,
        selection_path=args.selection_path,
    )
    selected_notice_ids = normalize_notice_ids(selection.notice_ids)
    if not selected_notice_ids:
        raise ValueError("--notice-id or --selection-path is required")
    gate_report = check_internal_notice_consumer_admission_gate(
        manifest=consumer_manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=selected_notice_ids,
            scope_write_mode="upsert_selected",
            target_surface=NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
        ),
    )
    if not gate_report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked stable contact candidate build: "
            + ", ".join(gate_report.reason_codes)
        )

    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    projection_store = build_notice_consumption_projection_store_from_env(source)
    projection_entries = projection_store.list_by_scope(
        "campus_notices",
        "internal_notice",
        notice_ids=selected_notice_ids,
    )
    build_result = build_notice_derived_contact_candidate_bundle(
        projection_entries=projection_entries,
        registry=build_document_registry_from_env(source),
        object_store=object_store,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        generated_at=generated_at,
    )

    work_dir = Path(args.work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    candidate_output_path = work_dir / args.output_filename
    build_report_path = work_dir / "build-report.json"
    candidate_output_path.write_text(
        json.dumps(build_result.bundle, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    payload = {
        "schema_version": "notice_stable_contact_candidates_build_report.v1",
        "generated_at": generated_at,
        "candidate_output_path": str(candidate_output_path),
        "selected_notice_ids": list(selected_notice_ids),
        "candidate_count": build_result.candidate_count,
        "rejected_count": build_result.rejected_count,
        "manual_review_count": build_result.manual_review_count,
        "consumer_admission_gate": asdict(gate_report),
    }
    build_report_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
