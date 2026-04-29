from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_reimport_preview import (
    CollectedNoticeReimportPreview,
    build_collected_notice_reimport_preview_from_inventory_path,
    preview_to_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_CAPTURED_RUNS_INVENTORY_PATH = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-01-current-state-audit-and-reset-manifest/captured-runs-inventory.json"
)
DEFAULT_PHASE_04_OUTPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-dry-run-reimport-and-universal-search-preview"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview collected notice reimport and universal searchable units"
    )
    parser.add_argument(
        "--captured-runs-inventory-path",
        default=str(DEFAULT_CAPTURED_RUNS_INVENTORY_PATH),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_04_OUTPUT_DIR))
    parser.add_argument(
        "--source-surface",
        action="append",
        default=[],
        help="Source surface to include. Defaults to notice and file_release.",
    )
    parser.add_argument("--default-site-id", default="muc_internal_portal")
    parser.add_argument("--default-source-home-url", default="https://my.muc.edu.cn")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    preview = build_collected_notice_reimport_preview_from_inventory_path(
        captured_runs_inventory_path=Path(args.captured_runs_inventory_path),
        source_surfaces=tuple(args.source_surface or ("notice", "file_release")),
        default_site_id=args.default_site_id,
        default_source_home_url=args.default_source_home_url,
    )
    files = write_preview_evidence_files(preview=preview, output_dir=output_dir)
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "counts": preview.reimport_plan.get("counts", {}),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def write_preview_evidence_files(
    *,
    preview: CollectedNoticeReimportPreview,
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in preview_to_output_files(preview).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    return written


__all__ = [
    "CollectedNoticeReimportPreview",
    "build_collected_notice_reimport_preview_from_inventory_path",
    "build_parser",
    "main",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
