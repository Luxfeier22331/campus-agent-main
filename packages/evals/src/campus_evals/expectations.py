from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import DelegateToRagAgentResponse


@dataclass(frozen=True, slots=True)
class ExpectationResult:
    passed: bool
    reason: str = ""


@dataclass(frozen=True, slots=True)
class StudentHandbookExpectation:
    user_goal: str

    def evaluate(self, response: DelegateToRagAgentResponse) -> ExpectationResult:
        if response.status != "completed":
            return ExpectationResult(False, f"status={response.status}")
        if not response.answer_text.strip():
            return ExpectationResult(False, "answer_text is empty")
        return ExpectationResult(True, "ok")
