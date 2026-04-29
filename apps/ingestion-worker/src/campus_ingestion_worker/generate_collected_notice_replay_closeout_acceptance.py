from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_replay_closeout_acceptance import (
    CollectedNoticeReplayCloseoutReport,
    build_closeout_acceptance_report_from_root,
    closeout_to_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_WORKSTREAM_ROOT = Path(".planning/workstreams/collected-notice-consumption-replay-closeout")
DEFAULT_OUTPUT_DIR = DEFAULT_WORKSTREAM_ROOT / "evidence/phase-07-acceptance-and-closeout"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate Phase 7 collected-notice replay closeout evidence."
    )
    parser.add_argument("--workstream-root", default=str(DEFAULT_WORKSTREAM_ROOT))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--generated-at", default="")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = build_closeout_acceptance_report_from_root(
        workstream_root=Path(args.workstream_root),
        generated_at=str(args.generated_at or "") or None,
    )
    files = write_closeout_evidence_files(report=report, output_dir=output_dir)
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "verdict": report.acceptance_report["verdict"],
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def write_closeout_evidence_files(
    *,
    report: CollectedNoticeReplayCloseoutReport,
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in closeout_to_output_files(report).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    return written


__all__ = [
    "CollectedNoticeReplayCloseoutReport",
    "build_closeout_acceptance_report_from_root",
    "build_parser",
    "closeout_to_output_files",
    "main",
    "write_closeout_evidence_files",
]


if __name__ == "__main__":
    main()
