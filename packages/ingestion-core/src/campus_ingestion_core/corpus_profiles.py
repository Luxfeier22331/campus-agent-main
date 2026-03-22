from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from campus_contracts import ALLOWED_CORPORA


ALLOWED_PHASE1_STAGES = ("query_serving", "cleaned_ingestion")
ALLOWED_ARTIFACT_MODES = ("normalized", "provider_only")


@dataclass(frozen=True, slots=True)
class CorpusRuntimeProfile:
    corpus: str
    phase1_stage: str
    allowed_artifact_modes: tuple[str, ...]
    split_manifest_required: bool
    cleaning_policy_version: str
    retrieval_enabled: bool
    default_query_enabled: bool

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if self.phase1_stage not in ALLOWED_PHASE1_STAGES:
            raise ValueError(f"unsupported phase1_stage: {self.phase1_stage}")
        if not self.allowed_artifact_modes:
            raise ValueError("allowed_artifact_modes must not be empty")
        for mode in self.allowed_artifact_modes:
            if mode not in ALLOWED_ARTIFACT_MODES:
                raise ValueError(f"unsupported artifact mode: {mode}")
        if not self.cleaning_policy_version:
            raise ValueError("cleaning_policy_version is required")


def load_corpus_runtime_profile(
    corpus: str,
    *,
    config_root: Path | None = None,
) -> CorpusRuntimeProfile:
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    root = Path(config_root) if config_root is not None else _default_config_root()
    path = root / corpus / "runtime-profile.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return CorpusRuntimeProfile(
        corpus=str(payload.get("corpus") or ""),
        phase1_stage=str(payload.get("phase1_stage") or ""),
        allowed_artifact_modes=tuple(str(item) for item in list(payload.get("allowed_artifact_modes") or [])),
        split_manifest_required=bool(payload.get("split_manifest_required")),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        retrieval_enabled=bool(payload.get("retrieval_enabled")),
        default_query_enabled=bool(payload.get("default_query_enabled")),
    )


def default_query_corpora(*, config_root: Path | None = None) -> tuple[str, ...]:
    root = Path(config_root) if config_root is not None else _default_config_root()
    return tuple(
        corpus
        for corpus in ALLOWED_CORPORA
        if load_corpus_runtime_profile(corpus, config_root=root).default_query_enabled
    )


def _default_config_root() -> Path:
    return Path(__file__).resolve().parents[4] / "configs" / "ingestion"
