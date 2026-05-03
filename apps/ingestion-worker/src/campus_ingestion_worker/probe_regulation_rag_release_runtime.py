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
                "surfaces": [
                    _probe_surface(
                        scope=scope,
                        qdrant_client=qdrant_client,
                        settings=settings,
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
) -> dict[str, object]:
    corpus, collection = _parse_scope(scope)
    profile = load_runtime_profile(corpus, collection)
    alias_name = profile.qdrant_index_binding.alias_name
    alias_target = resolve_alias_target(qdrant_client=qdrant_client, alias_name=alias_name)
    collection_info = _read_collection_info(qdrant_client=qdrant_client, alias_target=alias_target)
    guard_status, guard_message = _probe_release_metadata_guard(
        qdrant_client=qdrant_client,
        settings=settings,
        profile=profile,
        alias_name=alias_name,
    )
    return {
        "scope": f"{corpus}/{collection}",
        "corpus": corpus,
        "collection": collection,
        "retrieval_enabled": profile.retrieval_enabled,
        "query_enabled_by_default": profile.query_enabled_by_default,
        "alias_name": alias_name,
        "alias_target": alias_target,
        "points_count": getattr(collection_info, "points_count", None) if collection_info else None,
        "vectors_count": getattr(collection_info, "vectors_count", None) if collection_info else None,
        "release_metadata_guard_status": guard_status,
        "release_metadata_guard_message": guard_message,
        "release_metadata_guard_missing_fields": _release_metadata_missing_fields(guard_message),
    }


def _probe_release_metadata_guard(
    *,
    qdrant_client,
    settings: RetrievalSettings,
    profile,
    alias_name: str,
) -> tuple[str, str]:
    backend = SimpleNamespace(qdrant_client=qdrant_client)
    try:
        validate_alias_release_metadata(
            backend,
            collection_name=alias_name,
            profile=profile,
            settings=settings,
            timeout_seconds=_qdrant_http_timeout_seconds(settings.qdrant_timeout_seconds),
        )
    except Exception as exc:
        return "failed", str(exc)
    return "passed", ""


def _read_collection_info(*, qdrant_client, alias_target: str | None):
    if not alias_target:
        return None
    try:
        return qdrant_client.get_collection(alias_target)
    except TypeError:
        return qdrant_client.get_collection(collection_name=alias_target)


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
