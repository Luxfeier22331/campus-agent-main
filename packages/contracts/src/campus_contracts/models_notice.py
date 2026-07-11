from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    NoticeBodyAccessPolicy,
    NoticePublicSurfacePolicy,
    NoticeSourceFamily,
    NoticeTargetSurface,
    _validate_notice_body_access_policy,
    _validate_notice_public_surface_policy,
    _validate_notice_source_family,
    _validate_notice_target_surface,
)


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


__all__ = [
    "NoticeCard",
    "NoticeDisplayPolicy",
]
