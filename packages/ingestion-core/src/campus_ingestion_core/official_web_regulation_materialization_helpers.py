from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import ObjectStoreWriter
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry


def _is_source_truth_key(key: str) -> bool:
    return key.startswith("official_web/")


def _document_id_short_suffix(document_id: str) -> str:
    suffix = document_id.strip().split(":")[-1]
    return suffix[:8] if len(suffix) > 8 else suffix


def _preserve_non_official_web_scope_record(record: DocumentRegistryRecord) -> bool:
    return record.source_channel != "official_web"


def _preserve_scope_refresh_artifacts(record: DocumentRegistryRecord) -> bool:
    if record.source_channel != "official_web":
        return True
    return record.is_current and record.status == "active"


def _build_materialized_document_reports(
    *,
    candidates: tuple[dict[str, object], ...],
    candidate_document_projection: Callable[[dict[str, object]], dict[str, object]],
    document_registry: DocumentRegistry,
    object_store: ObjectStoreWriter,
    bucket_derived: str,
) -> tuple[dict[str, object], ...]:
    reports: list[dict[str, object]] = []
    for candidate in candidates:
        projection = candidate_document_projection(candidate)
        target_document_id = str(projection["document_id"])
        record = document_registry.current_version(
            target_document_id,
            preferred_revision_tracks=("current-effective",),
        )
        if record is None:
            continue
        reports.append(
            _materialized_document_report(
                projection=projection,
                record=record,
                object_store=object_store,
                bucket_derived=bucket_derived,
            )
        )
    return tuple(reports)


def _materialized_document_report(
    *,
    projection: dict[str, object],
    record: DocumentRegistryRecord,
    object_store: ObjectStoreWriter,
    bucket_derived: str,
) -> dict[str, object]:
    canonical_key = record.canonical_markdown_object_key
    document_units_key = record.document_units_object_key
    canonical_bytes = (
        object_store.get_bytes(bucket=bucket_derived, key=canonical_key) if canonical_key else b""
    )
    document_units_bytes = (
        object_store.get_bytes(bucket=bucket_derived, key=document_units_key)
        if document_units_key
        else b""
    )
    return {
        "target_document_id": record.document_id,
        "target_corpus": record.corpus,
        "target_collection": record.collection,
        "version_id": record.version_id,
        "content_hash": record.content_hash,
        "title": str(projection["title"]),
        "title_base": str(projection["title_base"]),
        "title_raw": str(projection["title_raw"]),
        "title_source_marker": _optional_text(projection.get("title_source_marker")),
        "title_status_qualifier": _optional_text(projection.get("title_status_qualifier")),
        "title_status_kind": _optional_text(projection.get("title_status_kind")),
        "cleaning_policy_version": record.cleaning_policy_version,
        "normalizer_version": str(projection["normalizer_version"]),
        "normalization_quality": dict(projection["normalization_quality"]),
        "source_channel": "official_web",
        "canonical_markdown_object_key": canonical_key,
        "canonical_markdown_sha256": hashlib.sha256(canonical_bytes).hexdigest()
        if canonical_bytes
        else "",
        "document_units_object_key": document_units_key,
        "document_units_sha256": hashlib.sha256(document_units_bytes).hexdigest()
        if document_units_bytes
        else "",
    }


def _dedupe_candidates_by_url(candidates: list[dict[str, object]]) -> tuple[dict[str, object], ...]:
    by_url: dict[str, dict[str, object]] = {}
    for candidate in candidates:
        url = _require_text(candidate.get("normalized_canonical_url"), "normalized_canonical_url")
        by_url[url] = candidate
    return tuple(by_url[url] for url in sorted(by_url))


def _candidate_selected_write_target(candidate: dict[str, object]) -> str:
    return _require_text(candidate.get("selected_write_target"), "selected_write_target")


def _candidate_scope(candidate: dict[str, object]) -> tuple[str, str]:
    selected_write_target = _candidate_selected_write_target(candidate)
    if "/" in selected_write_target:
        corpus, collection = selected_write_target.split("/", 1)
        if corpus and collection:
            return corpus, collection
    target_corpus = _require_text(candidate.get("target_corpus"), "target_corpus")
    target_collection = _require_text(candidate.get("target_collection"), "target_collection")
    return target_corpus, target_collection


def _candidate_regulation_lines(typed_candidate: dict[str, object]) -> tuple[str, ...]:
    raw_lines = typed_candidate.get("regulation_lines")
    if isinstance(raw_lines, list):
        normalized = tuple(str(line).strip() for line in raw_lines if str(line).strip())
        if normalized:
            return normalized
    regulation_text = str(typed_candidate.get("regulation_text") or "").strip()
    if not regulation_text:
        return ()
    return tuple(line.strip() for line in regulation_text.splitlines() if line.strip())


def _render_canonical_markdown(*, title: str, source_url: str, canonical_body: str) -> str:
    return "\n".join(
        [
            f"# {title}",
            "",
            f"> Source URL: {source_url}",
            "",
            canonical_body,
            "",
        ]
    )


def _build_document_id(*, source_url: str) -> str:
    digest = hashlib.sha1(source_url.encode("utf-8")).hexdigest()[:16]
    return f"official_web_regulation:{digest}"


def _build_version_id(
    *,
    raw_version_id: str,
    source_url: str,
    title: str,
    canonical_body: str,
) -> str:
    digest = hashlib.sha1(
        json.dumps(
            {
                "body": canonical_body,
                "raw_version_id": raw_version_id,
                "source_url": source_url,
                "title": title,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return f"owregver:{digest}"


def _semantic_content_hash(*, title: str, canonical_body: str) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {"title": title, "body": canonical_body},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"


def _read_provider_bytes(
    *, output_dir: Path, raw_asset_id: str, raw_version_id: str
) -> bytes | None:
    path = (
        output_dir
        / "source-assets"
        / raw_asset_id
        / raw_version_id
        / "provider"
        / "cheerio-basic"
        / "page-extraction.json"
    )
    return path.read_bytes() if path.exists() else None


def _source_truth_object_keys(candidate: dict[str, object]) -> tuple[str, ...]:
    keys = [
        _optional_text(candidate.get("page_manifest_object_key")),
        _optional_text(candidate.get("content_blocks_object_key")),
    ]
    return tuple(key for key in keys if key is not None)


def _year_from_candidate(candidate: dict[str, object]) -> str | None:
    for key in ("published_at", "fetched_at", "last_modified"):
        value = _optional_text(candidate.get(key))
        if value is not None and len(value) >= 4 and value[:4].isdigit():
            return value[:4]
    return None


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _require_list(value: object, field_name: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array")
    return value


def _require_dict(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return value


def _require_text(value: object, field_name: str) -> str:
    text = _optional_text(value)
    if text is None:
        raise ValueError(f"{field_name} is required")
    return text


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None
