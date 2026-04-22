from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    serialize_handbook_document_units,
    validate_handbook_manifest_title,
)
from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
    build_handbook_service_navigation_hybrid_document,
    build_handbook_service_navigation_hybrid_document_from_projection_artifact,
    is_handbook_service_navigation_projection,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_processed_artifact_key,
    build_source_projection_artifact_key,
    infer_year_label,
)
from campus_ingestion_core.split_manifest import SplitManifestDocument

HANDBOOK_SOURCE_PROJECTIONS_SCHEMA_VERSION = "student_rules_source_projections_v1"


@dataclass(frozen=True, slots=True)
class HandbookSourceProjection:
    projection_name: str
    target_corpus: str
    target_collection: str
    projection_family: str
    replay_from_source_truth: bool
    derived_from: str
    derived_from_document_id: str | None
    parent_document_id: str | None
    attachment_kind: str | None
    attachment_role: str | None
    target_title: str | None = None
    migration_reason: str | None = None
    source_title: str | None = None
    source_handbook_section: str | None = None
    source_page_start: int | None = None
    source_page_end: int | None = None


@dataclass(frozen=True, slots=True)
class HandbookSourceProjectionsConfig:
    source_corpus: str
    source_collection: str
    raw_asset_id: str
    projections: tuple[HandbookSourceProjection, ...]


def read_handbook_source_projections_config_path(source: dict[str, str]) -> Path:
    value = (source.get("HANDBOOK_SOURCE_PROJECTIONS_PATH") or "").strip()
    if value:
        return Path(value)
    return (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "regulations"
        / "student_rules"
        / "source-projections.v1.json"
    )


def load_handbook_source_projections_config(path: Path) -> HandbookSourceProjectionsConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if str(payload.get("schema_version") or "") != HANDBOOK_SOURCE_PROJECTIONS_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported handbook source projections schema_version: {payload.get('schema_version')!r}"
        )
    projections = tuple(
        HandbookSourceProjection(
            projection_name=str(item.get("projection_name") or ""),
            target_corpus=str(item.get("target_corpus") or ""),
            target_collection=str(item.get("target_collection") or ""),
            projection_family=str(item.get("projection_family") or ""),
            replay_from_source_truth=bool(item.get("replay_from_source_truth", False)),
            derived_from=str(item.get("derived_from") or ""),
            derived_from_document_id=(
                str(item["derived_from_document_id"])
                if item.get("derived_from_document_id") is not None
                else None
            ),
            parent_document_id=(
                str(item["parent_document_id"])
                if item.get("parent_document_id") is not None
                else None
            ),
            attachment_kind=str(item["attachment_kind"])
            if item.get("attachment_kind") is not None
            else None,
            attachment_role=str(item["attachment_role"])
            if item.get("attachment_role") is not None
            else None,
            target_title=str(item["target_title"])
            if item.get("target_title") is not None
            else None,
            migration_reason=str(item["migration_reason"])
            if item.get("migration_reason") is not None
            else None,
            source_title=str(item["source_title"])
            if item.get("source_title") is not None
            else None,
            source_handbook_section=(
                str(item["source_handbook_section"])
                if item.get("source_handbook_section") is not None
                else None
            ),
            source_page_start=(
                int(item["source_page_start"])
                if item.get("source_page_start") is not None
                else None
            ),
            source_page_end=(
                int(item["source_page_end"]) if item.get("source_page_end") is not None else None
            ),
        )
        for item in list(payload.get("projections") or [])
    )
    return HandbookSourceProjectionsConfig(
        source_corpus=str(payload.get("source_corpus") or ""),
        source_collection=str(payload.get("source_collection") or ""),
        raw_asset_id=str(payload.get("raw_asset_id") or ""),
        projections=projections,
    )


def build_handbook_projection_import_documents(
    *,
    source: dict[str, str],
    config_path: Path | None = None,
    raw_asset_record: RawAssetRecord,
    hybrid_raw_asset_record: RawAssetRecord | None = None,
    provider_response_key: str,
    layout_elements_key: str,
    structured_rows: list[dict[str, object]],
    split_manifest_documents: tuple[SplitManifestDocument, ...],
    reader: object | None = None,
    source_bucket: str | None = None,
    import_source: str = "provider_response_replay",
) -> list[DocumentImportInput]:
    config = load_handbook_source_projections_config(
        config_path or read_handbook_source_projections_config_path(source)
    )
    manifest_by_document_id = {
        document.document_id: document for document in split_manifest_documents
    }
    source_pdf = raw_asset_record.source_filename
    documents: list[DocumentImportInput] = []
    for projection in config.projections:
        if (
            projection.target_corpus == config.source_corpus
            and projection.target_collection == config.source_collection
        ):
            continue
        manifest_document = _resolve_projection_source_document(
            projection=projection,
            manifest_by_document_id=manifest_by_document_id,
            split_manifest_documents=split_manifest_documents,
        )
        if manifest_document is None:
            continue
        try:
            validate_handbook_manifest_title(
                structured_rows=structured_rows, manifest_document=manifest_document
            )
        except ValueError:
            continue
        document_id = build_projection_target_document_id(projection=projection)
        if is_handbook_service_navigation_projection(
            projection_name=projection.projection_name,
            target_collection=projection.target_collection,
            attachment_role=projection.attachment_role,
            source_page_start=projection.source_page_start,
            source_page_end=projection.source_page_end,
        ):
            if reader is None or source_bucket is None:
                raise ValueError(
                    "service navigation hybrid materialization requires reader and source_bucket"
                )
            resolved_hybrid_raw_asset_record = _resolve_hybrid_raw_asset_record(
                raw_asset_record=raw_asset_record,
                hybrid_raw_asset_record=hybrid_raw_asset_record,
                import_source=import_source,
            )
            target_title = projection.target_title or manifest_document.title
            if import_source == "provider_response_replay":
                projection_artifact_key = build_source_projection_artifact_key(
                    raw_asset_id=resolved_hybrid_raw_asset_record.raw_asset_id,
                    raw_version_id=resolved_hybrid_raw_asset_record.raw_version_id,
                    projection_name=projection.projection_name,
                    filename="flow-graph.json",
                    year=infer_year_label(resolved_hybrid_raw_asset_record.source_filename),
                )
                try:
                    document = (
                        build_handbook_service_navigation_hybrid_document_from_projection_artifact(
                            reader=reader,  # type: ignore[arg-type]
                            source_bucket=source_bucket,
                            projection_artifact_key=projection_artifact_key,
                            raw_asset_record=resolved_hybrid_raw_asset_record,
                            source_document_id=manifest_document.document_id,
                            source_uri=manifest_document.source_uri or "",
                            source_handbook_section=manifest_document.handbook_section
                            or manifest_document.title,
                            target_document_id=document_id,
                            target_title=target_title,
                            projection_name=projection.projection_name,
                            derived_from=projection.derived_from,
                            parent_document_id=projection.parent_document_id
                            or manifest_document.document_id,
                            attachment_kind=projection.attachment_kind,
                            attachment_role=projection.attachment_role,
                            provider_response_key=provider_response_key,
                            layout_elements_key=layout_elements_key,
                            source_page_start=manifest_document.page_start,
                            source_page_end=manifest_document.page_end,
                            entitlement_groups=manifest_document.resolved_entitlement_groups(),
                            visibility_scope=manifest_document.resolved_visibility_scope(),
                            visibility_level=manifest_document.resolved_visibility_level(),
                            import_source=import_source,
                        )
                    )
                except Exception as exc:
                    raise ValueError(
                        "missing handbook service navigation projection artifact: "
                        f"{projection_artifact_key}"
                    ) from exc
            else:
                document = build_handbook_service_navigation_hybrid_document(
                    source=source,
                    reader=reader,  # type: ignore[arg-type]
                    source_bucket=source_bucket,
                    raw_asset_record=resolved_hybrid_raw_asset_record,
                    source_document_id=manifest_document.document_id,
                    source_uri=manifest_document.source_uri or "",
                    source_handbook_section=manifest_document.handbook_section
                    or manifest_document.title,
                    target_document_id=document_id,
                    target_title=target_title,
                    projection_name=projection.projection_name,
                    derived_from=projection.derived_from,
                    parent_document_id=projection.parent_document_id
                    or manifest_document.document_id,
                    attachment_kind=projection.attachment_kind,
                    attachment_role=projection.attachment_role,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    source_page_start=manifest_document.page_start,
                    source_page_end=manifest_document.page_end,
                    entitlement_groups=manifest_document.resolved_entitlement_groups(),
                    visibility_scope=manifest_document.resolved_visibility_scope(),
                    visibility_level=manifest_document.resolved_visibility_level(),
                    import_source=import_source,
                )
            metadata = load_metadata_from_bytes(document.document_units_bytes)
            metadata["title"] = target_title
            apply_authorization_projection_metadata(
                metadata,
                entitlement_groups=manifest_document.resolved_entitlement_groups(),
                visibility_scope=manifest_document.resolved_visibility_scope(),
                visibility_level=manifest_document.resolved_visibility_level(),
            )
            metadata["status"] = manifest_document.status
            documents.append(
                DocumentImportInput(
                    source_label=document.source_label,
                    document_units_bytes=document.document_units_bytes,
                    provider_response_bytes=None,
                    canonical_markdown_bytes=document.canonical_markdown_bytes,
                    metadata=metadata,
                    import_source=import_source,
                    revision_track=document.revision_track,
                    source_channel=document.source_channel,
                    is_current=document.is_current,
                    corpus=document.corpus,
                    collection=document.collection,
                    visibility_scope=document.visibility_scope,
                    status=manifest_document.status,
                    raw_path=None,
                    raw_source_uri=document.raw_source_uri,
                    raw_asset_id=document.raw_asset_id,
                    raw_version_id=document.raw_version_id,
                    provider_response_object_key=document.provider_response_object_key,
                    additional_processed_object_keys=document.additional_processed_object_keys,
                    additional_processed_artifacts=document.additional_processed_artifacts,
                    title=document.title,
                    year=document.year,
                )
            )
            continue
        cleanup_result = cleanup_handbook_document(
            structured_rows=structured_rows,
            manifest_document=manifest_document,
            source_doc=source_pdf,
        )
        target_title = projection.target_title or cleanup_result.title
        canonical_markdown = _render_canonical_markdown(
            metadata={
                "schema_version": 1,
                "doc_id": document_id,
                "corpus": projection.target_corpus,
                "collection": projection.target_collection,
                "title": target_title,
                "source_kind": "handbook_source_truth_projection",
                "source_doc": source_pdf,
                "handbook_section": manifest_document.handbook_section,
                "page_start": manifest_document.page_start,
                "page_end": manifest_document.page_end,
                "projection_name": projection.projection_name,
                "derived_from": projection.derived_from,
                "derived_from_document_id": manifest_document.document_id,
                "derived_from_raw_asset_id": raw_asset_record.raw_asset_id,
                "derived_from_raw_version_id": raw_asset_record.raw_version_id,
                "parent_document_id": projection.parent_document_id
                or manifest_document.document_id,
                "attachment_kind": projection.attachment_kind,
                "attachment_role": projection.attachment_role,
                "migration_reason": projection.migration_reason,
                "migration_source_corpus": config.source_corpus,
                "migration_source_collection": config.source_collection,
                "migration_source_document_id": manifest_document.document_id,
                "migration_source_raw_asset_id": raw_asset_record.raw_asset_id,
                "migration_source_raw_version_id": raw_asset_record.raw_version_id,
                "migration_source_provider_response_key": provider_response_key,
            },
            body=_retitle_markdown_heading(
                cleanup_result.canonical_markdown, cleanup_result.title, target_title
            ),
        )
        document_units_bytes = _build_handbook_derived_document_units_bytes(
            cleanup_result_document_units=cleanup_result.document_units,
            source_document_id=manifest_document.document_id,
            target_document_id=document_id,
            target_title=target_title,
            source_uri=manifest_document.source_uri,
            projection=projection,
            raw_asset_record=raw_asset_record,
        )
        metadata = load_metadata_from_bytes(document_units_bytes)
        metadata["title"] = target_title
        apply_authorization_projection_metadata(
            metadata,
            entitlement_groups=manifest_document.resolved_entitlement_groups(),
            visibility_scope=manifest_document.resolved_visibility_scope(),
            visibility_level=manifest_document.resolved_visibility_level(),
        )
        metadata["status"] = manifest_document.status
        documents.append(
            DocumentImportInput(
                source_label=f"{provider_response_key}#{projection.projection_name}",
                document_units_bytes=document_units_bytes,
                provider_response_bytes=None,
                canonical_markdown_bytes=canonical_markdown.encode("utf-8"),
                metadata=metadata,
                import_source=import_source,
                revision_track="source-faithful",
                source_channel="pdf_ocr",
                is_current=False,
                corpus=projection.target_corpus,
                collection=projection.target_collection,
                visibility_scope=manifest_document.resolved_visibility_scope(),
                status=manifest_document.status,
                raw_path=None,
                raw_source_uri=raw_asset_record.raw_source_uri,
                raw_asset_id=raw_asset_record.raw_asset_id,
                raw_version_id=raw_asset_record.raw_version_id,
                provider_response_object_key=provider_response_key,
                additional_processed_object_keys=(layout_elements_key,),
                title=target_title,
                year=_infer_year(source_pdf),
            )
        )
    return documents


def build_declared_projection_processed_keys(
    *,
    config: HandbookSourceProjectionsConfig,
    source_pdf: str,
) -> tuple[str, ...]:
    keys: list[str] = []
    year = _infer_year(source_pdf)
    for projection in config.projections:
        if (
            projection.target_corpus == config.source_corpus
            and projection.target_collection == config.source_collection
        ):
            continue
        document_id = build_projection_target_document_id(projection=projection)
        title = projection.target_title or projection.source_title
        if title is None:
            continue
        keys.append(
            build_processed_artifact_key(
                corpus=projection.target_corpus,
                collection=projection.target_collection,
                document_id=document_id,
                revision_track="source-faithful",
                version_id=_build_projection_placeholder_version_id(projection),
                filename="canonical.md",
                title=title,
                year=year,
            )
        )
        keys.append(
            build_processed_artifact_key(
                corpus=projection.target_corpus,
                collection=projection.target_collection,
                document_id=document_id,
                revision_track="source-faithful",
                version_id=_build_projection_placeholder_version_id(projection),
                filename="document-units.jsonl",
                title=title,
                year=year,
            )
        )
    return tuple(dict.fromkeys(keys))


def build_projection_target_document_id(*, projection: HandbookSourceProjection) -> str:
    if projection.source_title is not None:
        legacy_document_id = build_handbook_projection_source_document_id(projection=projection)
        return _build_campus_services_document_id(projection.target_collection, legacy_document_id)
    source_document_id = projection.derived_from_document_id or projection.parent_document_id
    if source_document_id:
        return _build_campus_services_document_id(projection.target_collection, source_document_id)
    if projection.source_title is None:
        raise ValueError("projection source_title is required when source document id is absent")
    legacy_document_id = build_handbook_projection_source_document_id(projection=projection)
    return _build_campus_services_document_id(projection.target_collection, legacy_document_id)


def build_handbook_projection_source_document_id(*, projection: HandbookSourceProjection) -> str:
    if projection.source_title is None:
        raise ValueError("projection source_title is required")
    return (
        "handbook:"
        + hashlib.sha1(
            _normalize_projection_source_title(projection.source_title).encode("utf-8")
        ).hexdigest()
    )


def _resolve_projection_source_document(
    *,
    projection: HandbookSourceProjection,
    manifest_by_document_id: dict[str, SplitManifestDocument],
    split_manifest_documents: tuple[SplitManifestDocument, ...],
) -> SplitManifestDocument | None:
    source_document_id = projection.derived_from_document_id or projection.parent_document_id
    if source_document_id:
        manifest_document = manifest_by_document_id.get(source_document_id)
        if manifest_document is not None:
            return manifest_document
    return _match_projection_source_document_from_selector(
        projection=projection,
        split_manifest_documents=split_manifest_documents,
    )


def _match_projection_source_document_from_selector(
    *,
    projection: HandbookSourceProjection,
    split_manifest_documents: tuple[SplitManifestDocument, ...],
) -> SplitManifestDocument | None:
    if projection.source_title is None:
        return None
    for document in split_manifest_documents:
        if projection.source_title != document.title:
            continue
        if (
            projection.source_handbook_section is not None
            and projection.source_handbook_section != document.handbook_section
        ):
            continue
        if (
            projection.source_page_start is not None
            and projection.source_page_start != document.page_start
        ):
            continue
        if (
            projection.source_page_end is not None
            and projection.source_page_end != document.page_end
        ):
            continue
        return document
    if projection.source_page_start is None or projection.source_page_end is None:
        return None
    return SplitManifestDocument(
        document_id=build_handbook_projection_source_document_id(projection=projection),
        title=projection.source_title,
        page_start=projection.source_page_start,
        page_end=projection.source_page_end,
        source_uri=(
            f"campus-agent://{HANDBOOK_SOURCE_PROJECTIONS_SCHEMA_VERSION}/"
            f"{projection.target_corpus}/{projection.target_collection}/{projection.projection_name}"
        ),
        handbook_section=projection.source_handbook_section or projection.source_title,
        status="active",
    )


def _build_projection_placeholder_version_id(projection: HandbookSourceProjection) -> str:
    seed = "|".join(
        [
            projection.projection_name,
            projection.target_collection,
            projection.target_title or "",
            projection.source_title or "",
            projection.source_handbook_section or "",
            str(projection.source_page_start or ""),
            str(projection.source_page_end or ""),
        ]
    )
    return f"projection:{hashlib.sha1(seed.encode('utf-8')).hexdigest()}"


def _resolve_hybrid_raw_asset_record(
    *,
    raw_asset_record: RawAssetRecord,
    hybrid_raw_asset_record: RawAssetRecord | None,
    import_source: str,
) -> RawAssetRecord:
    if import_source != "provider_response_replay":
        return hybrid_raw_asset_record or raw_asset_record
    if hybrid_raw_asset_record is None:
        raise ValueError("service navigation hybrid replay raw asset record is required")
    return hybrid_raw_asset_record


def _normalize_projection_source_title(value: str) -> str:
    return " ".join(value.split()).strip()


def _build_handbook_derived_document_units_bytes(
    *,
    cleanup_result_document_units: tuple[dict[str, object], ...] | list[dict[str, object]],
    source_document_id: str,
    target_document_id: str,
    target_title: str,
    source_uri: str,
    projection: HandbookSourceProjection,
    raw_asset_record: RawAssetRecord,
) -> bytes:
    original_bytes = serialize_handbook_document_units(cleanup_result_document_units)
    original_rows = [
        json.loads(line) for line in original_bytes.decode("utf-8").splitlines() if line.strip()
    ]
    original_version_id = str(original_rows[0]["version_id"])
    version_id = f"{original_version_id}:projection:{projection.projection_name}"
    rows: list[dict[str, object]] = []
    for row in original_rows:
        row["doc_id"] = target_document_id
        row["version_id"] = version_id
        row["source_url"] = source_uri
        row["source"] = {"id": source_uri}
        metadata = dict(row.get("metadata") or {})
        metadata["title"] = target_title
        metadata["projection_name"] = projection.projection_name
        metadata["derived_from"] = projection.derived_from
        metadata["derived_from_document_id"] = source_document_id
        metadata["derived_from_raw_asset_id"] = raw_asset_record.raw_asset_id
        metadata["derived_from_raw_version_id"] = raw_asset_record.raw_version_id
        metadata["parent_document_id"] = projection.parent_document_id or source_document_id
        if projection.attachment_kind is not None:
            metadata["attachment_kind"] = projection.attachment_kind
        if projection.attachment_role is not None:
            metadata["attachment_role"] = projection.attachment_role
        row["metadata"] = metadata
        rows.append(row)
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _retitle_markdown_heading(body: str, old_title: str, new_title: str) -> str:
    content = body
    if content.startswith("---\n"):
        lines = content.splitlines()
        for index, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                content = "\n".join(lines[index + 1 :]).lstrip("\n")
                break
    lines = content.splitlines()
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        if line.strip() == f"# {old_title}":
            lines[index] = f"# {new_title}"
            return "\n".join(lines).rstrip()
        break
    if not content.strip():
        return f"# {new_title}"
    return f"# {new_title}\n\n{content.lstrip()}".rstrip()


def _render_canonical_markdown(*, metadata: dict[str, object], body: str) -> str:
    lines = ["---"]
    for key, value in metadata.items():
        if value is None or value == "":
            continue
        lines.append(f"{key}: {_format_front_matter_value(value)}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def _format_front_matter_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in ["#", "[", "]", "{", "}", ","]) or text != text.strip():
        return json.dumps(text, ensure_ascii=False)
    return text


def _build_campus_services_document_id(collection: str, legacy_document_id: str) -> str:
    suffix = legacy_document_id.split(":")[-1].strip()
    if not suffix:
        raise ValueError("legacy_document_id suffix is required")
    return f"campus_services:{collection}:{suffix}"


def _infer_year(value: str) -> str:
    for year in ("2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017"):
        if year in value:
            return year
    return "undated"
