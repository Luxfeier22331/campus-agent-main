from __future__ import annotations


ALLOWLISTED_TARGETS = {
    "official-homepage": "https://www.muc.edu.cn/",
    "service-catalog": "https://service.muc.edu.cn/v2/site/index",
}


class MissingAllowlistTargetError(KeyError):
    """Raised when an availability target is not configured in the phase allowlist."""


def resolve_allowlisted_target(target_id: str) -> str:
    try:
        return ALLOWLISTED_TARGETS[target_id]
    except KeyError as exc:
        raise MissingAllowlistTargetError(target_id) from exc
