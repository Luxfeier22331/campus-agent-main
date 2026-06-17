from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import urlparse

from qdrant_client import QdrantClient

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.object_store_admin import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings

_RENAME_TARGETS: tuple[tuple[str, str, str], ...] = (
    ("regulations", "student_handbook", "student_rules"),
    ("regulations", "institutional_regulations", "institutional_rules"),
)
_DEFAULT_QDRANT_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True, slots=True)
class QdrantAuditSettings:
    qdrant_url: str
    qdrant_api_key: str | None = None
    qdrant_timeout_seconds: float = _DEFAULT_QDRANT_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        if self.qdrant_url != ":memory:":
            parsed = urlparse(self.qdrant_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("QDRANT_URL must be http(s) or :memory:")
        if self.qdrant_timeout_seconds <= 0:
            raise ValueError("QDRANT_TIMEOUT_SECONDS must be greater than zero")

    @classmethod
    def from_env(cls, env: dict[str, str]) -> QdrantAuditSettings:
        qdrant_url = (env.get("QDRANT_URL") or "").strip()
        if not qdrant_url:
            raise ValueError("QDRANT_URL is required")
        return cls(
            qdrant_url=qdrant_url,
            qdrant_api_key=(env.get("QDRANT_API_KEY") or "").strip() or None,
            qdrant_timeout_seconds=float(
                (env.get("QDRANT_TIMEOUT_SECONDS") or str(_DEFAULT_QDRANT_TIMEOUT_SECONDS)).strip()
            ),
        )


@dataclass(frozen=True, slots=True)
class ReleaseFamilySummary:
    corpus: str
    collection: str
    manifest_count: int
    release_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class QdrantFamilySummary:
    alias_name: str
    alias_target: str | None
    collection_prefix: str
    physical_collections: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CollectionRuntimeRenameTargetAudit:
    corpus: str
    legacy_collection: str
    canonical_collection: str
    legacy_release_family: ReleaseFamilySummary
    canonical_release_family: ReleaseFamilySummary
    legacy_qdrant_family: QdrantFamilySummary
    canonical_qdrant_family: QdrantFamilySummary


@dataclass(frozen=True, slots=True)
class CollectionRuntimeAuditReport:
    targets: tuple[CollectionRuntimeRenameTargetAudit, ...]


def summarize_release_family(
    *,
    corpus: str,
    collection: str,
    keys: Sequence[str],
) -> ReleaseFamilySummary:
    prefix = f"{corpus}/releases/{collection}/"
    release_ids = sorted(
        {
            key[len(prefix) :].split("/", 1)[0]
            for key in keys
            if key.startswith(prefix) and key.endswith("/index-release.json")
        }
    )
    return ReleaseFamilySummary(
        corpus=corpus,
        collection=collection,
        manifest_count=len(release_ids),
        release_ids=tuple(release_ids),
    )


def summarize_qdrant_family(
    *,
    alias_name: str,
    aliases: Sequence[object],
    collection_names: Sequence[str],
    collection_prefix: str,
) -> QdrantFamilySummary:
    alias_target: str | None = None
    for alias in aliases:
        if str(getattr(alias, "alias_name", "") or "") == alias_name:
            alias_target = str(getattr(alias, "collection_name", "") or "") or None
            break

    physical_collections = tuple(
        sorted(
            {
                name
                for name in collection_names
                if name == alias_name or name.startswith(f"{collection_prefix}__")
            }
        )
    )
    return QdrantFamilySummary(
        alias_name=alias_name,
        alias_target=alias_target,
        collection_prefix=collection_prefix,
        physical_collections=physical_collections,
    )


def audit_collection_runtime_state(
    *,
    env: dict[str, str] | None = None,
    object_store: S3ObjectStoreAdmin | None = None,
    qdrant_client: QdrantClient | None = None,
) -> CollectionRuntimeAuditReport:
    source = dict(env if env is not None else os.environ)
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_qdrant_client = qdrant_client or _build_qdrant_client(
        QdrantAuditSettings.from_env(source)
    )
    release_keys = runtime_object_store.list_keys(
        bucket=object_store_settings.bucket_derived,
        prefix="regulations/releases/",
    )
    aliases = tuple(runtime_qdrant_client.get_aliases().aliases or ())
    collection_names = tuple(
        str(collection.name or "")
        for collection in runtime_qdrant_client.get_collections().collections or ()
        if str(collection.name or "")
    )

    targets: list[CollectionRuntimeRenameTargetAudit] = []
    for corpus, legacy_collection, canonical_collection in _RENAME_TARGETS:
        runtime_profile = load_runtime_profile(corpus, canonical_collection)
        binding = runtime_profile.qdrant_index_binding
        targets.append(
            CollectionRuntimeRenameTargetAudit(
                corpus=corpus,
                legacy_collection=legacy_collection,
                canonical_collection=canonical_collection,
                legacy_release_family=summarize_release_family(
                    corpus=corpus,
                    collection=legacy_collection,
                    keys=release_keys,
                ),
                canonical_release_family=summarize_release_family(
                    corpus=corpus,
                    collection=canonical_collection,
                    keys=release_keys,
                ),
                legacy_qdrant_family=summarize_qdrant_family(
                    alias_name=legacy_collection,
                    aliases=aliases,
                    collection_names=collection_names,
                    collection_prefix=legacy_collection,
                ),
                canonical_qdrant_family=summarize_qdrant_family(
                    alias_name=binding.alias_name,
                    aliases=aliases,
                    collection_names=collection_names,
                    collection_prefix=binding.collection_prefix,
                ),
            )
        )
    return CollectionRuntimeAuditReport(targets=tuple(targets))


def _build_qdrant_client(settings: QdrantAuditSettings) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=settings.qdrant_timeout_seconds,
        cloud_inference=False,
        check_compatibility=False,
        trust_env=False,
    )


__all__ = [
    "CollectionRuntimeAuditReport",
    "CollectionRuntimeRenameTargetAudit",
    "QdrantAuditSettings",
    "QdrantFamilySummary",
    "ReleaseFamilySummary",
    "audit_collection_runtime_state",
    "summarize_qdrant_family",
    "summarize_release_family",
]
