from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from campus_ingestion_worker.build_transport_schedule_projection_contracts import (
    _SourceObjectStore,
)
from campus_ingestion_worker.build_transport_schedule_projection_io import (
    _read_json,
    _require_mapping,
    _required_text,
)


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
