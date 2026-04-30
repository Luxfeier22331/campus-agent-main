from __future__ import annotations

from collections import Counter
from typing import Any

from campus_ingestion_core.authenticated_notice_browser_url_backfill import (
    build_authenticated_notice_browser_urls,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_samples import (
    sample_authenticated_notice_routing_from_bundle_record,
)
from campus_ingestion_core.authenticated_notice_source_retention_decision import (
    build_authenticated_notice_source_retention_decision,
    resolve_authenticated_notice_capture_route,
)
from campus_ingestion_core.authenticated_notice_source_truth_blocks import (
    _build_attachment_refs,
    _build_content_blocks,
    _build_owner_expectations,
    build_authenticated_notice_notice_document_artifacts,
)
from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    AUTHENTICATED_NOTICE_MANIFEST_SCHEMA,
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
    AuthenticatedNoticeSourceMaterial,
    _attachments_payload,
    _category_pairs,
    _collector_version,
    _exported_at,
    _fetcher_version,
    _joined_attachments,
    _json_bytes,
    _jsonl_bytes,
    _links_payload,
    _notice_attachments_payload,
    _notice_payload,
    _optional_text,
    build_authenticated_notice_raw_asset_id,
    build_authenticated_notice_raw_version_id,
    infer_authenticated_notice_year,
    resolve_authenticated_notice_attachment_object_key,
)


def prepare_authenticated_notice_source_material(
    *,
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
    site_id: str,
    source_home_url: str,
    notice_family_config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeSourceMaterial:
    notice = _notice_payload(bundle_record)
    notice_id = str(notice.get("notice_id") or bundle_record.get("notice_id") or "").strip()
    if not notice_id:
        raise ValueError("notice_id is required")
    title = str(notice.get("notice_title") or "").strip()
    if not title:
        raise ValueError("notice_title is required")
    raw_asset_id = build_authenticated_notice_raw_asset_id(site_id, notice_id)
    raw_version_id = build_authenticated_notice_raw_version_id(bundle_record)
    source_uri = str(
        notice.get("notice_link") or f"campusnotice://{site_id}/notice/{notice_id}"
    ).strip()
    source_home_url = source_home_url.strip()
    if not source_home_url:
        raise ValueError("source_home_url is required")
    year = infer_authenticated_notice_year(notice=notice)

    content_blocks = _build_content_blocks(
        title=title,
        html_value=str(notice.get("notice_content") or ""),
        links=tuple(_links_payload(bundle_record)),
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
    )
    attachment_refs = _build_attachment_refs(
        bundle_record=bundle_record,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        notice_id=notice_id,
    )
    source_retention_decision = _build_source_retention_decision(
        bundle_record=bundle_record,
        attachment_refs=attachment_refs,
        notice_family_config=notice_family_config,
    )
    attachment_refs = _attachment_refs_with_source_retention(
        attachment_refs=attachment_refs,
        source_retention_decision=source_retention_decision,
    )
    capture_artifacts = _build_capture_artifacts(
        bundle_record=bundle_record,
        export_manifest=export_manifest,
    )
    provider_artifacts = _build_provider_artifacts(bundle_record=bundle_record)
    source_truth_artifacts = _build_source_truth_artifacts(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        site_id=site_id,
        notice_id=notice_id,
        source_uri=source_uri,
        source_home_url=source_home_url,
        title=title,
        notice=notice,
        export_manifest=export_manifest,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
        notice_capture_route=source_retention_decision.notice_capture_route,
    )
    canonical_markdown_bytes, document_units_bytes = (
        build_authenticated_notice_notice_document_artifacts(
            document_id=f"notice:{site_id}:{notice_id}",
            version_id=raw_version_id,
            source_uri=source_uri,
            title=title,
            content_blocks=content_blocks,
        )
    )
    return AuthenticatedNoticeSourceMaterial(
        notice_id=notice_id,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_uri=source_uri,
        source_home_url=source_home_url,
        title=title,
        year=year,
        capture_artifacts=capture_artifacts,
        provider_artifacts=provider_artifacts,
        source_truth_artifacts=source_truth_artifacts,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
        canonical_markdown_bytes=canonical_markdown_bytes,
        document_units_bytes=document_units_bytes,
    )


def _build_capture_artifacts(
    *,
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
) -> dict[str, bytes]:
    notice = _notice_payload(bundle_record)
    list_payload = {
        "notice_id": notice.get("notice_id") or bundle_record.get("notice_id"),
        "notice_title": notice.get("notice_title"),
        "organization_name": notice.get("organization_name"),
        "organization_id": notice.get("organization_id"),
        "notice_release_time": notice.get("notice_release_time"),
        "notice_create_time": notice.get("notice_create_time"),
        "notice_first_time": notice.get("notice_first_time"),
        "notice_link": notice.get("notice_link"),
        "notice_source": notice.get("notice_source"),
        "notice_link_state": notice.get("notice_link_state"),
        "notice_state": notice.get("notice_state"),
        "notice_stick": notice.get("notice_stick"),
        "categories": notice.get("categories") or [],
    }
    detail_payload = {
        "notice": notice,
        "links": list(_links_payload(bundle_record)),
        "notice_attachments": list(_notice_attachments_payload(bundle_record)),
        "attachments": list(_attachments_payload(bundle_record)),
    }
    fetch_metadata = {
        "schema_version": "authenticated_notice_fetch_metadata_v1",
        "captured_at": _exported_at(export_manifest),
        "export_manifest": export_manifest or {},
    }
    return {
        "capture/list-response.json": _json_bytes(list_payload),
        "capture/detail-response.json": _json_bytes(detail_payload),
        "capture/fetch-metadata.json": _json_bytes(fetch_metadata),
    }


def _build_provider_artifacts(
    *,
    bundle_record: dict[str, Any],
) -> dict[str, bytes]:
    notice = _notice_payload(bundle_record)
    normalized_notice = {
        "schema_version": "authenticated_notice_normalized_notice_v1",
        "notice_id": notice.get("notice_id") or bundle_record.get("notice_id"),
        "notice_title": notice.get("notice_title"),
        "organization_name": notice.get("organization_name"),
        "organization_id": notice.get("organization_id"),
        "notice_release_time": notice.get("notice_release_time"),
        "notice_create_time": notice.get("notice_create_time"),
        "notice_first_time": notice.get("notice_first_time"),
        "notice_link": notice.get("notice_link"),
        "notice_source": notice.get("notice_source"),
        "notice_link_state": notice.get("notice_link_state"),
        "notice_state": notice.get("notice_state"),
        "notice_stick": notice.get("notice_stick"),
        "notice_type_ids": [item[0] for item in _category_pairs(notice)],
        "notice_type_names": [item[1] for item in _category_pairs(notice)],
        "notice_content_html": notice.get("notice_content"),
    }
    discovered_links = tuple(_links_payload(bundle_record))
    attachment_observations = tuple(
        {
            "attachment_id": attachment.get("attachment_id"),
            "link_id": relation.get("link_id"),
            "source_url": attachment.get("source_url"),
            "normalized_source_url": attachment.get("normalized_source_url"),
            "final_url": attachment.get("final_url"),
            "resource_role": relation.get("resource_role"),
            "relation_source": relation.get("relation_source"),
            "anchor_text": relation.get("anchor_text"),
            "object_key": resolve_authenticated_notice_attachment_object_key(
                attachment=attachment,
                year=infer_authenticated_notice_year(notice=notice),
            ),
            "content_sha256": attachment.get("sha256"),
            "mime_type": attachment.get("mime_type"),
            "byte_size": attachment.get("byte_size"),
            "origin_scope": attachment.get("origin_scope"),
            "provenance_status": attachment.get("provenance_status"),
        }
        for attachment, relation in _joined_attachments(bundle_record)
    )
    return {
        "provider/normalized-notice.json": _json_bytes(normalized_notice),
        "provider/discovered-links.jsonl": _jsonl_bytes(discovered_links),
        "provider/attachment-observations.jsonl": _jsonl_bytes(attachment_observations),
    }


def _build_source_truth_artifacts(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    site_id: str,
    notice_id: str,
    source_uri: str,
    source_home_url: str,
    title: str,
    notice: dict[str, Any],
    export_manifest: dict[str, Any] | None,
    content_blocks: tuple[dict[str, Any], ...],
    attachment_refs: tuple[dict[str, Any], ...],
    notice_capture_route: str,
) -> dict[str, bytes]:
    category_pairs = _category_pairs(notice)
    browser_urls = build_authenticated_notice_browser_urls(
        notice=notice,
        record={"notice_id": notice_id},
        source_home_url=source_home_url,
    )
    portal_print_url = (
        _optional_text(notice.get("portal_print_url")) or browser_urls["portal_print_url"]
    )
    notice_browser_url = (
        _optional_text(notice.get("notice_browser_url")) or browser_urls["notice_browser_url"]
    )
    notice_browser_url_source = _optional_text(notice.get("notice_browser_url_source")) or str(
        browser_urls["notice_browser_url_source"]
    )
    owner_expectations = _build_owner_expectations(
        title=title,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
    )
    notice_manifest = {
        "schema_version": AUTHENTICATED_NOTICE_MANIFEST_SCHEMA,
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "site_id": site_id,
        "notice_id": notice_id,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "captured_at": _exported_at(export_manifest),
        "list_observed_at": _optional_text(notice.get("last_seen_at"))
        or _exported_at(export_manifest),
        "detail_observed_at": _optional_text(notice.get("enrich_attempted_at"))
        or _exported_at(export_manifest),
        "fetcher_name": "authenticated_notice_bundle_import",
        "fetcher_version": _fetcher_version(export_manifest),
        "collector_version": _collector_version(export_manifest),
        "credentials_mode": "authenticated",
        "notice_title_raw": title,
        "notice_title_normalized": title,
        "organization_name": _optional_text(notice.get("organization_name")),
        "organization_id": _optional_text(notice.get("organization_id")),
        "notice_release_time": _optional_text(notice.get("notice_release_time")),
        "notice_create_time": _optional_text(notice.get("notice_create_time")),
        "notice_first_time": _optional_text(notice.get("notice_first_time")),
        "notice_source": notice.get("notice_source"),
        "notice_link_state": notice.get("notice_link_state"),
        "notice_state": notice.get("notice_state"),
        "notice_stick": notice.get("notice_stick"),
        "notice_type_ids": [item[0] for item in category_pairs],
        "notice_type_names": [item[1] for item in category_pairs],
        "source_notice_link": source_uri,
        "source_home_url": source_home_url,
        "portal_print_url": portal_print_url,
        "notice_browser_url": notice_browser_url,
        "notice_browser_url_source": notice_browser_url_source,
        "body_html_hash": __import__("hashlib")
        .sha256(str(notice.get("notice_content") or "").encode("utf-8"))
        .hexdigest(),
        "block_count": len(content_blocks),
        "link_count": sum(1 for row in content_blocks if row.get("block_role") == "link"),
        "attachment_ref_count": len(attachment_refs),
        **_source_retention_manifest_fields(
            notice_capture_route=notice_capture_route,
            attachment_refs=attachment_refs,
        ),
        "owner_expectation_count": len(owner_expectations),
        "owner_expectations": [dict(item) for item in owner_expectations],
    }
    return {
        "source-truth/notice-manifest.json": _json_bytes(notice_manifest),
        "source-truth/content-blocks.jsonl": _jsonl_bytes(content_blocks),
        "source-truth/attachment-refs.jsonl": _jsonl_bytes(attachment_refs),
    }


def _build_source_retention_decision(
    *,
    bundle_record: dict[str, Any],
    attachment_refs: tuple[dict[str, Any], ...],
    notice_family_config: AuthenticatedNoticeNoticeFamilyConfig,
):
    routing_sample = sample_authenticated_notice_routing_from_bundle_record(
        bundle_record,
        config=notice_family_config,
    )
    return build_authenticated_notice_source_retention_decision(
        notice_capture_route=resolve_authenticated_notice_capture_route(
            suggested_consumption_route=routing_sample.suggested_consumption_route,
        ),
        attachment_refs=attachment_refs,
    )


def _attachment_refs_with_source_retention(
    *,
    attachment_refs: tuple[dict[str, Any], ...],
    source_retention_decision,
) -> tuple[dict[str, Any], ...]:
    decisions_by_ref_id = {
        decision.attachment_ref_id: decision
        for decision in source_retention_decision.attachment_decisions
    }
    rows: list[dict[str, Any]] = []
    for attachment_ref in attachment_refs:
        attachment_ref_id = str(attachment_ref.get("attachment_ref_id") or "")
        decision = decisions_by_ref_id.get(attachment_ref_id)
        if decision is None:
            rows.append(dict(attachment_ref))
            continue
        rows.append(
            {
                **dict(attachment_ref),
                "notice_capture_route": source_retention_decision.notice_capture_route,
                "attachment_capture_policy": decision.attachment_capture_policy,
                "attachment_capture_state": decision.attachment_capture_state,
                "byte_fetch_required": decision.byte_fetch_required,
                "byte_fetch_required_reason": ",".join(decision.reason_codes) or None,
                "required_source_object": decision.required_source_object,
                "source_object_role": "notice_attachment_source_bytes"
                if decision.required_source_object
                else None,
                "retention_class": decision.retention_class,
                "retention_expires_at": None,
                "promotion_owner": None,
                "attachment_promotion_state": "not_applicable",
                "promotion_decision_id": None,
                "promotion_reason_codes": [],
                "skip_reason": None,
                "terminal_reason": None,
                "last_error_class": None,
            }
        )
    return tuple(rows)


def _source_retention_manifest_fields(
    *,
    notice_capture_route: str,
    attachment_refs: tuple[dict[str, Any], ...],
) -> dict[str, Any]:
    attachment_capture_policy_counts = Counter(
        str(ref.get("attachment_capture_policy") or "")
        for ref in attachment_refs
        if str(ref.get("attachment_capture_policy") or "")
    )
    attachment_capture_state_counts = Counter(
        str(ref.get("attachment_capture_state") or "")
        for ref in attachment_refs
        if str(ref.get("attachment_capture_state") or "")
    )
    retention_class_counts = Counter(
        str(ref.get("retention_class") or "")
        for ref in attachment_refs
        if str(ref.get("retention_class") or "")
    )
    return {
        "notice_capture_route": notice_capture_route,
        "attachment_capture_policy_counts": dict(sorted(attachment_capture_policy_counts.items())),
        "attachment_capture_state_counts": dict(sorted(attachment_capture_state_counts.items())),
        "retention_class_counts": dict(sorted(retention_class_counts.items())),
        "required_source_object_count": sum(
            1 for ref in attachment_refs if bool(ref.get("required_source_object"))
        ),
        "metadata_only_attachment_ref_count": attachment_capture_policy_counts.get(
            "metadata_only",
            0,
        ),
        "quarantine_attachment_ref_count": attachment_capture_policy_counts.get(
            "fetch_to_quarantine",
            0,
        ),
        "admitted_source_byte_ref_count": retention_class_counts.get(
            "admitted_source_bytes",
            0,
        ),
    }
