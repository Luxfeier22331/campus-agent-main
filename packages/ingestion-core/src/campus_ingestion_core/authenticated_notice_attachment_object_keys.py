from __future__ import annotations

import re

LEGACY_ATTACHMENT_OBJECT_KEY_RE = re.compile(r"^[0-9a-f]{2}/[0-9a-f]{64}/[^/]+$")
CANONICAL_ATTACHMENT_OBJECT_KEY_RE = re.compile(
    r"^authenticated_notice_portal/attachment-[^/]+/"
    r"(?:undated|(?:19|20)\d{2})/sha256/[0-9a-f]{64}/capture/.+$"
)


def is_legacy_attachment_object_key(value: str) -> bool:
    return bool(LEGACY_ATTACHMENT_OBJECT_KEY_RE.fullmatch(str(value or "").strip()))


def is_canonical_attachment_object_key(value: str) -> bool:
    return bool(CANONICAL_ATTACHMENT_OBJECT_KEY_RE.fullmatch(str(value or "").strip()))


__all__ = [
    "CANONICAL_ATTACHMENT_OBJECT_KEY_RE",
    "LEGACY_ATTACHMENT_OBJECT_KEY_RE",
    "is_canonical_attachment_object_key",
    "is_legacy_attachment_object_key",
]
