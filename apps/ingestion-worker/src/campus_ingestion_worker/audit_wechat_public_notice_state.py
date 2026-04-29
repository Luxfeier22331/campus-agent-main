from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.wechat_public_notice_state_audit import (
    audit_wechat_public_notice_state,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit WeChat public-notice projection/read-model state"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="wechat_public_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--repair-selection-output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
    )
    report = audit_wechat_public_notice_state(
        source_corpus=str(args.corpus or "").strip() or "campus_notices",
        source_collection=str(args.collection or "").strip() or "wechat_public_notice",
        notice_ids=selection.notice_ids,
    )
    if args.repair_selection_output_path:
        output_path = Path(args.repair_selection_output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(
                {
                    "source_corpus": report.source_corpus,
                    "source_collection": report.source_collection,
                    "selected_notice_ids": list(report.selected_notice_ids),
                    "reproject_notice_ids": list(report.reproject_notice_ids),
                    "purge_notice_ids": list(report.purge_notice_ids),
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


__all__ = ["audit_wechat_public_notice_state", "build_parser", "main"]


if __name__ == "__main__":
    main()
