from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_media_source_object_verification import (
    CollectedNoticeMediaSourceObjectS3Verifier,
    build_collected_notice_media_source_object_verification_report,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Live-verify collected notice media source objects before media closeout."
    )
    parser.add_argument("--candidate-inventory-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--checked-at")
    parser.add_argument(
        "--disable-get-hash",
        action="store_true",
        help="Only use HEAD checksum evidence; do not GET objects when HEAD lacks checksum.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    candidate_inventory = _load_json_object(Path(args.candidate_inventory_path))
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = build_collected_notice_media_source_object_verification_report(
        candidate_inventory=candidate_inventory,
        object_store=CollectedNoticeMediaSourceObjectS3Verifier(
            ObjectStoreSettings.from_env(dict(os.environ))
        ),
        checked_at=args.checked_at,
        allow_get_hash=not bool(args.disable_get_hash),
    )
    output_path = output_dir / "media-source-object-verification-report.json"
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output_path": str(output_path),
                "row_count": report["row_count"],
                "verified_count": report["verified_count"],
                "status_counts": report["status_counts"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )
    if int(report["verified_count"]) != int(report["row_count"]):
        raise SystemExit(1)


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


if __name__ == "__main__":
    main()
