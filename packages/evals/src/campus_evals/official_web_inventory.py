from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "official_web_muc_public_pages_current_truth_inventory.json"
)

_ALLOWED_ANSWER_GATE_STATUSES = frozenset({"release_gate_required", "inventory_only"})
_ALLOWED_INVENTORY_DISPOSITIONS = frozenset(
    {"retain_inventory_only", "current_scope_follow_up_candidate", "future_fresh_news_surface"}
)


@lru_cache(maxsize=1)
def load_official_web_current_truth_inventory() -> dict[str, object]:
    payload = json.loads(OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH.read_text(encoding="utf-8"))
    documents = payload.get("documents")
    if not isinstance(documents, list):
        raise ValueError("official_web current truth inventory documents must be an array")

    inventory_triage_summary = payload.get("inventory_triage_summary")
    if not isinstance(inventory_triage_summary, dict):
        raise ValueError("official_web current truth inventory summary must be an object")

    computed_inventory_counts: dict[str, int] = dict.fromkeys(_ALLOWED_INVENTORY_DISPOSITIONS, 0)

    for raw_entry in documents:
        if not isinstance(raw_entry, dict):
            raise ValueError("official_web current truth inventory entries must be objects")
        answer_gate_status = str(raw_entry.get("answer_gate_status") or "").strip()
        if answer_gate_status not in _ALLOWED_ANSWER_GATE_STATUSES:
            raise ValueError(f"unsupported official_web answer gate status: {answer_gate_status}")
        if answer_gate_status != "inventory_only":
            continue
        disposition = str(raw_entry.get("inventory_disposition") or "").strip()
        if disposition not in _ALLOWED_INVENTORY_DISPOSITIONS:
            raise ValueError(f"unsupported official_web inventory disposition: {disposition}")
        computed_inventory_counts[disposition] += 1

    normalized_summary = {
        disposition: int(inventory_triage_summary.get(disposition) or 0)
        for disposition in sorted(_ALLOWED_INVENTORY_DISPOSITIONS)
    }
    if normalized_summary != {
        disposition: computed_inventory_counts[disposition]
        for disposition in sorted(_ALLOWED_INVENTORY_DISPOSITIONS)
    }:
        raise ValueError("official_web inventory triage summary does not match document entries")

    return payload


def official_web_release_gate_doc_ids() -> frozenset[str]:
    return official_web_current_truth_doc_ids_by_bucket()["release_gate_required"]


def official_web_current_truth_doc_ids_by_bucket() -> dict[str, frozenset[str]]:
    payload = load_official_web_current_truth_inventory()
    documents = payload["documents"]
    doc_ids_by_bucket: dict[str, set[str]] = {
        "release_gate_required": set(),
        **{disposition: set() for disposition in sorted(_ALLOWED_INVENTORY_DISPOSITIONS)},
    }

    for entry in documents:
        if not isinstance(entry, dict):
            continue
        answer_gate_status = str(entry.get("answer_gate_status") or "").strip()
        doc_id = str(entry.get("doc_id") or "").strip()
        if answer_gate_status == "release_gate_required":
            doc_ids_by_bucket["release_gate_required"].add(doc_id)
            continue
        if answer_gate_status != "inventory_only":
            continue
        disposition = str(entry.get("inventory_disposition") or "").strip()
        doc_ids_by_bucket[disposition].add(doc_id)

    partition = {
        bucket: frozenset(sorted(doc_ids)) for bucket, doc_ids in doc_ids_by_bucket.items()
    }
    covered_doc_ids = set().union(*partition.values())
    total_partition_count = sum(len(doc_ids) for doc_ids in partition.values())
    if len(covered_doc_ids) != total_partition_count:
        raise ValueError("official_web current truth partition buckets must be disjoint")
    if total_partition_count != int(payload["document_count"]):
        raise ValueError("official_web current truth partition does not cover all promotable docs")
    return partition


def official_web_inventory_only_doc_ids_by_disposition() -> dict[str, frozenset[str]]:
    partition = official_web_current_truth_doc_ids_by_bucket()
    return {
        disposition: partition[disposition]
        for disposition in sorted(_ALLOWED_INVENTORY_DISPOSITIONS)
    }


def official_web_inventory_only_titles_by_disposition() -> dict[str, frozenset[str]]:
    payload = load_official_web_current_truth_inventory()
    documents = payload["documents"]
    titles_by_disposition: dict[str, set[str]] = {
        disposition: set() for disposition in sorted(_ALLOWED_INVENTORY_DISPOSITIONS)
    }
    for entry in documents:
        if not isinstance(entry, dict) or entry.get("answer_gate_status") != "inventory_only":
            continue
        disposition = str(entry["inventory_disposition"])
        titles_by_disposition[disposition].add(str(entry["title"]))
    return {
        disposition: frozenset(sorted(titles))
        for disposition, titles in titles_by_disposition.items()
    }


def official_web_future_fresh_news_doc_ids() -> frozenset[str]:
    return official_web_inventory_only_doc_ids_by_disposition()["future_fresh_news_surface"]


def official_web_future_fresh_news_titles() -> frozenset[str]:
    return official_web_inventory_only_titles_by_disposition()["future_fresh_news_surface"]


def official_web_retain_inventory_only_doc_ids() -> frozenset[str]:
    return official_web_inventory_only_doc_ids_by_disposition()["retain_inventory_only"]


def official_web_retain_inventory_only_titles() -> frozenset[str]:
    return official_web_inventory_only_titles_by_disposition()["retain_inventory_only"]


__all__ = [
    "OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH",
    "official_web_current_truth_doc_ids_by_bucket",
    "official_web_future_fresh_news_doc_ids",
    "official_web_future_fresh_news_titles",
    "load_official_web_current_truth_inventory",
    "official_web_inventory_only_doc_ids_by_disposition",
    "official_web_inventory_only_titles_by_disposition",
    "official_web_retain_inventory_only_doc_ids",
    "official_web_retain_inventory_only_titles",
    "official_web_release_gate_doc_ids",
]
