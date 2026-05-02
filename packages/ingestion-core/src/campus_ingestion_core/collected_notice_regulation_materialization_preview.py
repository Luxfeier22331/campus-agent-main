from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    RegulationTextNormalizationResult,
    build_regulation_document_units,
    normalize_regulation_owner_text,
)

PHASE_06_R2_ID = "phase-06-r2-regulation-promotion-dry-run-and-gated-materialization"
PHASE_06_R3_ID = "phase-06-r3-regulation-normalization-quality-gate"

MATERIALIZATION_SCHEMA_VERSION = "collected_notice_regulation_materialization_preview.v1"
DUPLICATE_REPORT_SCHEMA_VERSION = "collected_notice_regulation_duplicate_provenance_report.v1"
CONSISTENCY_SCHEMA_VERSION = "collected_notice_regulation_materialization_consistency.v1"
SOURCE_TRACE_SCHEMA_VERSION = "collected_notice_regulation_source_to_target_trace.v1"
QUALITY_REPORT_SCHEMA_VERSION = "collected_notice_regulation_normalization_quality_report.v1"
BEFORE_AFTER_SCHEMA_VERSION = "collected_notice_regulation_normalization_before_after.v1"

INSTITUTIONAL_TARGET_COLLECTION = "institutional_rules"
SCOPED_TARGET_COLLECTION = "scoped_rules"
TARGET_COLLECTIONS = (INSTITUTIONAL_TARGET_COLLECTION, SCOPED_TARGET_COLLECTION)

_ARTICLE_OR_CHAPTER_RE = re.compile(r"(第[一二三四五六七八九十百千万0-9]+[章节条])")


class RegulationMaterializationObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class CollectedNoticeRegulationMaterializationPreview:
    institutional_rules_materialization: dict[str, Any]
    scoped_rules_materialization: dict[str, Any]
    duplicate_provenance_aggregation_report: dict[str, Any]
    consistency_report: dict[str, Any]
    source_to_target_trace: dict[str, Any]
    normalization_quality_report: dict[str, Any] = field(default_factory=dict)
    before_after_report: dict[str, Any] = field(default_factory=dict)


def build_collected_notice_regulation_materialization_preview_from_paths(
    *,
    admission_manifest_path: Path,
    object_store: RegulationMaterializationObjectStoreReader,
    phase_id: str = PHASE_06_R3_ID,
    generated_by: str = (
        "campus_ingestion_worker.preview_collected_notice_regulation_materialization"
    ),
) -> CollectedNoticeRegulationMaterializationPreview:
    return build_collected_notice_regulation_materialization_preview(
        admission_manifest=_load_json_object(admission_manifest_path),
        object_store=object_store,
        phase_id=phase_id,
        generated_by=generated_by,
        evidence_refs={"admission_manifest": str(admission_manifest_path)},
    )


def build_collected_notice_regulation_materialization_preview(
    *,
    admission_manifest: Mapping[str, Any],
    object_store: RegulationMaterializationObjectStoreReader,
    generated_at: str | None = None,
    phase_id: str = PHASE_06_R3_ID,
    generated_by: str = (
        "campus_ingestion_worker.preview_collected_notice_regulation_materialization"
    ),
    evidence_refs: Mapping[str, str] | None = None,
) -> CollectedNoticeRegulationMaterializationPreview:
    timestamp = generated_at or utc_now()
    admitted_entries = [
        dict(entry)
        for entry in _mapping_rows(admission_manifest.get("entries"))
        if _is_downstream_admitted_regulation(entry)
    ]
    grouped = _group_admitted_entries(admitted_entries)
    documents_by_collection = {
        collection: [
            _build_preview_document(
                target_collection=collection,
                entries=entries,
                object_store=object_store,
                generated_at=timestamp,
            )
            for entries in groups
        ]
        for collection, groups in grouped.items()
    }
    skipped_not_admitted = [
        dict(entry)
        for entry in _mapping_rows(admission_manifest.get("entries"))
        if not _is_downstream_admitted_regulation(entry)
    ]
    duplicate_report = _duplicate_report(
        generated_at=timestamp,
        generated_by=generated_by,
        phase_id=phase_id,
        grouped=grouped,
    )
    quality_report = _normalization_quality_report(
        generated_at=timestamp,
        generated_by=generated_by,
        phase_id=phase_id,
        documents_by_collection=documents_by_collection,
        evidence_refs=dict(evidence_refs or {}),
    )
    before_after_report = _before_after_report(
        generated_at=timestamp,
        generated_by=generated_by,
        phase_id=phase_id,
        documents_by_collection=documents_by_collection,
        evidence_refs=dict(evidence_refs or {}),
    )
    consistency_report = _consistency_report(
        generated_at=timestamp,
        generated_by=generated_by,
        phase_id=phase_id,
        admitted_entries=admitted_entries,
        skipped_not_admitted=skipped_not_admitted,
        documents_by_collection=documents_by_collection,
        quality_report=quality_report,
        evidence_refs=dict(evidence_refs or {}),
    )
    return CollectedNoticeRegulationMaterializationPreview(
        institutional_rules_materialization=_target_report(
            target_collection=INSTITUTIONAL_TARGET_COLLECTION,
            documents=documents_by_collection[INSTITUTIONAL_TARGET_COLLECTION],
            generated_at=timestamp,
            generated_by=generated_by,
            phase_id=phase_id,
            evidence_refs=dict(evidence_refs or {}),
        ),
        scoped_rules_materialization=_target_report(
            target_collection=SCOPED_TARGET_COLLECTION,
            documents=documents_by_collection[SCOPED_TARGET_COLLECTION],
            generated_at=timestamp,
            generated_by=generated_by,
            phase_id=phase_id,
            evidence_refs=dict(evidence_refs or {}),
        ),
        duplicate_provenance_aggregation_report=duplicate_report,
        consistency_report=consistency_report,
        source_to_target_trace=_source_to_target_trace(
            generated_at=timestamp,
            generated_by=generated_by,
            phase_id=phase_id,
            documents_by_collection=documents_by_collection,
        ),
        normalization_quality_report=quality_report,
        before_after_report=before_after_report,
    )


def preview_to_output_files(
    preview: CollectedNoticeRegulationMaterializationPreview,
) -> dict[str, dict[str, Any]]:
    return {
        "institutional-rules-materialization.normalized.dry-run.json": (
            preview.institutional_rules_materialization
        ),
        "scoped-rules-materialization.normalized.dry-run.json": (
            preview.scoped_rules_materialization
        ),
        "duplicate-provenance-aggregation-report.json": (
            preview.duplicate_provenance_aggregation_report
        ),
        "regulation-normalization-quality-report.json": preview.normalization_quality_report,
        "regulation-normalization-before-after-report.json": preview.before_after_report,
        "regulation-normalization-consistency-report.json": preview.consistency_report,
        "regulation-source-to-target-trace.json": preview.source_to_target_trace,
    }


def _target_report(
    *,
    target_collection: str,
    documents: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
    phase_id: str,
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    return {
        "schema_version": MATERIALIZATION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "release_publish_enabled": False,
        "query_serving_enabled": False,
        "phase": phase_id,
        "target": "regulation",
        "target_surface": f"regulations/{target_collection}",
        "target_collection": target_collection,
        "document_count": len(documents),
        "documents": list(documents),
        "registry_refresh_preview": {
            "action": "replace_scope_preview",
            "target_scope": ["regulations", target_collection],
            "document_ids": [str(document["target_document_id"]) for document in documents],
        },
        "evidence_refs": dict(evidence_refs),
    }


def _build_preview_document(
    *,
    target_collection: str,
    entries: Sequence[Mapping[str, Any]],
    object_store: RegulationMaterializationObjectStoreReader,
    generated_at: str,
) -> dict[str, Any]:
    primary = entries[0]
    title = _required_text(
        primary.get("regulation_title_normalized") or primary.get("title"),
        "regulation_title_normalized",
    )
    owner_text = _load_owner_text(entry=primary, object_store=object_store)
    legacy_body = _legacy_strip_wrapper_text(title=title, owner_text=owner_text)
    normalization = normalize_regulation_owner_text(title=title, owner_text=owner_text)
    canonical_body = normalization.canonical_body
    canonical_markdown = _canonical_markdown(title=title, body=canonical_body)
    target_document_id = _target_document_id(primary)
    source_notice_ids = sorted({str(entry.get("source_notice_id") or "") for entry in entries})
    source_document_ids = sorted({str(entry.get("source_document_id") or "") for entry in entries})
    source_notice_release_time = _source_notice_release_time(entries)
    return {
        "schema_version": "collected_notice_regulation_target_document_preview.v1",
        "generated_at": generated_at,
        "target": "regulation",
        "target_collection": target_collection,
        "target_surface": f"regulations/{target_collection}",
        "target_document_id": target_document_id,
        "target_identity_preview": primary.get("target_identity_preview"),
        "candidate_key": primary.get("candidate_key"),
        "title": title,
        "issuing_org": primary.get("issuing_org") or "中央民族大学",
        "canonical_markdown": canonical_markdown,
        "canonical_markdown_preview": _preview_text(canonical_markdown, limit=900),
        "document_units_preview": build_regulation_document_units(
            target_document_id=target_document_id,
            title=title,
            canonical_body=canonical_body,
        ),
        "normalization_quality": _normalization_quality_document(
            target_collection=target_collection,
            target_document_id=target_document_id,
            source_notice_ids=source_notice_ids,
            title=title,
            normalization=normalization,
            unit_count=len(
                build_regulation_document_units(
                    target_document_id=target_document_id,
                    title=title,
                    canonical_body=canonical_body,
                )
            ),
        ),
        "normalization_before_after": {
            "legacy_canonical_markdown_preview": _preview_text(
                _canonical_markdown(title=title, body=legacy_body),
                limit=900,
            ),
            "normalized_canonical_markdown_preview": _preview_text(
                canonical_markdown,
                limit=900,
            ),
            "changed": _canonical_markdown(title=title, body=legacy_body) != canonical_markdown,
        },
        "source_notice_ids": source_notice_ids,
        "source_notice_release_time": source_notice_release_time,
        "source_document_ids": source_document_ids,
        "source_urls": sorted(
            {str(entry.get("source_url") or "") for entry in entries if entry.get("source_url")}
        ),
        "source_scope": {
            "source_channel": primary.get("source_channel"),
            "source_surface": primary.get("source_surface"),
            "source_corpus": primary.get("source_corpus"),
            "source_collection": primary.get("source_collection"),
        },
        "source_object_refs": _merged_source_object_refs(entries),
        "owner_text_recovery": primary.get("owner_text_recovery") or {},
        "no_write_boundary": {
            "db_writes_enabled": False,
            "object_store_writes_enabled": False,
            "release_publish_enabled": False,
            "query_serving_enabled": False,
        },
    }


def _source_notice_release_time(entries: Sequence[Mapping[str, Any]]) -> str:
    for entry in entries:
        for field_name in ("source_notice_release_time", "notice_release_time", "published_at"):
            value = str(entry.get(field_name) or "").strip()
            if value:
                return value
    return "unknown"


def _duplicate_report(
    *,
    generated_at: str,
    generated_by: str,
    phase_id: str,
    grouped: Mapping[str, Sequence[Sequence[Mapping[str, Any]]]],
) -> dict[str, Any]:
    groups: list[dict[str, Any]] = []
    for collection, collection_groups in grouped.items():
        for entries in collection_groups:
            if len(entries) <= 1:
                continue
            primary = entries[0]
            groups.append(
                {
                    "target_collection": collection,
                    "candidate_key": primary.get("candidate_key"),
                    "target_document_id": _target_document_id(primary),
                    "source_notice_ids": sorted(
                        {str(entry.get("source_notice_id") or "") for entry in entries}
                    ),
                    "source_document_ids": sorted(
                        {str(entry.get("source_document_id") or "") for entry in entries}
                    ),
                    "aggregation_policy": "candidate_key_and_target_identity",
                }
            )
    return {
        "schema_version": DUPLICATE_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": "regulation",
        "duplicate_group_count": len(groups),
        "groups": groups,
    }


def _consistency_report(
    *,
    generated_at: str,
    generated_by: str,
    phase_id: str,
    admitted_entries: Sequence[Mapping[str, Any]],
    skipped_not_admitted: Sequence[Mapping[str, Any]],
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
    quality_report: Mapping[str, Any],
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    institutional_docs = documents_by_collection[INSTITUTIONAL_TARGET_COLLECTION]
    scoped_docs = documents_by_collection[SCOPED_TARGET_COLLECTION]
    document_ids = [
        str(document["target_document_id"]) for document in (*institutional_docs, *scoped_docs)
    ]
    duplicate_target_document_ids = sorted(
        document_id for document_id in set(document_ids) if document_ids.count(document_id) > 1
    )
    failures: list[str] = []
    if duplicate_target_document_ids:
        failures.append("duplicate_target_document_id")
    if any(
        _contains_notice_id(str(document["target_document_id"]), document)
        for document in (*institutional_docs, *scoped_docs)
    ):
        failures.append("target_identity_contains_source_notice_id")
    quality_rows = [
        row
        for row in _mapping_rows(quality_report.get("documents"))
        if row.get("quality_verdict") == "failed"
    ]
    if quality_rows:
        failures.append("normalization_quality_failed")
    verdict = "passed" if not failures else "failed"
    return {
        "schema_version": CONSISTENCY_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": "regulation",
        "verdict": verdict,
        "failure_reason_codes": failures,
        "counts": {
            "downstream_admitted": len(admitted_entries),
            "institutional_rules_admitted": sum(
                1
                for entry in admitted_entries
                if entry.get("target_collection") == INSTITUTIONAL_TARGET_COLLECTION
            ),
            "scoped_rules_admitted": sum(
                1
                for entry in admitted_entries
                if entry.get("target_collection") == SCOPED_TARGET_COLLECTION
            ),
            "institutional_rules_document_count": len(institutional_docs),
            "scoped_rules_document_count": len(scoped_docs),
            "skipped_not_admitted": len(skipped_not_admitted),
            "duplicate_target_document_id_count": len(duplicate_target_document_ids),
            "normalization_failed_document_count": len(quality_rows),
            "normalization_flagged_document_count": sum(
                1
                for row in _mapping_rows(quality_report.get("documents"))
                if row.get("quality_verdict") == "flagged_manual_review"
            ),
        },
        "evidence_refs": dict(evidence_refs),
    }


def _normalization_quality_report(
    *,
    generated_at: str,
    generated_by: str,
    phase_id: str,
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    rows = [
        dict(document["normalization_quality"])
        for documents in documents_by_collection.values()
        for document in documents
    ]
    failed_count = sum(1 for row in rows if row.get("quality_verdict") == "failed")
    flagged_count = sum(1 for row in rows if row.get("quality_verdict") == "flagged_manual_review")
    verdict = "failed" if failed_count else "flagged_manual_review" if flagged_count else "passed"
    return {
        "schema_version": QUALITY_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": "regulation",
        "verdict": verdict,
        "document_count": len(rows),
        "failed_document_count": failed_count,
        "flagged_document_count": flagged_count,
        "documents": rows,
        "evidence_refs": dict(evidence_refs),
    }


def _before_after_report(
    *,
    generated_at: str,
    generated_by: str,
    phase_id: str,
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
    evidence_refs: Mapping[str, str],
) -> dict[str, Any]:
    rows = [
        {
            "target_collection": document["target_collection"],
            "target_document_id": document["target_document_id"],
            "source_notice_ids": document["source_notice_ids"],
            "title": document["title"],
            **dict(document["normalization_before_after"]),
        }
        for documents in documents_by_collection.values()
        for document in documents
    ]
    return {
        "schema_version": BEFORE_AFTER_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": "regulation",
        "document_count": len(rows),
        "changed_document_count": sum(1 for row in rows if row.get("changed")),
        "documents": rows,
        "evidence_refs": dict(evidence_refs),
    }


def _source_to_target_trace(
    *,
    generated_at: str,
    generated_by: str,
    phase_id: str,
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for documents in documents_by_collection.values():
        for document in documents:
            for source_notice_id in document["source_notice_ids"]:
                entries.append(
                    {
                        "source_notice_id": source_notice_id,
                        "source_document_ids": document["source_document_ids"],
                        "target_collection": document["target_collection"],
                        "target_surface": document["target_surface"],
                        "target_document_id": document["target_document_id"],
                        "candidate_key": document["candidate_key"],
                        "source_scope": document["source_scope"],
                    }
                )
    return {
        "schema_version": SOURCE_TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": "regulation",
        "entry_count": len(entries),
        "entries": sorted(
            entries,
            key=lambda item: (
                str(item.get("target_collection") or ""),
                str(item.get("source_notice_id") or ""),
            ),
        ),
    }


def _group_admitted_entries(
    entries: Sequence[Mapping[str, Any]],
) -> dict[str, list[list[Mapping[str, Any]]]]:
    grouped_by_collection: dict[str, dict[str, list[Mapping[str, Any]]]] = {
        INSTITUTIONAL_TARGET_COLLECTION: {},
        SCOPED_TARGET_COLLECTION: {},
    }
    for entry in entries:
        collection = str(entry.get("target_collection") or "")
        if collection not in grouped_by_collection:
            continue
        key = _group_key(entry)
        grouped_by_collection[collection].setdefault(key, []).append(entry)
    return {
        collection: [
            sorted(rows, key=lambda item: str(item.get("source_notice_id") or ""))
            for _, rows in sorted(groups.items())
        ]
        for collection, groups in grouped_by_collection.items()
    }


def _is_downstream_admitted_regulation(entry: Mapping[str, Any]) -> bool:
    return (
        str(entry.get("consumption_class") or "") == "downstream_admitted"
        and str(entry.get("target") or "") == "regulation"
        and str(entry.get("target_collection") or "") in TARGET_COLLECTIONS
    )


def _group_key(entry: Mapping[str, Any]) -> str:
    for key in ("candidate_key", "target_identity_preview"):
        value = str(entry.get(key) or "").strip()
        if value:
            return value
    title = str(entry.get("regulation_title_normalized") or entry.get("title") or "")
    return hashlib.sha256(title.encode("utf-8")).hexdigest()[:16]


def _target_document_id(entry: Mapping[str, Any]) -> str:
    value = str(entry.get("target_identity_preview") or "").strip()
    if value:
        return value
    collection = _required_text(entry.get("target_collection"), "target_collection")
    digest = hashlib.sha256(_group_key(entry).encode("utf-8")).hexdigest()[:16]
    return f"collected_notice_regulation:{collection}:{digest}"


def _load_owner_text(
    *,
    entry: Mapping[str, Any],
    object_store: RegulationMaterializationObjectStoreReader,
) -> str:
    recovery = entry.get("owner_text_recovery")
    if not isinstance(recovery, Mapping):
        raise ValueError(f"entry {entry.get('entry_id')} is missing owner_text_recovery")
    refs = recovery.get("written_refs")
    if not isinstance(refs, Mapping):
        raise ValueError(f"entry {entry.get('entry_id')} is missing owner_text written_refs")
    merge_ref = refs.get("searchable_merge_input")
    if isinstance(merge_ref, Mapping):
        owner_text = _read_owner_text_from_merge_ref(object_store=object_store, ref=merge_ref)
        if owner_text:
            return owner_text
    plain_text_ref = refs.get("plain_text")
    if isinstance(plain_text_ref, Mapping):
        owner_text = _read_owner_text_from_plain_text_ref(
            object_store=object_store,
            ref=plain_text_ref,
        )
        if owner_text:
            return owner_text
    raise ValueError(f"entry {entry.get('entry_id')} owner text refs are empty")


def _read_owner_text_from_merge_ref(
    *,
    object_store: RegulationMaterializationObjectStoreReader,
    ref: Mapping[str, Any],
) -> str:
    payload = json.loads(
        object_store.get_bytes(
            bucket=_required_text(ref.get("bucket"), "owner_text.bucket"),
            key=_required_text(ref.get("key"), "owner_text.key"),
        ).decode("utf-8")
    )
    if not isinstance(payload, Mapping):
        return ""
    return str(payload.get("owner_text") or "").strip()


def _read_owner_text_from_plain_text_ref(
    *,
    object_store: RegulationMaterializationObjectStoreReader,
    ref: Mapping[str, Any],
) -> str:
    data = object_store.get_bytes(
        bucket=_required_text(ref.get("bucket"), "plain_text.bucket"),
        key=_required_text(ref.get("key"), "plain_text.key"),
    )
    texts: list[str] = []
    for line in data.decode("utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, Mapping):
            continue
        text = str(payload.get("text") or "").strip()
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def _normalization_quality_document(
    *,
    target_collection: str,
    target_document_id: str,
    source_notice_ids: Sequence[str],
    title: str,
    normalization: RegulationTextNormalizationResult,
    unit_count: int,
) -> dict[str, Any]:
    return {
        "target_collection": target_collection,
        "target_document_id": target_document_id,
        "source_notice_ids": list(source_notice_ids),
        "title": title,
        "wrapper_removed": normalization.wrapper_removed,
        "suspicious_prefix": normalization.suspicious_prefix,
        "title_occurrence_count": normalization.title_occurrence_count,
        "chapter_count": normalization.chapter_count,
        "article_count": normalization.article_count,
        "page_artifact_count": normalization.page_artifact_count,
        "soft_wrap_repair_count": normalization.soft_wrap_repair_count,
        "soft_wrap_residue_count": normalization.soft_wrap_residue_count,
        "readability_normalization_count": normalization.readability_normalization_count,
        "normalizer_version": normalization.normalizer_version,
        "unit_count": unit_count,
        "quality_verdict": normalization.quality_verdict,
        "reason_codes": list(normalization.reason_codes),
    }


def _legacy_strip_wrapper_text(*, title: str, owner_text: str) -> str:
    normalized = owner_text.strip()
    title_index = normalized.find(title)
    if title_index > 0:
        return normalized[title_index:].strip()
    match = _ARTICLE_OR_CHAPTER_RE.search(normalized)
    if title_index < 0 and match is not None and match.start() > 0:
        return normalized[match.start() :].strip()
    return normalized


def _canonical_markdown(*, title: str, body: str) -> str:
    cleaned_body = body.strip()
    if cleaned_body.startswith(title):
        cleaned_body = cleaned_body[len(title) :].strip()
    return f"# {title}\n\n{cleaned_body}\n"


def _merged_source_object_refs(entries: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    refs_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for entry in entries:
        for ref in entry.get("source_object_refs") or ():
            if not isinstance(ref, Mapping):
                continue
            key = (
                str(ref.get("bucket") or ""),
                str(ref.get("key") or ""),
                str(ref.get("role") or ""),
            )
            refs_by_key[key] = dict(ref)
    return [refs_by_key[key] for key in sorted(refs_by_key)]


def _contains_notice_id(document_id: str, document: Mapping[str, Any]) -> bool:
    return any(str(source_id) in document_id for source_id in document["source_notice_ids"])


def _preview_text(text: str, *, limit: int) -> str:
    stripped = text.strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 1].rstrip() + "…"


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "PHASE_06_R2_ID",
    "PHASE_06_R3_ID",
    "CollectedNoticeRegulationMaterializationPreview",
    "RegulationMaterializationObjectStoreReader",
    "build_collected_notice_regulation_materialization_preview",
    "build_collected_notice_regulation_materialization_preview_from_paths",
    "preview_to_output_files",
]
