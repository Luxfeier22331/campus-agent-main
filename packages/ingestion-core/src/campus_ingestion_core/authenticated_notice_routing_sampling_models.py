from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class AuthenticatedNoticeRoutingObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingSample:
    notice_id: str
    notice_title: str
    notice_type_names: tuple[str, ...]
    notice_family: str
    admission_policy: str
    priority: int
    suggested_consumption_route: str
    machine_processing_policy: str
    attachment_processing_policy: str
    attachment_processing_reason: str
    matched_title_patterns: tuple[str, ...]
    matched_body_patterns: tuple[str, ...]
    attachment_ref_count: int = 0
    attachment_document_count: int = 0
    text_extractable_count: int = 0
    ocr_required_count: int = 0
    reference_only_count: int = 0
    multimodal_processing_required_count: int = 0
    reviewer_verdict: str = ""


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingDecision:
    suggested_consumption_route: str
    machine_processing_policy: str
    attachment_processing_policy: str
    attachment_processing_reason: str


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingSampleReport:
    source_corpus: str
    source_collection: str
    notice_count: int
    sample_limit_per_group: int
    boundary_sample_limit: int
    family_counts: dict[str, int]
    admission_policy_counts: dict[str, int]
    suggested_consumption_route_counts: dict[str, int]
    machine_processing_policy_counts: dict[str, int]
    attachment_processing_policy_counts: dict[str, int]
    attachment_processing_ref_counts: dict[str, int]
    samples: tuple[AuthenticatedNoticeRoutingSample, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingResidualCluster:
    cluster_id: str
    count: int
    notice_type_names: tuple[str, ...]
    title_signature: str
    action_signals: tuple[str, ...]
    service_signals: tuple[str, ...]
    publicity_signals: tuple[str, ...]
    attachment_bucket: str
    recommended_action: str
    sample_notice_ids: tuple[str, ...]
    sample_titles: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingAuditReport:
    source_corpus: str
    source_collection: str
    notice_count: int
    family_counts: dict[str, int]
    admission_policy_counts: dict[str, int]
    suggested_consumption_route_counts: dict[str, int]
    machine_processing_policy_counts: dict[str, int]
    attachment_processing_policy_counts: dict[str, int]
    attachment_processing_ref_counts: dict[str, int]
    residual_count: int
    residual_notices: tuple[AuthenticatedNoticeRoutingSample, ...]
    residual_clusters: tuple[AuthenticatedNoticeRoutingResidualCluster, ...]


__all__ = [
    "AuthenticatedNoticeRoutingAuditReport",
    "AuthenticatedNoticeRoutingDecision",
    "AuthenticatedNoticeRoutingObjectStore",
    "AuthenticatedNoticeRoutingResidualCluster",
    "AuthenticatedNoticeRoutingSample",
    "AuthenticatedNoticeRoutingSampleReport",
]
