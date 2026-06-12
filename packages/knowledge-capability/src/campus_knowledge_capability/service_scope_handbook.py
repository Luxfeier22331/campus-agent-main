from __future__ import annotations

from campus_contracts import KnowledgeScope

from campus_knowledge_capability.query_planning import (
    HandbookQueryPlan,
    plan_student_handbook_query,
)


def _plan_handbook_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> HandbookQueryPlan | None:
    if scope.corpus != "regulations" or scope.collection != "student_rules":
        return None
    return plan_student_handbook_query(user_goal)


__all__ = ["_plan_handbook_query"]
