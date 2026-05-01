from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_context import SelectedNoticeRef
from campus_contracts.models_shared import (
    HistoricalDowngradeReason,
    NoticeBodyAccessPolicy,
    NoticePublicSurfacePolicy,
    NoticeSourceFamily,
    NoticeTargetSurface,
    ToolBusinessOutcome,
    ToolFailCloseReason,
    _validate_historical_downgrade_reason,
    _validate_notice_body_access_policy,
    _validate_notice_public_surface_policy,
    _validate_notice_source_family,
    _validate_notice_target_surface,
    _validate_tool_business_outcome,
    _validate_tool_fail_close_reason,
)
from campus_contracts.models_temporal import TemporalQuery


@dataclass(frozen=True, slots=True)
class NoticeDisplayPolicy:
    public_surface: NoticePublicSurfacePolicy | str = "card_only"
    full_body_forbidden: bool = True
    body_access: NoticeBodyAccessPolicy | str = "none"

    def __post_init__(self) -> None:
        _validate_notice_public_surface_policy(self.public_surface)
        _validate_notice_body_access_policy(self.body_access)
        if not self.full_body_forbidden:
            raise ValueError("full_body_forbidden must be true for public notice display policy")


@dataclass(frozen=True, slots=True)
class NoticeCard:
    notice_id: str
    title: str
    source_family: NoticeSourceFamily | str
    source_url: str
    canonical_url: str = ""
    target_surface: NoticeTargetSurface | str = ""
    summary: str = ""
    published_at: str = ""
    effective_at: str = ""
    is_current: bool = False
    display_policy: NoticeDisplayPolicy = field(default_factory=NoticeDisplayPolicy)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if not self.title.strip():
            raise ValueError("title must not be empty")
        _validate_notice_source_family(self.source_family)
        if not self.source_url.strip():
            raise ValueError("source_url must not be empty")
        if self.target_surface:
            _validate_notice_target_surface(self.target_surface)


@dataclass(frozen=True, slots=True)
class NoticeContextProjection:
    projection_id: str
    notice_ref: SelectedNoticeRef
    content_hash: str
    source_url: str = ""
    body_excerpt: str = ""
    bounded_summary: str = ""
    extracted_facts: tuple[str, ...] = field(default_factory=tuple)
    attachment_refs: tuple[str, ...] = field(default_factory=tuple)
    provenance_refs: tuple[str, ...] = field(default_factory=tuple)
    display_policy: NoticeDisplayPolicy = field(
        default_factory=lambda: NoticeDisplayPolicy(public_surface="bounded_summary")
    )

    def __post_init__(self) -> None:
        if not self.projection_id.strip():
            raise ValueError("projection_id must not be empty")
        if not self.content_hash.strip():
            raise ValueError("content_hash must not be empty")
        if not self.display_policy.full_body_forbidden:
            raise ValueError("notice context projection forbids full body exposure")


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverPayload:
    query_text: str
    temporal_query: TemporalQuery = field(default_factory=TemporalQuery)
    source_families: tuple[NoticeSourceFamily | str, ...] = field(default_factory=tuple)
    target_surfaces: tuple[NoticeTargetSurface | str, ...] = field(default_factory=tuple)
    max_results: int = 5

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        for target_surface in self.target_surfaces:
            _validate_notice_target_surface(target_surface)
        if self.max_results <= 0:
            raise ValueError("max_results must be positive")


@dataclass(frozen=True, slots=True)
class CampusNoticeDiscoverResult:
    query_text: str
    outcome: ToolBusinessOutcome
    source_families: tuple[NoticeSourceFamily | str, ...] = field(
        default_factory=tuple, compare=False
    )
    notice_cards: tuple[NoticeCard, ...] = field(default_factory=tuple)
    queried_time_anchor: str = ""
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.query_text.strip():
            raise ValueError("query_text must not be empty")
        _validate_tool_business_outcome(self.outcome)
        for source_family in self.source_families:
            _validate_notice_source_family(source_family)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if (
            self.outcome in {"resolved_current", "resolved_historical_reference"}
            and not self.notice_cards
        ):
            raise ValueError("notice_cards must not be empty for resolved notice discovery results")
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed notice discovery results"
            )


@dataclass(frozen=True, slots=True)
class CampusNoticeGetPayload:
    notice_id: str
    source_family: NoticeSourceFamily | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        if self.source_family:
            _validate_notice_source_family(self.source_family)


@dataclass(frozen=True, slots=True)
class CampusNoticeGetResult:
    notice_id: str
    outcome: ToolBusinessOutcome
    title: str = ""
    source_family: NoticeSourceFamily | str = field(default="", compare=False)
    source_url: str = ""
    canonical_url: str = ""
    normalized_body: str = ""
    reference_only: bool = False
    display_policy: NoticeDisplayPolicy = field(default_factory=NoticeDisplayPolicy)
    body_excerpt: str = ""
    bounded_summary: str = ""
    extracted_facts: tuple[str, ...] = field(default_factory=tuple)
    target_surface: NoticeTargetSurface | str = field(default="", compare=False)
    published_at: str = ""
    effective_at: str = ""
    attachment_refs: tuple[str, ...] = field(default_factory=tuple)
    provenance_refs: tuple[str, ...] = field(default_factory=tuple)
    historical_downgrade_reason: HistoricalDowngradeReason | str = field(default="", compare=False)
    fail_close_reason: ToolFailCloseReason | str = field(default="", compare=False)

    def __post_init__(self) -> None:
        if not self.notice_id.strip():
            raise ValueError("notice_id must not be empty")
        _validate_tool_business_outcome(self.outcome)
        if self.source_family:
            _validate_notice_source_family(self.source_family)
        if self.target_surface:
            _validate_notice_target_surface(self.target_surface)
        if self.historical_downgrade_reason:
            _validate_historical_downgrade_reason(self.historical_downgrade_reason)
        if self.fail_close_reason:
            _validate_tool_fail_close_reason(self.fail_close_reason)
        if self.outcome in {"resolved_current", "resolved_historical_reference"}:
            if not self.title.strip():
                raise ValueError("title must not be empty for resolved notice results")
            if not self.source_family:
                raise ValueError("source_family must not be empty for resolved notice results")
            if not self.source_url.strip():
                raise ValueError("source_url must not be empty for resolved notice results")
            if not self.display_policy.full_body_forbidden:
                raise ValueError("notice get display policy must forbid full body exposure")
        if self.outcome == "temporarily_unverifiable" and not self.fail_close_reason:
            raise ValueError(
                "fail_close_reason must not be empty for fail-closed notice get results"
            )


__all__ = [
    "CampusNoticeDiscoverPayload",
    "CampusNoticeDiscoverResult",
    "CampusNoticeGetPayload",
    "CampusNoticeGetResult",
    "NoticeCard",
    "NoticeContextProjection",
    "NoticeDisplayPolicy",
]
