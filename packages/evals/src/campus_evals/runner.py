from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse

from campus_evals.expectations import StudentHandbookExpectation
from campus_evals.scenarios import high_frequency_scenarios


@dataclass(frozen=True, slots=True)
class BaselineResult:
    user_goal: str
    passed: bool
    reason: str


@dataclass(frozen=True, slots=True)
class BaselineReport:
    total: int
    passed: int
    failed: int
    results: tuple[BaselineResult, ...]


Answerer = Callable[[DelegateToRagAgentRequest], DelegateToRagAgentResponse]


def run_student_handbook_baseline(*, answerer: Answerer) -> BaselineReport:
    results: list[BaselineResult] = []
    for scenario in high_frequency_scenarios():
        response = answerer(scenario.request)
        evaluation = scenario.expectation.evaluate(response)
        results.append(
            BaselineResult(
                user_goal=scenario.request.user_goal,
                passed=evaluation.passed,
                reason=evaluation.reason,
            )
        )
    passed = sum(1 for result in results if result.passed)
    total = len(results)
    return BaselineReport(total=total, passed=passed, failed=total - passed, results=tuple(results))
