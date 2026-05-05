from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
    materialize_official_web_regulation_candidates,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.document_reader_publisher import publish_document_reader_assets
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.models import DocumentRegistryRecord

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_handoff_consumer_runtime import materialize_replay_input

_SCHEMA_VERSION = "official_web_regulation_materialization_worker.v1"
_TARGET_SCOPE = ("regulations", "institutional_rules")


class LocalFilesystemObjectStore:
    def __init__(self, source_root: Path, *, write_root: Path | None = None) -> None:
        self.source_root = Path(source_root)
        self.write_root = Path(write_root) if write_root is not None else self.source_root

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        overlay_path = self.write_root / bucket / key
        if overlay_path.exists():
            return overlay_path.read_bytes()
        return (self.source_root / bucket / key).read_bytes()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        del content_type
        target = self.write_root / bucket / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Materialize already-collected official_web regulation candidates into "
            "regulations/institutional_rules canonical artifacts and reader assets."
        )
    )
    parser.add_argument("--source-truth-output-dir")
    parser.add_argument("--source-truth-bundle-path")
    parser.add_argument("--source-truth-bundle-key")
    parser.add_argument("--declarations-path")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--object-store-root")
    parser.add_argument("--source-bucket", default=DEFAULT_BUCKET_SOURCE)
    parser.add_argument("--derived-bucket")
    parser.add_argument("--registry-json")
    parser.add_argument("--raw-registry-json")
    parser.add_argument("--scope-refresh", action="store_true")
    parser.add_argument("--no-reader-assets", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    settings = _resolve_object_store_settings(
        source_bucket=args.source_bucket,
        derived_bucket=args.derived_bucket,
    )
    runtime = _resolve_runtime(args=args, settings=settings, output_dir=output_dir)
    source_truth_output_dir = _resolve_source_truth_output_dir(
        args=args,
        output_dir=output_dir,
        object_store=runtime["object_store"],
        source_bucket=settings.bucket_source,
    )
    projection_output_dir = output_dir / "projection-output"
    materialization_report = materialize_official_web_regulation_candidates(
        source_truth_output_dir=source_truth_output_dir,
        projection_output_dir=projection_output_dir,
        work_dir=output_dir / "materialization-work",
        declarations_path=Path(args.declarations_path) if args.declarations_path else None,
        object_store=runtime["object_store"],
        document_registry=runtime["document_registry"],
        raw_asset_registry=runtime["raw_asset_registry"],
        object_store_settings=settings,
        scope_refresh=bool(args.scope_refresh),
    )
    materialization_report_path = output_dir / "materialization-report.json"
    _write_json(materialization_report_path, asdict(materialization_report))

    reader_report_payload = None
    docs_read_model_manifest_path = None
    if not args.no_reader_assets:
        records = _select_current_scope_records(runtime["document_registry"])
        reader_report = publish_document_reader_assets(
            bucket_derived=settings.bucket_derived,
            generated_at=_generated_at_from_report(materialization_report_path),
            object_store=runtime["object_store"],
            records=records,
        )
        docs_read_model_manifest_path = output_dir / "docs-read-model-manifest.json"
        _write_json(docs_read_model_manifest_path, reader_report.manifest)
        reader_report_payload = {
            "asset_count": reader_report.asset_count,
            "collection_count": reader_report.collection_count,
            "document_count": reader_report.document_count,
            "gated_entry_count": reader_report.gated_entry_count,
            "public_entry_count": reader_report.public_entry_count,
        }

    summary = {
        "schema_version": _SCHEMA_VERSION,
        "target_scope": "/".join(_TARGET_SCOPE),
        "materialization_report": asdict(materialization_report),
        "materialization_report_path": str(materialization_report_path.resolve()),
        "docs_read_model_manifest_path": (
            str(docs_read_model_manifest_path.resolve())
            if docs_read_model_manifest_path is not None
            else None
        ),
        "reader_report": reader_report_payload,
        "registry_json": str(Path(args.registry_json).resolve()) if args.registry_json else None,
        "raw_registry_json": (
            str(Path(args.raw_registry_json).resolve()) if args.raw_registry_json else None
        ),
    }
    summary_path = output_dir / "official-web-regulation-materialization-summary.json"
    _write_json(summary_path, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _resolve_runtime(
    *,
    args: argparse.Namespace,
    settings: ObjectStoreSettings,
    output_dir: Path,
) -> dict[str, object]:
    if args.object_store_root:
        object_store_root = Path(args.object_store_root)
        object_store = LocalFilesystemObjectStore(object_store_root, write_root=object_store_root)
    else:
        object_store = S3ObjectStoreWriter(settings)
    if args.registry_json:
        document_registry = InMemoryDocumentRegistry(Path(args.registry_json))
    else:
        document_registry = build_document_registry_from_env()
    if args.raw_registry_json:
        raw_asset_registry = InMemoryRawAssetRegistry(Path(args.raw_registry_json))
    else:
        raw_asset_registry = build_raw_asset_registry_from_env()
    if args.object_store_root and not args.registry_json:
        document_registry = InMemoryDocumentRegistry(output_dir / "document-registry.snapshot.json")
    if args.object_store_root and not args.raw_registry_json:
        raw_asset_registry = InMemoryRawAssetRegistry(
            output_dir / "raw-asset-registry.snapshot.json"
        )
    return {
        "document_registry": document_registry,
        "object_store": object_store,
        "raw_asset_registry": raw_asset_registry,
    }


def _resolve_source_truth_output_dir(
    *,
    args: argparse.Namespace,
    output_dir: Path,
    object_store: object,
    source_bucket: str,
) -> Path:
    if args.source_truth_output_dir:
        return Path(args.source_truth_output_dir)
    bundle_payload = _load_source_truth_bundle(
        args=args, object_store=object_store, bucket=source_bucket
    )
    replay_input_dir = output_dir / "replay-input"
    materialize_replay_input(
        replay_input_dir=replay_input_dir,
        bundle_payload=bundle_payload,
        object_store=object_store,
        bucket=source_bucket,
    )
    return replay_input_dir


def _load_source_truth_bundle(
    *,
    args: argparse.Namespace,
    object_store: object,
    bucket: str,
) -> dict[str, object]:
    if args.source_truth_bundle_path:
        return _read_json(Path(args.source_truth_bundle_path))
    if args.source_truth_bundle_key:
        payload = object_store.get_bytes(bucket=bucket, key=args.source_truth_bundle_key)
        decoded = json.loads(payload.decode("utf-8"))
        if not isinstance(decoded, dict):
            raise ValueError("source-truth bundle payload must be an object")
        return decoded
    raise ValueError(
        "one of --source-truth-output-dir, --source-truth-bundle-path, or "
        "--source-truth-bundle-key is required"
    )


def _select_current_scope_records(registry: object) -> tuple[DocumentRegistryRecord, ...]:
    records = registry.list_by_scope(*_TARGET_SCOPE)
    return tuple(record for record in records if record.is_current and record.status == "active")


def _resolve_object_store_settings(
    *,
    source_bucket: str,
    derived_bucket: str | None,
) -> ObjectStoreSettings:
    settings = ObjectStoreSettings.from_env()
    return ObjectStoreSettings(
        endpoint=settings.endpoint,
        access_key=settings.access_key,
        secret_key=settings.secret_key,
        region=settings.region,
        bucket_source=source_bucket,
        bucket_derived=derived_bucket or settings.bucket_derived,
        secure=settings.secure,
        source_access_key=settings.source_access_key,
        source_secret_key=settings.source_secret_key,
        derived_access_key=settings.derived_access_key,
        derived_secret_key=settings.derived_secret_key,
    )


def _generated_at_from_report(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
