from __future__ import annotations

from dataclasses import dataclass

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.file_asset_routing import (
    MINERU_ADAPTED_PARSER_VERSION,
    PADDLE_PARSER_VERSION,
)
from campus_ingestion_core.object_store import build_source_model_slug
from campus_ingestion_core.raw_ingestion_online_ocr import (
    DEFAULT_MINERU_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_PROVIDER,
    ONLINE_OCR_PROVIDER_MINERU_API,
)


@dataclass(frozen=True, slots=True)
class CollectionSourceOcrRuntime:
    provider: str
    model: str
    parser_version: str
    model_slug: str


def resolve_collection_source_ocr_runtime(
    *,
    corpus: str | None = None,
    collection: str | None = None,
    profile: CollectionRuntimeProfile | None = None,
) -> CollectionSourceOcrRuntime:
    runtime_profile = profile
    if runtime_profile is None:
        if not corpus or not collection:
            raise ValueError("corpus and collection are required when profile is omitted")
        runtime_profile = load_runtime_profile(corpus, collection)
    provider = runtime_profile.source_ocr_provider or DEFAULT_ONLINE_OCR_PROVIDER
    model = runtime_profile.source_ocr_model or _default_source_ocr_model(provider)
    parser_version = runtime_profile.source_parser_version or _default_source_parser_version(
        provider
    )
    return CollectionSourceOcrRuntime(
        provider=provider,
        model=model,
        parser_version=parser_version,
        model_slug=build_source_model_slug(model),
    )


def _default_source_ocr_model(provider: str) -> str:
    if provider == ONLINE_OCR_PROVIDER_MINERU_API:
        return DEFAULT_MINERU_ONLINE_OCR_MODEL
    return DEFAULT_ONLINE_OCR_MODEL


def _default_source_parser_version(provider: str) -> str:
    if provider == ONLINE_OCR_PROVIDER_MINERU_API:
        return MINERU_ADAPTED_PARSER_VERSION
    return PADDLE_PARSER_VERSION


__all__ = (
    "CollectionSourceOcrRuntime",
    "resolve_collection_source_ocr_runtime",
)
