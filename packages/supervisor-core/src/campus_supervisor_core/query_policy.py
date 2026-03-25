from __future__ import annotations

from campus_contracts import KnowledgeScope

from campus_supervisor_core.errors import DisallowedKnowledgeScopeError


QUERY_ENABLED_SCOPES: frozenset[tuple[str, str]] = frozenset(
    {
        ("regulations", "student_handbook"),
    }
)


def assert_scope_is_query_enabled(scope: KnowledgeScope) -> None:
    if (scope.corpus, scope.collection) in QUERY_ENABLED_SCOPES:
        return
    raise DisallowedKnowledgeScopeError(
        f"knowledge scope {scope.corpus}/{scope.collection} is not query-enabled"
    )
