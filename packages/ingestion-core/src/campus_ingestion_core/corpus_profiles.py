from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from campus_contracts import ALLOWED_REVISION_TRACKS

from campus_ingestion_core.scope_catalog import (
    DEFAULT_QDRANT_DENSE_VECTOR_NAME,
    DEFAULT_QDRANT_SPARSE_VECTOR_NAME,
    QdrantIndexBinding,
    assert_known_scope,
    default_config_root,
    list_collection_scopes,
)

ALLOWED_SERVING_STAGES = ("query_serving", "offline_preparation")
ALLOWED_SERVING_SURFACES = ("mixed", "stable_reference", "fresh_news", "news_archive")
OFFICIAL_WEB_STABLE_REFERENCE_LIKE_COLLECTIONS = frozenset({"muc_public_pages", "stable_reference"})
OFFICIAL_WEB_STABLE_REFERENCE_LIKE_SURFACES = frozenset({"mixed", "stable_reference"})
ALLOWED_ARTIFACT_MODES = ("normalized", "source_truth_only")
ALLOWED_LISTING_PAGE_ROLES = ("discovery_only", "navigation_fallback", "primary_evidence")
DEFAULT_DENSE_PREFETCH_LIMIT = 20
DEFAULT_SPARSE_PREFETCH_LIMIT = 20
DEFAULT_RRF_K = 60
DEFAULT_RRF_DENSE_WEIGHT = 1.0
DEFAULT_RRF_SPARSE_WEIGHT = 1.0
DEFAULT_DOCUMENT_SUPPORT_LIMIT = 24
DEFAULT_DOCUMENT_SUPPORT_STRATEGY = "followup_query"
ALLOWED_DOCUMENT_SUPPORT_STRATEGIES = (
    "followup_query",
    "targeted_overfetch",
)
DEFAULT_EMBEDDING_QUERY_INSTRUCTION = (
    "Given a campus policy or handbook question, retrieve relevant passages that answer the query."
)


@dataclass(frozen=True, slots=True)
class CollectionRuntimeProfile:
    corpus: str
    collection: str
    serving_stage: str
    allowed_artifact_modes: tuple[str, ...]
    split_manifest_required: bool
    cleaning_policy_version: str
    chunk_profile_version: str
    retrieval_enabled: bool
    query_enabled_by_default: bool
    source_ocr_provider: str | None = None
    source_ocr_model: str | None = None
    source_parser_version: str | None = None
    serving_surface: str | None = None
    supports_freshness_sensitive_queries: bool = False
    freshness_max_age_hours: int | None = None
    live_search_fallback_allowed: bool = False
    retrieval_top_k: int = 3
    current_only: bool = False
    serving_revision_tracks: tuple[str, ...] = ()
    required_metadata_fields: tuple[str, ...] = ()
    primary_evidence_page_families: tuple[str, ...] = ()
    listing_page_role: str | None = None
    requires_freshness_gate: bool = False
    requires_explicit_history_intent: bool = False
    duplicate_collapse_required: bool = False
    dense_prefetch_limit: int = DEFAULT_DENSE_PREFETCH_LIMIT
    sparse_prefetch_limit: int = DEFAULT_SPARSE_PREFETCH_LIMIT
    rrf_k: int = DEFAULT_RRF_K
    rrf_dense_weight: float = DEFAULT_RRF_DENSE_WEIGHT
    rrf_sparse_weight: float = DEFAULT_RRF_SPARSE_WEIGHT
    document_support_limit: int = DEFAULT_DOCUMENT_SUPPORT_LIMIT
    document_support_strategy: str = DEFAULT_DOCUMENT_SUPPORT_STRATEGY
    embedding_query_instruction: str = DEFAULT_EMBEDDING_QUERY_INSTRUCTION
    no_hit_min_top_score: float | None = None
    no_hit_min_score_gap: float | None = None
    qdrant_index_binding: QdrantIndexBinding = field(
        default_factory=lambda: QdrantIndexBinding(
            alias_name="unconfigured", collection_prefix="unconfigured"
        )
    )

    def __post_init__(self) -> None:
        if not self.corpus:
            raise ValueError("corpus is required")
        if not self.collection:
            raise ValueError("collection is required")
        if self.serving_stage not in ALLOWED_SERVING_STAGES:
            raise ValueError(f"unsupported serving_stage: {self.serving_stage}")
        if (
            self.serving_surface is not None
            and self.serving_surface not in ALLOWED_SERVING_SURFACES
        ):
            raise ValueError(f"unsupported serving_surface: {self.serving_surface}")
        if not self.allowed_artifact_modes:
            raise ValueError("allowed_artifact_modes must not be empty")
        for mode in self.allowed_artifact_modes:
            if mode not in ALLOWED_ARTIFACT_MODES:
                raise ValueError(f"unsupported artifact mode: {mode}")
        if not self.cleaning_policy_version:
            raise ValueError("cleaning_policy_version is required")
        if not self.chunk_profile_version:
            raise ValueError("chunk_profile_version is required")
        if self.retrieval_top_k <= 0:
            raise ValueError("retrieval_top_k must be greater than zero")
        if self.dense_prefetch_limit <= 0:
            raise ValueError("dense_prefetch_limit must be greater than zero")
        if self.sparse_prefetch_limit <= 0:
            raise ValueError("sparse_prefetch_limit must be greater than zero")
        if self.rrf_k <= 0:
            raise ValueError("rrf_k must be greater than zero")
        if self.rrf_dense_weight <= 0:
            raise ValueError("rrf_dense_weight must be greater than zero")
        if self.rrf_sparse_weight <= 0:
            raise ValueError("rrf_sparse_weight must be greater than zero")
        if self.document_support_limit <= 0:
            raise ValueError("document_support_limit must be greater than zero")
        if self.document_support_strategy not in ALLOWED_DOCUMENT_SUPPORT_STRATEGIES:
            raise ValueError(
                f"unsupported document_support_strategy: {self.document_support_strategy}"
            )
        if self.freshness_max_age_hours is not None and self.freshness_max_age_hours <= 0:
            raise ValueError("freshness_max_age_hours must be greater than zero")
        for revision_track in self.serving_revision_tracks:
            if revision_track not in ALLOWED_REVISION_TRACKS:
                raise ValueError(f"unsupported serving_revision_track: {revision_track}")
        for field_name in self.required_metadata_fields:
            if not field_name.strip():
                raise ValueError("required_metadata_fields must not contain empty values")
        for page_family in self.primary_evidence_page_families:
            if not page_family.strip():
                raise ValueError("primary_evidence_page_families must not contain empty values")
        if (
            self.listing_page_role is not None
            and self.listing_page_role not in ALLOWED_LISTING_PAGE_ROLES
        ):
            raise ValueError(f"unsupported listing_page_role: {self.listing_page_role}")
        if self.no_hit_min_top_score is not None and not 0.0 <= self.no_hit_min_top_score <= 1.0:
            raise ValueError("no_hit_min_top_score must be between zero and one")
        if self.no_hit_min_score_gap is not None and not 0.0 <= self.no_hit_min_score_gap <= 1.0:
            raise ValueError("no_hit_min_score_gap must be between zero and one")
        if not self.embedding_query_instruction.strip():
            raise ValueError("embedding_query_instruction is required")


@dataclass(frozen=True, slots=True)
class CollectionChunkRuntimeDefaults:
    strategy_name: str
    chunk_size: int
    max_chunk_size: int
    chunk_overlap: int
    min_chunk_size: int

    def __post_init__(self) -> None:
        if not self.strategy_name.strip():
            raise ValueError("strategy_name is required")
        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be greater than zero")
        if self.max_chunk_size < self.chunk_size:
            raise ValueError("max_chunk_size must be greater than or equal to chunk_size")
        if self.chunk_overlap < 0:
            raise ValueError("chunk_overlap must be greater than or equal to zero")
        if self.chunk_overlap >= self.max_chunk_size:
            raise ValueError("chunk_overlap must be less than max_chunk_size")
        if self.min_chunk_size <= 0:
            raise ValueError("min_chunk_size must be greater than zero")
        if self.min_chunk_size >= self.max_chunk_size:
            raise ValueError("min_chunk_size must be less than max_chunk_size")


@dataclass(frozen=True, slots=True)
class CollectionChunkProfile:
    corpus: str
    collection: str
    chunk_profile_version: str
    structured_input: str
    runtime_defaults: CollectionChunkRuntimeDefaults
    cleaning_policy_version: str
    lane_defaults: dict[str, CollectionChunkRuntimeDefaults] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.corpus:
            raise ValueError("corpus is required")
        if not self.collection:
            raise ValueError("collection is required")
        if not self.chunk_profile_version:
            raise ValueError("chunk_profile_version is required")
        if not self.structured_input:
            raise ValueError("structured_input is required")
        if not self.cleaning_policy_version:
            raise ValueError("cleaning_policy_version is required")
        for lane_name, defaults in self.lane_defaults.items():
            if not lane_name.strip():
                raise ValueError("lane_defaults must not contain empty lane names")
            if not isinstance(defaults, CollectionChunkRuntimeDefaults):
                raise ValueError("lane_defaults values must be CollectionChunkRuntimeDefaults")


def load_runtime_profile(
    corpus: str,
    collection: str,
    *,
    config_root: Path | None = None,
) -> CollectionRuntimeProfile:
    root = Path(config_root) if config_root is not None else default_config_root()
    scope = assert_known_scope(corpus, collection, config_root=root)
    path = root / scope.corpus / scope.collection / "runtime-profile.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return CollectionRuntimeProfile(
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        serving_stage=str(payload.get("serving_stage") or ""),
        serving_surface=_optional_text(payload.get("serving_surface")),
        allowed_artifact_modes=tuple(
            str(item) for item in list(payload.get("allowed_artifact_modes") or [])
        ),
        split_manifest_required=bool(payload.get("split_manifest_required")),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        chunk_profile_version=str(payload.get("chunk_profile_version") or ""),
        source_ocr_provider=_optional_text(payload.get("source_ocr_provider")),
        source_ocr_model=_optional_text(payload.get("source_ocr_model")),
        source_parser_version=_optional_text(payload.get("source_parser_version")),
        retrieval_enabled=bool(payload.get("retrieval_enabled")),
        query_enabled_by_default=bool(payload.get("query_enabled_by_default")),
        supports_freshness_sensitive_queries=bool(
            payload.get("supports_freshness_sensitive_queries", False)
        ),
        freshness_max_age_hours=_optional_int(payload.get("freshness_max_age_hours")),
        live_search_fallback_allowed=bool(payload.get("live_search_fallback_allowed", False)),
        retrieval_top_k=int(payload.get("retrieval_top_k") or 3),
        current_only=bool(payload.get("current_only", False)),
        serving_revision_tracks=tuple(
            str(item) for item in list(payload.get("serving_revision_tracks") or [])
        ),
        required_metadata_fields=tuple(
            str(item) for item in list(payload.get("required_metadata_fields") or [])
        ),
        primary_evidence_page_families=tuple(
            str(item) for item in list(payload.get("primary_evidence_page_families") or [])
        ),
        listing_page_role=_optional_text(payload.get("listing_page_role")),
        requires_freshness_gate=bool(payload.get("requires_freshness_gate", False)),
        requires_explicit_history_intent=bool(
            payload.get("requires_explicit_history_intent", False)
        ),
        duplicate_collapse_required=bool(payload.get("duplicate_collapse_required", False)),
        dense_prefetch_limit=int(
            payload.get("dense_prefetch_limit") or DEFAULT_DENSE_PREFETCH_LIMIT
        ),
        sparse_prefetch_limit=int(
            payload.get("sparse_prefetch_limit") or DEFAULT_SPARSE_PREFETCH_LIMIT
        ),
        rrf_k=int(payload.get("rrf_k") or DEFAULT_RRF_K),
        rrf_dense_weight=float(payload.get("rrf_dense_weight") or DEFAULT_RRF_DENSE_WEIGHT),
        rrf_sparse_weight=float(payload.get("rrf_sparse_weight") or DEFAULT_RRF_SPARSE_WEIGHT),
        document_support_limit=int(
            payload.get("document_support_limit") or DEFAULT_DOCUMENT_SUPPORT_LIMIT
        ),
        document_support_strategy=str(
            payload.get("document_support_strategy") or DEFAULT_DOCUMENT_SUPPORT_STRATEGY
        ),
        embedding_query_instruction=str(
            payload.get("embedding_query_instruction") or DEFAULT_EMBEDDING_QUERY_INSTRUCTION
        ),
        no_hit_min_top_score=_optional_float(payload.get("no_hit_min_top_score")),
        no_hit_min_score_gap=_optional_float(payload.get("no_hit_min_score_gap")),
        qdrant_index_binding=QdrantIndexBinding(
            alias_name=str(payload.get("qdrant_alias_name") or ""),
            collection_prefix=str(payload.get("qdrant_collection_prefix") or ""),
            dense_vector_name=(
                str(payload.get("qdrant_dense_vector_name") or DEFAULT_QDRANT_DENSE_VECTOR_NAME)
                or DEFAULT_QDRANT_DENSE_VECTOR_NAME
            ),
            sparse_vector_name=(
                str(payload.get("qdrant_sparse_vector_name") or DEFAULT_QDRANT_SPARSE_VECTOR_NAME)
                or DEFAULT_QDRANT_SPARSE_VECTOR_NAME
            ),
        ),
    )


def load_chunk_profile(
    corpus: str,
    collection: str,
    *,
    config_root: Path | None = None,
) -> CollectionChunkProfile:
    root = Path(config_root) if config_root is not None else default_config_root()
    scope = assert_known_scope(corpus, collection, config_root=root)
    path = root / scope.corpus / scope.collection / "chunk-profile.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    runtime_defaults_payload = dict(payload.get("runtime_defaults") or {})
    lane_defaults_payload = dict(payload.get("lane_defaults") or {})
    return CollectionChunkProfile(
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        chunk_profile_version=str(payload.get("chunk_profile_version") or ""),
        structured_input=str(payload.get("structured_input") or ""),
        runtime_defaults=CollectionChunkRuntimeDefaults(
            strategy_name=str(runtime_defaults_payload.get("strategy_name") or ""),
            chunk_size=int(runtime_defaults_payload.get("chunk_size") or 0),
            max_chunk_size=int(runtime_defaults_payload.get("max_chunk_size") or 0),
            chunk_overlap=int(runtime_defaults_payload.get("chunk_overlap") or 0),
            min_chunk_size=int(runtime_defaults_payload.get("min_chunk_size") or 0),
        ),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        lane_defaults={
            str(lane_name): CollectionChunkRuntimeDefaults(
                strategy_name=str(dict(lane_payload).get("strategy_name") or ""),
                chunk_size=int(dict(lane_payload).get("chunk_size") or 0),
                max_chunk_size=int(dict(lane_payload).get("max_chunk_size") or 0),
                chunk_overlap=int(dict(lane_payload).get("chunk_overlap") or 0),
                min_chunk_size=int(dict(lane_payload).get("min_chunk_size") or 0),
            )
            for lane_name, lane_payload in lane_defaults_payload.items()
            if isinstance(lane_payload, dict)
        },
    )


def default_query_scopes(*, config_root: Path | None = None) -> tuple[tuple[str, str], ...]:
    root = Path(config_root) if config_root is not None else default_config_root()
    scopes: list[tuple[str, str]] = []
    for scope in list_collection_scopes(config_root=root):
        try:
            profile = load_runtime_profile(scope.corpus, scope.collection, config_root=root)
        except (FileNotFoundError, ValueError):
            continue
        if profile.query_enabled_by_default:
            scopes.append((scope.corpus, scope.collection))
    return tuple(scopes)


def is_official_web_stable_reference_like_profile(profile: CollectionRuntimeProfile) -> bool:
    return profile.corpus == "official_web" and (
        profile.serving_surface in OFFICIAL_WEB_STABLE_REFERENCE_LIKE_SURFACES
        or profile.collection in OFFICIAL_WEB_STABLE_REFERENCE_LIKE_COLLECTIONS
    )


@cache
def is_official_web_stable_reference_like_collection(
    collection: str,
    *,
    config_root: Path | None = None,
) -> bool:
    normalized_collection = collection.strip()
    if not normalized_collection:
        return False
    try:
        profile = load_runtime_profile(
            "official_web",
            normalized_collection,
            config_root=config_root,
        )
    except (FileNotFoundError, ValueError):
        return False
    return is_official_web_stable_reference_like_profile(profile)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None
