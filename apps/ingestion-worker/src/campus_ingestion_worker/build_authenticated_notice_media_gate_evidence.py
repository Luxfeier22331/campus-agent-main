from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_media_gate_evidence import (
    build_authenticated_notice_media_gate_evidence_manifest,
    validate_authenticated_notice_media_gate_evidence_manifest,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build authenticated notice consumer-owned media gate evidence manifest."
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--operations-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    operations_dir = Path(args.operations_dir)
    manifest = build_authenticated_notice_media_gate_evidence_manifest(
        run_id=args.run_id,
        operations_dir=operations_dir,
    )
    verdict = validate_authenticated_notice_media_gate_evidence_manifest(manifest)
    manifest_path = operations_dir / "authenticated-notice-media-gate-evidence.json"
    verdict_path = operations_dir / "authenticated-notice-media-gate-evidence-verdict.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    verdict_path.write_text(
        json.dumps(verdict, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "run_id": args.run_id,
                "operations_dir": str(operations_dir),
                "manifest_path": str(manifest_path),
                "verdict_path": str(verdict_path),
                "verdict": verdict["verdict"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
