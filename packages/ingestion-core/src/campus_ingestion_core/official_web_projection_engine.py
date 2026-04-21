from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from campus_ingestion_core.official_web_projection_config import (
    _load_official_web_projection_routing_if_present,
    _resolve_projection_routing_route,
    default_official_web_projection_declarations_path,
    load_official_web_projection_declarations,
)
from campus_ingestion_core.official_web_projection_content import (
    _resolve_document_promotion_block_reason,
    _resolve_document_serving_intent,
)
from campus_ingestion_core.official_web_projection_listing import (
    _looks_like_portal_directory_page,
    _looks_like_portal_generic_page,
    _looks_like_sparse_generic_link_hub,
)
from campus_ingestion_core.official_web_projection_shared import (
    OFFICIAL_WEB_PROJECTION_REPLAY_REPORT_SCHEMA_VERSION,
    OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_SCHEMA_VERSION,
    OfficialWebProjectionDeclaration,
    OfficialWebProjectionReplayReport,
    _normalize_block_text,
    _read_json,
    _require_page_family,
    _require_text,
)
from campus_ingestion_core.official_web_projection_units import (
    _build_document_id,
    _build_document_output_dir,
    _build_projection_units,
    _build_version_id,
    _load_local_page_source_truth,
    _render_canonical_markdown,
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

    projection_output_dir.mkdir(parents=True, exist_ok=True)
    documents: list[dict[str, object]] = []
    manual_review_pages: list[dict[str, object]] = []
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
        title = _resolve_document_title(manifest=manifest, blocks=blocks)
        matched_route = _resolve_projection_routing_route(
            routing=routing,
            declaration=declaration,
            title=title,
        )
        effective_declaration = declaration
        if matched_route is not None:
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
                    "routing_route_id": matched_route.route_id
                    if matched_route is not None
                    else None,
                }
            )
            continue
        document = _project_document(
            declaration=effective_declaration,
            manifest=manifest,
            blocks=blocks,
            projection_output_dir=projection_output_dir,
            title=title,
            routing_route_id=matched_route.route_id if matched_route is not None else None,
        )
        documents.append(document)

    report = OfficialWebProjectionReplayReport(
        schema_version=OFFICIAL_WEB_PROJECTION_REPLAY_REPORT_SCHEMA_VERSION,
        site_id=site_id,
        crawl_run_id=crawl_run_id,
        output_dir=str(output_dir.resolve()),
        projection_output_dir=str(projection_output_dir.resolve()),
        generated_at=datetime.now(timezone.utc).isoformat(),
        counts={
            "pages_seen": len(pages),
            "emitted_documents": len(documents),
            "manual_review_pages": len(manual_review_pages),
        },
        documents=documents,
        manual_review_pages=manual_review_pages,
    )
    (projection_output_dir / "projection-report.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def _resolve_projection_action(
    *,
    declaration: OfficialWebProjectionDeclaration,
    manifest: dict[str, object],
    blocks: list[dict[str, object]],
    title: str | None = None,
) -> tuple[Literal["emit_document", "manual_review"], str]:
    if declaration.action == "manual_review":
        return "manual_review", "manual_review declaration"

    title = title or _resolve_document_title(manifest=manifest, blocks=blocks)
    main_blocks = [
        block
        for block in blocks
        if bool(block.get("isMainContent")) and _normalize_block_text(block)
    ]

    if declaration.document_kind == "generic":
        if _looks_like_portal_generic_page(
            title=title,
            main_blocks=main_blocks,
        ) or _looks_like_sparse_generic_link_hub(main_blocks):
            return "manual_review", "staged_only portal_like_generic_page"
    if declaration.document_kind == "directory" and _looks_like_portal_directory_page(
        title=title,
        manifest=manifest,
        main_blocks=main_blocks,
    ):
        return "manual_review", "staged_only portal_like_directory_page"

    return "emit_document", "emit_document declaration"


def _project_document(
    *,
    declaration: OfficialWebProjectionDeclaration,
    manifest: dict[str, object],
    blocks: list[dict[str, object]],
    projection_output_dir: Path,
    title: str | None = None,
    routing_route_id: str | None = None,
) -> dict[str, object]:
    title = title or _resolve_document_title(manifest=manifest, blocks=blocks)
    document_id = _build_document_id(
        site_id=_require_text(manifest.get("siteId"), "siteId"),
        page_family=declaration.page_family,
        normalized_canonical_url=_require_text(
            manifest.get("normalizedCanonicalUrl"),
            "normalizedCanonicalUrl",
        ),
    )
    version_id = _build_version_id(
        raw_version_id=_require_text(manifest.get("rawVersionId"), "rawVersionId"),
        declaration_id=declaration.declaration_id,
        main_content_hash=_require_text(manifest.get("mainContentHash"), "mainContentHash"),
    )
    units = _build_projection_units(
        declaration=declaration,
        manifest=manifest,
        blocks=blocks,
        document_id=document_id,
        version_id=version_id,
        title=title,
    )
    if not units:
        raise ValueError(f"projected document {document_id} produced no document units")

    document_dir = _build_document_output_dir(
        projection_output_dir=projection_output_dir,
        declaration=declaration,
        title=title,
        document_id=document_id,
    )
    canonical_markdown_path = document_dir / "canonical.md"
    document_units_path = document_dir / "document-units.jsonl"
    canonical_markdown_path.parent.mkdir(parents=True, exist_ok=True)
    canonical_markdown_path.write_text(
        _render_canonical_markdown(title=title, manifest=manifest, units=units),
        encoding="utf-8",
    )
    document_units_path.write_text(
        "\n".join(json.dumps(unit, ensure_ascii=False) for unit in units) + "\n",
        encoding="utf-8",
    )
    return {
        "document_id": document_id,
        "version_id": version_id,
        "title": title,
        "declaration_id": declaration.declaration_id,
        "page_family": declaration.page_family,
        "projection_family": declaration.projection_family,
        "document_kind": declaration.document_kind,
        "target_corpus": declaration.target_corpus,
        "target_collection": declaration.target_collection,
        "routing_route_id": routing_route_id,
        "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
        "raw_asset_id": manifest["rawAssetId"],
        "raw_version_id": manifest["rawVersionId"],
        "published_at": _require_optional_text(
            manifest.get("publishedAt") or manifest.get("published_at")
        ),
        "fetched_at": _require_optional_text(
            manifest.get("fetchedAt") or manifest.get("fetched_at")
        ),
        "last_modified": _require_optional_text(
            manifest.get("lastModified") or manifest.get("last_modified")
        ),
        "unit_count": len(units),
        "serving_intent": _resolve_document_serving_intent(
            page_family=declaration.page_family,
            document_kind=declaration.document_kind,
            title=title,
            normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
        ),
        "promotion_block_reason": _resolve_document_promotion_block_reason(
            page_family=declaration.page_family,
            document_kind=declaration.document_kind,
            title=title,
            normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
        ),
        "canonical_markdown_path": str(canonical_markdown_path.resolve()),
        "document_units_path": str(document_units_path.resolve()),
    }


def _require_optional_text(value: object) -> str | None:
    text = value.strip() if isinstance(value, str) else None
    return text or None
