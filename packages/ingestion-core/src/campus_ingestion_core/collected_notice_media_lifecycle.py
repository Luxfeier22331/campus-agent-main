from __future__ import annotations

MEDIA_LIFECYCLE_PENDING = "pending"
MEDIA_LIFECYCLE_COMPLETED = "completed"
MEDIA_LIFECYCLE_SKIPPED = "skipped"
MEDIA_LIFECYCLE_MANUAL_REVIEW = "manual_review"
MEDIA_LIFECYCLE_FAILED_RETRYABLE = "failed_retryable"
MEDIA_LIFECYCLE_FAILED_TERMINAL = "failed_terminal"

MEDIA_LIFECYCLE_TERMINAL_STATUSES = frozenset(
    (
        MEDIA_LIFECYCLE_COMPLETED,
        MEDIA_LIFECYCLE_SKIPPED,
        MEDIA_LIFECYCLE_FAILED_TERMINAL,
    )
)
MEDIA_LIFECYCLE_NONTERMINAL_STATUSES = frozenset(
    (
        MEDIA_LIFECYCLE_PENDING,
        MEDIA_LIFECYCLE_MANUAL_REVIEW,
        MEDIA_LIFECYCLE_FAILED_RETRYABLE,
    )
)
MEDIA_LIFECYCLE_STATUSES = MEDIA_LIFECYCLE_TERMINAL_STATUSES | MEDIA_LIFECYCLE_NONTERMINAL_STATUSES


def normalize_media_lifecycle_status(status: object) -> str:
    normalized = str(status or "").strip()
    if normalized in MEDIA_LIFECYCLE_STATUSES:
        return normalized
    raise ValueError(f"media lifecycle status has unsupported value: {normalized}")


def is_media_lifecycle_terminal(status: object) -> bool:
    return normalize_media_lifecycle_status(status) in MEDIA_LIFECYCLE_TERMINAL_STATUSES


def is_media_lifecycle_cleanup_blocking(status: object) -> bool:
    return normalize_media_lifecycle_status(status) in MEDIA_LIFECYCLE_NONTERMINAL_STATUSES


__all__ = [
    "MEDIA_LIFECYCLE_COMPLETED",
    "MEDIA_LIFECYCLE_FAILED_RETRYABLE",
    "MEDIA_LIFECYCLE_FAILED_TERMINAL",
    "MEDIA_LIFECYCLE_MANUAL_REVIEW",
    "MEDIA_LIFECYCLE_NONTERMINAL_STATUSES",
    "MEDIA_LIFECYCLE_PENDING",
    "MEDIA_LIFECYCLE_SKIPPED",
    "MEDIA_LIFECYCLE_STATUSES",
    "MEDIA_LIFECYCLE_TERMINAL_STATUSES",
    "is_media_lifecycle_cleanup_blocking",
    "is_media_lifecycle_terminal",
    "normalize_media_lifecycle_status",
]
