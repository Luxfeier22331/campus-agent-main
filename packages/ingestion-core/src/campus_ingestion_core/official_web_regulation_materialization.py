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
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import build_document_artifact_key
from campus_ingestion_core.official_web_projection import replay_official_web_source_truth_local
from campus_ingestion_core.official_web_regulation_titles import (
    NormalizedOfficialWebRegulationTitle,
    normalize_official_web_regulation_title,
    official_web_regulation_title_metadata,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings

_TARGET_CORPUS = "regulations"
_IMPORT_SOURCE = "official_web_regulation_source_truth_materialization"
_PARSER_VERSION = "official_web_regulation_materialization.v1"
_NORMALIZER_VERSION = "official_web_regulation_normalizer.v1"
_DOCUMENT_UNITS_SCHEMA_VERSION = "official_web_regulation_document_units.v1"
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
    typed_candidate = _require_dict(candidate.get("typed_candidate"), "typed_candidate")
    title_info = normalize_official_web_regulation_title(
        _require_text(typed_candidate.get("reference_title"), "reference_title")
    )
    title = title_info.display_title
    source_url = _require_text(
        candidate.get("normalized_canonical_url"), "normalized_canonical_url"
    )
    raw_asset_id = _require_text(candidate.get("raw_asset_id"), "raw_asset_id")
    raw_version_id = _require_text(candidate.get("raw_version_id"), "raw_version_id")
    body_lines = _normalize_regulation_lines(
        str(typed_candidate.get("regulation_text") or ""), title_info=title_info
    )
    if not body_lines:
        raise ValueError(f"missing regulation body text for {source_url}")
    document_id = _build_document_id(source_url=source_url)
    version_id = _build_version_id(
        raw_version_id=raw_version_id,
        source_url=source_url,
        title=title,
        body_lines=body_lines,
    )
    units = _build_document_units(
        body_lines=body_lines,
        candidate=candidate,
        document_id=document_id,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_url=source_url,
        title=title,
        title_info=title_info,
        version_id=version_id,
    )
    document_units_bytes = (
        "\n".join(json.dumps(unit, ensure_ascii=False, sort_keys=True) for unit in units) + "\n"
    ).encode("utf-8")
    canonical_markdown = _render_canonical_markdown(
        title=title,
        source_url=source_url,
        body_lines=body_lines,
    )
    metadata = dict(units[0]["metadata"])
    metadata.update(
        {
            "document_id": document_id,
            "version_id": version_id,
            "source_url": source_url,
            "source_pdf": f"official_web:{source_url}",
            "title": title,
            "title_base": title_info.base_title,
            "title_raw": title_info.raw_title,
            "semantic_content_hash": _semantic_content_hash(title=title, body_lines=body_lines),
            "entitlement_groups": [],
            "visibility_scope": None,
            "visibility_level": "public",
        }
    )
    metadata.update(official_web_regulation_title_metadata(title_info))
    target_corpus, target_collection = _candidate_scope(candidate)
    runtime_profile = load_runtime_profile(target_corpus, target_collection)
    metadata["cleaning_policy_version"] = (
        runtime_profile.cleaning_policy_version or _CLEANING_POLICY_VERSION
    )
    return DocumentImportInput(
        source_label=title,
        document_units_bytes=document_units_bytes,
        provider_response_bytes=_read_provider_bytes(
            output_dir=output_dir,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
        ),
        canonical_markdown_bytes=canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source=_IMPORT_SOURCE,
        revision_track="current-effective",
        source_channel="official_web",
        is_current=True,
        corpus=target_corpus,
        collection=target_collection,
        raw_source_uri=source_url,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        provider_response_object_key=_optional_text(
            candidate.get("provider_extraction_object_key")
        ),
        additional_processed_object_keys=_source_truth_object_keys(candidate),
        title=title,
        year=_year_from_candidate(candidate),
    )


def _build_document_units(
    *,
    body_lines: tuple[str, ...],
    candidate: dict[str, object],
    document_id: str,
    raw_asset_id: str,
    raw_version_id: str,
    source_url: str,
    title: str,
    title_info: NormalizedOfficialWebRegulationTitle,
    version_id: str,
) -> tuple[dict[str, object], ...]:
    base_metadata = {
        "title": title,
        "title_base": title_info.base_title,
        "title_raw": title_info.raw_title,
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
        "normalizer_version": _NORMALIZER_VERSION,
        "cleaning_policy_version": _candidate_cleaning_policy_version(candidate),
        "document_units_schema_version": _DOCUMENT_UNITS_SCHEMA_VERSION,
        "normalization_quality": {
            "quality_verdict": "passed",
            "cleaning_policy_version": _candidate_cleaning_policy_version(candidate),
            "normalizer_version": _NORMALIZER_VERSION,
        },
        "regulation_lane": "formal_regulation",
        "promotion_class": "formal_regulation",
        "content_role": "formal_regulation",
        "is_answer_bearing": True,
        "source_version_evidence": {
            "raw_asset_id": raw_asset_id,
            "raw_version_id": raw_version_id,
            "candidate_key": _optional_text(candidate.get("candidate_key")),
        },
    }
    base_metadata.update(official_web_regulation_title_metadata(title_info))
    units: list[dict[str, object]] = []
    for index, unit_lines in enumerate(_group_regulation_lines(body_lines), start=1):
        text = "\n".join(unit_lines).strip()
        row_ids = _candidate_row_ids(candidate)
        units.append(
            {
                "doc_id": document_id,
                "version_id": version_id,
                "chunk_id": f"{document_id}:unit-{index:04d}",
                "root_unit_id": f"{document_id}:root-{index:04d}",
                "unit_type": "section_text",
                "clean_text": text,
                "source_pdf": f"official_web:{source_url}",
                "source_url": source_url,
                "source_md": None,
                "source": {"id": source_url},
                "page_start": 1,
                "page_end": 1,
                "anchor": {
                    "page_start": 1,
                    "page_end": 1,
                    "normalized_canonical_url": source_url,
                    "page_family": base_metadata["page_family"],
                    "section_path": [title],
                    "row_ids": row_ids,
                },
                "metadata": {
                    **base_metadata,
                    "unit_index": index,
                    "semantic_content_hash": _semantic_content_hash(
                        title=title,
                        body_lines=unit_lines,
                    ),
                },
                "table_cells": None,
            }
        )
    return tuple(units)


def _candidate_document_projection(candidate: dict[str, object]) -> dict[str, object]:
    typed_candidate = _require_dict(candidate.get("typed_candidate"), "typed_candidate")
    title_info = normalize_official_web_regulation_title(
        _require_text(typed_candidate.get("reference_title"), "reference_title")
    )
    title = title_info.display_title
    source_url = _require_text(
        candidate.get("normalized_canonical_url"), "normalized_canonical_url"
    )
    raw_version_id = _require_text(candidate.get("raw_version_id"), "raw_version_id")
    body_lines = _normalize_regulation_lines(
        str(typed_candidate.get("regulation_text") or ""), title_info=title_info
    )
    document_id = _build_document_id(source_url=source_url)
    version_id = _build_version_id(
        raw_version_id=raw_version_id,
        source_url=source_url,
        title=title,
        body_lines=body_lines,
    )
    return {
        "document_id": document_id,
        "version_id": version_id,
        "title": title,
        "title_base": title_info.base_title,
        "title_raw": title_info.raw_title,
        **official_web_regulation_title_metadata(title_info),
        "target_corpus": _candidate_scope(candidate)[0],
        "target_collection": _candidate_scope(candidate)[1],
        "normalized_canonical_url": source_url,
        "raw_asset_id": candidate.get("raw_asset_id"),
        "raw_version_id": raw_version_id,
        "canonical_markdown_object_key": build_document_artifact_key(
            corpus=_candidate_scope(candidate)[0],
            collection=_candidate_scope(candidate)[1],
            document_id=document_id,
            revision_track="current-effective",
            version_id=version_id,
            filename="canonical.md",
            title=title,
            year=_year_from_candidate(candidate),
        ),
        "document_units_object_key": build_document_artifact_key(
            corpus=_candidate_scope(candidate)[0],
            collection=_candidate_scope(candidate)[1],
            document_id=document_id,
            revision_track="current-effective",
            version_id=version_id,
            filename="document-units.jsonl",
            title=title,
            year=_year_from_candidate(candidate),
        ),
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
                candidate=candidate,
                projection=projection,
                record=record,
                object_store=object_store,
                bucket_derived=bucket_derived,
            )
        )
    return tuple(reports)


def _materialized_document_report(
    *,
    candidate: dict[str, object],
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
    typed_candidate = _require_dict(candidate.get("typed_candidate"), "typed_candidate")
    title_info = normalize_official_web_regulation_title(
        _require_text(typed_candidate.get("reference_title"), "reference_title")
    )
    return {
        "target_document_id": record.document_id,
        "target_corpus": record.corpus,
        "target_collection": record.collection,
        "version_id": record.version_id,
        "content_hash": record.content_hash,
        "cleaning_policy_version": record.cleaning_policy_version,
        "normalizer_version": _NORMALIZER_VERSION,
        "normalization_quality": {
            "quality_verdict": "passed",
            "title_raw": title_info.raw_title,
            "title_display": title_info.display_title,
            "title_base": title_info.base_title,
            "title_source_marker": title_info.source_title_marker,
            "title_status_qualifier": title_info.status_qualifier,
            "title_status_kind": title_info.status_kind,
            "source_url": str(projection["normalized_canonical_url"]),
            "raw_asset_id": candidate.get("raw_asset_id"),
            "raw_version_id": candidate.get("raw_version_id"),
        },
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


def _candidate_cleaning_policy_version(candidate: dict[str, object]) -> str:
    target_corpus, target_collection = _candidate_scope(candidate)
    runtime_profile = load_runtime_profile(target_corpus, target_collection)
    return runtime_profile.cleaning_policy_version or _CLEANING_POLICY_VERSION


def _normalize_regulation_lines(
    text: str, *, title_info: NormalizedOfficialWebRegulationTitle | None = None
) -> tuple[str, ...]:
    lines = tuple(line.strip() for line in text.splitlines() if line.strip())
    if title_info is None:
        return lines
    title_line_keys = _title_line_keys(title_info)
    while lines and _regulation_line_key(lines[0]) in title_line_keys:
        lines = lines[1:]
    return lines


def _title_line_keys(title_info: NormalizedOfficialWebRegulationTitle) -> frozenset[str]:
    titles = {
        title_info.raw_title,
        title_info.display_title,
        title_info.base_title,
    }
    if title_info.source_title_marker is not None:
        titles.add(f"{title_info.display_title}（{title_info.source_title_marker}）")
        titles.add(f"{title_info.base_title}（{title_info.source_title_marker}）")
    return frozenset(_regulation_line_key(title) for title in titles if title.strip())


def _regulation_line_key(value: str) -> str:
    title_info = normalize_official_web_regulation_title(value)
    return title_info.display_title.replace(" ", "")


def _group_regulation_lines(
    lines: tuple[str, ...], *, max_lines: int = 4
) -> tuple[tuple[str, ...], ...]:
    groups: list[tuple[str, ...]] = []
    buffer: list[str] = []
    for line in lines:
        if buffer and _looks_like_article_start(line):
            groups.append(tuple(buffer))
            buffer = []
        buffer.append(line)
        if len(buffer) >= max_lines:
            groups.append(tuple(buffer))
            buffer = []
    if buffer:
        groups.append(tuple(buffer))
    return tuple(groups)


def _looks_like_article_start(line: str) -> bool:
    return bool(line.startswith("第") and "条" in line[:12])


def _render_canonical_markdown(*, title: str, source_url: str, body_lines: tuple[str, ...]) -> str:
    return "\n".join(
        [
            f"# {title}",
            "",
            f"> Source URL: {source_url}",
            "",
            *body_lines,
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
    body_lines: tuple[str, ...],
) -> str:
    digest = hashlib.sha1(
        json.dumps(
            {
                "body": list(body_lines),
                "raw_version_id": raw_version_id,
                "source_url": source_url,
                "title": title,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return f"owregver:{digest}"


def _semantic_content_hash(*, title: str, body_lines: tuple[str, ...]) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {"title": title, "body": list(body_lines)},
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


def _candidate_row_ids(candidate: dict[str, object]) -> list[str]:
    spans = candidate.get("evidence_spans")
    if not isinstance(spans, list):
        return []
    row_ids: list[str] = []
    for span in spans:
        if not isinstance(span, dict):
            continue
        row_id = _optional_text(span.get("row_id") or span.get("rowId"))
        if row_id is not None:
            row_ids.append(row_id)
    return list(dict.fromkeys(row_ids))


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
