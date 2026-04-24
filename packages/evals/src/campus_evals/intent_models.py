from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import ContextProjection, KnowledgeScope, RequestedCapability, VersionQuery


@dataclass(frozen=True, slots=True)
class IntentCase:
    case_id: str
    user_goal: str
    expected_capability: str
    expected_task_kind: str
    expected_launch_state: str
    expected_next_action: str
    expected_scope_class: str
    expected_target: str
    requested_capability: RequestedCapability | None = None
    requested_scope: KnowledgeScope | None = None
    version_query: VersionQuery = field(default_factory=VersionQuery)
    context: ContextProjection = field(default_factory=ContextProjection)
    expected_policy_reason: str = ""
    expected_scope_reason: str = ""
    expected_allowed_tools: tuple[str, ...] = ()
    expected_error_code: str = ""
    critical: bool = False
    tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.case_id.strip():
            raise ValueError("case_id must not be empty")
        if not self.user_goal.strip():
            raise ValueError("user_goal must not be empty")
        if not self.expected_capability.strip() and not self.expected_error_code:
            raise ValueError("expected_capability must not be empty")
        if not self.expected_target.strip():
            raise ValueError("expected_target must not be empty")


@dataclass(frozen=True, slots=True)
class ObservedIntent:
    capability: str = ""
    task_kind: str = ""
    launch_state: str = ""
    next_action: str = ""
    scope_class: str = ""
    policy_reason: str = ""
    scope_reason: str = ""
    target: str = "none"
    allowed_tools: tuple[str, ...] = ()
    classifier_version: str = ""
    error_code: str = ""


@dataclass(frozen=True, slots=True)
class IntentCaseResult:
    case_id: str
    passed: bool
    critical: bool
    observed: ObservedIntent
    mismatches: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class IntentEvalReport:
    total: int
    passed: int
    failed: int
    overall_exact_match_rate: float | None
    critical_total: int
    critical_passed: int
    critical_gate_pass_rate: float | None
    confusion: dict[str, dict[str, int]]
    results: tuple[IntentCaseResult, ...]


__all__ = [
    "IntentCase",
    "IntentCaseResult",
    "IntentEvalReport",
    "ObservedIntent",
]
