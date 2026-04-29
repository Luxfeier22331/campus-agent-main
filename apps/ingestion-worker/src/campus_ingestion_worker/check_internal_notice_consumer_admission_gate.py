from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    load_internal_notice_consumer_admission_manifest,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check internal_notice consumer admission release gate"
    )
    parser.add_argument("--manifest-path", required=True)
    parser.add_argument(
        "--operation",
        required=True,
        choices=(
            "projection-rebuild",
            "projection_rebuild",
            "read-model-rebuild",
            "read_model_rebuild",
            "typed-materialization",
            "typed_materialization",
            "multimodal-drain",
            "multimodal_drain",
            "import-materialization",
            "import_materialization",
        ),
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--scope-write-mode", default="upsert_selected")
    parser.add_argument("--target-surface", default="")
    parser.add_argument("--max-empty-body-count", type=int)
    parser.add_argument("--max-owner-expectation-count", type=int)
    parser.add_argument("--max-reference-only-attachment-count", type=int)
    parser.add_argument("--max-unsupported-binary-count", type=int)
    parser.add_argument("--max-pending-multimodal-attachment-count", type=int)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    manifest = load_internal_notice_consumer_admission_manifest(Path(args.manifest_path))
    report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=str(args.operation).replace("-", "_"),
            source_corpus=args.corpus,
            source_collection=args.collection,
            selected_notice_ids=tuple(args.notice_ids or ()),
            scope_write_mode=args.scope_write_mode,
            target_surface=args.target_surface,
            max_empty_body_count=args.max_empty_body_count,
            max_owner_expectation_count=args.max_owner_expectation_count,
            max_reference_only_attachment_count=args.max_reference_only_attachment_count,
            max_unsupported_binary_count=args.max_unsupported_binary_count,
            max_pending_multimodal_attachment_count=(args.max_pending_multimodal_attachment_count),
        ),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))
    if not report.allowed:
        raise SystemExit(1)


__all__ = [
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
