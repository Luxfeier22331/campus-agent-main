from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class CollectionTruthConfig:
    corpus: str
    collection: str
    config_root: Path
    runtime_profile_path: Path
    split_manifest_path: Path
    canonical_profile_path: Path
    chunk_profile_path: Path
    source_projections_path: Path | None = None


def resolve_collection_truth_config(corpus: str, collection: str) -> CollectionTruthConfig:
    config_root = _repo_root() / "configs" / "ingestion" / corpus / collection
    source_projections_path = config_root / "source-projections.v1.json"
    return CollectionTruthConfig(
        corpus=corpus,
        collection=collection,
        config_root=config_root,
        runtime_profile_path=config_root / "runtime-profile.json",
        split_manifest_path=config_root / "split-manifest.v1.json",
        canonical_profile_path=config_root / "canonical-profile.json",
        chunk_profile_path=config_root / "chunk-profile.json",
        source_projections_path=(source_projections_path if source_projections_path.exists() else None),
    )


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]
