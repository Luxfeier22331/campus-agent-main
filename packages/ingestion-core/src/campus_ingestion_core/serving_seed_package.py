from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

_SCHEMA_VERSION = "campus_serving_seed_manifest_v1"
_SEED_PROFILE = "serving-seed"


class ServingSeedObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class ServingSeedExportRequest:
    manifest_object_keys: tuple[str, ...]
    output_path: Path | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "manifest_object_keys",
            tuple(_normalize_key(key) for key in self.manifest_object_keys),
        )
        if not self.manifest_object_keys:
            raise ValueError("manifest_object_keys must not be empty")
        if self.output_path is not None:
            object.__setattr__(self, "output_path", Path(self.output_path))


@dataclass(frozen=True, slots=True)
class ServingSeedVerifyRequest:
    manifest_path: Path | None = None
    manifest: dict[str, object] | None = None

    def __post_init__(self) -> None:
        if self.manifest_path is None and self.manifest is None:
            raise ValueError("manifest_path or manifest is required")
        if self.manifest_path is not None and self.manifest is not None:
            raise ValueError("manifest_path and manifest are mutually exclusive")
        if self.manifest_path is not None:
            object.__setattr__(self, "manifest_path", Path(self.manifest_path))


@dataclass(frozen=True, slots=True)
class ServingSeedRestoreRequest:
    manifest_path: Path | None = None
    manifest: dict[str, object] | None = None

    def __post_init__(self) -> None:
        if self.manifest_path is None and self.manifest is None:
            raise ValueError("manifest_path or manifest is required")
        if self.manifest_path is not None and self.manifest is not None:
            raise ValueError("manifest_path and manifest are mutually exclusive")
        if self.manifest_path is not None:
            object.__setattr__(self, "manifest_path", Path(self.manifest_path))


@dataclass(frozen=True, slots=True)
class ServingSeedExportReport:
    manifest: dict[str, object]
    object_count: int
    total_size_bytes: int
    output_path: str | None


@dataclass(frozen=True, slots=True)
class ServingSeedVerifyReport:
    object_count: int
    total_size_bytes: int


@dataclass(frozen=True, slots=True)
class ServingSeedRestoreReport:
    restored_count: int
    total_size_bytes: int


def export_serving_seed_manifest(
    *,
    request: ServingSeedExportRequest,
    bucket_derived: str,
    generated_at: str,
    object_store: ServingSeedObjectStore,
    repo_revision: str,
) -> ServingSeedExportReport:
    if not bucket_derived.strip():
        raise ValueError("bucket_derived is required")
    if not generated_at.strip():
        raise ValueError("generated_at is required")
    if not repo_revision.strip():
        raise ValueError("repo_revision is required")

    object_refs: dict[tuple[str, str], str] = {}
    for manifest_key in request.manifest_object_keys:
        manifest_bytes = object_store.get_bytes(bucket=bucket_derived, key=manifest_key)
        object_refs[(bucket_derived, manifest_key)] = "docs_reader_manifest"
        for key in _extract_object_keys_from_docs_manifest(manifest_bytes):
            object_refs[(bucket_derived, key)] = "reader_asset"

    rows: list[dict[str, object]] = []
    for bucket, key in sorted(object_refs):
        data = object_store.get_bytes(bucket=bucket, key=key)
        content_type = _resolve_content_type(
            metadata=object_store.head_object(bucket=bucket, key=key),
            key=key,
        )
        rows.append(
            {
                "bucket": bucket,
                "contentType": content_type,
                "key": key,
                "role": object_refs[(bucket, key)],
                "sha256": hashlib.sha256(data).hexdigest(),
                "sizeBytes": len(data),
            }
        )

    manifest = {
        "generatedAt": generated_at,
        "objects": rows,
        "repoRevision": repo_revision,
        "schemaVersion": _SCHEMA_VERSION,
        "seedProfile": _SEED_PROFILE,
    }
    output_path = request.output_path
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return ServingSeedExportReport(
        manifest=manifest,
        object_count=len(rows),
        total_size_bytes=sum(int(row["sizeBytes"]) for row in rows),
        output_path=str(output_path) if output_path is not None else None,
    )


def verify_serving_seed_manifest(
    *,
    request: ServingSeedVerifyRequest,
    object_store: ServingSeedObjectStore,
) -> ServingSeedVerifyReport:
    manifest = _load_manifest(request)
    rows = _manifest_object_rows(manifest)
    total_size = 0
    for row in rows:
        bucket = _required_text(row, "bucket")
        key = _required_text(row, "key")
        expected_size = _required_int(row, "sizeBytes")
        expected_sha256 = _required_sha256(row, "sha256")
        data = object_store.get_bytes(bucket=bucket, key=key)
        actual_size = len(data)
        if actual_size != expected_size:
            raise ValueError(
                f"size mismatch for {bucket}/{key}: expected {expected_size}, got {actual_size}"
            )
        actual_sha256 = hashlib.sha256(data).hexdigest()
        if actual_sha256 != expected_sha256:
            raise ValueError(
                f"sha256 mismatch for {bucket}/{key}: expected {expected_sha256}, got {actual_sha256}"
            )
        total_size += actual_size
    return ServingSeedVerifyReport(object_count=len(rows), total_size_bytes=total_size)


def restore_serving_seed_manifest(
    *,
    request: ServingSeedRestoreRequest,
    source_object_store: ServingSeedObjectStore,
    target_object_store: ServingSeedObjectStore,
) -> ServingSeedRestoreReport:
    manifest = _load_manifest(request)
    rows = _manifest_object_rows(manifest)
    total_size = 0
    for row in rows:
        bucket = _required_text(row, "bucket")
        key = _required_text(row, "key")
        content_type = _required_text(row, "contentType")
        expected_size = _required_int(row, "sizeBytes")
        expected_sha256 = _required_sha256(row, "sha256")
        data = source_object_store.get_bytes(bucket=bucket, key=key)
        actual_sha256 = hashlib.sha256(data).hexdigest()
        if len(data) != expected_size:
            raise ValueError(f"size mismatch for {bucket}/{key}")
        if actual_sha256 != expected_sha256:
            raise ValueError(f"sha256 mismatch for {bucket}/{key}")
        target_object_store.put_bytes(bucket=bucket, key=key, data=data, content_type=content_type)
        total_size += len(data)
    return ServingSeedRestoreReport(restored_count=len(rows), total_size_bytes=total_size)


def _extract_object_keys_from_docs_manifest(manifest_bytes: bytes) -> tuple[str, ...]:
    payload = json.loads(manifest_bytes.decode("utf-8"))
    public_manifest = payload.get("publicDocsSyncManifest")
    if not isinstance(public_manifest, dict):
        raise ValueError("docs reader manifest missing publicDocsSyncManifest")
    entries = public_manifest.get("entries")
    if not isinstance(entries, list):
        raise ValueError("docs reader manifest publicDocsSyncManifest.entries must be a list")
    keys: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("docs reader manifest entry must be an object")
        source_objects = entry.get("sourceObjects")
        if not isinstance(source_objects, dict):
            raise ValueError("docs reader manifest entry sourceObjects must be an object")
        for value in source_objects.values():
            keys.add(_normalize_key(str(value)))
    return tuple(sorted(keys))


def _load_manifest(
    request: ServingSeedVerifyRequest | ServingSeedRestoreRequest,
) -> dict[str, object]:
    if request.manifest is not None:
        return _assert_seed_manifest(request.manifest)
    if request.manifest_path is None:
        raise ValueError("manifest_path is required")
    return _assert_seed_manifest(json.loads(request.manifest_path.read_text(encoding="utf-8")))


def _assert_seed_manifest(manifest: dict[str, object]) -> dict[str, object]:
    if manifest.get("schemaVersion") != _SCHEMA_VERSION:
        raise ValueError("unsupported serving seed manifest schemaVersion")
    if manifest.get("seedProfile") != _SEED_PROFILE:
        raise ValueError("unsupported serving seed profile")
    return manifest


def _manifest_object_rows(manifest: dict[str, object]) -> tuple[dict[str, object], ...]:
    objects = manifest.get("objects")
    if not isinstance(objects, list) or not objects:
        raise ValueError("serving seed manifest objects must be a non-empty list")
    rows: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for item in objects:
        if not isinstance(item, dict):
            raise ValueError("serving seed manifest object row must be an object")
        bucket = _required_text(item, "bucket")
        key = _required_text(item, "key")
        identity = (bucket, key)
        if identity in seen:
            raise ValueError(f"duplicate serving seed object: {bucket}/{key}")
        seen.add(identity)
        rows.append(item)
    return tuple(rows)


def _resolve_content_type(*, metadata: dict[str, object], key: str) -> str:
    for name in ("content_type", "ContentType"):
        value = metadata.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if key.endswith((".json", ".jsonl")):
        return "application/json"
    if key.endswith(".png"):
        return "image/png"
    return "application/octet-stream"


def _normalize_key(value: str) -> str:
    normalized = value.strip().lstrip("/")
    if not normalized:
        raise ValueError("object key is required")
    if any(part in {"", ".", ".."} for part in normalized.split("/")):
        raise ValueError(f"invalid object key: {value}")
    return normalized


def _required_text(row: dict[str, object], field_name: str) -> str:
    value = row.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _required_int(row: dict[str, object], field_name: str) -> int:
    value = row.get(field_name)
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return value


def _required_sha256(row: dict[str, object], field_name: str) -> str:
    value = _required_text(row, field_name)
    if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
        raise ValueError(f"{field_name} must be a lowercase sha256 hex digest")
    return value


__all__ = [
    "ServingSeedExportReport",
    "ServingSeedExportRequest",
    "ServingSeedRestoreReport",
    "ServingSeedRestoreRequest",
    "ServingSeedVerifyReport",
    "ServingSeedVerifyRequest",
    "export_serving_seed_manifest",
    "restore_serving_seed_manifest",
    "verify_serving_seed_manifest",
]
