from __future__ import annotations

from dataclasses import dataclass, field
import json
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
ALLOWED_ARTIFACT_MODES = ("normalized", "source_truth_only")


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
    retrieval_top_k: int = 3
    current_only: bool = False
    serving_revision_tracks: tuple[str, ...] = ()
    no_hit_min_top_score: float | None = None
    no_hit_min_score_gap: float | None = None
    qdrant_index_binding: QdrantIndexBinding = field(
        default_factory=lambda: QdrantIndexBinding(alias_name="unconfigured", collection_prefix="unconfigured")
    )

    def __post_init__(self) -> None:
        if not self.corpus:
            raise ValueError("corpus is required")
        if not self.collection:
            raise ValueError("collection is required")
        if self.serving_stage not in ALLOWED_SERVING_STAGES:
            raise ValueError(f"unsupported serving_stage: {self.serving_stage}")
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
        for revision_track in self.serving_revision_tracks:
            if revision_track not in ALLOWED_REVISION_TRACKS:
                raise ValueError(f"unsupported serving_revision_track: {revision_track}")
        if self.no_hit_min_top_score is not None and not 0.0 <= self.no_hit_min_top_score <= 1.0:
            raise ValueError("no_hit_min_top_score must be between zero and one")
        if self.no_hit_min_score_gap is not None and not 0.0 <= self.no_hit_min_score_gap <= 1.0:
            raise ValueError("no_hit_min_score_gap must be between zero and one")


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
        allowed_artifact_modes=tuple(str(item) for item in list(payload.get("allowed_artifact_modes") or [])),
        split_manifest_required=bool(payload.get("split_manifest_required")),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        chunk_profile_version=str(payload.get("chunk_profile_version") or ""),
        retrieval_enabled=bool(payload.get("retrieval_enabled")),
        query_enabled_by_default=bool(payload.get("query_enabled_by_default")),
        retrieval_top_k=int(payload.get("retrieval_top_k") or 3),
        current_only=bool(payload.get("current_only", False)),
        serving_revision_tracks=tuple(str(item) for item in list(payload.get("serving_revision_tracks") or [])),
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


def default_query_scopes(*, config_root: Path | None = None) -> tuple[tuple[str, str], ...]:
    root = Path(config_root) if config_root is not None else default_config_root()
    scopes: list[tuple[str, str]] = []
    for scope in list_collection_scopes(config_root=root):
        profile = load_runtime_profile(scope.corpus, scope.collection, config_root=root)
        if profile.query_enabled_by_default:
            scopes.append((scope.corpus, scope.collection))
    return tuple(scopes)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)
