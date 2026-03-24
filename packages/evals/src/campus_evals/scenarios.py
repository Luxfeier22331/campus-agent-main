from __future__ import annotations

from campus_contracts import ActorContext, KnowledgeScope

from campus_evals.models import GoldenCase


def student_handbook_smoke_cases() -> tuple[GoldenCase, ...]:
    goals = (
        "library hours",
        "scholarship eligibility",
        "graduation credits",
        "registrar transcript",
        "add/drop",
        "leave of absence",
    )
    return tuple(
        GoldenCase(
            case_id=f"student-handbook-smoke-{index}",
            split="smoke",
            source_type="synthetic_expansion",
            user_goal=goal,
            actor=ActorContext(),
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_status="completed",
            generator_name="bootstrap-smoke-generator",
            generator_version="v1",
            generation_recipe="phase1-handbook-smoke-topics",
            tags=("phase1", "student_handbook", "smoke"),
        )
        for index, goal in enumerate(goals, start=1)
    )
