from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest
    from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter


def _assert_attachment_blob_root_precondition(
    *,
    request: AuthenticatedNoticeImportRequest,
    export_manifest: dict[str, Any] | None,
    bundle_records: tuple[dict[str, Any], ...] | list[dict[str, Any]],
) -> None:
    if request.attachment_blob_root is not None:
        return
    if not _manifest_uses_blob_store_reference(export_manifest):
        return
    if not _bundle_contains_object_backed_attachments(bundle_records):
        return
    raise ValueError(
        "authenticated notice import requires attachment_blob_root when "
        "collector.attachment_storage_mode=blob_store_reference and the selected bundle "
        "contains object-backed attachments"
    )


def _maybe_backfill_attachment_objects_for_import(
    *,
    request: AuthenticatedNoticeImportRequest,
    source: dict[str, str],
    object_store: S3ObjectStoreWriter | object,
    notice_ids: tuple[str, ...],
) -> dict[str, Any] | None:
    attachment_blob_root = request.attachment_blob_root
    if attachment_blob_root is None:
        return None
    from campus_ingestion_core.authenticated_notice_attachment_object_backfill import (
        AuthenticatedNoticeAttachmentObjectBackfillRequest,
        backfill_authenticated_notice_attachment_objects,
    )

    return backfill_authenticated_notice_attachment_objects(
        request=AuthenticatedNoticeAttachmentObjectBackfillRequest(
            bundle_path=request.bundle_path,
            blob_root=attachment_blob_root,
            notice_ids=notice_ids,
        ),
        env=source,
        object_store=object_store,
    )


def _manifest_uses_blob_store_reference(
    export_manifest: dict[str, Any] | None,
) -> bool:
    if not isinstance(export_manifest, dict):
        return False
    collector = export_manifest.get("collector")
    if not isinstance(collector, dict):
        return False
    storage_mode = str(collector.get("attachment_storage_mode") or "").strip().lower()
    return storage_mode == "blob_store_reference"


def _bundle_contains_object_backed_attachments(
    bundle_records: tuple[dict[str, Any], ...] | list[dict[str, Any]],
) -> bool:
    for record in bundle_records:
        if not isinstance(record, dict):
            continue
        attachments = {
            item.get("attachment_id"): item
            for item in list(record.get("attachments") or ())
            if isinstance(item, dict) and item.get("attachment_id") is not None
        }
        for relation in list(record.get("notice_attachments") or ()):
            if not isinstance(relation, dict):
                continue
            attachment = attachments.get(relation.get("attachment_id"))
            if not isinstance(attachment, dict):
                continue
            object_key = str(attachment.get("object_key") or "").strip()
            if object_key:
                return True
    return False


def _content_type_for_artifact(path: str) -> str:
    if path.endswith(".jsonl"):
        return "application/x-ndjson"
    if path.endswith(".json"):
        return "application/json"
    if path.endswith(".md"):
        return "text/markdown; charset=utf-8"
    return "application/octet-stream"
