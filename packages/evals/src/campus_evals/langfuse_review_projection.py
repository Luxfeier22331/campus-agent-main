from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping


def build_langfuse_review_export_item(
    queue_id: str,
    item: Mapping[str, object],
) -> dict[str, object]:
    queue_item_id = _required_string(item.get("id"), "queue_item.id")
    reviewer_score_summary = _reviewer_score_summary(item)
    return {
        "queue_id": queue_id,
        "queue_item_id": queue_item_id,
        "object_id": _required_string(item.get("objectId"), "queue_item.objectId"),
        "object_type": _required_string(item.get("objectType"), "queue_item.objectType"),
        "case_id": _review_case_id(item),
        "score_config_ids": [
            _required_string(score.get("score_config_id"), "score_config_id")
            for score in reviewer_score_summary
        ],
        "reviewer_score_summary": reviewer_score_summary,
        "review_comment_hash": _sha256_json(item.get("comment") or ""),
        "repo_backlog_candidate_id": _stable_id("review", queue_id, queue_item_id),
    }


def _review_case_id(item: Mapping[str, object]) -> str:
    metadata = item.get("metadata")
    metadata_map = metadata if isinstance(metadata, Mapping) else {}
    return (
        _optional_string(item.get("caseId"))
        or _optional_string(metadata_map.get("case_id"))
        or _required_string(item.get("objectId"), "queue_item.objectId")
    )


def _reviewer_score_summary(item: Mapping[str, object]) -> list[dict[str, object]]:
    raw_scores = item.get("scores") or item.get("annotations") or []
    if not isinstance(raw_scores, list):
        return []
    summary: list[dict[str, object]] = []
    for raw_score in raw_scores:
        if not isinstance(raw_score, Mapping):
            continue
        score_config_id = _optional_string(raw_score.get("scoreConfigId")) or _optional_string(
            raw_score.get("configId")
        )
        if not score_config_id:
            continue
        summary.append(
            {
                "score_config_id": score_config_id,
                "score_name": _optional_string(raw_score.get("name")),
                "value": raw_score.get("value"),
            }
        )
    return summary


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _stable_id(*parts: object) -> str:
    prefix = _slug(str(parts[0]))
    digest = _sha256_text(":".join(str(part) for part in parts[1:]))[:24]
    return f"{prefix}:{digest}"


def _slug(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


def _sha256_json(value: object) -> str:
    return _sha256_text(json.dumps(value, ensure_ascii=False, sort_keys=True))


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


__all__ = ["build_langfuse_review_export_item"]
