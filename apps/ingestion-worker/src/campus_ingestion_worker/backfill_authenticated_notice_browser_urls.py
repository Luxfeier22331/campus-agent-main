from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_browser_url_backfill import (
    backfill_authenticated_notice_browser_urls,
)
from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit and backfill authenticated notice browser URLs in a bundle."
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--summary-output-path", required=True)
    parser.add_argument("--bundle-output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    result = backfill_authenticated_notice_browser_urls(
        bundle_records=load_authenticated_notice_bundle_payload(Path(args.bundle_path)),
        source_home_url=args.source_home_url,
    )
    summary = {
        **result.summary,
        "input_bundle_path": args.bundle_path,
        "output_bundle_path": args.bundle_output_path,
    }
    _write_json(Path(args.summary_output_path), summary)
    if args.bundle_output_path:
        _write_json(Path(args.bundle_output_path), list(result.bundle_records))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
