from __future__ import annotations

from pathlib import Path

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.campusrag_ingestion_reporting import (
    ImportReport,
    write_import_report,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry

from campus_ingestion_worker.official_web_handoff_consumer_io import (
    optional_text,
    read_json,
    require_object,
    require_text,
    utcnow,
)
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    OfficialWebDerivedObjectStore,
    OfficialWebHandoffConsumeError,
    OfficialWebSourceObjectStore,
)
from campus_ingestion_worker.official_web_projection_import import import_projection_output


def persist_projection_output(
    *,
    work_dir: Path,
    projection_output_dir: Path,
    replay_input_dir: Path,
    bundle_payload: dict[str, object],
    source_object_store: OfficialWebSourceObjectStore,
    derived_object_store: OfficialWebDerivedObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store_settings: ObjectStoreSettings,
):
    if not isinstance(bundle_payload.get("pages"), list):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="bundle pages must be an array.",
        )
    scope_refreshes = resolve_promotable_scope_refreshes(projection_output_dir)
    if not scope_refreshes:
        raise OfficialWebHandoffConsumeError(
            code="missing_promotable_projection_scope",
            message="projection report contains no promotable official_web target scope.",
        )
    reports = [
        import_projection_output(
            work_dir=work_dir,
            projection_output_dir=projection_output_dir,
            replay_input_dir=replay_input_dir,
            source_object_store=source_object_store,
            derived_object_store=derived_object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            object_store_settings=object_store_settings,
            scope_refresh=scope_refresh,
            require_promotable=True,
        )
        for scope_refresh in scope_refreshes
    ]
    return merge_import_reports(work_dir=work_dir, reports=reports)


def resolve_promotable_scope_refreshes(projection_output_dir: Path) -> tuple[tuple[str, str], ...]:
    projection_report = read_json(projection_output_dir / "projection-report.json")
    raw_documents = projection_report.get("documents")
    if not isinstance(raw_documents, list):
        raise OfficialWebHandoffConsumeError(
            code="invalid_projection_report",
            message="projection report documents must be an array.",
        )

    scope_refreshes: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw_document in raw_documents:
        document = require_object(raw_document, "documents[]")
        if optional_text(document.get("serving_intent")) != "promotable":
            continue
        scope_refresh = (
            require_text(document.get("target_corpus"), "documents[].target_corpus"),
            require_text(document.get("target_collection"), "documents[].target_collection"),
        )
        if scope_refresh in seen:
            continue
        seen.add(scope_refresh)
        scope_refreshes.append(scope_refresh)
    return tuple(scope_refreshes)


def merge_import_reports(*, work_dir: Path, reports: list[ImportReport]) -> ImportReport:
    if len(reports) == 1:
        return reports[0]
    return write_import_report(
        import_mode="official_web_source_truth_replay_multi_scope",
        report_dir=work_dir / "import-reports",
        report_prefix="official-web-import-multi-scope",
        success_count=sum(report.success_count for report in reports),
        skipped_count=sum(report.skipped_count for report in reports),
        failed_count=sum(report.failed_count for report in reports),
        raw_uploaded_count=sum(report.raw_uploaded_count for report in reports),
        raw_reused_count=sum(report.raw_reused_count for report in reports),
        document_ids=tuple(
            document_id for report in reports for document_id in report.document_ids
        ),
        created_document_ids=tuple(
            document_id for report in reports for document_id in report.created_document_ids
        ),
        updated_document_ids=tuple(
            document_id for report in reports for document_id in report.updated_document_ids
        ),
        skipped_document_ids=tuple(
            document_id for report in reports for document_id in report.skipped_document_ids
        ),
        unresolved_source_pdfs=tuple(
            source_pdf for report in reports for source_pdf in report.unresolved_source_pdfs
        ),
        errors=tuple(error for report in reports for error in report.errors),
        timestamp=utcnow(),
    )
