from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

NO_SERVING_OPENING_GATE_SCHEMA_VERSION = "source_handoff_no_serving_opening_gate.v1"

_FORBIDDEN_TRUE_KEYS = frozenset(
    (
        "query_enabled",
        "query_enabled_by_default",
        "serving_alias_published",
        "serving_opened",
        "published_serving_alias",
        "default_query_enabled",
    )
)
_PROMOTION_KEYS = frozenset(("promotion_enabled", "promote_current_truth", "publish_current_truth"))


class NoServingOpeningViolation(RuntimeError):
    pass


def validate_no_serving_opening_gate(
    payloads: Sequence[Mapping[str, Any]],
    *,
    explicit_promotion_allowed: bool = False,
) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    for index, payload in enumerate(payloads):
        _scan_payload(
            payload,
            path=(str(index),),
            findings=findings,
            explicit_promotion_allowed=explicit_promotion_allowed,
        )
    result = {
        "schema_version": NO_SERVING_OPENING_GATE_SCHEMA_VERSION,
        "verdict": "passed" if not findings else "failed",
        "finding_count": len(findings),
        "findings": findings,
    }
    if findings:
        keys = ", ".join(sorted({finding["key"] for finding in findings}))
        raise NoServingOpeningViolation(f"source handoff no-serving gate failed: {keys}")
    return result


def _scan_payload(
    value: object,
    *,
    path: tuple[str, ...],
    findings: list[dict[str, str]],
    explicit_promotion_allowed: bool,
) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            item_path = (*path, key_text)
            if key_text in _FORBIDDEN_TRUE_KEYS and _truthy(item):
                findings.append(
                    {
                        "path": ".".join(item_path),
                        "key": key_text,
                        "reason": "query-serving or serving-alias opening is forbidden",
                    }
                )
            if key_text in _PROMOTION_KEYS and _truthy(item) and not explicit_promotion_allowed:
                findings.append(
                    {
                        "path": ".".join(item_path),
                        "key": key_text,
                        "reason": "current-truth promotion requires an explicit gate",
                    }
                )
            _scan_payload(
                item,
                path=item_path,
                findings=findings,
                explicit_promotion_allowed=explicit_promotion_allowed,
            )
    elif isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        for index, item in enumerate(value):
            _scan_payload(
                item,
                path=(*path, str(index)),
                findings=findings,
                explicit_promotion_allowed=explicit_promotion_allowed,
            )


def _truthy(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1", "enabled", "published", "open"}
    return bool(value)


__all__ = [
    "NO_SERVING_OPENING_GATE_SCHEMA_VERSION",
    "NoServingOpeningViolation",
    "validate_no_serving_opening_gate",
]
