from __future__ import annotations

import json
import os
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import campus_ingestion_core.internal_notice_regulation_promotion_shared as shared
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.collection_config import resolve_collection_truth_config
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.internal_notice_regulation_promotion_artifacts import (
    _build_candidate_artifact_document,
    _render_candidate_artifact_markdown,
)
from campus_ingestion_core.internal_notice_regulation_promotion_scan import (
    _apply_duplicate_resolution,
    _apply_required_quality_gate_enforcement,
    _build_attachment_plan_index,
    _build_materialized_attachment_ref_index,
    _extract_notice_id,
    _filter_selected_records,
    _scan_document,
    _select_latest_scope_records,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticePromotionObjectStore,
    InternalNoticePromotionRoutingClassConfig,
    InternalNoticePromotionRoutingConfig,
    InternalNoticeRegulationCandidateArtifactManifest,
    InternalNoticeRegulationCandidateArtifactRef,
    InternalNoticeRegulationPromotionManifestReport,
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


def build_internal_notice_regulation_promotion_manifest(
    *,
    request: InternalNoticeRegulationPromotionRequest,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticePromotionObjectStore | None = None,
) -> InternalNoticeRegulationPromotionManifestReport:
    if (request.corpus, request.collection) != shared._INTERNAL_NOTICE_SCOPE:
        raise ValueError(
            "internal notice regulation promotion only supports campus_notices/internal_notice"
        )
    source = env if env is not None else dict(os.environ)
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_inventory = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(source)
    )
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    routing = load_internal_notice_promotion_routing_config(
        request.promotion_routing_path or read_internal_notice_promotion_routing_path(source)
    )
    target_profile = load_runtime_profile(routing.target_corpus, routing.target_collection)
    bucket_source, bucket_derived = resolve_object_store_bucket_names(source)
    scope_records = _select_latest_scope_records(
        runtime_registry.list_by_scope(request.corpus, request.collection)
    )
    selected_records = _filter_selected_records(
        scope_records,
        notice_ids=request.notice_ids,
        document_ids=request.document_ids,
    )
    notice_ids = tuple(
        sorted({_extract_notice_id(record.document_id) for record in selected_records})
    )
    inventory_entries = runtime_inventory.list_by_scope(
        request.corpus,
        request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    attachment_plan_by_ref = _build_attachment_plan_index(inventory_entries)
    materialized_attachment_refs_by_notice = _build_materialized_attachment_ref_index(scope_records)

    reports = tuple(
        _scan_document(
            record=record,
            bucket_derived=bucket_derived,
            object_store=runtime_object_store,
            routing=routing,
            inventory_entry=inventory_by_notice.get(_extract_notice_id(record.document_id)),
            attachment_plan_by_ref=attachment_plan_by_ref,
            bucket_source=bucket_source,
            materialized_attachment_refs_by_notice=materialized_attachment_refs_by_notice,
        )
        for record in selected_records
    )
    reports = _apply_duplicate_resolution(reports)
    reports = _apply_required_quality_gate_enforcement(reports, routing=routing)

    promotion_class_counts: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()
    lane_counts: Counter[str] = Counter()
    candidate_count = 0
    hold_count = 0
    machine_processing_required_count = 0
    for report in reports:
        promotion_class_counts[report.promotion_class] += 1
        action_counts[report.action] += 1
        lane_counts[report.input_lane] += 1
        if report.action == "promote_candidate":
            candidate_count += 1
        elif (
            report.action == shared.INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING
        ):
            machine_processing_required_count += 1
        else:
            hold_count += 1

    return InternalNoticeRegulationPromotionManifestReport(
        corpus=request.corpus,
        collection=request.collection,
        target_corpus=routing.target_corpus,
        target_collection=routing.target_collection,
        target_serving_stage=target_profile.serving_stage,
        registry_record_count=len(scope_records),
        selected_record_count=len(selected_records),
        selected_notice_ids=notice_ids,
        selected_document_ids=request.document_ids,
        scanned_document_count=len(reports),
        candidate_count=candidate_count,
        hold_count=hold_count,
        machine_processing_required_count=machine_processing_required_count,
        promotion_class_counts=dict(sorted(promotion_class_counts.items())),
        action_counts=dict(sorted(action_counts.items())),
        lane_counts=dict(sorted(lane_counts.items())),
        documents=reports,
    )


def build_internal_notice_regulation_candidate_artifact_manifest(
    *,
    request: InternalNoticeRegulationPromotionRequest,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticePromotionObjectStore | None = None,
) -> tuple[
    InternalNoticeRegulationCandidateArtifactManifest,
    tuple[shared.InternalNoticeRegulationCandidateArtifactDocument, ...],
]:
    if (request.corpus, request.collection) != shared._INTERNAL_NOTICE_SCOPE:
        raise ValueError(
            "internal notice regulation candidate artifacts only support campus_notices/internal_notice"
        )
    source = env if env is not None else dict(os.environ)
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_inventory = (
        source_truth_inventory_store
        or build_authenticated_notice_source_truth_inventory_store_from_env(source)
    )
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    scope_records = _select_latest_scope_records(
        runtime_registry.list_by_scope(request.corpus, request.collection)
    )
    selected_records = _filter_selected_records(
        scope_records,
        notice_ids=request.notice_ids,
        document_ids=request.document_ids,
    )
    record_by_document_id = {record.document_id: record for record in selected_records}
    notice_ids = tuple(
        sorted({_extract_notice_id(record.document_id) for record in selected_records})
    )
    inventory_entries = runtime_inventory.list_by_scope(
        request.corpus,
        request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    report = build_internal_notice_regulation_promotion_manifest(
        request=request,
        env=source,
        registry=runtime_registry,
        source_truth_inventory_store=runtime_inventory,
        object_store=runtime_object_store,
    )

    candidate_documents: list[shared.InternalNoticeRegulationCandidateArtifactDocument] = []
    candidate_refs: list[InternalNoticeRegulationCandidateArtifactRef] = []
    for document_report in report.documents:
        if document_report.action != "promote_candidate":
            continue
        source_record = record_by_document_id.get(document_report.document_id)
        if source_record is None:
            raise ValueError(
                f"candidate artifact export requires selected registry record: {document_report.document_id}"
            )
        inventory_entry = inventory_by_notice.get(document_report.notice_id)
        candidate_document = _build_candidate_artifact_document(
            report=document_report,
            record=source_record,
            inventory_entry=inventory_entry,
            object_store=runtime_object_store,
            bucket_derived=bucket_derived,
        )
        candidate_documents.append(candidate_document)
        candidate_refs.append(
            InternalNoticeRegulationCandidateArtifactRef(
                candidate_id=candidate_document.candidate_id,
                source_document_id=candidate_document.source_document_id,
                artifact_markdown_path=candidate_document.artifact_markdown_path,
            )
        )

    manifest = InternalNoticeRegulationCandidateArtifactManifest(
        schema_version="internal_notice_promotion_candidate_artifact_v1",
        exported_at=datetime.now(UTC).isoformat(),
        corpus=report.corpus,
        collection=report.collection,
        target_corpus=report.target_corpus,
        target_collection=report.target_collection,
        source_manifest_candidate_count=report.candidate_count,
        exported_candidate_count=len(candidate_documents),
        selected_notice_ids=report.selected_notice_ids,
        selected_document_ids=report.selected_document_ids,
        documents=tuple(candidate_refs),
    )
    return manifest, tuple(candidate_documents)


def export_internal_notice_regulation_candidate_artifacts(
    *,
    output_dir: Path,
    manifest: InternalNoticeRegulationCandidateArtifactManifest,
    documents: Sequence[shared.InternalNoticeRegulationCandidateArtifactDocument],
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "promotion-candidate-manifest.json"
    documents_path = output_dir / "candidate-documents.jsonl"
    for document in documents:
        candidate_markdown_path = output_dir / document.artifact_markdown_path
        candidate_markdown_path.parent.mkdir(parents=True, exist_ok=True)
        candidate_markdown_path.write_text(
            _render_candidate_artifact_markdown(document),
            encoding="utf-8",
        )
    manifest_path.write_text(
        json.dumps(asdict(manifest), ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    with documents_path.open("w", encoding="utf-8") as handle:
        for document in documents:
            handle.write(json.dumps(asdict(document), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    return manifest_path, documents_path


def export_internal_notice_regulation_promotion_manifest(
    *,
    output_dir: Path,
    report: InternalNoticeRegulationPromotionManifestReport,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "promotion-manifest.json"
    document_reports_path = output_dir / "document-reports.jsonl"
    payload = asdict(report)
    documents = payload.pop("documents")
    payload["document_report_count"] = len(documents)
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    with document_reports_path.open("w", encoding="utf-8") as handle:
        for document in report.documents:
            handle.write(json.dumps(asdict(document), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    return manifest_path, document_reports_path


def read_internal_notice_promotion_routing_path(env: dict[str, str] | None = None) -> Path:
    del env
    config = resolve_collection_truth_config(*shared._INTERNAL_NOTICE_SCOPE)
    path = config.config_root / "promotion-routing.v1.json"
    if not path.exists():
        raise ValueError(f"promotion routing config not found: {path}")
    return path


def load_internal_notice_promotion_routing_config(
    path: Path | str,
) -> InternalNoticePromotionRoutingConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    promotion_classes = {
        key: InternalNoticePromotionRoutingClassConfig(
            promotion_class=key,
            admission_goal=shared._optional_text(value.get("admission_goal")),
            accepted_revision_tracks=tuple(
                str(item) for item in value.get("accepted_revision_tracks") or ()
            ),
            required_quality_gates=tuple(
                str(item) for item in value.get("required_quality_gates") or ()
            ),
            default_action=shared._optional_text(value.get("default_action")),
            reason=shared._optional_text(value.get("reason")),
        )
        for key, value in dict(payload.get("promotion_classes") or {}).items()
    }
    return InternalNoticePromotionRoutingConfig(
        schema_version=str(payload.get("schema_version") or ""),
        source_corpus=str(payload.get("source_corpus") or ""),
        source_collection=str(payload.get("source_collection") or ""),
        target_corpus=str(payload.get("target_corpus") or ""),
        target_collection=str(payload.get("target_collection") or ""),
        document_nature_target_collections={
            str(key).strip(): str(value).strip()
            for key, value in dict(payload.get("document_nature_target_collections") or {}).items()
            if str(key).strip() and str(value).strip()
        },
        default_action=str(payload.get("default_action") or "hold_in_internal_notice"),
        accepted_input_lanes=tuple(str(item) for item in payload.get("accepted_input_lanes") or ()),
        terminal_outcomes_excluded_from_promotion=tuple(
            str(item) for item in payload.get("terminal_outcomes_excluded_from_promotion") or ()
        ),
        promotion_classes=promotion_classes,
        required_promotion_metadata=tuple(
            str(item) for item in payload.get("required_promotion_metadata") or ()
        ),
        identity_rules=dict(payload.get("identity_rules") or {}),
        notes=tuple(str(item) for item in payload.get("notes") or ()),
    )
