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
    target_document_ids: tuple[str, ...] = field(default_factory=tuple)
    preferred_document_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_course_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_course_family_ids: tuple[str, ...] = field(default_factory=tuple)
    canonical_program_family_ids: tuple[str, ...] = field(default_factory=tuple)
    authorized_filter: AuthorizedRetrievalFilter | None = None
    personalization_hint: PersonalizationHint | None = None
    top_k: int = 3

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")
        normalized_target_document_ids = tuple(
            doc_id.strip()
            for doc_id in self.target_document_ids
            if isinstance(doc_id, str) and doc_id.strip()
        )
        if normalized_target_document_ids != self.target_document_ids:
            object.__setattr__(self, "target_document_ids", normalized_target_document_ids)
        normalized_preferred_document_ids = tuple(
            doc_id.strip()
            for doc_id in self.preferred_document_ids
            if isinstance(doc_id, str) and doc_id.strip()
        )
        if normalized_preferred_document_ids != self.preferred_document_ids:
            object.__setattr__(self, "preferred_document_ids", normalized_preferred_document_ids)
        normalized_canonical_course_ids = tuple(
            value.strip()
            for value in self.canonical_course_ids
            if isinstance(value, str) and value.strip()
        )
        if normalized_canonical_course_ids != self.canonical_course_ids:
            object.__setattr__(self, "canonical_course_ids", normalized_canonical_course_ids)
        normalized_canonical_course_family_ids = tuple(
            value.strip()
            for value in self.canonical_course_family_ids
            if isinstance(value, str) and value.strip()
        )
        if normalized_canonical_course_family_ids != self.canonical_course_family_ids:
            object.__setattr__(self, "canonical_course_family_ids", normalized_canonical_course_family_ids)
        normalized_canonical_program_family_ids = tuple(
            value.strip()
            for value in self.canonical_program_family_ids
            if isinstance(value, str) and value.strip()
        )
        if normalized_canonical_program_family_ids != self.canonical_program_family_ids:
            object.__setattr__(self, "canonical_program_family_ids", normalized_canonical_program_family_ids)

    def effective_authorized_filter(self) -> AuthorizedRetrievalFilter:
        if self.authorized_filter is not None:
            return self.authorized_filter
        return AuthorizedRetrievalFilter()

    def effective_entitlement_groups(self) -> tuple[str, ...]:
        return self.effective_authorized_filter().entitlement_groups

    def effective_acl_groups(self) -> tuple[str, ...]:
        return self.effective_authorized_filter().acl_groups

    def effective_visibility_scope(self) -> str | None:
        return self.effective_authorized_filter().visibility_scope

    def effective_visibility_level(self) -> str:
        return self.effective_authorized_filter().visibility_level or "public"
