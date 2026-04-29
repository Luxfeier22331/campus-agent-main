from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence


def resolve_stage_id(*, stage_id: str, stage_label: str) -> str:
    text = stage_id.strip()
    if text:
        return _normalize_identifier(text)
    stage_text = stage_label.strip()
    if stage_text:
        return f"stage-{_hash_identifier(stage_text)[:10]}"
    return "stage-unknown"


def resolve_node_id(
    *,
    node_id: str,
    stage_id: str,
    stage_label: str,
    node_label: str,
    occurrence_index: int,
) -> str:
    text = node_id.strip()
    if text:
        return _normalize_identifier(text)
    identity = f"{stage_id}|{stage_label.strip()}|{node_label.strip()}|{occurrence_index}"
    return f"node-{_hash_identifier(identity)[:12]}"


def resolve_edge_id(
    *,
    edge_id: str,
    source_node_id: str,
    target_node_id: str,
    occurrence_index: int,
) -> str:
    text = edge_id.strip()
    if text:
        return _normalize_identifier(text)
    identity = f"{source_node_id}->{target_node_id}#{occurrence_index}"
    return f"edge-{_hash_identifier(identity)[:12]}"


def resolve_unique_node_id_for_label(
    *,
    label: str,
    node_ids_by_label: Mapping[str, Sequence[str]],
    notes: list[str],
    endpoint_name: str,
) -> str:
    text = label.strip()
    if not text:
        notes.append("存在端点为空的课程关系，已从结构化关系中移除。")
        return ""
    node_ids = tuple(node_ids_by_label.get(text) or ())
    if len(node_ids) == 1:
        return node_ids[0]
    if not node_ids:
        notes.append(f"存在引用未发布课程节点的关系，已从结构化关系中移除：{text}。")
        return ""
    notes.append(
        f"存在同名课程节点导致无法唯一定位的关系端点，已从结构化关系中移除：{text}（{endpoint_name}）。"
    )
    return ""


def _normalize_identifier(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    normalized = "".join(
        ch if ch.isascii() and (ch.isalnum() or ch in "_.:-") else "-" for ch in text
    )
    normalized = "-".join(part for part in normalized.split("-") if part)
    if normalized:
        return normalized
    return f"id-{_hash_identifier(text)[:12]}"


def _hash_identifier(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


__all__ = (
    "resolve_edge_id",
    "resolve_node_id",
    "resolve_stage_id",
    "resolve_unique_node_id_for_label",
)
