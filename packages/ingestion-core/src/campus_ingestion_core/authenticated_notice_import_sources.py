from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.settings import ObjectStoreSettings


class AuthenticatedNoticeImportObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeImportObjectRefs:
    source_bucket: str
    bundle_object_key: str
    manifest_object_key: str
    bundle_content_sha256: str | None = None
    bundle_byte_size: int | None = None
    manifest_content_sha256: str | None = None
    manifest_byte_size: int | None = None
    run_id: str | None = None


@dataclass(frozen=True, slots=True)
class LoadedAuthenticatedNoticeImportPayload:
    bundle_records: tuple[dict[str, Any], ...]
    export_manifest: dict[str, Any]


def explicit_authenticated_notice_import_object_refs(
    *,
    source_bucket: str | None,
    bundle_object_key: str | None,
    manifest_object_key: str | None,
    bundle_content_sha256: str | None = None,
    bundle_byte_size: int | None = None,
    manifest_content_sha256: str | None = None,
    manifest_byte_size: int | None = None,
    run_id: str | None = None,
) -> AuthenticatedNoticeImportObjectRefs:
    return AuthenticatedNoticeImportObjectRefs(
        source_bucket=_required_text(source_bucket, "source_bucket"),
        bundle_object_key=_required_text(bundle_object_key, "bundle_object_key"),
        manifest_object_key=_required_text(manifest_object_key, "manifest_object_key"),
        bundle_content_sha256=_optional_sha256(
            bundle_content_sha256,
            "bundle_content_sha256",
        ),
        bundle_byte_size=_optional_non_negative_int(bundle_byte_size, "bundle_byte_size"),
        manifest_content_sha256=_optional_sha256(
            manifest_content_sha256,
            "manifest_content_sha256",
        ),
        manifest_byte_size=_optional_non_negative_int(manifest_byte_size, "manifest_byte_size"),
        run_id=_optional_text(run_id),
    )


def load_authenticated_notice_import_payload_from_object_refs(
    *,
    refs: AuthenticatedNoticeImportObjectRefs,
    env: dict[str, str],
    object_store: object | None,
    bundle_label: str,
    manifest_label: str,
) -> LoadedAuthenticatedNoticeImportPayload:
    reader = _object_store_reader(env=env, object_store=object_store)
    bundle_bytes = _get_verified_object_bytes(
        reader=reader,
        bucket=refs.source_bucket,
        key=refs.bundle_object_key,
        expected_sha256=refs.bundle_content_sha256,
        expected_byte_size=refs.bundle_byte_size,
        label=bundle_label,
        missing_reason_code="missing_bundle_object",
    )
    manifest_bytes = _get_verified_object_bytes(
        reader=reader,
        bucket=refs.source_bucket,
        key=refs.manifest_object_key,
        expected_sha256=refs.manifest_content_sha256,
        expected_byte_size=refs.manifest_byte_size,
        label=manifest_label,
        missing_reason_code="missing_manifest_object",
    )
    return LoadedAuthenticatedNoticeImportPayload(
        bundle_records=load_json_array_payload_from_bytes(bundle_bytes, label=bundle_label),
        export_manifest=load_json_object_payload_from_bytes(manifest_bytes, label=manifest_label),
    )


def authenticated_notice_import_object_refs_from_capture_release(
    *,
    source_bucket: str | None,
    capture_release_object_key: str | None,
    capture_release_content_sha256: str | None = None,
    capture_release_byte_size: int | None = None,
    env: dict[str, str],
    object_store: object | None,
) -> AuthenticatedNoticeImportObjectRefs:
    bucket = _required_text(source_bucket, "source_bucket")
    release_key = _required_text(
        capture_release_object_key,
        "capture_release_object_key",
    )
    reader = _object_store_reader(env=env, object_store=object_store)
    release_bytes = get_verified_authenticated_notice_object_bytes(
        reader=reader,
        bucket=bucket,
        key=release_key,
        expected_sha256=_optional_sha256(
            capture_release_content_sha256,
            "capture_release_content_sha256",
        ),
        expected_byte_size=_optional_non_negative_int(
            capture_release_byte_size,
            "capture_release_byte_size",
        ),
        label="authenticated notice capture release",
        missing_reason_code="missing_capture_release_object",
    )
    release = load_json_object_payload_from_bytes(
        release_bytes,
        label="authenticated notice capture release",
    )
    if release.get("schema_version") != "authenticated_notice_capture_release.v1":
        raise ValueError(
            "capture release schema_version must be authenticated_notice_capture_release.v1"
        )
    if release.get("source_channel") != "authenticated_notice_portal":
        raise ValueError("capture release source_channel must be authenticated_notice_portal")
    if release.get("source_surface") != "notice":
        raise ValueError("capture release source_surface must be notice")
    bundle_ref = _required_ref_record(release.get("bundle_ref"), "bundle_ref")
    manifest_ref = _required_ref_record(release.get("export_manifest_ref"), "export_manifest_ref")
    bundle_bucket = _required_text(bundle_ref.get("bucket"), "bundle_ref.bucket")
    manifest_bucket = _required_text(manifest_ref.get("bucket"), "export_manifest_ref.bucket")
    if bundle_bucket != bucket or manifest_bucket != bucket:
        raise ValueError("capture release object refs must use the source_bucket")
    return explicit_authenticated_notice_import_object_refs(
        source_bucket=bucket,
        bundle_object_key=_required_text(bundle_ref.get("key"), "bundle_ref.key"),
        manifest_object_key=_required_text(manifest_ref.get("key"), "export_manifest_ref.key"),
        bundle_content_sha256=_optional_sha256(
            bundle_ref.get("content_sha256"),
            "bundle_ref.content_sha256",
        ),
        bundle_byte_size=_optional_non_negative_int(
            bundle_ref.get("byte_size"),
            "bundle_ref.byte_size",
        ),
        manifest_content_sha256=_optional_sha256(
            manifest_ref.get("content_sha256"),
            "export_manifest_ref.content_sha256",
        ),
        manifest_byte_size=_optional_non_negative_int(
            manifest_ref.get("byte_size"),
            "export_manifest_ref.byte_size",
        ),
        run_id=_optional_text(release.get("capture_id")),
    )


def load_json_array_payload_from_bytes(
    payload_bytes: bytes,
    *,
    label: str,
) -> tuple[dict[str, Any], ...]:
    payload = json.loads(payload_bytes.decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{label} must be a JSON array")
    return tuple(item for item in payload if isinstance(item, dict))


def load_json_object_payload_from_bytes(
    payload_bytes: bytes,
    *,
    label: str,
) -> dict[str, Any]:
    payload = json.loads(payload_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _object_store_reader(
    *,
    env: dict[str, str],
    object_store: object | None,
) -> AuthenticatedNoticeImportObjectStoreReader:
    if object_store is not None:
        get_bytes = getattr(object_store, "get_bytes", None)
        if not callable(get_bytes):
            raise ValueError("object_store must support get_bytes for object-ref import")
        return object_store  # type: ignore[return-value]
    return S3ObjectStoreWriter(ObjectStoreSettings.from_env(env))


def _get_verified_object_bytes(
    *,
    reader: AuthenticatedNoticeImportObjectStoreReader,
    bucket: str,
    key: str,
    expected_sha256: str | None,
    expected_byte_size: int | None,
    label: str,
    missing_reason_code: str,
) -> bytes:
    return get_verified_authenticated_notice_object_bytes(
        reader=reader,
        bucket=bucket,
        key=key,
        expected_sha256=expected_sha256,
        expected_byte_size=expected_byte_size,
        label=label,
        missing_reason_code=missing_reason_code,
    )


def get_verified_authenticated_notice_object_bytes(
    *,
    reader: AuthenticatedNoticeImportObjectStoreReader,
    bucket: str,
    key: str,
    expected_sha256: str | None,
    expected_byte_size: int | None,
    label: str,
    missing_reason_code: str,
) -> bytes:
    try:
        payload = reader.get_bytes(bucket=bucket, key=key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            raise ValueError(
                f"{missing_reason_code}: {label} object missing for {bucket}/{key}"
            ) from exc
        raise
    if expected_byte_size is not None and len(payload) != expected_byte_size:
        raise ValueError(
            f"size_mismatch: {label} object size mismatch for {bucket}/{key}: "
            f"expected {expected_byte_size}, got {len(payload)}"
        )
    if expected_sha256 is not None:
        actual_sha256 = hashlib.sha256(payload).hexdigest()
        if actual_sha256 != expected_sha256:
            raise ValueError(
                f"checksum_mismatch: {label} object sha256 mismatch for {bucket}/{key}: "
                f"expected {expected_sha256}, got {actual_sha256}"
            )
    return payload


def _is_missing_object_error(exc: BaseException) -> bool:
    if isinstance(exc, KeyError):
        return True
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        metadata = response.get("ResponseMetadata")
        if isinstance(error, dict):
            code = str(error.get("Code") or "").strip()
            if code in {"NoSuchKey", "NoSuchBucket", "NotFound", "404"}:
                return True
        if isinstance(metadata, dict) and str(metadata.get("HTTPStatusCode") or "") == "404":
            return True
    return exc.__class__.__name__ in {
        "NoSuchKey",
        "NoSuchBucket",
        "NotFound",
    }


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} is required for object-ref import")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} is required for object-ref import")
    return normalized


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _optional_sha256(value: object, label: str) -> str | None:
    normalized = _optional_text(value)
    if normalized is None:
        return None
    if len(normalized) != 64 or any(
        character not in "0123456789abcdef" for character in normalized
    ):
        raise ValueError(f"{label} must be a lowercase sha256 hex digest")
    return normalized


def _optional_non_negative_int(value: object, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a non-negative integer")
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


def _required_ref_record(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} is required for capture release import")
    return value


__all__ = [
    "AuthenticatedNoticeImportObjectRefs",
    "LoadedAuthenticatedNoticeImportPayload",
    "authenticated_notice_import_object_refs_from_capture_release",
    "explicit_authenticated_notice_import_object_refs",
    "get_verified_authenticated_notice_object_bytes",
    "load_authenticated_notice_import_payload_from_object_refs",
    "load_json_array_payload_from_bytes",
    "load_json_object_payload_from_bytes",
]
