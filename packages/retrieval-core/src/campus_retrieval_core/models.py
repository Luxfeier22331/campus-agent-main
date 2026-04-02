from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import AuthorizedRetrievalFilter, PersonalizationHint
from campus_ingestion_core.scope_catalog import assert_known_scope


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query_text: str
    corpus: str
    collection: str
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

    def effective_visibility_scope(self) -> str | None:
        return self.effective_authorized_filter().visibility_scope

    def effective_visibility_level(self) -> str:
        return self.effective_authorized_filter().visibility_level or "public"

    def allows_document_access(
        self,
        *,
        visibility_level: str,
        entitlement_groups: tuple[str, ...] = (),
        visibility_scope: str | None = None,
    ) -> bool:
        normalized_visibility_level = visibility_level.strip() or "public"
        normalized_visibility_scope = visibility_scope.strip() if isinstance(visibility_scope, str) else None
        normalized_visibility_scope = normalized_visibility_scope or None

        if not self._allows_visibility_scope(normalized_visibility_scope):
            return False
        if normalized_visibility_level == "public":
            return True
        if normalized_visibility_level != "restricted":
            return False

        allowed_entitlements = set(self.effective_entitlement_groups())
        if not allowed_entitlements:
            return False
        normalized_entitlement_groups = {
            group.strip() for group in entitlement_groups if isinstance(group, str) and group.strip()
        }
        if not normalized_entitlement_groups:
            return False
        return bool(allowed_entitlements.intersection(normalized_entitlement_groups))

    def _allows_visibility_scope(self, document_visibility_scope: str | None) -> bool:
        if document_visibility_scope is None:
            return True
        request_visibility_scope = self.effective_visibility_scope()
        if request_visibility_scope is None:
            return False
        return request_visibility_scope == document_visibility_scope
