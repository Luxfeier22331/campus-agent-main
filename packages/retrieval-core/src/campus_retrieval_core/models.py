from __future__ import annotations

from dataclasses import dataclass, field

from campus_ingestion_core.scope_catalog import assert_known_scope


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query_text: str
    corpus: str
    collection: str
    campus_scope: str | None = None
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    top_k: int = 3

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")
