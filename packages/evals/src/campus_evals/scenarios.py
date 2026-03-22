from __future__ import annotations

from campus_contracts import ActorContext

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
            source_type="expert_authored",
            user_goal=goal,
            actor=ActorContext(),
            corpora=("student_handbook",),
            expected_status="completed",
            expected_evidence_corpus="student_handbook",
        )
        for index, goal in enumerate(goals, start=1)
    )
