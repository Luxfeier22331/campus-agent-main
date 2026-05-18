from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    resolve_authenticated_notice_collector_run_refs,
)
from campus_ingestion_core.authenticated_notice_import_sources import (
    explicit_authenticated_notice_import_object_refs,
    load_authenticated_notice_import_payload_from_object_refs,
)
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

from campus_ingestion_worker.consume_authenticated_notice_ingest_queue import (
    build_object_store_from_env,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build internal_notice consumer admission manifest"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bundle-path")
    source.add_argument("--inventory-path")
    source.add_argument("--collector-run-id")
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--admission-run-id", required=True)
    parser.add_argument("--selection-source")
    parser.add_argument("--selection-path")
    parser.add_argument("--site-id", default="")
    parser.add_argument("--source-surface", default="notice")
    parser.add_argument(
        "--notice-id",
        action="append",
        default=[],
        help="Limit collector-run or bundle input to a selected notice id. May be repeated.",
    )
    parser.add_argument("--scope-write-mode", default="upsert_selected")
    parser.add_argument("--notice-family-config-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    config_path = (
        Path(args.notice_family_config_path)
        if args.notice_family_config_path
        else read_authenticated_notice_notice_family_config_path(env)
    )
    config = load_authenticated_notice_notice_family_config(config_path)
    if args.bundle_path:
        input_path = Path(args.bundle_path)
        records = _filter_bundle_records_by_notice_ids(
            _load_json_array(input_path),
            notice_ids=args.notice_id,
        )
        manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
            bundle_records=records,
            config=config,
            admission_run_id=args.admission_run_id,
            selection_source=args.selection_source or "bundle_dry_run",
            selection_path=args.selection_path or str(input_path),
            site_id=args.site_id,
            scope_write_mode=args.scope_write_mode,
        )
    elif args.collector_run_id:
        records = _load_collector_run_bundle_records(
            env=env,
            run_id=args.collector_run_id,
            expected_source_surface=args.source_surface,
        )
        records = _filter_bundle_records_by_notice_ids(records, notice_ids=args.notice_id)
        manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
            bundle_records=records,
            config=config,
            admission_run_id=args.admission_run_id,
            selection_source=args.selection_source or "collector_run_object_store",
            selection_path=args.selection_path or args.collector_run_id,
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


def _load_collector_run_bundle_records(
    *,
    env: dict[str, str],
    run_id: str,
    expected_source_surface: str,
) -> tuple[dict[str, object], ...]:
    refs = resolve_authenticated_notice_collector_run_refs(
        env=env,
        run_id=run_id,
        expected_source_surface=expected_source_surface,
    )
    import_refs = explicit_authenticated_notice_import_object_refs(
        source_bucket=refs.source_bucket,
        bundle_object_key=refs.bundle_object_key,
        manifest_object_key=refs.manifest_object_key,
        bundle_content_sha256=refs.bundle_content_sha256,
        bundle_byte_size=refs.bundle_byte_size,
        manifest_content_sha256=refs.manifest_content_sha256,
        manifest_byte_size=refs.manifest_byte_size,
        run_id=refs.run_id,
    )
    loaded = load_authenticated_notice_import_payload_from_object_refs(
        refs=import_refs,
        env=env,
        object_store=build_object_store_from_env(env),
        bundle_label=f"authenticated notice collector run bundle {run_id}",
        manifest_label=f"authenticated notice collector run manifest {run_id}",
    )
    return tuple(dict(record) for record in loaded.bundle_records)


def _filter_bundle_records_by_notice_ids(
    records: Sequence[dict[str, object]],
    *,
    notice_ids: Sequence[str],
) -> tuple[dict[str, object], ...]:
    normalized_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
    if not normalized_notice_ids:
        return tuple(records)
    selected = tuple(
        record for record in records if _bundle_record_notice_id(record) in normalized_notice_ids
    )
    selected_ids = {_bundle_record_notice_id(record) for record in selected}
    missing = sorted(normalized_notice_ids - selected_ids)
    if missing:
        raise ValueError(f"notice_id not found in bundle records: {', '.join(missing)}")
    return selected


def _bundle_record_notice_id(record: dict[str, object]) -> str:
    notice = record.get("notice")
    notice_payload = notice if isinstance(notice, dict) else {}
    return str(record.get("notice_id") or notice_payload.get("notice_id") or "").strip()


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
