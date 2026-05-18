from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_media_extraction_attempt_ledger import (
    attempt_ledger_output_files,
    build_media_extraction_attempt_ledger_from_paths,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build normalized media extraction attempt ledger from candidate inventory."
    )
    parser.add_argument("--candidate-inventory-path", required=True)
    parser.add_argument("--attempt-plan-path", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    ledger = build_media_extraction_attempt_ledger_from_paths(
        candidate_inventory_path=Path(args.candidate_inventory_path),
        attempt_plan_path=Path(args.attempt_plan_path),
    )
    _write_outputs(output_dir=output_dir, outputs=attempt_ledger_output_files(ledger))
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "output_dir": str(output_dir),
                "attempt_count": ledger["attempt_count"],
                "counts_by_status": ledger["counts_by_status"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _write_outputs(*, output_dir: Path, outputs: Mapping[str, Any]) -> None:
    for filename, payload in outputs.items():
        (output_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
