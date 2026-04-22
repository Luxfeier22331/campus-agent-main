from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
    load_authenticated_notice_export_manifest,
)
from campus_ingestion_core.authenticated_notice_legacy_export import (
    build_notice_type_policy_snapshot_from_legacy_config,
    load_authenticated_notice_selection_notice_ids,
    normalize_authenticated_notice_legacy_export,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize legacy authenticated notice donor exports into repo-owned bootstrap artifacts."
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--notice-types-path")
    parser.add_argument("--selection-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--export-scope")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    bundle_records = load_authenticated_notice_bundle_payload(Path(args.bundle_path))
    legacy_manifest = load_authenticated_notice_export_manifest(
        Path(args.manifest_path) if args.manifest_path else None
    )
    selected_notice_ids = tuple(str(item).strip() for item in args.notice_ids if str(item).strip())
    if args.selection_path:
        selected_notice_ids = tuple(
            dict.fromkeys(
                [
                    *selected_notice_ids,
                    *load_authenticated_notice_selection_notice_ids(Path(args.selection_path)),
                ]
            )
        )
    notice_type_policy = ()
    if args.notice_types_path:
        notice_type_policy = build_notice_type_policy_snapshot_from_legacy_config(
            json.loads(Path(args.notice_types_path).read_text(encoding="utf-8"))
        )
    result = normalize_authenticated_notice_legacy_export(
        bundle_records=bundle_records,
        legacy_manifest=legacy_manifest,
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        selected_notice_ids=selected_notice_ids,
        notice_type_policy=notice_type_policy,
        export_scope=args.export_scope,
    )
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    bundle_output_path = output_dir / "notices-bundle.normalized.json"
    manifest_output_path = output_dir / "export-manifest.normalized.json"
    summary_output_path = output_dir / "normalization-summary.json"
    _write_json(bundle_output_path, list(result.bundle_records))
    _write_json(manifest_output_path, result.normalized_manifest)
    summary = {
        "bundle_path": str(bundle_output_path),
        "manifest_path": str(manifest_output_path),
        "original_notice_count": len(bundle_records),
        "normalized_notice_count": len(result.bundle_records),
        "selected_notice_ids": list(result.selected_notice_ids),
        "missing_notice_ids": list(result.missing_notice_ids),
        "notice_type_policy_count": len(notice_type_policy),
    }
    _write_json(summary_output_path, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
