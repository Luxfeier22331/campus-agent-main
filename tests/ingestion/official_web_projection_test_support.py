from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.official_web_projection import (
    load_official_web_projection_declarations,
    replay_official_web_source_truth_local,
    validate_official_web_projection_output,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _declarations_payload() -> dict[str, object]:
    return {
        "schema_version": "official_web_projection_declarations.v1",
        "site_id": "campus_public",
        "projection_policy_version": "campus_public_projection_v1",
        "declarations": [
            {
                "declaration_id": "article-detail-primary",
                "page_family": "article_detail",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "content_document",
                "document_kind": "article",
                "action": "emit_document",
            },
            {
                "declaration_id": "listing-page-primary",
                "page_family": "listing_page",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "navigation_document",
                "document_kind": "listing",
                "action": "emit_document",
            },
            {
                "declaration_id": "generic-page-primary",
                "page_family": "generic_content_page",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "generic_content_document",
                "document_kind": "generic",
                "action": "emit_document",
            },
            {
                "declaration_id": "dynamic-shell-review",
                "page_family": "dynamic_shell_page",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "shell_review",
                "document_kind": "shell",
                "action": "manual_review",
            },
        ],
    }


def _routing_payload(
    *,
    titles: list[str] | None = None,
    extra_routes: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    routes = [
        {
            "route_id": "stable-reference-bootstrap",
            "target_corpus": "official_web",
            "target_collection": "stable_reference",
            "page_families": ["article_detail", "directory_page", "generic_content_page"],
            "title_allowlist": titles or [],
        }
    ]
    if extra_routes:
        routes.extend(extra_routes)
    return {
        "schema_version": "official_web_projection_routing.v1",
        "site_id": "campus_public",
        "routing_policy_version": "campus_public_routing_v1",
        "routes": routes,
    }


def _page_bundle_entry(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    page_family: str,
    consumer_matches: list[dict[str, object]] | None = None,
    target_matches: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    entry = {
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "normalizedCanonicalUrl": normalized_canonical_url,
        "pageFamily": page_family,
        "pageManifestObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/page-manifest.json",
        "contentBlocksObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/content-blocks.jsonl",
        "providerExtractionObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/provider/cheerio-basic/page-extraction.json",
        "discoveredLinksObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/provider/cheerio-basic/discovered-links.jsonl",
        "responseHtmlObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/capture/response.html",
        "responseBodyHash": f"hash-{raw_asset_id}",
        "blockCount": 3,
    }
    if consumer_matches is not None:
        entry["consumerMatches"] = consumer_matches
        entry["consumerRetentionDecision"] = "retain_source_truth"
    if target_matches is not None:
        entry["targetMatches"] = target_matches
        entry["targetJobId"] = target_matches[0]["targetJobId"] if target_matches else None
        entry["targetCandidateId"] = (
            target_matches[0]["targetCandidateId"] if target_matches else None
        )
        entry["targetDeclarationVersion"] = (
            target_matches[0]["targetDeclarationVersion"] if target_matches else None
        )
        entry["materializationPolicy"] = (
            target_matches[0]["materializationPolicy"] if target_matches else None
        )
        entry["selectedWriteTarget"] = (
            target_matches[0]["selectedWriteTarget"] if target_matches else ""
        )
        entry["reviewPolicy"] = target_matches[0]["reviewPolicy"] if target_matches else None
    return entry


def _write_output_page(
    output_dir: Path,
    *,
    site_id: str,
    host: str,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    page_title: str,
    page_family: str,
    blocks: list[dict[str, object]],
    published_at: str | None = None,
    last_modified: str | None = None,
    consumer_matches: list[dict[str, object]] | None = None,
    target_matches: list[dict[str, object]] | None = None,
) -> None:
    base_dir = output_dir / "source-assets" / raw_asset_id / raw_version_id
    _write_json(
        base_dir / "source-truth" / "page-manifest.json",
        {
            "schemaVersion": "official_web_page_manifest.v1",
            "sourceChannel": "official_web",
            "siteId": site_id,
            "host": host,
            "rawAssetId": raw_asset_id,
            "rawVersionId": raw_version_id,
            "requestedUrl": normalized_canonical_url,
            "finalUrl": normalized_canonical_url,
            "declaredCanonicalUrl": normalized_canonical_url,
            "normalizedCanonicalUrl": normalized_canonical_url,
            "urlIdentityBasis": "declared_canonical",
            "fetchedAt": "2026-03-31T09:00:00.000Z",
            "publishedAt": published_at,
            "httpStatus": 200,
            "contentType": "text/html",
            "etag": None,
            "lastModified": last_modified,
            "redirectChain": [],
            "responseBodyHash": f"hash-{raw_asset_id}",
            "retainedSnapshotHash": f"snapshot-{raw_asset_id}",
            "fetcherName": "collector-test",
            "fetcherVersion": "1.0",
            "parserName": "cheerio-basic",
            "parserVersion": "1.0",
            "pageTitleRaw": page_title,
            "pageTitleNormalized": page_title,
            "languageHint": "zh-CN",
            "pageFamily": page_family,
            "pageFamilyConfidence": 0.99,
            "pageFamilyReason": "test-fixture",
            "mainContentHash": f"main-{raw_asset_id}",
            "blockCount": len(blocks),
            "mainContentBlockCount": sum(1 for block in blocks if block.get("isMainContent")),
            "navigationBlockCount": 0,
            "boilerplateBlockCount": 0,
            "discoveredFromUrl": None,
            "discoveryMethod": "seed",
            "crawlRunId": "owrun_projection_001",
            "hostPolicyVersion": "campus_public_hosts_v1",
            "crawlPolicyVersion": "campus_public_crawl_policy_v1",
            "credentialsMode": "public",
            **(
                {
                    "consumerDenominatorVersion": "test_consumer_denominator_v1",
                    "consumerMatches": consumer_matches,
                    "consumerRetentionDecision": "retain_source_truth",
                    "consumerRejectionReason": None,
                }
                if consumer_matches is not None
                else {}
            ),
            **(
                {
                    "targetJobId": target_matches[0]["targetJobId"] if target_matches else None,
                    "targetCandidateId": (
                        target_matches[0]["targetCandidateId"] if target_matches else None
                    ),
                    "targetDeclarationVersion": (
                        target_matches[0]["targetDeclarationVersion"] if target_matches else None
                    ),
                    "targetMatches": target_matches,
                    "materializationPolicy": (
                        target_matches[0]["materializationPolicy"] if target_matches else None
                    ),
                    "selectedWriteTarget": (
                        target_matches[0]["selectedWriteTarget"] if target_matches else ""
                    ),
                    "reviewPolicy": target_matches[0]["reviewPolicy"] if target_matches else None,
                }
                if target_matches is not None
                else {}
            ),
        },
    )
    _write_jsonl(base_dir / "source-truth" / "content-blocks.jsonl", blocks)


def _target_match(
    *,
    consumer_family: str,
    materialization_policy: str,
    selected_write_target: str,
    target_id: str,
    target_job_id: str = "owtargetjob_test",
    target_candidate_id: str | None = "owtargetcandidate_test",
    target_declaration_version: str = "muc_public_target_source_map_v2",
    retention_policy: str = "retain_source_truth",
    review_policy: str = "selected_write_requires_review",
    workset_reason: str = "target_source_map_match",
) -> dict[str, object]:
    return {
        "targetJobId": target_job_id,
        "targetCandidateId": target_candidate_id,
        "targetId": target_id,
        "targetDeclarationVersion": target_declaration_version,
        "consumerFamily": consumer_family,
        "retentionPolicy": retention_policy,
        "materializationPolicy": materialization_policy,
        "selectedWriteTarget": selected_write_target,
        "reviewPolicy": review_policy,
        "worksetReason": workset_reason,
    }


def _block(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    row_id: str,
    row_index: int,
    block_order: int,
    block_role: str,
    text: str,
    parent_heading_path: list[str] | None = None,
    is_main_content: bool = True,
    is_navigation: bool = False,
    is_boilerplate: bool = False,
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_content_block.v1",
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "rowId": row_id,
        "rowIndex": row_index,
        "blockOrder": block_order,
        "blockRole": block_role,
        "headingLevel": 1 if block_role in {"title", "heading"} else None,
        "domPath": None,
        "parentHeadingPath": parent_heading_path or [],
        "listLevel": None,
        "tableId": None,
        "tableRowIndex": None,
        "tableColIndex": None,
        "textRaw": text,
        "textNormalized": text,
        "htmlFragment": None,
        "linkTarget": None,
        "linkText": None,
        "tableHtml": None,
        "tableCells": None,
        "isNavigation": is_navigation,
        "isBoilerplate": is_boilerplate,
        "isMainContent": is_main_content,
        "isRepeatedCandidate": False,
        "mainContentScore": 1.0 if is_main_content else 0.0,
        "titleCandidateScore": 1.0 if block_role == "title" else 0.0,
        "sectionHint": None,
        "classificationConfidence": 0.99,
        "classificationReason": "test",
        "parentHeadingHint": None,
    }


__all__ = [name for name in globals() if not name.startswith("__")]
