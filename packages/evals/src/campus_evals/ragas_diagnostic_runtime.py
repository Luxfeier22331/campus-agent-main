from __future__ import annotations

from collections.abc import Mapping
from contextlib import ExitStack, contextmanager
from dataclasses import replace
from unittest.mock import patch

import campus_retrieval_core.backend_qdrant as backend_qdrant_module
import campus_retrieval_core.backend_qdrant_release_guard as release_guard_module
import campus_retrieval_core.service as retrieval_service_module

from campus_evals.ragas_diagnostic_fixtures import SURFACE_QRELS_FIXTURES


def _parse_qdrant_collection_overrides(values: list[str]) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"--qdrant-collection-name must use SURFACE=COLLECTION, got {value!r}")
        surface_key, collection_name = (part.strip() for part in value.split("=", 1))
        if not surface_key or not collection_name:
            raise ValueError("--qdrant-collection-name must use non-empty SURFACE=COLLECTION")
        if surface_key not in SURFACE_QRELS_FIXTURES:
            raise ValueError(f"unknown RAGAS diagnostic surface override: {surface_key}")
        overrides[surface_key] = collection_name
    return overrides


def _normalize_qdrant_collection_overrides(
    overrides: Mapping[str, str],
) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for surface_key, collection_name in overrides.items():
        normalized_surface_key = str(surface_key).strip()
        normalized_collection_name = str(collection_name).strip()
        if not normalized_surface_key or not normalized_collection_name:
            raise ValueError("qdrant collection overrides must be non-empty")
        if normalized_surface_key not in SURFACE_QRELS_FIXTURES:
            raise ValueError(f"unknown RAGAS diagnostic surface override: {surface_key}")
        normalized[normalized_surface_key] = normalized_collection_name
    return normalized


@contextmanager
def _override_ragas_diagnostic_runtime_profiles(
    qdrant_collection_overrides: Mapping[str, str],
):
    normalized_overrides = _normalize_qdrant_collection_overrides(qdrant_collection_overrides)
    if not normalized_overrides:
        yield
        return

    original_backend = backend_qdrant_module.load_runtime_profile
    original_service = retrieval_service_module.load_runtime_profile

    def _build_override(loader):
        def _load_runtime_profile(corpus: str, collection: str, *, config_root=None):
            profile = loader(corpus, collection, config_root=config_root)
            override = normalized_overrides.get(f"{corpus}/{collection}")
            if override is None:
                return profile
            return replace(
                profile,
                retrieval_enabled=True,
                qdrant_index_binding=replace(
                    profile.qdrant_index_binding,
                    alias_name=override,
                ),
            )

        return _load_runtime_profile

    stack = ExitStack()
    try:
        stack.enter_context(
            patch.object(
                backend_qdrant_module,
                "load_runtime_profile",
                side_effect=_build_override(original_backend),
            )
        )
        stack.enter_context(
            patch.object(
                retrieval_service_module,
                "load_runtime_profile",
                side_effect=_build_override(original_service),
            )
        )
        stack.enter_context(
            patch.object(
                release_guard_module,
                "_requires_regulation_target_release_proof",
                side_effect=_build_preview_release_guard_override(
                    original=release_guard_module._requires_regulation_target_release_proof,
                    overrides=normalized_overrides,
                ),
            )
        )
        stack.enter_context(
            patch.object(
                backend_qdrant_module,
                "validate_alias_release_metadata",
                side_effect=_build_preview_release_metadata_validation_override(
                    original=backend_qdrant_module.validate_alias_release_metadata,
                    overrides=normalized_overrides,
                    default_alias_names=_default_alias_names(
                        overrides=normalized_overrides,
                        loader=original_backend,
                    ),
                ),
            )
        )
        yield
    finally:
        stack.close()


def _build_preview_release_guard_override(*, original, overrides: Mapping[str, str]):
    def _requires_regulation_target_release_proof(profile) -> bool:
        surface_key = f"{profile.corpus}/{profile.collection}"
        override = overrides.get(surface_key)
        if override and profile.qdrant_index_binding.alias_name == override:
            return False
        return original(profile)

    return _requires_regulation_target_release_proof


def _build_preview_release_metadata_validation_override(
    *,
    original,
    overrides: Mapping[str, str],
    default_alias_names: Mapping[str, str],
):
    def _validate_alias_release_metadata(
        backend,
        *,
        collection_name: str,
        profile,
        settings,
        timeout_seconds: int | None,
    ) -> None:
        surface_key = f"{profile.corpus}/{profile.collection}"
        override = overrides.get(surface_key)
        if (
            override
            and collection_name == override
            and profile.qdrant_index_binding.alias_name == override
            and override != default_alias_names.get(surface_key)
        ):
            return None
        return original(
            backend,
            collection_name=collection_name,
            profile=profile,
            settings=settings,
            timeout_seconds=timeout_seconds,
        )

    return _validate_alias_release_metadata


def _default_alias_names(*, overrides: Mapping[str, str], loader) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for surface_key in overrides:
        corpus, collection = surface_key.split("/", 1)
        aliases[surface_key] = loader(corpus, collection).qdrant_index_binding.alias_name
    return aliases


__all__ = [
    "_build_preview_release_guard_override",
    "_build_preview_release_metadata_validation_override",
    "_default_alias_names",
    "_normalize_qdrant_collection_overrides",
    "_override_ragas_diagnostic_runtime_profiles",
    "_parse_qdrant_collection_overrides",
]
