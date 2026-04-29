from __future__ import annotations

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile

from campus_retrieval_core.backend_qdrant_errors import RestrictedDocumentAccessDeniedError
from campus_retrieval_core.backend_qdrant_filters import _record_has_restricted_visibility
from campus_retrieval_core.backend_qdrant_registry import get_current_registry_version
from campus_retrieval_core.models import RetrievalRequest

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")


def _fail_closed_on_denied_target_documents(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
) -> None:
    if not request.target_document_ids:
        return

    denied_target_found = False
    for document_id in request.target_document_ids:
        record = get_current_registry_version(
            backend,
            document_id,
            preferred_revision_tracks=profile.serving_revision_tracks
            or DEFAULT_LATEST_REVISION_TRACKS,
        )
        if record is None:
            continue
        if request.allows_document_access(
            visibility_level=record.visibility_level,
            entitlement_groups=record.entitlement_groups,
            visibility_scope=record.visibility_scope,
        ):
            continue
        if _record_has_restricted_visibility(record):
            denied_target_found = True

    if denied_target_found:
        raise RestrictedDocumentAccessDeniedError("restricted document access denied")
