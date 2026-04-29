from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_QDRANT_DENSE_VECTOR_NAME = "dense"
DEFAULT_QDRANT_SPARSE_VECTOR_NAME = "sparse"


@dataclass(frozen=True, slots=True)
class CollectionScope:
    corpus: str
    collection: str

    def __post_init__(self) -> None:
        self._validate_segment(self.corpus, "corpus")
        self._validate_segment(self.collection, "collection")

    @staticmethod
    def _validate_segment(value: str, field_name: str) -> None:
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{field_name} is required")
        if "/" in normalized:
            raise ValueError(f"{field_name} must not contain slash")


@dataclass(frozen=True, slots=True)
class QdrantIndexBinding:
    alias_name: str
    collection_prefix: str
    dense_vector_name: str = DEFAULT_QDRANT_DENSE_VECTOR_NAME
    sparse_vector_name: str = DEFAULT_QDRANT_SPARSE_VECTOR_NAME

    def __post_init__(self) -> None:
        for field_name, value in (
            ("alias_name", self.alias_name),
            ("collection_prefix", self.collection_prefix),
            ("dense_vector_name", self.dense_vector_name),
            ("sparse_vector_name", self.sparse_vector_name),
        ):
            normalized = value.strip()
            if not normalized:
                raise ValueError(f"{field_name} is required")
            if "/" in normalized:
                raise ValueError(f"{field_name} must not contain slash")

    def build_physical_collection_name(self, release_id: str) -> str:
        normalized_release_id = release_id.strip()
        if not normalized_release_id:
            raise ValueError("release_id is required")
        if "/" in normalized_release_id:
            raise ValueError("release_id must not contain slash")
        return f"{self.collection_prefix}__{normalized_release_id}"


def default_config_root() -> Path:
    return Path(__file__).resolve().parents[4] / "configs" / "ingestion"


def list_corpora(*, config_root: Path | None = None) -> tuple[str, ...]:
    root = Path(config_root) if config_root is not None else default_config_root()
    if not root.exists():
        return ()
    return tuple(sorted(path.name for path in root.iterdir() if path.is_dir()))


def list_collection_scopes(*, config_root: Path | None = None) -> tuple[CollectionScope, ...]:
    root = Path(config_root) if config_root is not None else default_config_root()
    if not root.exists():
        return ()
    scopes: list[CollectionScope] = []
    for corpus_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        for collection_dir in sorted(path for path in corpus_dir.iterdir() if path.is_dir()):
            scopes.append(CollectionScope(corpus=corpus_dir.name, collection=collection_dir.name))
    return tuple(scopes)


def assert_known_corpus(corpus: str, *, config_root: Path | None = None) -> str:
    normalized = corpus.strip()
    if not normalized:
        raise ValueError("corpus is required")
    if normalized not in list_corpora(config_root=config_root):
        raise ValueError(f"unsupported corpus: {normalized}")
    return normalized


def assert_known_scope(
    corpus: str, collection: str, *, config_root: Path | None = None
) -> CollectionScope:
    root = Path(config_root) if config_root is not None else default_config_root()
    normalized_corpus = assert_known_corpus(corpus, config_root=root)
    normalized_collection = collection.strip()
    if not normalized_collection:
        raise ValueError("collection is required")
    path = root / normalized_corpus / normalized_collection
    if not path.is_dir():
        raise ValueError(
            f"unsupported collection scope: {normalized_collection} does not belong to {normalized_corpus}"
        )
    return CollectionScope(corpus=normalized_corpus, collection=normalized_collection)
