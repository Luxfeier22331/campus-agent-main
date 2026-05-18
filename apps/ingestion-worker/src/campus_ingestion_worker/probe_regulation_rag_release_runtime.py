from __future__ import annotations

import argparse
import json
import re
from collections.abc import Sequence
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.backend_qdrant_release_guard import validate_alias_release_metadata
from campus_retrieval_core.backend_qdrant_runtime import _build_qdrant_client
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_RAG_SURFACE_SCOPES = (
    "regulations/student_rules",
    "regulations/institutional_rules",
    "curriculum/curriculum_plan",
    "official_web/stable_reference",
)

_MISSING_FIELDS_RE = re.compile(r"missing release metadata fields: ([^;]+)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Probe query-serving RAG retrieval runtime readiness without printing secrets."
    )
    parser.add_argument(
        "--scope",
        action="append",
        default=None,
        help="Optional corpus/collection scope. Defaults to all current RAG consumption surfaces.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    loaded_env_path = load_worker_env()
    settings = RetrievalSettings.from_env()
    qdrant_client = _build_qdrant_client(settings)
    object_store_status, object_store_error, object_store, bucket_derived = (
        _build_release_object_store()
    )
    checks = {
        path: _check_qdrant_endpoint(settings=settings, path=path)
        for path in ("/readyz", "/livez", "/collections")
    }
    print(
        json.dumps(
            {
                "schema_version": "rag_retrieval_runtime_readiness.v1",
                "loaded_env_path": str(loaded_env_path) if loaded_env_path else None,
                "qdrant_url_present": bool(settings.qdrant_url),
                "qdrant_scheme": _url_part(settings.qdrant_url, "scheme"),
                "qdrant_host": _url_part(settings.qdrant_url, "hostname"),
                "qdrant_api_key_present": bool(settings.qdrant_api_key),
                "qdrant_checks": checks,
                "qdrant_ready": "ready" if _all_checks_ready(checks) else "not_ready",
                "object_store_status": object_store_status,
                "object_store_error": object_store_error,
                "object_store_bucket_derived": bucket_derived,
                "surfaces": [
                    _probe_surface(
                        scope=scope,
                        qdrant_client=qdrant_client,
                        settings=settings,
                        object_store=object_store,
                        bucket_derived=bucket_derived,
                    )
                    for scope in tuple(args.scope or DEFAULT_RAG_SURFACE_SCOPES)
                ],
                "embedding_provider": settings.embedding_provider,
                "embedding_model": settings.embedding_model,
                "embedding_dimensions": settings.embedding_dimensions,
                "embedding_api_key_present": bool(settings.embedding_api_key),
                "embedding_base_url_present": bool(settings.embedding_base_url),
                "secrets_redacted": True,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def _probe_surface(
    *,
    scope: str,
    qdrant_client,
    settings: RetrievalSettings,
    object_store,
    bucket_derived: str | None,
) -> dict[str, object]:
    corpus, collection = _parse_scope(scope)
    profile = load_runtime_profile(corpus, collection)
    alias_name = profile.qdrant_index_binding.alias_name
    alias_target = resolve_alias_target(qdrant_client=qdrant_client, alias_name=alias_name)
    release_family_status = "unavailable"
    release_family_error = ""
    release_manifests: tuple[dict[str, object], ...] = ()
    if object_store is not None and bucket_derived is not None:
        try:
            release_manifests = _load_release_manifests(
                object_store=object_store,
                bucket=bucket_derived,
                corpus=corpus,
                collection=collection,
            )
            release_family_status = "available"
        except Exception as exc:
            release_family_status = "error"
            release_family_error = f"{type(exc).__name__}: {exc}"
    latest_manifest = _select_latest_release_manifest(release_manifests)
    latest_collection_name = (
        str(latest_manifest.get("physical_collection_name") or "") if latest_manifest else None
    )
    alias_manifest = _find_release_manifest_for_collection(
        release_manifests=release_manifests,
        collection_name=alias_target,
    )
    collection_info = _read_collection_info(
        qdrant_client=qdrant_client,
        collection_name=alias_target,
    )
    latest_collection_info = _read_collection_info(
        qdrant_client=qdrant_client,
        collection_name=latest_collection_name,
    )
    latest_guard_status, latest_guard_message = _probe_release_metadata_guard(
        qdrant_client=qdrant_client,
        settings=settings,
        profile=profile,
        collection_name=latest_collection_name,
    )
    if alias_target and alias_target != latest_collection_name:
        alias_guard_status, alias_guard_message = _probe_release_metadata_guard(
            qdrant_client=qdrant_client,
            settings=settings,
            profile=profile,
            collection_name=alias_target,
        )
    else:
        alias_guard_status, alias_guard_message = latest_guard_status, latest_guard_message
    release_freshness_status, release_freshness_reason = _classify_release_freshness(
        alias_target=alias_target,
        latest_manifest=latest_manifest,
        alias_manifest=alias_manifest,
    )
    readiness_status, readiness_blocker = _classify_surface_readiness(
        release_freshness_status=release_freshness_status,
        latest_guard_status=latest_guard_status,
        alias_guard_status=alias_guard_status,
    )
    return {
        "scope": f"{corpus}/{collection}",
        "corpus": corpus,
        "collection": collection,
        "retrieval_enabled": profile.retrieval_enabled,
        "query_enabled_by_default": profile.query_enabled_by_default,
        "alias_name": alias_name,
        "alias_target": alias_target,
        "release_family_status": release_family_status,
        "release_family_error": release_family_error,
        "release_family_manifest_count": len(release_manifests),
        "release_family_published_manifest_count": len(
            [manifest for manifest in release_manifests if _is_published_release_manifest(manifest)]
        ),
        "release_family_latest_release_id": (
            str(latest_manifest.get("release_id") or "") if latest_manifest else None
        ),
        "release_family_latest_physical_collection_name": latest_collection_name,
        "release_family_latest_manifest_object_key": (
            str(latest_manifest.get("manifest_object_key") or "") if latest_manifest else None
        ),
        "release_freshness_status": release_freshness_status,
        "release_freshness_reason": release_freshness_reason,
        "points_count": getattr(collection_info, "points_count", None) if collection_info else None,
        "vectors_count": getattr(collection_info, "vectors_count", None)
        if collection_info
        else None,
        "latest_release_points_count": (
            getattr(latest_collection_info, "points_count", None)
            if latest_collection_info
            else None
        ),
        "latest_release_vectors_count": (
            getattr(latest_collection_info, "vectors_count", None)
            if latest_collection_info
            else None
        ),
        "release_metadata_guard_status": latest_guard_status,
        "release_metadata_guard_message": latest_guard_message,
        "release_metadata_guard_missing_fields": _release_metadata_missing_fields(
            latest_guard_message
        ),
        "alias_target_guard_status": alias_guard_status,
        "alias_target_guard_message": alias_guard_message,
        "alias_target_guard_missing_fields": _release_metadata_missing_fields(alias_guard_message),
        "readiness_status": readiness_status,
        "readiness_blocker": readiness_blocker,
    }


def _probe_release_metadata_guard(
    *,
    qdrant_client,
    settings: RetrievalSettings,
    profile,
    collection_name: str | None,
) -> tuple[str, str]:
    if not collection_name:
        return "missing", "missing release collection name"
    backend = SimpleNamespace(qdrant_client=qdrant_client)
    try:
        validate_alias_release_metadata(
            backend,
            collection_name=collection_name,
            profile=profile,
            settings=settings,
            timeout_seconds=_qdrant_http_timeout_seconds(settings.qdrant_timeout_seconds),
        )
    except Exception as exc:
        return "failed", str(exc)
    return "passed", ""


def _read_collection_info(*, qdrant_client, collection_name: str | None):
    if not collection_name:
        return None
    try:
        return qdrant_client.get_collection(collection_name)
    except TypeError:
        return qdrant_client.get_collection(collection_name=collection_name)


def _build_release_object_store() -> tuple[str, str, object | None, str | None]:
    try:
        settings = ObjectStoreSettings.from_env()
        return "available", "", S3ObjectStoreAdmin(settings), settings.bucket_derived
    except Exception as exc:
        return "unavailable", f"{type(exc).__name__}: {exc}", None, None


def _load_release_manifests(
    *,
    object_store,
    bucket: str,
    corpus: str,
    collection: str,
) -> tuple[dict[str, object], ...]:
    prefix = "/".join([corpus, "releases", collection]) + "/"
    keys = [
        key
        for key in object_store.list_keys(bucket=bucket, prefix=prefix)
        if key.endswith("/index-release.json")
    ]
    manifests: list[dict[str, object]] = []
    for key in sorted(keys):
        payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
        payload = dict(payload)
        payload["manifest_object_key"] = key
        manifests.append(payload)
    return tuple(manifests)


def _select_latest_release_manifest(
    release_manifests: Sequence[dict[str, object]],
) -> dict[str, object] | None:
    published_manifests = [
        manifest for manifest in release_manifests if _is_published_release_manifest(manifest)
    ]
    if not published_manifests:
        return None
    return max(
        published_manifests,
        key=lambda payload: (
            str(payload.get("published_at") or ""),
            str(payload.get("indexed_at") or ""),
            str(payload.get("release_id") or ""),
        ),
    )


def _is_published_release_manifest(manifest: dict[str, object]) -> bool:
    return bool(str(manifest.get("published_at") or "").strip())


def _find_release_manifest_for_collection(
    *,
    release_manifests: Sequence[dict[str, object]],
    collection_name: str | None,
) -> dict[str, object] | None:
    if not collection_name:
        return None
    for manifest in release_manifests:
        if str(manifest.get("physical_collection_name") or "") == collection_name:
            return manifest
    return None


def _classify_release_freshness(
    *,
    alias_target: str | None,
    latest_manifest: dict[str, object] | None,
    alias_manifest: dict[str, object] | None,
) -> tuple[str, str]:
    if latest_manifest is None:
        return "unavailable", "no published release manifest found"
    latest_collection_name = str(latest_manifest.get("physical_collection_name") or "")
    latest_release_id = str(latest_manifest.get("release_id") or "")
    if not alias_target:
        return "unpublished", "alias is not published"
    if alias_target == latest_collection_name:
        return "current", ""
    if alias_manifest is None:
        return (
            "stale_alias_untracked",
            f"alias target {alias_target} has no matching release manifest; latest release is {latest_release_id}/{latest_collection_name}",
        )
    return (
        "stale_alias",
        "alias target "
        f"{alias_target} points to release {alias_manifest.get('release_id') or ''!s}, "
        f"but latest release is {latest_release_id}/{latest_collection_name}",
    )


def _classify_surface_readiness(
    *,
    release_freshness_status: str,
    latest_guard_status: str,
    alias_guard_status: str,
) -> tuple[str, str]:
    if release_freshness_status != "current":
        return "blocked", release_freshness_status
    if latest_guard_status != "passed":
        return "blocked", "latest_release_metadata_guard_failed"
    if alias_guard_status != "passed":
        return "blocked", "alias_target_metadata_guard_failed"
    return "ready", ""


def _release_metadata_missing_fields(message: str) -> list[str]:
    values: list[str] = []
    for match in _MISSING_FIELDS_RE.finditer(message):
        fields = [field.strip() for field in match.group(1).split(",")]
        for field in fields:
            if field and field not in values:
                values.append(field)
    return values


def _check_qdrant_endpoint(*, settings: RetrievalSettings, path: str) -> dict[str, object]:
    if settings.qdrant_url == ":memory:":
        return {"status": "skipped", "reason": "memory_qdrant"}
    endpoint = urljoin(settings.qdrant_url.rstrip("/") + "/", path.lstrip("/"))
    headers = {"api-key": settings.qdrant_api_key} if settings.qdrant_api_key else {}
    request = Request(endpoint, headers=headers)
    try:
        with urlopen(request, timeout=settings.qdrant_timeout_seconds) as response:
            body = response.read(160).decode("utf-8", errors="replace")
            return {"status": response.status, "body_prefix": body}
    except HTTPError as exc:
        body = exc.read(160).decode("utf-8", errors="replace")
        return {"status": exc.code, "body_prefix": body}
    except (TimeoutError, URLError) as exc:
        return {"status": "error", "error_type": type(exc).__name__}


def _all_checks_ready(checks: dict[str, dict[str, object]]) -> bool:
    return all(check.get("status") == 200 for check in checks.values())


def _url_part(url: str, part: str) -> str | None:
    parsed = urlparse(url)
    value = getattr(parsed, part)
    return str(value) if value else None


def _qdrant_http_timeout_seconds(value: float | int | None) -> int | None:
    if value is None:
        return None
    return max(int(float(value)), 1)


def _parse_scope(scope: str) -> tuple[str, str]:
    parts = [part.strip() for part in str(scope or "").split("/") if part.strip()]
    if len(parts) != 2:
        raise ValueError(f"scope must use corpus/collection format: {scope}")
    return parts[0], parts[1]


__all__ = ["DEFAULT_RAG_SURFACE_SCOPES", "build_parser", "main"]


if __name__ == "__main__":
    main()
