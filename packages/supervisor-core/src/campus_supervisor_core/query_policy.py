from __future__ import annotations

from functools import lru_cache

from campus_contracts import KnowledgeScope
from campus_ingestion_core import default_query_scopes

from campus_supervisor_core.errors import DisallowedKnowledgeScopeError


@lru_cache(maxsize=1)
def query_enabled_scopes() -> frozenset[tuple[str, str]]:
    return frozenset(default_query_scopes())


def assert_scope_is_query_enabled(scope: KnowledgeScope) -> None:
    if (scope.corpus, scope.collection) in query_enabled_scopes():
        return
    raise DisallowedKnowledgeScopeError(
        f"knowledge scope {scope.corpus}/{scope.collection} is not query-enabled"
    )
