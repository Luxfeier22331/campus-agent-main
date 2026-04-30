from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_evals.retrieval_chunk_quality import (
    build_chunk_quality_audit_report,
    load_chunks_jsonl,
    retrieval_chunk_quality_report_to_dict,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a deterministic retrieval chunk quality report from chunks JSONL."
    )
    parser.add_argument("--chunks", required=True, help="Path to chunks JSONL.")
    parser.add_argument("--output", required=True, help="Path to write report JSON.")
    parser.add_argument("--max-tokens", type=int, required=True)
    parser.add_argument(
        "--required-metadata-field",
        action="append",
        default=[],
        help=(
            "Metadata field required on chunk, metadata, or anchor. Repeat to override the "
            "default root_unit_id/chunk_policy_version fields."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    required_metadata_fields = tuple(args.required_metadata_field) or (
        "root_unit_id",
        "chunk_policy_version",
    )
    report = build_chunk_quality_audit_report(
        chunks=load_chunks_jsonl(args.chunks),
        max_tokens=args.max_tokens,
        required_metadata_fields=required_metadata_fields,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(retrieval_chunk_quality_report_to_dict(report), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return 0 if report.status == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
