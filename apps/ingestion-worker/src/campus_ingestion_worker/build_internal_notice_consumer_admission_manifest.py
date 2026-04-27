from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_bundle_records,
    build_internal_notice_consumer_admission_manifest_from_inventory_entries,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    write_internal_notice_consumer_admission_manifest,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build internal_notice consumer admission manifest"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bundle-path")
    source.add_argument("--inventory-path")
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--admission-run-id", required=True)
    parser.add_argument("--selection-source")
    parser.add_argument("--selection-path")
    parser.add_argument("--site-id", default="")
    parser.add_argument("--scope-write-mode", default="upsert_selected")
    parser.add_argument("--notice-family-config-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = {}
    config_path = (
        Path(args.notice_family_config_path)
        if args.notice_family_config_path
        else read_authenticated_notice_notice_family_config_path(env)
    )
    config = load_authenticated_notice_notice_family_config(config_path)
    if args.bundle_path:
        input_path = Path(args.bundle_path)
        records = _load_json_array(input_path)
        manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
            bundle_records=records,
            config=config,
            admission_run_id=args.admission_run_id,
            selection_source=args.selection_source or "bundle_dry_run",
            selection_path=args.selection_path or str(input_path),
            site_id=args.site_id,
            scope_write_mode=args.scope_write_mode,
        )
    else:
        input_path = Path(args.inventory_path)
        entries = tuple(
            AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(item)
            for item in _load_json_or_jsonl_array(input_path)
        )
        manifest = build_internal_notice_consumer_admission_manifest_from_inventory_entries(
            inventory_entries=entries,
            config=config,
            admission_run_id=args.admission_run_id,
            selection_source=args.selection_source or "source_truth_inventory",
            selection_path=args.selection_path or str(input_path),
            scope_write_mode=args.scope_write_mode,
        )
    write_internal_notice_consumer_admission_manifest(Path(args.output_path), manifest)
    print(json.dumps(asdict(manifest), ensure_ascii=False, indent=2, sort_keys=True))


def _load_json_array(path: Path) -> tuple[dict[str, object], ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} must contain a JSON array")
    return tuple(dict(item) for item in payload if isinstance(item, dict))


def _load_json_or_jsonl_array(path: Path) -> tuple[dict[str, object], ...]:
    text = path.read_text(encoding="utf-8")
    stripped = text.strip()
    if stripped.startswith("["):
        return _load_json_array(path)
    return tuple(
        dict(json.loads(line))
        for line in text.splitlines()
        if line.strip() and isinstance(json.loads(line), dict)
    )


__all__ = [
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
