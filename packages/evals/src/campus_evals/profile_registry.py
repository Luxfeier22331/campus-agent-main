from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ArtifactKind = Literal["case_results", "profile_report", "composite_gate", "report_only"]
RunnerKind = Literal[
    "handbook",
    "curriculum",
    "official_web",
    "release_gate",
    "profile_gate",
    "composite_gate",
    "report_only",
]


@dataclass(frozen=True, slots=True)
class EvalProfileDefinition:
    profile_id: str
    runner_kind: RunnerKind
    default_reruns: int
    output_prefix: str
    artifact_kind: ArtifactKind
    official_web_scope: str | None = None
    supports_collect_runtime: bool = False
    supports_case_results_publish: bool = False
    supports_profile_publish: bool = False
    dispatchable: bool = True
    operations_policy_subject: bool = True
    operations_profile_id: str | None = None

    @property
    def policy_profile_id(self) -> str:
        return self.operations_profile_id or self.profile_id.replace("-", "_")


_PROFILE_DEFINITIONS = (
    EvalProfileDefinition(
        "handbook",
        "handbook",
        3,
        "student-handbook-formal-benchmark-accept",
        "case_results",
        supports_case_results_publish=True,
    ),
    EvalProfileDefinition(
        "curriculum",
        "curriculum",
        3,
        "curriculum-plan-live-gate-accept",
        "case_results",
        supports_case_results_publish=True,
    ),
    EvalProfileDefinition(
        "official-web-stable-reference",
        "official_web",
        1,
        "official-web-stable-reference-live-gate-accept",
        "case_results",
        official_web_scope="stable_reference",
        supports_case_results_publish=True,
    ),
    EvalProfileDefinition(
        "official-web-fresh-news",
        "official_web",
        1,
        "official-web-fresh-news-live-gate-accept",
        "case_results",
        official_web_scope="fresh_news",
        supports_case_results_publish=True,
    ),
    EvalProfileDefinition(
        "service-guide-lookup",
        "release_gate",
        1,
        "service-guide-lookup-release-gate-accept",
        "composite_gate",
    ),
    EvalProfileDefinition(
        "contact-directory-lookup",
        "release_gate",
        1,
        "contact-directory-lookup-release-gate-accept",
        "composite_gate",
    ),
    EvalProfileDefinition(
        "campus-services-product-path",
        "composite_gate",
        1,
        "campus-services-product-path-opening-gate-accept",
        "composite_gate",
    ),
    EvalProfileDefinition(
        "multi-agent-runtime-contract",
        "composite_gate",
        1,
        "multi-agent-runtime-contract-gate-accept",
        "composite_gate",
    ),
    EvalProfileDefinition(
        "multi-agent-live-smoke",
        "composite_gate",
        1,
        "multi-agent-live-smoke-gate-accept",
        "composite_gate",
        dispatchable=False,
        operations_policy_subject=False,
    ),
    EvalProfileDefinition(
        "public-chat-product-path",
        "profile_gate",
        1,
        "public-chat-product-path-gate-accept",
        "profile_report",
        supports_collect_runtime=True,
        supports_profile_publish=True,
        operations_profile_id="public_chat_product_path",
    ),
    EvalProfileDefinition(
        "public-chat-entry-e2e",
        "profile_gate",
        1,
        "public-chat-entry-e2e-gate-accept",
        "profile_report",
        supports_profile_publish=True,
    ),
    EvalProfileDefinition(
        "tool-family-denominator",
        "profile_gate",
        1,
        "tool-family-denominator-gate-accept",
        "profile_report",
        supports_collect_runtime=True,
        operations_profile_id="tool_family_denominator",
    ),
    EvalProfileDefinition(
        "tool-routing-product-path",
        "profile_gate",
        1,
        "tool-routing-product-path-gate-accept",
        "profile_report",
    ),
    EvalProfileDefinition(
        "document-quality",
        "profile_gate",
        1,
        "document-quality-gate-accept",
        "profile_report",
        operations_profile_id="document_quality",
    ),
    EvalProfileDefinition(
        "authz-privacy",
        "profile_gate",
        1,
        "authz-privacy-gate-accept",
        "profile_report",
        supports_collect_runtime=True,
        operations_profile_id="authz_privacy",
    ),
    EvalProfileDefinition(
        "agentic-retrieval-plan",
        "profile_gate",
        1,
        "agentic-retrieval-plan-gate-accept",
        "profile_report",
        supports_collect_runtime=True,
        operations_profile_id="agentic_retrieval_plan",
    ),
    EvalProfileDefinition(
        "answer-quality-contract",
        "profile_gate",
        1,
        "answer-quality-contract-gate-accept",
        "profile_report",
    ),
    EvalProfileDefinition(
        "institutional-rules-release-baseline",
        "composite_gate",
        1,
        "institutional-rules-release-baseline-gate-accept",
        "composite_gate",
        dispatchable=False,
        operations_policy_subject=False,
    ),
    EvalProfileDefinition(
        "eval-operations-governance",
        "profile_gate",
        1,
        "eval-operations-governance-gate-accept",
        "profile_report",
        operations_policy_subject=False,
        operations_profile_id="eval_operations_governance",
    ),
    EvalProfileDefinition(
        "quality-calibration",
        "report_only",
        1,
        "quality-calibration-report",
        "report_only",
        operations_policy_subject=False,
        supports_profile_publish=True,
        operations_profile_id="quality_calibration",
    ),
)

_PROFILE_BY_ID = {definition.profile_id: definition for definition in _PROFILE_DEFINITIONS}


def iter_profile_definitions() -> tuple[EvalProfileDefinition, ...]:
    return _PROFILE_DEFINITIONS


def accepted_profile_ids() -> tuple[str, ...]:
    return tuple(sorted(_PROFILE_BY_ID))


def dispatchable_profile_ids() -> tuple[str, ...]:
    return tuple(
        definition.profile_id for definition in _PROFILE_DEFINITIONS if definition.dispatchable
    )


def operations_policy_profile_ids() -> tuple[str, ...]:
    return tuple(
        definition.policy_profile_id
        for definition in _PROFILE_DEFINITIONS
        if definition.operations_policy_subject
    )


def resolve_profile_id(profile_id: str) -> str:
    normalized = profile_id.strip().lower()
    if normalized in _PROFILE_BY_ID:
        return normalized
    allowed = ", ".join(accepted_profile_ids())
    raise ValueError(f"unsupported eval profile {profile_id!r}; expected one of {allowed}")


def get_profile_definition(profile_id: str) -> EvalProfileDefinition:
    return _PROFILE_BY_ID[resolve_profile_id(profile_id)]
