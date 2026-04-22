from __future__ import annotations

from collections import Counter

from campus_contracts import KnowledgeScope

from campus_evals.models import GoldenCase


def _handbook_scope() -> KnowledgeScope:
    return KnowledgeScope(corpus="regulations", collection="student_handbook")


def _curriculum_scope() -> KnowledgeScope:
    return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")


def _official_web_scope(*, collection: str = "muc_public_pages") -> KnowledgeScope:
    return KnowledgeScope(corpus="official_web", collection=collection)


def official_web_stable_reference_scope() -> KnowledgeScope:
    return _official_web_scope(collection="stable_reference")


def official_web_fresh_news_scope() -> KnowledgeScope:
    return _official_web_scope(collection="fresh_news")


def _reference_context_ids(*context_ids: str) -> tuple[str, ...]:
    return tuple(context_ids)


def _metric_overrides(**flags: bool) -> dict[str, bool]:
    return dict(flags)


def _validated_cases(
    *, inventory_name: str, cases: tuple[GoldenCase, ...]
) -> tuple[GoldenCase, ...]:
    duplicate_case_ids = tuple(
        case_id for case_id, count in Counter(case.case_id for case in cases).items() if count > 1
    )
    if duplicate_case_ids:
        duplicate_labels = ", ".join(sorted(duplicate_case_ids))
        raise ValueError(f"{inventory_name} contains duplicate case_id values: {duplicate_labels}")
    return cases
