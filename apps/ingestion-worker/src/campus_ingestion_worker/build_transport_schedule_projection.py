from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.transport_schedule_projection import (
    DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    TRANSPORT_SCHEDULE_COLLECTION,
    TRANSPORT_SCHEDULE_CORPUS,
    TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
    build_transport_schedule_projection_bundle,
    write_transport_schedule_projection_release,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


class _SourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class _DerivedObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build campus_services transport_schedule projection from authenticated notice source truth.",
    )
    parser.add_argument("--source-truth-inventory", required=True)
    parser.add_argument("--source-truth-root")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument(
        "--service-horizon-days",
        type=int,
        default=DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    )
    parser.add_argument("--source-bucket")
    parser.add_argument("--derived-bucket")
    return parser


def build_transport_schedule_projection_release_from_inventory(
    *,
    source_truth_inventory_path: Path,
    source_truth_root: Path | None,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    service_horizon_days: int,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    source_object_store: _SourceObjectStore | None = None,
    source_bucket: str | None = None,
):
    parents = _load_source_truth_parents(
        inventory_path=source_truth_inventory_path,
        source_truth_root=source_truth_root,
        source_object_store=source_object_store,
        source_bucket=source_bucket,
    )
    build_result = build_transport_schedule_projection_bundle(
        source_truth_parents=parents,
        generated_at=generated_at,
        service_horizon_days=service_horizon_days,
    )
    if not build_result.validation_report.valid:
        _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
        raise ValueError("transport schedule projection validation failed")
    if not build_result.bundle["transport_schedule_snapshots"]:
        _write_json(work_dir / "manual-review-report.json", build_result.manual_review_sources)
        raise ValueError("transport schedule projection produced no schedule snapshots")

    work_dir.mkdir(parents=True, exist_ok=True)
    manual_review_path = work_dir / "manual-review-report.json"
    _write_json(manual_review_path, build_result.manual_review_sources)
    report = write_transport_schedule_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store,
        bucket=derived_bucket,
    )
    object_store.put_bytes(
        bucket=derived_bucket,
        key=build_index_release_artifact_key(
            corpus=TRANSPORT_SCHEDULE_CORPUS,
            collection=TRANSPORT_SCHEDULE_COLLECTION,
            release_id=release_id,
            filename="manual-review-report.json",
        ),
        data=manual_review_path.read_bytes(),
        content_type="application/json",
    )
    _write_json(work_dir / "build-report.json", asdict(report))
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    generated_at = args.generated_at or _default_generated_at()
    source_truth_root = Path(args.source_truth_root).resolve() if args.source_truth_root else None
    source_object_store = None if source_truth_root is not None else object_store
    report = build_transport_schedule_projection_release_from_inventory(
        source_truth_inventory_path=Path(args.source_truth_inventory).resolve(),
        source_truth_root=source_truth_root,
        work_dir=Path(args.work_dir).resolve(),
        release_id=args.release_id,
        generated_at=generated_at,
        service_horizon_days=args.service_horizon_days,
        object_store=object_store,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        source_object_store=source_object_store,
        source_bucket=args.source_bucket or settings.bucket_source,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _load_source_truth_parents(
    *,
    inventory_path: Path,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> tuple[dict[str, Any], ...]:
    inventory = _read_json(inventory_path)
    raw_parents = inventory.get("parents")
    if not isinstance(raw_parents, list):
        raise ValueError("source-truth inventory parents must be an array")
    parents: list[dict[str, Any]] = []
    for raw_parent in raw_parents:
        parent = _require_mapping(raw_parent, "parents[]")
        if isinstance(parent.get("notice_manifest"), dict) and isinstance(
            parent.get("content_blocks"), list
        ):
            parents.append(
                {
                    "notice_manifest": dict(parent["notice_manifest"]),
                    "content_blocks": [dict(row) for row in parent["content_blocks"]],
                }
            )
            continue
        manifest_key = _required_text(parent.get("notice_manifest_key"))
        blocks_key = _required_text(parent.get("content_blocks_key"))
        if manifest_key is None or blocks_key is None:
            raise ValueError(
                "source-truth parent requires embedded notice_manifest/content_blocks or "
                "notice_manifest_key/content_blocks_key"
            )
        parents.append(
            {
                "notice_manifest": _read_source_json(
                    key=manifest_key,
                    source_truth_root=source_truth_root,
                    source_object_store=source_object_store,
                    source_bucket=source_bucket,
                ),
                "content_blocks": _read_source_jsonl(
                    key=blocks_key,
                    source_truth_root=source_truth_root,
                    source_object_store=source_object_store,
                    source_bucket=source_bucket,
                ),
            }
        )
    return tuple(parents)


def _read_source_json(
    *,
    key: str,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> dict[str, Any]:
    payload = json.loads(
        _read_source_bytes(
            key=key,
            source_truth_root=source_truth_root,
            source_object_store=source_object_store,
            source_bucket=source_bucket,
        ).decode("utf-8")
    )
    return _require_mapping(payload, key)


def _read_source_jsonl(
    *,
    key: str,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, line in enumerate(
        _read_source_bytes(
            key=key,
            source_truth_root=source_truth_root,
            source_object_store=source_object_store,
            source_bucket=source_bucket,
        )
        .decode("utf-8")
        .splitlines(),
        start=1,
    ):
        if not line.strip():
            continue
        rows.append(_require_mapping(json.loads(line), f"{key}:{index}"))
    return rows


def _read_source_bytes(
    *,
    key: str,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> bytes:
    if source_truth_root is not None:
        return (source_truth_root / key).read_bytes()
    if source_object_store is None or source_bucket is None:
        raise ValueError(
            "source object store and source bucket are required without source_truth_root"
        )
    return source_object_store.get_bytes(bucket=source_bucket, key=key)


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _require_mapping(payload, str(path))


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return dict(value)


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "TRANSPORT_SCHEDULE_PROJECTION_FILENAME",
    "build_parser",
    "build_transport_schedule_projection_release_from_inventory",
    "main",
]


if __name__ == "__main__":
    main()
