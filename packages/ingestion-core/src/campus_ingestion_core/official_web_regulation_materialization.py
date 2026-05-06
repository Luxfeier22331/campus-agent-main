from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ObjectStoreWriter,
    PersistImportStats,
    collect_import_document_stats,
)
from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    normalize_regulation_owner_text,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import build_document_artifact_key
from campus_ingestion_core.official_web_projection import replay_official_web_source_truth_local
from campus_ingestion_core.official_web_regulation_structure import (
    regulation_body_text_for_materialization,
)
from campus_ingestion_core.official_web_regulation_titles import (
    normalize_official_web_regulation_title,
    official_web_regulation_title_metadata,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.regulation_document_units import (
    normalize_regulation_canonical_body,
    regulation_common_metadata,
    serialize_regulation_document_units,
)
from campus_ingestion_core.settings import ObjectStoreSettings

_TARGET_CORPUS = "regulations"
_IMPORT_SOURCE = "official_web_regulation_source_truth_materialization"
_PARSER_VERSION = "official_web_regulation_materialization.v2"
_CLEANING_POLICY_VERSION = "institutional_rules_cleaning_v1"
_EMBEDDING_MODEL = "Qwen3-Embedding-4B"


@dataclass(frozen=True, slots=True)
class OfficialWebRegulationMaterializationReport:
    candidate_count: int
    materialized_document_count: int
    materialized_scopes: tuple[str, ...]
    created_document_ids: tuple[str, ...]
    updated_document_ids: tuple[str, ...]
    skipped_document_ids: tuple[str, ...]
    document_ids: tuple[str, ...]
    selected_target_document_ids: tuple[str, ...]
    materialized_documents: tuple[dict[str, object], ...]
    source_urls: tuple[str, ...]
    import_failed_count: int
    errors: tuple[str, ...]
    projection_report_path: str


def materialize_official_web_regulation_candidates(
    *,
    source_truth_output_dir: Path,
    projection_output_dir: Path,
    work_dir: Path,
    object_store: ObjectStoreWriter,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store_settings: ObjectStoreSettings,
    declarations_path: Path | None = None,
    scope_refresh: bool = False,
) -> OfficialWebRegulationMaterializationReport:
    work_dir.mkdir(parents=True, exist_ok=True)
    replay_report = replay_official_web_source_truth_local(
        output_dir=source_truth_output_dir,
        projection_output_dir=projection_output_dir,
        declarations_path=declarations_path,
    )
    candidates = _select_release_ready_regulation_candidates(replay_report.consumer_candidate_pages)
    stats = _materialize_candidates_by_scope(
        candidates=candidates,
        output_dir=source_truth_output_dir,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store_settings=object_store_settings,
        scope_refresh=scope_refresh,
    )
    return _build_report(
        candidates=candidates,
        candidate_count=len(candidates),
        document_registry=document_registry,
        materialized_scopes=tuple(sorted({"/".join(_candidate_scope(candidate)) for candidate in candidates})),
        object_store=object_store,
        object_store_settings=object_store_settings,
        stats=stats,
        projection_report_path=projection_output_dir / "projection-report.json",
        source_urls=tuple(str(candidate["normalized_canonical_url"]) for candidate in candidates),
    )


def build_official_web_regulation_candidate_documents(
    *,
    projection_output_dir: Path,
) -> tuple[dict[str, object], ...]:
    report = _read_json(projection_output_dir / "projection-report.json")
    return tuple(
        _candidate_document_projection(candidate)
        for candidate in _select_release_ready_regulation_candidates(
            _require_list(report.get("consumer_candidate_pages"), "consumer_candidate_pages")
        )
    )


def _select_release_ready_regulation_candidates(
    candidates: list[object],
) -> tuple[dict[str, object], ...]:
    selected: list[dict[str, object]] = []
    for raw_candidate in candidates:
        if not isinstance(raw_candidate, dict):
            continue
        if str(raw_candidate.get("consumer_family") or "").strip() not in {
            "regulation_candidate",
            "student_regulation_candidate",
        }:
            continue
        selected_write_target = str(raw_candidate.get("selected_write_target") or "").strip()
        if not selected_write_target.startswith("regulations/"):
            continue
        target_corpus, target_collection = _candidate_scope(raw_candidate)
        if target_corpus != _TARGET_CORPUS or not target_collection:
            continue
        quality_gate = raw_candidate.get("quality_gate")
        decision = (
            str(quality_gate.get("decision") or "").strip()
            if isinstance(quality_gate, dict)
            else ""
        )
        if decision != "pass":
            continue
        typed_candidate = raw_candidate.get("typed_candidate")
        if not isinstance(typed_candidate, dict):
            continue
        if not str(typed_candidate.get("regulation_text") or "").strip():
            continue
        selected.append(raw_candidate)
    return tuple(_dedupe_candidates_by_url(selected))


def _build_document_import(
    *,
    candidate: dict[str, object],
    output_dir: Path,
) -> DocumentImportInput:
    projection = _candidate_projection_payload(candidate)
    metadata = dict(projection["common_metadata"])
    metadata.update(
        {
            "document_id": projection["document_id"],
            "version_id": projection["version_id"],
            "source_url": projection["source_url"],
            "source_pdf": f"official_web:{projection['source_url']}",
            "title": projection["title"],
            "title_base": projection["title_base"],
            "title_raw": projection["title_raw"],
            "semantic_content_hash": projection["semantic_content_hash"],
            "entitlement_groups": [],
            "visibility_scope": None,
            "visibility_level": "public",
        }
    )
    return DocumentImportInput(
        source_label=str(projection["title"]),
        document_units_bytes=projection["document_units_bytes"],
        provider_response_bytes=_read_provider_bytes(
            output_dir=output_dir,
            raw_asset_id=str(projection["raw_asset_id"]),
            raw_version_id=str(projection["raw_version_id"]),
        ),
        canonical_markdown_bytes=str(projection["canonical_markdown"]).encode("utf-8"),
        metadata=metadata,
        import_source=_IMPORT_SOURCE,
        revision_track="current-effective",
        source_channel="official_web",
        is_current=True,
        corpus=str(projection["target_corpus"]),
        collection=str(projection["target_collection"]),
        raw_source_uri=str(projection["source_url"]),
        raw_asset_id=str(projection["raw_asset_id"]),
        raw_version_id=str(projection["raw_version_id"]),
        provider_response_object_key=_optional_text(
            candidate.get("provider_extraction_object_key")
        ),
        additional_processed_object_keys=_source_truth_object_keys(candidate),
        title=str(projection["title"]),
        year=_year_from_candidate(candidate),
    )


def _candidate_document_projection(candidate: dict[str, object]) -> dict[str, object]:
    projection = _candidate_projection_payload(candidate)
    return {
        "document_id": projection["document_id"],
        "version_id": projection["version_id"],
        "title": projection["title"],
        "title_base": projection["title_base"],
        "title_raw": projection["title_raw"],
        **official_web_regulation_title_metadata(projection["title_info"]),
        "target_corpus": projection["target_corpus"],
        "target_collection": projection["target_collection"],
        "normalized_canonical_url": projection["source_url"],
        "raw_asset_id": projection["raw_asset_id"],
        "raw_version_id": projection["raw_version_id"],
        "regulation_lines": list(projection["regulation_lines"]),
        "canonical_body": projection["canonical_body"],
        "normalization_quality": dict(projection["normalization_quality"]),
        "normalizer_version": projection["normalizer_version"],
        "canonical_markdown_object_key": build_document_artifact_key(
            corpus=str(projection["target_corpus"]),
            collection=str(projection["target_collection"]),
            document_id=str(projection["document_id"]),
            revision_track="current-effective",
            version_id=str(projection["version_id"]),
            filename="canonical.md",
            title=str(projection["title"]),
            year=_year_from_candidate(candidate),
        ),
        "document_units_object_key": build_document_artifact_key(
            corpus=str(projection["target_corpus"]),
            collection=str(projection["target_collection"]),
            document_id=str(projection["document_id"]),
            revision_track="current-effective",
            version_id=str(projection["version_id"]),
            filename="document-units.jsonl",
            title=str(projection["title"]),
            year=_year_from_candidate(candidate),
        ),
    }


def _candidate_projection_payload(candidate: dict[str, object]) -> dict[str, object]:
    typed_candidate = _require_dict(candidate.get("typed_candidate"), "typed_candidate")
    source_title_raw = (
        _optional_text(typed_candidate.get("source_title_raw"))
        or _optional_text(candidate.get("title_raw"))
        or _require_text(typed_candidate.get("reference_title"), "reference_title")
    )
    title_info = normalize_official_web_regulation_title(
        _require_text(typed_candidate.get("reference_title"), "reference_title")
    )
    title = title_info.display_title
    source_url = _require_text(
        candidate.get("normalized_canonical_url"), "normalized_canonical_url"
    )
    raw_asset_id = _require_text(candidate.get("raw_asset_id"), "raw_asset_id")
    raw_version_id = _require_text(candidate.get("raw_version_id"), "raw_version_id")
    regulation_lines = _candidate_regulation_lines(typed_candidate)
    owner_text = regulation_body_text_for_materialization(
        title=title,
        regulation_lines=regulation_lines,
    )
    if not owner_text:
        raise ValueError(f"missing regulation body text for {source_url}")
    target_corpus, target_collection = _candidate_scope(candidate)
    runtime_profile = load_runtime_profile(target_corpus, target_collection)
    cleaning_policy_version = (
        runtime_profile.cleaning_policy_version or _CLEANING_POLICY_VERSION
    )
    normalization = normalize_regulation_owner_text(title=title, owner_text=owner_text)
    canonical_body = normalize_regulation_canonical_body(normalization.canonical_body.strip())
    if not canonical_body:
        raise ValueError(f"missing normalized regulation body text for {source_url}")
    document_id = _build_document_id(source_url=source_url)
    version_id = _build_version_id(
        raw_version_id=raw_version_id,
        source_url=source_url,
        title=title,
        canonical_body=canonical_body,
    )
    normalization_quality = {
        "quality_verdict": normalization.quality_verdict,
        "cleaning_policy_version": cleaning_policy_version,
        "normalizer_version": normalization.normalizer_version,
        "reason_codes": list(normalization.reason_codes),
        "wrapper_removed": normalization.wrapper_removed,
        "suspicious_prefix": normalization.suspicious_prefix,
        "title_occurrence_count": normalization.title_occurrence_count,
        "chapter_count": normalization.chapter_count,
        "article_count": normalization.article_count,
        "page_artifact_count": normalization.page_artifact_count,
        "layout_artifact_count": normalization.layout_artifact_count,
        "html_tag_removed_count": normalization.html_tag_removed_count,
        "publication_imprint_removed_count": normalization.publication_imprint_removed_count,
        "soft_wrap_repair_count": normalization.soft_wrap_repair_count,
        "soft_wrap_residue_count": normalization.soft_wrap_residue_count,
        "readability_normalization_count": normalization.readability_normalization_count,
    }
    semantic_content_hash = _semantic_content_hash(title=title, canonical_body=canonical_body)
    common_metadata = regulation_common_metadata(
        title=title,
        title_base=title_info.base_title,
        title_raw=source_title_raw,
        normalizer_version=normalization.normalizer_version,
        cleaning_policy_version=cleaning_policy_version,
        normalization_quality=normalization_quality,
        extra_metadata={
            "source_channel": "official_web",
            "source_url": source_url,
            "site_id": _optional_text(candidate.get("site_id")),
            "host": _optional_text(candidate.get("host")),
            "page_family": _optional_text(candidate.get("page_family")) or "article_detail",
            "consumer_family": str(candidate.get("consumer_family") or "regulation_candidate"),
            "selected_write_target": _candidate_selected_write_target(candidate),
            "target_id": _optional_text(candidate.get("target_id")),
            "target_candidate_id": _optional_text(candidate.get("target_candidate_id")),
            "target_declaration_version": _optional_text(candidate.get("target_declaration_version")),
            "materialization_policy": _optional_text(candidate.get("materialization_policy")),
            "review_policy": _optional_text(candidate.get("review_policy")),
            "regulation_lane": "formal_regulation",
            "promotion_class": "formal_regulation",
            "source_version_evidence": {
                "raw_asset_id": raw_asset_id,
                "raw_version_id": raw_version_id,
                "candidate_key": _optional_text(candidate.get("candidate_key")),
            },
            **official_web_regulation_title_metadata(title_info),
        },
    )
    canonical_markdown = _render_canonical_markdown(
        title=title,
        source_url=source_url,
        canonical_body=canonical_body,
    )
    document_units_bytes = serialize_regulation_document_units(
        target_collection=target_collection,
        target_document_id=document_id,
        version_id=version_id,
        title=title,
        canonical_markdown=canonical_markdown,
        source_url=source_url,
        visibility_level="public",
        visibility_scope=None,
        entitlement_groups=[],
        common_metadata=common_metadata,
        semantic_content_hash=semantic_content_hash,
    )
    return {
        "document_id": document_id,
        "version_id": version_id,
        "title": title,
        "title_base": title_info.base_title,
        "title_raw": source_title_raw,
        "title_info": title_info,
        "source_url": source_url,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "target_corpus": target_corpus,
        "target_collection": target_collection,
        "regulation_lines": regulation_lines,
        "canonical_body": canonical_body,
        "canonical_markdown": canonical_markdown,
        "document_units_bytes": document_units_bytes,
        "normalization_quality": normalization_quality,
        "normalizer_version": normalization.normalizer_version,
        "semantic_content_hash": semantic_content_hash,
        "common_metadata": common_metadata,
    }


def _build_raw_asset_record(
    *,
    candidate: dict[str, object],
    document: DocumentImportInput,
) -> RawAssetRecord:
    raw_asset_id = _require_text(candidate.get("raw_asset_id"), "raw_asset_id")
    raw_version_id = _require_text(candidate.get("raw_version_id"), "raw_version_id")
    source_url = _require_text(
        candidate.get("normalized_canonical_url"), "normalized_canonical_url"
    )
    response_hash = (
        _optional_text(candidate.get("response_body_hash"))
        or hashlib.sha256(source_url.encode("utf-8")).hexdigest()
    )
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=document.corpus,
        collection=document.collection,
        raw_source_uri=source_url,
        content_hash=response_hash,
        source_filename=f"{raw_asset_id}.html",
        object_key=_optional_text(candidate.get("response_html_object_key"))
        or f"official_web/{raw_asset_id}/{raw_version_id}/capture/response.html",
        ingestion_timestamp=_optional_text(candidate.get("fetched_at"))
        or "1970-01-01T00:00:00+00:00",
        import_source=_IMPORT_SOURCE,
        content_type="text/html",
        asset_kind="official_web_page",
    )


def _build_report(
    *,
    candidates: tuple[dict[str, object], ...],
    candidate_count: int,
    document_registry: DocumentRegistry,
    materialized_scopes: tuple[str, ...],
    object_store: ObjectStoreWriter,
    object_store_settings: ObjectStoreSettings,
    stats: PersistImportStats,
    projection_report_path: Path,
    source_urls: tuple[str, ...],
) -> OfficialWebRegulationMaterializationReport:
    materialized_documents = _build_materialized_document_reports(
        candidates=candidates,
        document_registry=document_registry,
        object_store=object_store,
        bucket_derived=object_store_settings.bucket_derived,
    )
    return OfficialWebRegulationMaterializationReport(
        candidate_count=candidate_count,
        materialized_document_count=stats.success_count,
        materialized_scopes=materialized_scopes,
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        skipped_document_ids=stats.skipped_document_ids,
        document_ids=stats.document_ids,
        selected_target_document_ids=tuple(
            str(item["target_document_id"]) for item in materialized_documents
        ),
        materialized_documents=materialized_documents,
        source_urls=source_urls,
        import_failed_count=stats.failed_count,
        errors=stats.errors,
        projection_report_path=str(projection_report_path.resolve()),
    )


def _materialize_candidates_by_scope(
    *,
    candidates: tuple[dict[str, object], ...],
    output_dir: Path,
    object_store: ObjectStoreWriter,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store_settings: ObjectStoreSettings,
    scope_refresh: bool,
) -> PersistImportStats:
    grouped: dict[tuple[str, str], list[dict[str, object]]] = {}
    for candidate in candidates:
        grouped.setdefault(_candidate_scope(candidate), []).append(candidate)

    success_count = 0
    skipped_count = 0
    failed_count = 0
    raw_uploaded_count = 0
    raw_reused_count = 0
    document_ids: list[str] = []
    created_document_ids: list[str] = []
    updated_document_ids: list[str] = []
    skipped_document_ids: list[str] = []
    errors: list[str] = []
    timestamp = ""

    for scope in sorted(grouped):
        scope_candidates = tuple(_dedupe_candidates_by_url(grouped[scope]))
        documents = [
            _build_document_import(candidate=candidate, output_dir=output_dir)
            for candidate in scope_candidates
        ]
        raw_records = tuple(
            _build_raw_asset_record(candidate=candidate, document=document)
            for candidate, document in zip(scope_candidates, documents, strict=True)
        )
        for raw_record in raw_records:
            raw_asset_registry.upsert(raw_record)
        runtime_profile = load_runtime_profile(*scope)
        stats = collect_import_document_stats(
            documents=documents,
            registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            writer=object_store,
            object_store=object_store_settings,
            parser_version=_PARSER_VERSION,
            embedding_model=_EMBEDDING_MODEL,
            cleaning_policy_version=runtime_profile.cleaning_policy_version
            or _CLEANING_POLICY_VERSION,
            default_visibility_scope=None,
            scope_refresh=scope if scope_refresh else None,
        )
        success_count += stats.success_count
        skipped_count += stats.skipped_count
        failed_count += stats.failed_count
        raw_uploaded_count += stats.raw_uploaded_count
        raw_reused_count += stats.raw_reused_count
        document_ids.extend(stats.document_ids)
        created_document_ids.extend(stats.created_document_ids)
        updated_document_ids.extend(stats.updated_document_ids)
        skipped_document_ids.extend(stats.skipped_document_ids)
        errors.extend(stats.errors)
        if stats.timestamp:
            timestamp = stats.timestamp

    return PersistImportStats(
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=tuple(document_ids),
        unresolved_source_pdfs=(),
        errors=tuple(errors),
        timestamp=timestamp,
        created_document_ids=tuple(created_document_ids),
        updated_document_ids=tuple(updated_document_ids),
        skipped_document_ids=tuple(skipped_document_ids),
    )


def _build_materialized_document_reports(
    *,
    candidates: tuple[dict[str, object], ...],
    document_registry: DocumentRegistry,
    object_store: ObjectStoreWriter,
    bucket_derived: str,
) -> tuple[dict[str, object], ...]:
    reports: list[dict[str, object]] = []
    for candidate in candidates:
        projection = _candidate_document_projection(candidate)
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
