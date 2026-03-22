from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import DelegateToRagAgentRequest
from campus_evals.expectations import StudentHandbookExpectation


@dataclass(frozen=True, slots=True)
class StudentHandbookScenario:
    request: DelegateToRagAgentRequest
    expectation: StudentHandbookExpectation


def high_frequency_scenarios() -> tuple[StudentHandbookScenario, ...]:
    goals = (
        "library hours",
        "scholarship eligibility",
        "graduation credits",
        "registrar transcript",
        "add/drop",
        "leave of absence",
    )
    return (
        *(
            StudentHandbookScenario(
                request=DelegateToRagAgentRequest(user_goal=goal),
                expectation=StudentHandbookExpectation(user_goal=goal),
            )
            for goal in goals
        ),
    )
