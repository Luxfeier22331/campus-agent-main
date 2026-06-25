from __future__ import annotations

from campus_ingestion_core.official_web_projection_engine_candidates import (
    _build_consumer_candidate_page,
)
from campus_ingestion_core.official_web_projection_engine_common import (
    _find_consumer_match,
    _require_optional_text,
    _string_list,
    _target_from_consumer_match,
    _target_lineage_matched_evidence,
)


def _resolve_consumer_projection(
    *,
    manifest: dict[str, object],
    matches: list[dict[str, object]],
    blocks: list[dict[str, object]],
    title: str,
    composition_override: dict[str, object] | None = None,
) -> dict[str, object] | None:
    if not matches and composition_override is None:
        return None
    stable_match = _find_consumer_match(matches, "stable_reference_candidate")
    if stable_match is not None:
        return {
            "action": "emit_document",
            "target_corpus": "official_web",
            "target_collection": "stable_reference",
            "routing_route_id": "consumer-denominator:stable_reference_candidate",
            "target_lineage": stable_match,
        }
    if _is_non_answer_bearing_source_pack_preview_seed(manifest=manifest, matches=matches):
        return {"action": "candidate", "candidate_pages": []}

    candidate_pages: list[dict[str, object]] = []
    for match in matches:
        if not isinstance(match, dict):
            continue
        consumer_family = _require_optional_text(match.get("consumerFamily"))
        materialization_policy = _require_optional_text(match.get("materializationPolicy"))
        if consumer_family is None or materialization_policy is None:
            continue
        if consumer_family == "stable_reference_candidate":
            continue
        target_corpus, target_collection = _target_from_consumer_match(match)
        selected_write_target = _require_optional_text(match.get("selectedWriteTarget")) or ""
        candidate = _build_consumer_candidate_page(
            blocks=blocks,
            consumer_family=consumer_family,
            manifest=manifest,
            materialization_policy=materialization_policy,
            matched_evidence=_string_list(match.get("matchedEvidence"))
            or _target_lineage_matched_evidence(match),
            review_policy=_require_optional_text(match.get("reviewPolicy")) or "",
            selected_write_target=selected_write_target,
            target_lineage=match,
            target_collection=target_collection,
            target_corpus=target_corpus,
            title=title,
        )
        if candidate:
            candidate_pages.append(candidate)
    if candidate_pages:
        return {"action": "candidate", "candidate_pages": candidate_pages}
    return None


def _is_non_answer_bearing_source_pack_preview_seed(
    *,
    manifest: dict[str, object],
    matches: list[dict[str, object]],
) -> bool:
    if str(manifest.get("pageFamily") or "").strip() not in {
        "directory_page",
        "listing_page",
    }:
        return False
    source_pack_id = _require_optional_text(manifest.get("sourcePackId"))
    source_pack_entry_id = _require_optional_text(manifest.get("sourcePackEntryId"))
    if source_pack_id is None or source_pack_entry_id is None or not matches:
        return False
    return all(
        _require_optional_text(match.get("worksetReason")) == "source_pack_preview_seed"
        for match in matches
        if isinstance(match, dict)
    )


def _build_consumer_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    return {}
