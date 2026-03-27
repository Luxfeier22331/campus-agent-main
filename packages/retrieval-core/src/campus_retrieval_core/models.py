from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import (
    ALLOWED_CORPORA,
    KNOWN_COLLECTION_TO_CORPUS,
)


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query_text: str
    corpus: str
    collection: str
    campus_scope: str | None = None
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    top_k: int = 3

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        expected_corpus = KNOWN_COLLECTION_TO_CORPUS.get(self.collection)
        if expected_corpus is not None and expected_corpus != self.corpus:
            raise ValueError(f"unsupported retrieval scope: {self.collection} does not belong to {self.corpus}")
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")
