from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import UTC, datetime
from pathlib import Path

from campus_ingestion_core.official_web_projection_config import (
    _load_official_web_projection_routing_if_present,
    _resolve_projection_routing_route,
    default_official_web_projection_declarations_path,
    load_official_web_projection_declarations,
)
from campus_ingestion_core.official_web_projection_engine_common import (
    _TARGET_WORKSET_COLLECTION_MODE,
    _consumer_matches,
    _merge_target_lineage_with_page_fields,
    _page_identity,
    _require_optional_text,
    _single_target_lineage,
    _target_lineage_issues,
    _target_matches,
    _target_projection_fields,
)
from campus_ingestion_core.official_web_projection_engine_composition import (
    _build_consumer_projection_overrides,
    _resolve_consumer_projection,
)
from campus_ingestion_core.official_web_projection_engine_document import (
    _project_document,
    _resolve_projection_action,
)
from campus_ingestion_core.official_web_projection_shared import (
    OFFICIAL_WEB_PROJECTION_REPLAY_REPORT_SCHEMA_VERSION,
    OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_SCHEMA_VERSION,
    OfficialWebProjectionReplayReport,
    _read_json,
    _require_page_family,
    _require_text,
)
from campus_ingestion_core.official_web_projection_units import (
    _load_local_page_source_truth,
    _resolve_document_title,
)


def replay_official_web_source_truth_local(
    *,
    output_dir: Path,
    projection_output_dir: Path,
    declarations_path: Path | None = None,
    routing_path: Path | None = None,
) -> OfficialWebProjectionReplayReport:
    bundle_payload = _read_json(output_dir / "source-truth-bundle.json")
    schema_version = str(
        bundle_payload.get("schemaVersion") or bundle_payload.get("schema_version") or ""
    ).strip()
    if schema_version != OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_SCHEMA_VERSION:
        raise ValueError(f"unsupported source-truth bundle schema_version: {schema_version!r}")
    site_id = _require_text(
        bundle_payload.get("siteId") or bundle_payload.get("site_id"),
        "siteId",
    )
    crawl_run_id = _require_text(
        bundle_payload.get("crawlRunId") or bundle_payload.get("crawl_run_id"),
        "crawlRunId",
    )
    declarations = load_official_web_projection_declarations(
        declarations_path or default_official_web_projection_declarations_path(site_id)
    )
    if declarations.site_id != site_id:
        raise ValueError(
            f"projection declarations site_id {declarations.site_id!r} does not match bundle siteId {site_id!r}"
        )
    routing = _load_official_web_projection_routing_if_present(
        site_id=site_id,
        routing_path=routing_path,
    )

    declaration_by_page_family = {
        declaration.page_family: declaration for declaration in declarations.declarations
    }
    pages = bundle_payload.get("pages")
    if not isinstance(pages, list):
        raise ValueError("source-truth bundle pages must be an array")
    collection_mode = _require_optional_text(
        bundle_payload.get("collectionMode") or bundle_payload.get("collection_mode")
    )

    projection_output_dir.mkdir(parents=True, exist_ok=True)
    documents: list[dict[str, object]] = []
    manual_review_pages: list[dict[str, object]] = []
    consumer_candidate_pages: list[dict[str, object]] = []
    target_family_counts: dict[str, int] = {}
    target_materialization_policy_counts: dict[str, int] = {}
    target_lineage_issues: list[dict[str, object]] = []
    page_contexts: list[dict[str, object]] = []
    for raw_page in pages:
        if not isinstance(raw_page, dict):
            raise ValueError("source-truth bundle page must be an object")
        page_family = _require_page_family(
            raw_page.get("pageFamily") or raw_page.get("page_family")
        )
        declaration = declaration_by_page_family.get(page_family)
        if declaration is None:
            raise ValueError(f"missing projection declaration for page_family={page_family}")
        manifest, blocks = _load_local_page_source_truth(
            output_dir=output_dir,
            raw_asset_id=_require_text(
                raw_page.get("rawAssetId") or raw_page.get("raw_asset_id"),
                "rawAssetId",
            ),
            raw_version_id=_require_text(
                raw_page.get("rawVersionId") or raw_page.get("raw_version_id"),
                "rawVersionId",
            ),
        )
        target_matches = [
            _merge_target_lineage_with_page_fields(
                target_match,
                manifest=manifest,
                raw_page=raw_page,
            )
            for target_match in (_target_matches(manifest) or _target_matches(raw_page))
        ]
        page_target_lineage_issues = _target_lineage_issues(
            collection_mode=collection_mode,
            manifest=manifest,
            raw_page=raw_page,
            target_matches=target_matches,
        )
        target_lineage_issues.extend(page_target_lineage_issues)
        for target_match in target_matches:
            consumer_family = _require_optional_text(
                target_match.get("consumerFamily") or target_match.get("consumer_family")
            )
            materialization_policy = _require_optional_text(
                target_match.get("materializationPolicy")
                or target_match.get("materialization_policy")
            )
            if consumer_family:
                target_family_counts[consumer_family] = (
                    target_family_counts.get(consumer_family, 0) + 1
                )
            if materialization_policy:
                target_materialization_policy_counts[materialization_policy] = (
                    target_materialization_policy_counts.get(materialization_policy, 0) + 1
                )
        title = _resolve_document_title(manifest=manifest, blocks=blocks)
        projection_matches = (
            target_matches
            if target_matches or collection_mode == _TARGET_WORKSET_COLLECTION_MODE
            else _consumer_matches(manifest) or _consumer_matches(raw_page)
        )
        page_contexts.append(
            {
                "raw_page": raw_page,
                "page_family": page_family,
                "declaration": declaration,
                "manifest": manifest,
                "blocks": blocks,
                "title": title,
                "target_matches": target_matches,
                "projection_matches": projection_matches,
            }
        )

    consumer_projection_overrides = _build_consumer_projection_overrides(page_contexts)

    for page_context in page_contexts:
        raw_page = dict(page_context["raw_page"])
        page_family = str(page_context["page_family"])
        declaration = page_context["declaration"]
        manifest = dict(page_context["manifest"])
        blocks = list(page_context["blocks"])
        title = str(page_context["title"])
        target_matches = list(page_context["target_matches"])
        projection_matches = list(page_context["projection_matches"])
        consumer_projection = _resolve_consumer_projection(
            manifest=manifest,
            matches=projection_matches,
            blocks=blocks,
            title=title,
            composition_override=consumer_projection_overrides.get(_page_identity(manifest)),
        )
        if consumer_projection is not None and consumer_projection["action"] == "candidate":
            consumer_candidate_pages.extend(consumer_projection["candidate_pages"])
            continue
        matched_route = _resolve_projection_routing_route(
            routing=routing,
            declaration=declaration,
            title=title,
        )
        effective_declaration = declaration
        consumer_routing_route_id: str | None = None
        if consumer_projection is not None and consumer_projection["action"] == "emit_document":
            effective_declaration = replace(
                declaration,
                target_corpus=str(consumer_projection["target_corpus"]),
                target_collection=str(consumer_projection["target_collection"]),
            )
            consumer_routing_route_id = str(consumer_projection["routing_route_id"])
        elif matched_route is not None:
            effective_declaration = replace(
                declaration,
                target_corpus=matched_route.target_corpus,
                target_collection=matched_route.target_collection,
            )
        effective_action, manual_review_reason = _resolve_projection_action(
            declaration=effective_declaration,
            manifest=manifest,
            blocks=blocks,
            title=title,
        )
        if effective_action == "manual_review":
            manual_review_pages.append(
                {
                    "declaration_id": declaration.declaration_id,
                    "page_family": page_family,
                    "target_corpus": effective_declaration.target_corpus,
                    "target_collection": effective_declaration.target_collection,
                    "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                    "raw_asset_id": manifest["rawAssetId"],
                    "raw_version_id": manifest["rawVersionId"],
                    "title": title,
                    "reason": manual_review_reason,
                    "routing_route_id": consumer_routing_route_id
                    or (matched_route.route_id if matched_route is not None else None),
                }
            )
            continue
        document = _project_document(
            declaration=effective_declaration,
            manifest=manifest,
            blocks=blocks,
            projection_output_dir=projection_output_dir,
            title=title,
            routing_route_id=consumer_routing_route_id
            or (matched_route.route_id if matched_route is not None else None),
        )
        target_lineage = (
            consumer_projection.get("target_lineage")
            if consumer_projection is not None
            and consumer_projection.get("action") == "emit_document"
            and isinstance(consumer_projection.get("target_lineage"), dict)
            else _single_target_lineage(target_matches)
        )
        if target_lineage is not None:
            document.update(_target_projection_fields(target_lineage))
        documents.append(document)

    report = OfficialWebProjectionReplayReport(
        schema_version=OFFICIAL_WEB_PROJECTION_REPLAY_REPORT_SCHEMA_VERSION,
        site_id=site_id,
        crawl_run_id=crawl_run_id,
        output_dir=str(output_dir.resolve()),
        projection_output_dir=str(projection_output_dir.resolve()),
        generated_at=datetime.now(UTC).isoformat(),
        counts={
            "pages_seen": len(pages),
            "emitted_documents": len(documents),
            "manual_review_pages": len(manual_review_pages),
            "consumer_candidate_pages": len(consumer_candidate_pages),
            "target_lineage_issues": len(target_lineage_issues),
            "target_lineage_issue_pages": len(
                {
                    (
                        str(issue.get("raw_asset_id") or ""),
                        str(issue.get("raw_version_id") or ""),
                    )
                    for issue in target_lineage_issues
                }
            ),
        },
        documents=documents,
        manual_review_pages=manual_review_pages,
        consumer_candidate_pages=consumer_candidate_pages,
        collection_mode=collection_mode,
        target_family_counts=target_family_counts,
        target_materialization_policy_counts=target_materialization_policy_counts,
        target_lineage_issues=target_lineage_issues,
    )
    (projection_output_dir / "projection-report.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report
