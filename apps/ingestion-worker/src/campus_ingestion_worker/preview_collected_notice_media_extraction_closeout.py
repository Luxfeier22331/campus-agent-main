from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_media_extraction_closeout import (
    apply_media_extraction_closeout_result_manifests_from_paths,
    closeout_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview closeout of notice media extraction candidates from result manifests.",
    )
    parser.add_argument("--candidate-inventory-path", required=True)
    parser.add_argument(
        "--result-manifest-path",
        action="append",
        required=True,
        help="Path to a notice media extraction closeout result manifest. Repeatable.",
    )
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = apply_media_extraction_closeout_result_manifests_from_paths(
        candidate_inventory_path=Path(args.candidate_inventory_path),
        result_manifest_paths=[Path(path) for path in args.result_manifest_path],
    )
    _write_outputs(output_dir=output_dir, outputs=closeout_output_files(payload))
    report = payload["closeout_report"]
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "output_dir": str(output_dir),
                "candidate_count": report["candidate_count"],
                "updated_candidate_count": report["updated_candidate_count"],
                "terminalized_candidate_count": report["terminalized_candidate_count"],
                "nonterminal_blocking_count": report["nonterminal_blocking_count"],
                "orphan_result_count": report["orphan_result_count"],
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
