from __future__ import annotations

from campus_ingestion_core.handbook_cleanup_normalize import (
    build_handbook_doc_id,
    build_handbook_version_id,
    normalize_handbook_title,
)
from campus_ingestion_core.handbook_cleanup_projection_completion import (
    repair_projected_content_rows,
)
from campus_ingestion_core.handbook_cleanup_projection_events import build_document_events
from campus_ingestion_core.handbook_cleanup_projection_render import (
    build_canonical_body,
    build_canonical_markdown,
    build_document_rows,
    serialize_handbook_document_units,
)
from campus_ingestion_core.handbook_cleanup_projection_selection import (
    extract_handbook_title_candidate,
    filter_content_rows,
    find_title_anchor_index,
    is_placeholder_title,
    normalize_title_for_match,
    project_manifest_rows,
    select_title,
)
from campus_ingestion_core.handbook_cleanup_shared import HandbookCleanupResult
from campus_ingestion_core.split_manifest import SplitManifestDocument


def cleanup_handbook_document(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
    source_doc: str,
) -> HandbookCleanupResult:
    projected_rows = project_manifest_rows(structured_rows, manifest_document)
    if not projected_rows:
        raise ValueError(
            f"manifest document {manifest_document.document_id} does not match any source rows"
        )
    if not manifest_document.handbook_section:
        raise ValueError("handbook manifest document requires handbook_section")

    title = select_title(projected_rows, manifest_document.title, manifest_document.page_start)
    content_rows = filter_content_rows(projected_rows, title=title)
    content_rows = repair_projected_content_rows(
        content_rows=content_rows,
        structured_rows=structured_rows,
        title=title,
    )
    events, policy_doc_no, preface_text = build_document_events(content_rows)

    metadata: dict[str, object] = {
        "title": title,
        "source_doc": source_doc,
        "page_start": manifest_document.page_start,
        "page_end": manifest_document.page_end,
        "handbook_section": manifest_document.handbook_section,
    }
    if policy_doc_no is not None:
        metadata["policy_doc_no"] = policy_doc_no

    canonical_body = build_canonical_body(events, preface_text=preface_text)
    doc_id = build_handbook_doc_id(title)
    version_id = build_handbook_version_id(title, canonical_body)
    canonical_markdown = build_canonical_markdown(
        title=title,
        doc_id=doc_id,
        metadata=metadata,
        canonical_body=canonical_body,
    )
    document_rows = build_document_rows(
        events=events,
        doc_id=doc_id,
        version_id=version_id,
        source_pdf=source_doc,
        source_url=manifest_document.source_uri,
        entitlement_groups=manifest_document.resolved_entitlement_groups(),
        title=title,
        policy_doc_no=policy_doc_no,
        preface_text=preface_text,
    )
    return HandbookCleanupResult(
        title=title,
        doc_id=doc_id,
        version_id=version_id,
        metadata=metadata,
        canonical_markdown=canonical_markdown,
        document_units=tuple(document_rows),
    )


def validate_handbook_manifest_title(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
) -> None:
    projected_rows = project_manifest_rows(structured_rows, manifest_document)
    if not projected_rows:
        raise ValueError(
            f"manifest document {manifest_document.document_id} does not match any source rows"
        )
    if (
        find_title_anchor_index(
            projected_rows,
            title=manifest_document.title,
        )
        is not None
    ):
        return
    candidate_title = extract_handbook_title_candidate(
        structured_rows=projected_rows,
        first_page=manifest_document.page_start,
    )
    if candidate_title is None or is_placeholder_title(manifest_document.title):
        raise ValueError(
            "manifest document "
            f"{manifest_document.document_id} missing title anchor for {normalize_handbook_title(manifest_document.title)!r}"
        )
    if normalize_title_for_match(candidate_title) == normalize_title_for_match(
        manifest_document.title
    ):
        return
    raise ValueError(
        "manifest title mismatch for "
        f"{manifest_document.document_id}: OCR title {normalize_handbook_title(candidate_title)!r} "
        f"!= manifest title {normalize_handbook_title(manifest_document.title)!r}"
    )


__all__ = [
    "cleanup_handbook_document",
    "extract_handbook_title_candidate",
    "serialize_handbook_document_units",
    "validate_handbook_manifest_title",
]
