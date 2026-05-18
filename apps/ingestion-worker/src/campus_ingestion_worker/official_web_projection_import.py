from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict, replace
from datetime import UTC
from pathlib import Path
from typing import Protocol

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreBucketSettings,
    ObjectStoreSettings,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.campusrag_ingestion_reporting import write_import_report
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    load_metadata_from_bytes,
    persist_import_documents,
)
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry

from campus_ingestion_worker.env_bootstrap import load_worker_env

_PROMOTION_DISALLOWED_PAGE_FAMILIES = frozenset(
    {"listing_page", "generic_content_page", "dynamic_shell_page", "structural_shell_page"}
)


class OfficialWebProjectionSourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class OfficialWebProjectionDerivedObjectStore(Protocol):
    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import a local official_web projection output into registry current truth.",
    )
    parser.add_argument("--projection-output-dir", required=True)
    parser.add_argument("--replay-input-dir", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--source-bucket", default=DEFAULT_BUCKET_SOURCE)
    parser.add_argument("--require-promotable", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def import_projection_output(
    *,
    work_dir: Path,
    projection_output_dir: Path,
    replay_input_dir: Path,
    source_object_store: OfficialWebProjectionSourceObjectStore,
    derived_object_store: OfficialWebProjectionDerivedObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store_settings: ObjectStoreBucketSettings,
    scope_refresh: tuple[str, str] | None = None,
    require_promotable: bool = False,
    dry_run: bool = False,
) -> ImportReport:
    projection_report = _read_json(projection_output_dir / "projection-report.json")
    bundle_payload = _read_json(replay_input_dir / "source-truth-bundle.json")
    raw_pages = bundle_payload.get("pages")
    if not isinstance(raw_pages, list):
        raise ValueError("source-truth bundle pages must be an array.")

    page_by_identity = {
        (
            _require_text(page.get("rawAssetId"), "rawAssetId"),
            _require_text(page.get("rawVersionId"), "rawVersionId"),
        ): _require_object(page, "pages[]")
        for page in raw_pages
    }
    raw_documents = projection_report.get("documents")
    if not isinstance(raw_documents, list):
        raise ValueError("projection report documents must be an array.")
    if scope_refresh is not None:
        raw_documents = [
            raw_document
            for raw_document in raw_documents
            if _document_matches_scope_refresh(
                document=_require_object(raw_document, "documents[]"),
                scope_refresh=scope_refresh,
            )
        ]

    documents: list[DocumentImportInput] = []
    raw_asset_records: list[RawAssetRecord] = []
    skipped_non_promotable_document_ids: list[str] = []
    for raw_document in raw_documents:
        document = _require_object(raw_document, "documents[]")
        document_id = _require_text(document.get("document_id"), "documents[].document_id")
        raw_asset_id = _require_text(document.get("raw_asset_id"), "documents[].raw_asset_id")
        raw_version_id = _require_text(document.get("raw_version_id"), "documents[].raw_version_id")
        page = page_by_identity[(raw_asset_id, raw_version_id)]
        if require_promotable:
            import_action = _resolve_promotable_document_import_action(document=document)
            if import_action == "skip":
                skipped_non_promotable_document_ids.append(document_id)
                continue

        canonical_path = Path(
            _require_text(
                document.get("canonical_markdown_path"), "documents[].canonical_markdown_path"
            )
        )
        document_units_path = Path(
            _require_text(document.get("document_units_path"), "documents[].document_units_path")
        )
        document_units_bytes = document_units_path.read_bytes()
        metadata = load_metadata_from_bytes(document_units_bytes)
        provider_key = _optional_text(page.get("providerExtractionObjectKey"))
        provider_bytes = _load_provider_bytes(
            replay_input_dir=replay_input_dir,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            provider_key=provider_key,
            source_object_store=source_object_store,
            object_store_settings=object_store_settings,
        )
        documents.append(
            DocumentImportInput(
                source_label=document_id,
                document_units_bytes=document_units_bytes,
                provider_response_bytes=provider_bytes,
                canonical_markdown_bytes=canonical_path.read_bytes(),
                metadata=metadata,
                import_source="official_web_source_truth_replay",
                source_channel="official_web",
                is_current=True,
                corpus=_require_text(document.get("target_corpus"), "documents[].target_corpus"),
                collection=_require_text(
                    document.get("target_collection"), "documents[].target_collection"
                ),
                raw_source_uri=_require_text(
                    document.get("normalized_canonical_url"),
                    "documents[].normalized_canonical_url",
                ),
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                provider_response_object_key=provider_key,
                additional_processed_object_keys=tuple(
                    key
                    for key in (
                        _optional_text(page.get("pageManifestObjectKey")),
                        _optional_text(page.get("contentBlocksObjectKey")),
                    )
                    if key is not None
                ),
                title=_require_text(document.get("title"), "documents[].title"),
            )
        )
        raw_asset_records.append(
            _build_official_web_raw_asset_record(
                bundle_page=page,
                document=documents[-1],
            )
        )

    if dry_run:
        document_ids = tuple(document.source_label for document in documents)
        skipped_document_ids = tuple(skipped_non_promotable_document_ids)
        return write_import_report(
            import_mode="official_web_source_truth_replay_dry_run",
            report_dir=work_dir / "import-reports",
            report_prefix="official-web-import-dry-run",
            success_count=len(document_ids),
            skipped_count=len(skipped_document_ids),
            failed_count=0,
            raw_uploaded_count=0,
            raw_reused_count=0,
            document_ids=document_ids,
            created_document_ids=document_ids,
            updated_document_ids=(),
            skipped_document_ids=skipped_document_ids,
            unresolved_source_pdfs=(),
            errors=(),
            timestamp=_utcnow(),
        )

    report = persist_import_documents(
        documents=documents,
        registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        writer=derived_object_store,
        object_store=object_store_settings,
        parser_version="official_web_projection_replay.v1",
        embedding_model="",
        cleaning_policy_version="official_web_cleaning_v2",
        default_visibility_scope=None,
        import_mode="official_web_source_truth_replay",
        report_dir=work_dir / "import-reports",
        report_prefix="official-web-import",
        scope_refresh=scope_refresh,
    )
    if scope_refresh is not None and report.failed_count == 0:
        refreshed_raw_records = tuple(
            sorted(
                {
                    (record.raw_asset_id, record.raw_version_id): record
                    for record in raw_asset_records
                }.values(),
                key=lambda record: (record.raw_asset_id, record.raw_version_id),
            )
        )
        replace_scope = getattr(raw_asset_registry, "replace_scope", None)
        if callable(replace_scope):
            replace_scope(scope_refresh[0], scope_refresh[1], refreshed_raw_records)
        else:
            raw_asset_registry.delete_by_scope(scope_refresh[0], scope_refresh[1])
            for record in refreshed_raw_records:
                raw_asset_registry.upsert(record)
    else:
        for record in raw_asset_records:
            raw_asset_registry.upsert(record)

    if skipped_non_promotable_document_ids:
        report = replace(
            report,
            skipped_count=report.skipped_count + len(skipped_non_promotable_document_ids),
            skipped_document_ids=tuple(
                list(report.skipped_document_ids) + skipped_non_promotable_document_ids
            ),
        )
        _rewrite_import_report(report)

    return report


def _build_official_web_raw_asset_record(
    *,
    bundle_page: dict[str, object],
    document: DocumentImportInput,
) -> RawAssetRecord:
    raw_asset_id = _require_text(bundle_page.get("rawAssetId"), "rawAssetId")
    raw_version_id = _require_text(bundle_page.get("rawVersionId"), "rawVersionId")
    object_key = _require_text(bundle_page.get("responseHtmlObjectKey"), "responseHtmlObjectKey")
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=document.corpus,
        collection=document.collection,
        raw_source_uri=document.raw_source_uri or f"official_web://{raw_asset_id}",
        content_hash=_require_text(bundle_page.get("responseBodyHash"), "responseBodyHash"),
        source_filename=Path(object_key).name,
        object_key=object_key,
        ingestion_timestamp=_utcnow(),
        import_source=document.import_source,
    )


def _resolve_promotable_document_import_action(*, document: dict[str, object]) -> str:
    page_family = _require_text(document.get("page_family"), "documents[].page_family")
    serving_intent = _require_text(document.get("serving_intent"), "documents[].serving_intent")
    materialization_policy = _optional_text(document.get("materialization_policy"))
    target_consumer_family = _optional_text(document.get("target_consumer_family"))
    if (
        materialization_policy == "inventory_only"
        or target_consumer_family == "notice_news_candidate"
    ):
        raise ValueError("inventory-only target documents cannot be promoted")
    if serving_intent == "promotable":
        if page_family in _PROMOTION_DISALLOWED_PAGE_FAMILIES:
            raise ValueError(f"non-promotable page family in projection report: {page_family}")
        return "import"
    if serving_intent == "audit_only":
        return "skip"
    raise ValueError(f"non-promotable serving_intent in projection report: {serving_intent}")


def _document_matches_scope_refresh(
    *,
    document: dict[str, object],
    scope_refresh: tuple[str, str],
) -> bool:
    return (
        _require_text(document.get("target_corpus"), "documents[].target_corpus")
        == scope_refresh[0]
        and _require_text(document.get("target_collection"), "documents[].target_collection")
        == scope_refresh[1]
    )


def _rewrite_import_report(report: ImportReport) -> None:
    payload = {
        "import_mode": report.import_mode,
        "success_count": report.success_count,
        "skipped_count": report.skipped_count,
        "failed_count": report.failed_count,
        "raw_uploaded_count": report.raw_uploaded_count,
        "raw_reused_count": report.raw_reused_count,
        "document_ids": list(report.document_ids),
        "created_document_ids": list(report.created_document_ids),
        "updated_document_ids": list(report.updated_document_ids),
        "skipped_document_ids": list(report.skipped_document_ids),
        "unresolved_source_pdfs": list(report.unresolved_source_pdfs),
        "errors": list(report.errors),
    }
    Path(report.report_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _load_provider_bytes(
    *,
    replay_input_dir: Path,
    raw_asset_id: str,
    raw_version_id: str,
    provider_key: str | None,
    source_object_store: OfficialWebProjectionSourceObjectStore,
    object_store_settings: ObjectStoreBucketSettings,
) -> bytes | None:
    local_provider_path = (
        replay_input_dir
        / "source-assets"
        / raw_asset_id
        / raw_version_id
        / "provider"
        / "cheerio-basic"
        / "page-extraction.json"
    )
    if local_provider_path.exists():
        return local_provider_path.read_bytes()
    if provider_key is None:
        return None
    return source_object_store.get_bytes(
        bucket=object_store_settings.bucket_source,
        key=provider_key,
    )


def _resolve_object_store_settings(*, source_bucket: str) -> ObjectStoreSettings:
    settings = ObjectStoreSettings.from_env()
    return ObjectStoreSettings(
        endpoint=settings.endpoint,
        access_key=settings.access_key,
        secret_key=settings.secret_key,
        region=settings.region,
        bucket_source=source_bucket,
        bucket_derived=settings.bucket_derived,
        secure=settings.secure,
    )


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON file must be an object: {path}")
    return payload


def _require_object(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object.")
    return value


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip()


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _utcnow() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat()


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    object_store_settings = _resolve_object_store_settings(source_bucket=args.source_bucket)
    object_store = S3ObjectStoreAdmin(object_store_settings)
    document_registry = (
        InMemoryDocumentRegistry()
        if args.dry_run
        else build_document_registry_from_env(prefer_operator=True)
    )
    raw_asset_registry = (
        InMemoryRawAssetRegistry()
        if args.dry_run
        else build_raw_asset_registry_from_env(prefer_operator=True)
    )
    report = import_projection_output(
        work_dir=Path(args.work_dir).resolve(),
        projection_output_dir=Path(args.projection_output_dir).resolve(),
        replay_input_dir=Path(args.replay_input_dir).resolve(),
        source_object_store=object_store,
        derived_object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store_settings=object_store_settings,
        scope_refresh=(args.corpus, args.collection),
        require_promotable=args.require_promotable,
        dry_run=args.dry_run,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["ObjectStoreSettings", "build_parser", "import_projection_output", "main"]


if __name__ == "__main__":
    main()
