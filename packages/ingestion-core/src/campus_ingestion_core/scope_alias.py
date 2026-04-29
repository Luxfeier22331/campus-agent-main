from __future__ import annotations

import os
from dataclasses import dataclass

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import (
    publish_release_alias,
    resolve_alias_target,
    unpublish_release_alias,
)


@dataclass(frozen=True, slots=True)
class ScopeAliasReport:
    corpus: str
    collection: str
    serving_alias: str
    action: str
    previous_physical_collection_name: str | None
    current_physical_collection_name: str | None


def set_scope_release_alias(
    *,
    corpus: str,
    collection: str,
    physical_collection_name: str | None,
    env: dict[str, str] | None = None,
    qdrant_client: QdrantClient | None = None,
) -> ScopeAliasReport:
    source = dict(env if env is not None else os.environ)
    runtime_profile = load_runtime_profile(corpus, collection)
    binding = runtime_profile.qdrant_index_binding
    client = qdrant_client or _build_qdrant_client(RetrievalSettings.from_env(source))
    previous_physical_collection_name = resolve_alias_target(
        qdrant_client=client,
        alias_name=binding.alias_name,
    )
    if physical_collection_name is None:
        current_physical_collection_name = None
        action = "unpublish"
        unpublish_release_alias(
            qdrant_client=client,
            binding=binding,
        )
    else:
        if not client.collection_exists(physical_collection_name):
            raise ValueError(
                f"physical collection {physical_collection_name} does not exist for {corpus}/{collection}"
            )
        publish_release_alias(
            qdrant_client=client,
            binding=binding,
            physical_collection_name=physical_collection_name,
        )
        current_physical_collection_name = physical_collection_name
        action = "publish"
    return ScopeAliasReport(
        corpus=corpus,
        collection=collection,
        serving_alias=binding.alias_name,
        action=action,
        previous_physical_collection_name=previous_physical_collection_name,
        current_physical_collection_name=current_physical_collection_name,
    )


def _build_qdrant_client(settings: RetrievalSettings) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=settings.qdrant_timeout_seconds,
        cloud_inference=True,
    )


__all__ = ["ScopeAliasReport", "set_scope_release_alias"]
