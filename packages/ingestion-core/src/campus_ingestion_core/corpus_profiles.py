from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from campus_contracts import ALLOWED_CORPORA


ALLOWED_PHASE1_STAGES = ("query_serving", "cleaned_ingestion")
ALLOWED_ARTIFACT_MODES = ("normalized", "provider_only")


@dataclass(frozen=True, slots=True)
class CollectionRuntimeProfile:
    corpus: str
    collection: str
    phase1_stage: str
    allowed_artifact_modes: tuple[str, ...]
    split_manifest_required: bool
    cleaning_policy_version: str
    chunk_profile_version: str
    retrieval_enabled: bool
    default_query_enabled: bool

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if not self.collection:
            raise ValueError("collection is required")
        if self.phase1_stage not in ALLOWED_PHASE1_STAGES:
            raise ValueError(f"unsupported phase1_stage: {self.phase1_stage}")
        if not self.allowed_artifact_modes:
            raise ValueError("allowed_artifact_modes must not be empty")
        for mode in self.allowed_artifact_modes:
            if mode not in ALLOWED_ARTIFACT_MODES:
                raise ValueError(f"unsupported artifact mode: {mode}")
        if not self.cleaning_policy_version:
            raise ValueError("cleaning_policy_version is required")
        if not self.chunk_profile_version:
            raise ValueError("chunk_profile_version is required")


def load_runtime_profile(
    corpus: str,
    collection: str,
    *,
    config_root: Path | None = None,
) -> CollectionRuntimeProfile:
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    if not collection:
        raise ValueError("collection is required")
    root = Path(config_root) if config_root is not None else _default_config_root()
    path = root / corpus / collection / "runtime-profile.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return CollectionRuntimeProfile(
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        phase1_stage=str(payload.get("phase1_stage") or ""),
        allowed_artifact_modes=tuple(str(item) for item in list(payload.get("allowed_artifact_modes") or [])),
        split_manifest_required=bool(payload.get("split_manifest_required")),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        chunk_profile_version=str(payload.get("chunk_profile_version") or ""),
        retrieval_enabled=bool(payload.get("retrieval_enabled")),
        default_query_enabled=bool(payload.get("default_query_enabled")),
    )


def default_query_scopes(*, config_root: Path | None = None) -> tuple[tuple[str, str], ...]:
    root = Path(config_root) if config_root is not None else _default_config_root()
    scopes: list[tuple[str, str]] = []
    for corpus_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        corpus = corpus_dir.name
        if corpus not in ALLOWED_CORPORA:
            continue
        for collection_dir in sorted(path for path in corpus_dir.iterdir() if path.is_dir()):
            collection = collection_dir.name
            profile = load_runtime_profile(corpus, collection, config_root=root)
            if profile.default_query_enabled:
                scopes.append((corpus, collection))
    return tuple(scopes)


def _default_config_root() -> Path:
    return Path(__file__).resolve().parents[4] / "configs" / "ingestion"
