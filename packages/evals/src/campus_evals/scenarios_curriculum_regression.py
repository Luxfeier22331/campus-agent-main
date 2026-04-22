from __future__ import annotations

from campus_contracts import ActorContext

from campus_evals.models import GoldenCase, TraceExpectation
from campus_evals.scenarios_curriculum_regression_locked import (
    curriculum_regression_locked_cases,
)
from campus_evals.scenarios_shared import _curriculum_scope

__all__ = ("curriculum_error_gate_cases", "curriculum_regression_locked_cases")


def curriculum_error_gate_cases() -> tuple[GoldenCase, ...]:
    scope = _curriculum_scope()
    return (
        GoldenCase(
            case_id="curriculum-error-gate-retrieval-backend-failure",
            split="release_gate",
            source_type="expert_authored",
            user_goal="模拟 curriculum retrieval backend 故障",
            actor=ActorContext(),
            scope=scope,
            expected_status="error",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=True,
                fail_closed_expected=True,
            ),
            tags=("curriculum", "release_gate", "error_gate"),
            notes="deterministic retrieval backend failure injection",
            metadata={"failure_mode": "retrieval_backend_failure"},
        ),
        GoldenCase(
            case_id="curriculum-error-gate-evidence-shaping-failure",
            split="release_gate",
            source_type="expert_authored",
            user_goal="模拟 curriculum evidence shaping 故障",
            actor=ActorContext(),
            scope=scope,
            expected_status="error",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=True,
                fail_closed_expected=True,
            ),
            tags=("curriculum", "release_gate", "error_gate"),
            notes="deterministic evidence shaping failure injection",
            metadata={"failure_mode": "evidence_shaping_failure"},
        ),
        GoldenCase(
            case_id="curriculum-error-gate-invalid-backend-contract",
            split="release_gate",
            source_type="expert_authored",
            user_goal="模拟 curriculum backend contract 非法返回",
            actor=ActorContext(),
            scope=scope,
            expected_status="error",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=True,
                fail_closed_expected=True,
            ),
            tags=("curriculum", "release_gate", "error_gate"),
            notes="deterministic backend contract failure injection",
            metadata={"failure_mode": "invalid_backend_contract"},
        ),
    )
