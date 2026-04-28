from __future__ import annotations

import re
from collections.abc import Mapping

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_models import (
    AuthenticatedNoticeRoutingDecision,
)


def resolve_authenticated_notice_routing_decision(
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    family: str,
    admission_policy: str,
    title: str = "",
    body: str = "",
    attachment_counts: Mapping[str, int],
) -> AuthenticatedNoticeRoutingDecision:
    policy = _resolve_family_route_policy(config=config, family=family)
    suggested_consumption_route = policy.consumption_route
    machine_processing_policy = policy.machine_processing_policy
    if family == config.default_family and admission_policy == config.default_admission_policy:
        override = _resolve_default_family_route_override(
            config=config,
            title=title,
            body=body,
        )
        if override is not None:
            suggested_consumption_route = override.consumption_route
            machine_processing_policy = override.machine_processing_policy
        elif _is_terminal_no_adoption_title(config=config, title=title):
            suggested_consumption_route = "no_adoption"
            machine_processing_policy = "skip"
    resolved_machine_processing_policy = _resolve_machine_processing_policy(
        config=config,
        base_policy=machine_processing_policy,
        suggested_consumption_route=suggested_consumption_route,
        title=title,
        body=body,
        multimodal_processing_required_count=int(
            attachment_counts.get("multimodal_processing_required_count") or 0
        ),
    )
    return AuthenticatedNoticeRoutingDecision(
        suggested_consumption_route=suggested_consumption_route,
        machine_processing_policy=resolved_machine_processing_policy,
        attachment_processing_policy=_resolve_attachment_processing_policy(
            suggested_consumption_route=suggested_consumption_route,
            machine_processing_policy=resolved_machine_processing_policy,
            attachment_counts=attachment_counts,
        ),
        attachment_processing_reason=_resolve_attachment_processing_reason(
            policy=policy,
            suggested_consumption_route=suggested_consumption_route,
            machine_processing_policy=resolved_machine_processing_policy,
            attachment_counts=attachment_counts,
        ),
    )


def _resolve_family_route_policy(
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    family: str,
):
    policy = config.routing_policy.family_policies.get(family)
    if policy is not None:
        return policy
    default_policy = config.routing_policy.family_policies.get(config.default_family)
    if default_policy is not None:
        return default_policy
    raise ValueError(f"routing policy is missing family {family!r}")


def _resolve_default_family_route_override(
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    title: str,
    body: str,
):
    text = _compact_routing_text(f"{title}\n{body}")
    for override in config.routing_policy.default_family_route_overrides:
        if any(_compact_routing_text(term) in text for term in override.any_terms):
            return override
    return None


def _is_terminal_no_adoption_title(
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    title: str,
) -> bool:
    normalized = _compact_terminal_title(title)
    return any(
        re.search(pattern, normalized, flags=re.IGNORECASE)
        for pattern in config.routing_policy.terminal_no_adoption_title_patterns
    )


def _compact_terminal_title(title: str) -> str:
    return re.sub(r"[\s《》“”\"'：:，,、（）()【】/\\—-]+", "", str(title or ""))


def _compact_routing_text(value: str) -> str:
    return "".join(str(value or "").split())


def _resolve_machine_processing_policy(
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    base_policy: str,
    suggested_consumption_route: str,
    title: str,
    body: str,
    multimodal_processing_required_count: int,
) -> str:
    if suggested_consumption_route in {"defer", "no_adoption"}:
        return "skip"
    if base_policy in {"skip", "not_required", "process"}:
        return base_policy
    text = _compact_routing_text(f"{title}\n{body}")
    has_value_signal = any(
        _compact_routing_text(term) in text
        for term in config.routing_policy.machine_processing_value_terms
    )
    if multimodal_processing_required_count <= 0:
        return "not_required"
    if has_value_signal:
        return "process"
    return "process"


def _resolve_attachment_processing_policy(
    *,
    suggested_consumption_route: str,
    machine_processing_policy: str,
    attachment_counts: Mapping[str, int],
) -> str:
    if suggested_consumption_route in {"defer", "no_adoption"}:
        return "metadata_only"
    if machine_processing_policy == "skip":
        return "metadata_only"
    attachment_ref_count = int(attachment_counts.get("attachment_ref_count") or 0)
    if attachment_ref_count <= 0:
        return "not_required"
    return "process"


def _resolve_attachment_processing_reason(
    *,
    policy,
    suggested_consumption_route: str,
    machine_processing_policy: str,
    attachment_counts: Mapping[str, int],
) -> str:
    if suggested_consumption_route == "no_adoption":
        return policy.terminal_reason or "no_adoption_or_out_of_scope"
    if suggested_consumption_route == "defer":
        return policy.terminal_reason or "low_value_or_deferred_family"
    if machine_processing_policy == "skip":
        return "route_skips_attachment_processing"
    attachment_ref_count = int(attachment_counts.get("attachment_ref_count") or 0)
    if attachment_ref_count <= 0:
        return "no_attachment_refs"
    return "route_requires_attachment_processing"


__all__ = ["resolve_authenticated_notice_routing_decision"]
