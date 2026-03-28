from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import AuthorizedRetrievalFilter, PersonalizationHint
from campus_ingestion_core.scope_catalog import assert_known_scope


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query_text: str
    corpus: str
    collection: str
    campus_scope: str | None = None
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    authorized_filter: AuthorizedRetrievalFilter | None = None
    personalization_hint: PersonalizationHint | None = None
    top_k: int = 3

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")

    def effective_authorized_filter(self) -> AuthorizedRetrievalFilter:
        if self.authorized_filter is not None:
            return self.authorized_filter
        return AuthorizedRetrievalFilter(
            acl_groups=self.acl_groups,
            visibility_scope=self.campus_scope,
            campus_scope=self.campus_scope,
        )

    def effective_acl_groups(self) -> tuple[str, ...]:
        return self.effective_authorized_filter().acl_groups

    def effective_visibility_scope(self) -> str | None:
        authorized_filter = self.effective_authorized_filter()
        return authorized_filter.visibility_scope or authorized_filter.campus_scope
