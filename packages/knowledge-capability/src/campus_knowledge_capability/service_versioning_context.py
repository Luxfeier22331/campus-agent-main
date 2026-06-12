from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from campus_contracts import CapabilityRequest, KnowledgeScope
from campus_ingestion_core import load_runtime_profile
from campus_ingestion_core.corpus_profiles import (
    is_official_web_stable_reference_like_profile,
)
from campus_retrieval_core import RetrievalBackendError

from .service_common import _is_official_web_freshness_sensitive_query


@dataclass(frozen=True, slots=True)
class _VersionAnswerContext:
    mode: str = "current"
    target_version_ids: tuple[str, ...] = ()
    target_revision_track: str = ""
    primary_version_id: str = ""
    comparison_version_id: str = ""
    as_of: str = ""


def _resolve_version_answer_context(
    *,
    request: CapabilityRequest,
    resolved_scope: KnowledgeScope,
    retrieval_collection: str,
    target_document_ids: tuple[str, ...],
    build_document_registry_from_env_fn: Callable[[], Any],
    resolve_version_query_fn: Callable[..., Any],
) -> _VersionAnswerContext | None:
    version_query = request.payload.version_query
    if version_query.mode == "current":
        return _VersionAnswerContext()
    if len(target_document_ids) != 1:
        return None
    try:
        runtime_profile = load_runtime_profile(resolved_scope.corpus, retrieval_collection)
        resolved_version_query = resolve_version_query_fn(
            build_document_registry_from_env_fn(),
            document_id=target_document_ids[0],
            version_query=version_query,
            preferred_revision_tracks=runtime_profile.serving_revision_tracks,
        )
    except Exception as exc:  # pragma: no cover - exercised via caller mapping
        raise RetrievalBackendError("version resolution failed") from exc
    if (
        resolved_version_query.status != "resolved"
        or resolved_version_query.primary_selection is None
        or not resolved_version_query.selected_version_ids
    ):
        return None
    return _VersionAnswerContext(
        mode=version_query.mode,
        target_version_ids=resolved_version_query.selected_version_ids,
        target_revision_track=resolved_version_query.primary_selection.revision_track,
        primary_version_id=resolved_version_query.primary_selection.version_id,
        comparison_version_id=(
            resolved_version_query.comparison_selection.version_id
            if resolved_version_query.comparison_selection is not None
            else ""
        ),
        as_of=version_query.as_of,
    )


def _resolve_retrieval_query_mode(
    *,
    resolved_scope: KnowledgeScope,
    retrieval_collection: str,
    user_goal: str,
    version_mode: str,
) -> str:
    if version_mode != "current":
        return version_mode
    profile = load_runtime_profile(resolved_scope.corpus, retrieval_collection)
    if _is_official_web_freshness_sensitive_query(user_goal) and (
        profile.requires_freshness_gate or is_official_web_stable_reference_like_profile(profile)
    ):
        return "freshness_sensitive"
    return version_mode


__all__ = [
    "_VersionAnswerContext",
    "_resolve_retrieval_query_mode",
    "_resolve_version_answer_context",
]
