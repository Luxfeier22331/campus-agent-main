from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Literal


OFFICIAL_WEB_PROJECTION_DECLARATIONS_SCHEMA_VERSION = "official_web_projection_declarations.v1"
OFFICIAL_WEB_PROJECTION_ROUTING_SCHEMA_VERSION = "official_web_projection_routing.v1"
OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_SCHEMA_VERSION = "official_web_source_truth_bundle.v1"
OFFICIAL_WEB_PAGE_MANIFEST_SCHEMA_VERSION = "official_web_page_manifest.v1"
OFFICIAL_WEB_CONTENT_BLOCK_SCHEMA_VERSION = "official_web_content_block.v1"
OFFICIAL_WEB_PROJECTION_REPLAY_REPORT_SCHEMA_VERSION = "official_web_projection_replay_report.v1"
OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION = "official_web_projection_validation_report.v1"
OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES = {
    "article_detail",
    "listing_page",
    "directory_page",
    "sitemap_navigation_page",
    "data_table_page",
    "gallery_page",
    "contact_widget_page",
    "structural_shell_page",
    "dynamic_shell_page",
    "generic_content_page",
}
OFFICIAL_WEB_SHELL_PAGE_FAMILIES = {
    "structural_shell_page",
    "dynamic_shell_page",
}
OFFICIAL_WEB_PROJECTION_ACTIONS = {
    "emit_document",
    "manual_review",
}
LISTING_DATE_ONLY_PATTERN = re.compile(r"^20\d{2}([./-])\d{1,2}\1\d{1,2}$")
LISTING_COMPACTED_ISO_DATE_PREFIX_PATTERN = re.compile(r"^(20\d{2})[-./](\d{2})[-./](\d{2})(\S.+)$")
LISTING_COMPACTED_DAY_YEAR_MONTH_PREFIX_PATTERN = re.compile(r"^(\d{2})(20\d{2})[./-](\d{2})(\S.+)$")
LISTING_UPPERCASE_BADGE_PATTERN = re.compile(r"^[A-Z][A-Z&/ \-]{2,}$")
LISTING_HEADING_BADGE_SUFFIX_PATTERN = re.compile(r"^(?P<label>.+?)(?P<badge>[A-Z][A-Z&/ \-]{2,})$")
SEMANTIC_HASH_TERMINAL_COPYRIGHT_PATTERN = re.compile(r"^copyright(?:@|\b)")
OFFICIAL_WEB_LOW_VALUE_QR_SIGNUP_PATTERN = re.compile(
    r"^(?:请[^。；]*?)?(?:扫描|扫码)(?:下方|下列)?(?:二维码|二维码报名码)[^。；]*(?:预约|报名|参与|讲座信息)",
)
OFFICIAL_WEB_LOW_VALUE_ACTIVITY_POINTS_PATTERN = re.compile(
    r"^[（(]?(?:活动结束后|参与活动后)[^。；]*(?:积分|学时|参与者)[^。；]*[)）]?$"
)
LISTING_PAGINATION_TOKENS = frozenset({"首页", "末页", "尾页", "上页", "下页", "上一页", "下一页"})
LISTING_UTILITY_LINK_TOKENS = frozenset(
    {
        "信息门户",
        "领导信箱",
        "精品课程",
        "民大校报",
        "信息公开",
        "会议室预约",
        "公共服务",
        "图书馆",
    }
)
SEMANTIC_HASH_TERMINAL_BOILERPLATE_PREFIXES = (
    "新闻网版权与免责声明",
    "投稿方式：",
    "投稿方式:",
    "① 凡本网未注明其他出处的作品",
    "② 凡本网注明其他来源的作品",
    "③ 有关作品内容、版权和其它问题请与我们联系",
)
_ARTICLE_SECTION_MAX_PARAGRAPHS_PER_UNIT = 3
_OFFICIAL_WEB_NOTICE_TITLE_HINTS = ("讲座", "预告", "通知", "公告", "活动")
_OFFICIAL_WEB_REFERENCE_PAGE_TITLES = frozenset(
    {
        "学校简介",
        "学校概况",
        "本科培养",
        "研究生培养",
        "博士后",
        "访问学者",
        "现任领导",
        "学术名流",
        "校友会简介",
        "基金会简介",
    }
)
_OFFICIAL_WEB_SOURCE_ATTRIBUTION_PATTERN = re.compile(r"^[（(]?\s*来源[:：]\s*[^（）()]+[)）]?$")
_OFFICIAL_WEB_LABELED_FACT_LINE_PATTERN = re.compile(r"^(?P<label>[^：:\n]{1,16})[:：]\s*\S.+$")
_OFFICIAL_WEB_MEDIA_CAPTION_PATTERN = re.compile(r"^[\u4e00-\u9fffA-Za-z·]{1,24}\s*摄$")
_OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES = frozenset({"source_attribution", "boilerplate", "media_caption"})
_OFFICIAL_WEB_NOTICE_FACT_LABELS = frozenset(
    {
        "讲座主题",
        "活动主题",
        "主题",
        "主讲人",
        "主 讲 人",
        "讲座时间",
        "活动时间",
        "时间",
        "讲座地点",
        "活动地点",
        "地点",
        "线上腾讯会议",
        "腾讯会议",
        "会议号",
    }
)
ListingBufferEntry = tuple[int, str]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionDeclaration:
    declaration_id: str
    page_family: str
    target_corpus: str
    target_collection: str
    projection_family: str
    document_kind: str
    action: Literal["emit_document", "manual_review"]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionDeclarationsConfig:
    schema_version: str
    site_id: str
    projection_policy_version: str
    declarations: tuple[OfficialWebProjectionDeclaration, ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionRoute:
    route_id: str
    target_corpus: str
    target_collection: str
    page_families: tuple[str, ...]
    title_allowlist: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionRoutingConfig:
    schema_version: str
    site_id: str
    routing_policy_version: str
    routes: tuple[OfficialWebProjectionRoute, ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionReplayReport:
    schema_version: str
    site_id: str
    crawl_run_id: str
    output_dir: str
    projection_output_dir: str
    generated_at: str
    counts: dict[str, int]
    documents: list[dict[str, object]]
    manual_review_pages: list[dict[str, object]]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionValidationReport:
    schema_version: str
    valid: bool
    projection_output_dir: str
    issues: list[dict[str, object]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class _ArticleLineSemantics:
    line_class: Literal[
        "narrative_paragraph",
        "labeled_fact_line",
        "source_attribution_line",
        "terminal_boilerplate_line",
        "media_caption_line",
    ]
    content_role: str


def default_official_web_projection_declarations_path(site_id: str) -> Path:
    return _repo_root() / "configs" / "sources" / "official_web" / site_id / "projection-declarations.json"


def default_official_web_projection_routing_path(site_id: str) -> Path:
    return _repo_root() / "configs" / "sources" / "official_web" / site_id / "projection-routing.json"


def load_official_web_projection_declarations(path: Path) -> OfficialWebProjectionDeclarationsConfig:
    payload = _read_json(path)
    schema_version = str(payload.get("schema_version") or "").strip()
    if schema_version != OFFICIAL_WEB_PROJECTION_DECLARATIONS_SCHEMA_VERSION:
        raise ValueError(f"unsupported official_web projection schema_version: {schema_version!r}")
    site_id = _require_text(payload.get("site_id"), "site_id")
    projection_policy_version = _require_text(
        payload.get("projection_policy_version"),
        "projection_policy_version",
    )
    raw_declarations = payload.get("declarations")
    if not isinstance(raw_declarations, list):
        raise ValueError("declarations must be an array")
    declarations: list[OfficialWebProjectionDeclaration] = []
    seen_ids: set[str] = set()
    seen_page_families: set[str] = set()
    for item in raw_declarations:
        if not isinstance(item, dict):
            raise ValueError("projection declaration must be an object")
        declaration = OfficialWebProjectionDeclaration(
            declaration_id=_require_text(item.get("declaration_id"), "declaration_id"),
            page_family=_require_page_family(item.get("page_family")),
            target_corpus=_require_path_segment(item.get("target_corpus"), "target_corpus"),
            target_collection=_require_path_segment(item.get("target_collection"), "target_collection"),
            projection_family=_require_path_segment(item.get("projection_family"), "projection_family"),
            document_kind=_require_path_segment(item.get("document_kind"), "document_kind"),
            action=_require_action(item.get("action")),
        )
        if declaration.declaration_id in seen_ids:
            raise ValueError(f"duplicate official_web declaration_id: {declaration.declaration_id}")
        if declaration.page_family in seen_page_families:
            raise ValueError(f"duplicate official_web page_family declaration: {declaration.page_family}")
        if declaration.page_family in OFFICIAL_WEB_SHELL_PAGE_FAMILIES and declaration.action != "manual_review":
            raise ValueError(
                f"shell-family projection {declaration.declaration_id} must use action=manual_review"
            )
        seen_ids.add(declaration.declaration_id)
        seen_page_families.add(declaration.page_family)
        declarations.append(declaration)
    return OfficialWebProjectionDeclarationsConfig(
        schema_version=schema_version,
        site_id=site_id,
        projection_policy_version=projection_policy_version,
        declarations=tuple(declarations),
    )


def load_official_web_projection_routing(path: Path) -> OfficialWebProjectionRoutingConfig:
    payload = _read_json(path)
    schema_version = str(payload.get("schema_version") or "").strip()
    if schema_version != OFFICIAL_WEB_PROJECTION_ROUTING_SCHEMA_VERSION:
        raise ValueError(f"unsupported official_web projection routing schema_version: {schema_version!r}")
    site_id = _require_text(payload.get("site_id"), "site_id")
    routing_policy_version = _require_text(payload.get("routing_policy_version"), "routing_policy_version")
    raw_routes = payload.get("routes")
    if not isinstance(raw_routes, list):
        raise ValueError("routes must be an array")

    routes: list[OfficialWebProjectionRoute] = []
    seen_route_ids: set[str] = set()
    for item in raw_routes:
        if not isinstance(item, dict):
            raise ValueError("projection routing route must be an object")
        route_id = _require_text(item.get("route_id"), "route_id")
        if route_id in seen_route_ids:
            raise ValueError(f"duplicate official_web route_id: {route_id}")
        routes.append(
            OfficialWebProjectionRoute(
                route_id=route_id,
                target_corpus=_require_path_segment(item.get("target_corpus"), "target_corpus"),
                target_collection=_require_path_segment(item.get("target_collection"), "target_collection"),
                page_families=_require_page_family_list(item.get("page_families"), "page_families"),
                title_allowlist=_require_non_empty_string_list(item.get("title_allowlist"), "title_allowlist"),
            )
        )
        seen_route_ids.add(route_id)
    return OfficialWebProjectionRoutingConfig(
        schema_version=schema_version,
        site_id=site_id,
        routing_policy_version=routing_policy_version,
        routes=tuple(routes),
    )


def replay_official_web_source_truth_local(
    *,
    output_dir: Path,
    projection_output_dir: Path,
    declarations_path: Path | None = None,
    routing_path: Path | None = None,
) -> OfficialWebProjectionReplayReport:
    bundle_payload = _read_json(output_dir / "source-truth-bundle.json")
    schema_version = str(bundle_payload.get("schemaVersion") or bundle_payload.get("schema_version") or "").strip()
    if schema_version != OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_SCHEMA_VERSION:
        raise ValueError(f"unsupported source-truth bundle schema_version: {schema_version!r}")
    site_id = _require_text(bundle_payload.get("siteId") or bundle_payload.get("site_id"), "siteId")
    crawl_run_id = _require_text(bundle_payload.get("crawlRunId") or bundle_payload.get("crawl_run_id"), "crawlRunId")
    declarations = load_official_web_projection_declarations(
        declarations_path or default_official_web_projection_declarations_path(site_id)
    )
    if declarations.site_id != site_id:
        raise ValueError(
            f"projection declarations site_id {declarations.site_id!r} does not match bundle siteId {site_id!r}"
        )
    routing = _load_official_web_projection_routing_if_present(site_id=site_id, routing_path=routing_path)

    declaration_by_page_family = {
        declaration.page_family: declaration
        for declaration in declarations.declarations
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
        page_family = _require_page_family(raw_page.get("pageFamily") or raw_page.get("page_family"))
        declaration = declaration_by_page_family.get(page_family)
        if declaration is None:
            raise ValueError(f"missing projection declaration for page_family={page_family}")
        manifest, blocks = _load_local_page_source_truth(
            output_dir=output_dir,
            raw_asset_id=_require_text(raw_page.get("rawAssetId") or raw_page.get("raw_asset_id"), "rawAssetId"),
            raw_version_id=_require_text(raw_page.get("rawVersionId") or raw_page.get("raw_version_id"), "rawVersionId"),
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
                    "routing_route_id": matched_route.route_id if matched_route is not None else None,
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


def validate_official_web_projection_output(
    projection_output_dir: Path,
) -> OfficialWebProjectionValidationReport:
    issues: list[dict[str, object]] = []
    report_path = projection_output_dir / "projection-report.json"
    if not report_path.exists():
        return OfficialWebProjectionValidationReport(
            schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
            valid=False,
            projection_output_dir=str(projection_output_dir.resolve()),
            issues=[
                {
                    "severity": "error",
                    "code": "missing_projection_report",
                    "message": "missing projection-report.json",
                }
            ],
            counts={"documents": 0, "errors": 1, "warnings": 0},
        )

    try:
        report_payload = _read_json(report_path)
    except ValueError as exc:
        return OfficialWebProjectionValidationReport(
            schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
            valid=False,
            projection_output_dir=str(projection_output_dir.resolve()),
            issues=[
                {
                    "severity": "error",
                    "code": "projection_report_parse_failed",
                    "message": str(exc),
                }
            ],
            counts={"documents": 0, "errors": 1, "warnings": 0},
        )

    documents = report_payload.get("documents")
    if not isinstance(documents, list):
        issues.append(
            {
                "severity": "error",
                "code": "projection_report_documents_invalid",
                "message": "projection report documents must be an array",
            }
        )
        documents = []

    seen_document_ids: set[str] = set()
    for document in documents:
        if not isinstance(document, dict):
            issues.append(
                {
                    "severity": "error",
                    "code": "projection_report_document_invalid",
                    "message": "projection report document entry must be an object",
                }
            )
            continue
        document_id = _require_text(document.get("document_id"), "document_id")
        version_id = _require_text(document.get("version_id"), "version_id")
        if document_id in seen_document_ids:
            issues.append(
                {
                    "severity": "error",
                    "code": "duplicate_document_id",
                    "message": f"duplicate projected document_id: {document_id}",
                }
            )
        seen_document_ids.add(document_id)

        canonical_path = Path(_require_text(document.get("canonical_markdown_path"), "canonical_markdown_path"))
        if not canonical_path.exists():
            issues.append(
                {
                    "severity": "error",
                    "code": "missing_canonical_markdown",
                    "message": f"missing canonical markdown for {document_id}",
                }
            )
        else:
            canonical_body = canonical_path.read_text(encoding="utf-8").strip()
            if not canonical_body or canonical_body == f"# {_require_text(document.get('title'), 'title')}":
                issues.append(
                    {
                        "severity": "error",
                        "code": "empty_canonical_markdown",
                        "message": f"empty canonical markdown body for {document_id}",
                    }
                )

        document_units_path = Path(_require_text(document.get("document_units_path"), "document_units_path"))
        if not document_units_path.exists():
            issues.append(
                {
                    "severity": "error",
                    "code": "missing_document_units",
                    "message": f"missing document-units.jsonl for {document_id}",
                }
            )
            continue
        try:
            rows = _read_jsonl(document_units_path)
        except ValueError as exc:
            issues.append(
                {
                    "severity": "error",
                    "code": "document_units_parse_failed",
                    "message": f"{document_id}: {exc}",
                }
            )
            continue
        if not rows:
            issues.append(
                {
                    "severity": "error",
                    "code": "empty_document_units",
                    "message": f"document-units.jsonl is empty for {document_id}",
                }
            )
            continue
        for row in rows:
            if str(row.get("doc_id") or "").strip() != document_id:
                issues.append(
                    {
                        "severity": "error",
                        "code": "document_identity_mismatch",
                        "message": f"document-units doc_id mismatch for {document_id}",
                    }
                )
                break
            if str(row.get("version_id") or "").strip() != version_id:
                issues.append(
                    {
                        "severity": "error",
                        "code": "document_identity_mismatch",
                        "message": f"document-units version_id mismatch for {document_id}",
                    }
                )
                break

    errors = sum(1 for issue in issues if issue["severity"] == "error")
    warnings = sum(1 for issue in issues if issue["severity"] == "warning")
    return OfficialWebProjectionValidationReport(
        schema_version=OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=errors == 0,
        projection_output_dir=str(projection_output_dir.resolve()),
        issues=issues,
        counts={
            "documents": len(documents),
            "errors": errors,
            "warnings": warnings,
        },
    )


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
        if _looks_like_portal_generic_page(title=title, main_blocks=main_blocks) or _looks_like_sparse_generic_link_hub(
            main_blocks
        ):
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
        "published_at": _optional_text(manifest.get("publishedAt") or manifest.get("published_at")),
        "fetched_at": _optional_text(manifest.get("fetchedAt") or manifest.get("fetched_at")),
        "last_modified": _optional_text(manifest.get("lastModified") or manifest.get("last_modified")),
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


def _build_projection_units(
    *,
    declaration: OfficialWebProjectionDeclaration,
    manifest: dict[str, object],
    blocks: list[dict[str, object]],
    document_id: str,
    version_id: str,
    title: str,
) -> list[dict[str, object]]:
    main_blocks = [
        block
        for block in blocks
        if bool(block.get("isMainContent")) and _normalize_block_text(block)
    ]
    if not main_blocks:
        raise ValueError(f"page {manifest['normalizedCanonicalUrl']} has no main-content blocks to project")

    units: list[dict[str, object]] = []
    buffered_lines: list[str] = []
    buffered_row_id_groups: list[list[str]] = []
    buffered_line_roles: list[str] = []
    buffered_line_navigation_flags: list[bool] = []
    buffered_line_boilerplate_flags: list[bool] = []
    buffered_unit_type: str | None = None
    buffered_content_role: str | None = None
    current_section_path: list[str] = []
    buffered_section_path: list[str] = []
    seen_primary_narrative = False
    is_listing_document = declaration.document_kind == "listing"
    listing_item_headings: set[str] = set()
    portal_like_generic_page = declaration.document_kind == "generic" and _looks_like_portal_generic_page(
        title=title,
        main_blocks=main_blocks,
    )
    def reset_buffer() -> None:
        nonlocal buffered_lines
        nonlocal buffered_row_id_groups
        nonlocal buffered_line_roles
        nonlocal buffered_line_navigation_flags
        nonlocal buffered_line_boilerplate_flags
        nonlocal buffered_unit_type
        nonlocal buffered_content_role
        nonlocal buffered_section_path
        buffered_lines = []
        buffered_row_id_groups = []
        buffered_line_roles = []
        buffered_line_navigation_flags = []
        buffered_line_boilerplate_flags = []
        buffered_unit_type = None
        buffered_content_role = None
        buffered_section_path = []

    def flush_buffer() -> None:
        nonlocal buffered_lines
        nonlocal buffered_row_id_groups
        nonlocal buffered_line_roles
        nonlocal buffered_line_navigation_flags
        nonlocal buffered_line_boilerplate_flags
        nonlocal buffered_unit_type
        nonlocal buffered_content_role
        nonlocal buffered_section_path
        if not buffered_lines:
            return
        final_entries: list[ListingBufferEntry] = list(enumerate(buffered_lines))
        if buffered_unit_type == "link_list":
            final_entries = _finalize_listing_buffer_entries(
                buffered_lines,
                buffered_line_roles,
                buffered_line_navigation_flags,
                buffered_line_boilerplate_flags,
                buffered_section_path,
            )
        clean_text = "\n".join(text for _, text in final_entries if text).strip()
        final_row_ids = [
            row_id
            for source_index, _ in final_entries
            if source_index < len(buffered_row_id_groups)
            for row_id in buffered_row_id_groups[source_index]
            if row_id
        ]
        if not clean_text:
            reset_buffer()
            return
        unit_index = len(units) + 1
        unit_metadata = _build_projection_unit_metadata(
            declaration=declaration,
            manifest=manifest,
            title=title,
            semantic_content_hash="",
            content_role=buffered_content_role,
            is_answer_bearing=_resolve_projection_is_answer_bearing(buffered_content_role),
        )
        units.append(
            _build_structured_unit_row(
                doc_id=document_id,
                version_id=version_id,
                chunk_id=f"{document_id}:unit-{unit_index:04d}",
                root_unit_id=f"{document_id}:root-{unit_index:04d}",
                unit_type=buffered_unit_type or "section_text",
                clean_text=clean_text,
                source_pdf=f"official_web:{manifest['siteId']}",
                source_url=str(manifest["normalizedCanonicalUrl"]),
                anchor={
                    "page_start": 1,
                    "page_end": 1,
                    "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                    "page_family": manifest["pageFamily"],
                    "section_path": list(buffered_section_path),
                    "row_ids": final_row_ids,
                },
                metadata=unit_metadata,
            )
        )
        reset_buffer()

    for block_index, block in enumerate(main_blocks):
        block_role = str(block.get("blockRole") or "").strip()
        text = _normalize_block_text(block)
        if not text:
            continue
        parent_heading_path = _normalize_string_list(block.get("parentHeadingPath"))
        if is_listing_document:
            parent_heading_path = _sanitize_listing_parent_heading_path(parent_heading_path, listing_item_headings)
        if block_role == "title":
            continue
        if block_role == "heading":
            flush_buffer()
            if is_listing_document and _looks_like_listing_item_heading_block(main_blocks, block_index, text):
                listing_item_headings.add(_normalize_listing_context_label(text))
                continue
            if portal_like_generic_page and seen_primary_narrative:
                current_section_path = list(parent_heading_path)
                continue
            if text == title or (current_section_path and text == current_section_path[-1]):
                current_section_path = list(parent_heading_path or current_section_path)
                continue
            current_section_path = [*parent_heading_path, text]
            continue
        if (
            declaration.document_kind in {"article", "generic"}
            and not seen_primary_narrative
            and block_role in {"list_item", "link"}
        ):
            continue
        if declaration.document_kind in {"article", "generic"} and _should_skip_generic_noise_line(
            text=text,
            block_role=block_role,
            seen_primary_narrative=seen_primary_narrative,
            portal_like_generic_page=portal_like_generic_page,
        ):
            continue
        unit_type = _resolve_unit_type(declaration.document_kind, block_role)
        section_path = parent_heading_path or current_section_path
        if unit_type == "link_list":
            text = _normalize_listing_line(text)
            if not text:
                continue
            section_path = _resolve_listing_section_path(
                parent_heading_path=parent_heading_path,
                current_section_path=current_section_path,
                listing_item_headings=listing_item_headings,
            )
            if (
                block_role == "paragraph"
                and _is_listing_date_only_line(text)
                and buffered_lines
                and _can_attach_listing_date(buffered_lines[-1])
            ):
                buffered_lines[-1] = f"{buffered_lines[-1]} {text}"
                if buffered_row_id_groups:
                    row_id = str(block.get("rowId") or "").strip()
                    if row_id:
                        buffered_row_id_groups[-1].append(row_id)
                continue
        if block_role in {"table", "table_row", "table_cell"}:
            flush_buffer()
            current_section_path = list(section_path)
            unit_index = len(units) + 1
            units.append(
                _build_structured_unit_row(
                    doc_id=document_id,
                    version_id=version_id,
                    chunk_id=f"{document_id}:unit-{unit_index:04d}",
                    root_unit_id=f"{document_id}:root-{unit_index:04d}",
                    unit_type="table_unit",
                    clean_text=text,
                    source_pdf=f"official_web:{manifest['siteId']}",
                    source_url=str(manifest["normalizedCanonicalUrl"]),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                    "page_family": manifest["pageFamily"],
                    "section_path": list(section_path),
                    "row_ids": [str(block.get("rowId") or "")],
                },
                    metadata=_build_projection_unit_metadata(
                        declaration=declaration,
                        manifest=manifest,
                        title=title,
                        semantic_content_hash="",
                        content_role=_resolve_projection_content_role(
                            page_family=declaration.page_family,
                            document_kind=declaration.document_kind,
                            title=title,
                        ),
                        is_answer_bearing=True,
                    ),
                    table_cells=block.get("tableCells"),
                )
            )
            continue
        if declaration.document_kind == "directory" and block_role == "paragraph":
            flush_buffer()
            current_section_path = list(section_path)
            unit_index = len(units) + 1
            units.append(
                _build_structured_unit_row(
                    doc_id=document_id,
                    version_id=version_id,
                    chunk_id=f"{document_id}:unit-{unit_index:04d}",
                    root_unit_id=f"{document_id}:root-{unit_index:04d}",
                    unit_type="directory_entry",
                    clean_text=text,
                    source_pdf=f"official_web:{manifest['siteId']}",
                    source_url=str(manifest["normalizedCanonicalUrl"]),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                        "page_family": manifest["pageFamily"],
                        "section_path": list(section_path),
                        "row_ids": [str(block.get("rowId") or "")],
                    },
                    metadata=_build_projection_unit_metadata(
                        declaration=declaration,
                        manifest=manifest,
                        title=title,
                        semantic_content_hash="",
                        content_role=_resolve_projection_content_role(
                            page_family=declaration.page_family,
                            document_kind=declaration.document_kind,
                            title=title,
                        ),
                        is_answer_bearing=True,
                    ),
                )
            )
            continue
        if block_role == "paragraph":
            seen_primary_narrative = True
        line_semantics = _classify_article_line(
            title=title,
            document_kind=declaration.document_kind,
            text=text,
        )
        content_role = _resolve_projection_content_role(
            page_family=declaration.page_family,
            document_kind=declaration.document_kind,
            title=title,
            line_class=line_semantics.line_class,
        )
        if buffered_unit_type is not None and (
            buffered_unit_type != unit_type
            or section_path != buffered_section_path
            or buffered_content_role != content_role
        ):
            flush_buffer()
        if _should_flush_article_section_text_buffer(
            document_kind=declaration.document_kind,
            buffered_unit_type=buffered_unit_type,
            buffered_content_role=buffered_content_role,
            buffered_lines=buffered_lines,
            buffered_line_roles=buffered_line_roles,
            next_unit_type=unit_type,
            next_content_role=content_role,
            next_block_role=block_role,
            next_line_class=line_semantics.line_class,
        ):
            flush_buffer()
        if buffered_unit_type is None:
            buffered_unit_type = unit_type
            buffered_section_path = list(section_path)
            buffered_content_role = content_role
        if buffered_lines and buffered_lines[-1] == text:
            continue
        buffered_lines.append(text)
        row_id = str(block.get("rowId") or "").strip()
        buffered_row_id_groups.append([row_id] if row_id else [])
        buffered_line_roles.append(block_role)
        buffered_line_navigation_flags.append(bool(block.get("isNavigation")))
        buffered_line_boilerplate_flags.append(bool(block.get("isBoilerplate")))

    flush_buffer()
    semantic_content_hash = _build_semantic_content_hash(
        document_kind=declaration.document_kind,
        title=title,
        units=units,
    )
    for unit in units:
        metadata = unit.get("metadata")
        if isinstance(metadata, dict):
            metadata["semantic_content_hash"] = semantic_content_hash
    return units


def _resolve_document_title(*, manifest: dict[str, object], blocks: list[dict[str, object]]) -> str:
    title = str(manifest.get("pageTitleNormalized") or "").strip()
    if title:
        return title
    for block in blocks:
        text = _normalize_block_text(block)
        if text:
            return text.splitlines()[0].strip()
    return "Untitled official web page"


def _load_official_web_projection_routing_if_present(
    *,
    site_id: str,
    routing_path: Path | None,
) -> OfficialWebProjectionRoutingConfig | None:
    resolved_path = routing_path or default_official_web_projection_routing_path(site_id)
    if routing_path is None and not resolved_path.exists():
        return None
    routing = load_official_web_projection_routing(resolved_path)
    if routing.site_id != site_id:
        raise ValueError(
            f"projection routing site_id {routing.site_id!r} does not match bundle siteId {site_id!r}"
        )
    return routing


def _resolve_projection_routing_route(
    *,
    routing: OfficialWebProjectionRoutingConfig | None,
    declaration: OfficialWebProjectionDeclaration,
    title: str,
) -> OfficialWebProjectionRoute | None:
    if routing is None:
        return None
    matched_routes = [
        route
        for route in routing.routes
        if declaration.page_family in route.page_families and title in route.title_allowlist
    ]
    if len(matched_routes) > 1:
        matched_route_ids = ", ".join(route.route_id for route in matched_routes)
        raise ValueError(
            f"multiple official_web projection routes matched page_family={declaration.page_family!r} "
            f"title={title!r}: {matched_route_ids}"
        )
    return matched_routes[0] if matched_routes else None


def _build_document_id(*, site_id: str, page_family: str, normalized_canonical_url: str) -> str:
    digest = hashlib.sha1(f"{site_id}\n{page_family}\n{normalized_canonical_url}".encode("utf-8")).hexdigest()
    return f"official_web:{site_id}:{page_family}:{digest}"


def _build_version_id(*, raw_version_id: str, declaration_id: str, main_content_hash: str) -> str:
    digest = hashlib.sha1(f"{raw_version_id}\n{declaration_id}\n{main_content_hash}".encode("utf-8")).hexdigest()
    return f"owdocver:{digest}"


def _build_document_output_dir(
    *,
    projection_output_dir: Path,
    declaration: OfficialWebProjectionDeclaration,
    title: str,
    document_id: str,
) -> Path:
    title_slug = _slugify_text(title) or declaration.document_kind or declaration.page_family
    document_hash = hashlib.sha1(document_id.encode("utf-8")).hexdigest()[:8]
    return (
        projection_output_dir
        / "documents"
        / declaration.target_corpus
        / declaration.target_collection
        / f"{title_slug}--{document_hash}"
    )


def _render_canonical_markdown(
    *,
    title: str,
    manifest: dict[str, object],
    units: list[dict[str, object]],
) -> str:
    lines = [f"# {title}", "", f"> Source URL: {manifest['normalizedCanonicalUrl']}", ""]
    is_listing_page = str(manifest.get("pageFamily") or "").strip() == "listing_page"
    last_section_path: tuple[str, ...] = ()
    for unit in units:
        if _is_support_only_projection_unit(unit):
            continue
        anchor = unit.get("anchor")
        section_path = tuple(_normalize_string_list(anchor.get("section_path") if isinstance(anchor, dict) else []))
        display_section_path = (
            tuple(_normalize_listing_section_heading(item) for item in section_path) if is_listing_page else section_path
        )
        if display_section_path and display_section_path != last_section_path:
            heading = display_section_path[-1]
            if heading and heading != title:
                lines.append(f"## {heading}")
                lines.append("")
            last_section_path = display_section_path
        clean_text = str(unit.get("clean_text") or "").strip()
        if not clean_text:
            continue
        if str(unit.get("unit_type") or "") in {"link_list", "directory_entry"}:
            for line in clean_text.splitlines():
                normalized = line.strip()
                if normalized:
                    lines.append(f"- {normalized}")
            lines.append("")
            continue
        lines.append(clean_text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _normalize_listing_context_label(text: str) -> str:
    return " ".join(text.split()).strip()


def _sanitize_listing_parent_heading_path(
    parent_heading_path: list[str],
    listing_item_headings: set[str],
) -> list[str]:
    if not parent_heading_path or not listing_item_headings:
        return list(parent_heading_path)
    return [
        item
        for item in parent_heading_path
        if _normalize_listing_context_label(item) not in listing_item_headings
    ]


def _resolve_listing_section_path(
    *,
    parent_heading_path: list[str],
    current_section_path: list[str],
    listing_item_headings: set[str],
) -> list[str]:
    sanitized_parent_heading_path = _sanitize_listing_parent_heading_path(parent_heading_path, listing_item_headings)
    if sanitized_parent_heading_path:
        return sanitized_parent_heading_path
    return list(current_section_path)


def _looks_like_listing_item_heading_block(
    main_blocks: list[dict[str, object]],
    block_index: int,
    text: str,
) -> bool:
    normalized_text = _normalize_listing_context_label(text)
    if len(normalized_text) <= 12:
        return False
    for next_index in range(block_index + 1, min(len(main_blocks), block_index + 4)):
        next_block = main_blocks[next_index]
        next_role = str(next_block.get("blockRole") or "").strip()
        next_text = _normalize_listing_context_label(_normalize_block_text(next_block))
        if not next_text or next_role == "title":
            continue
        return next_role in {"heading", "link"} and next_text == normalized_text
    return False


def _finalize_listing_buffer_entries(
    lines: list[str],
    block_roles: list[str],
    navigation_flags: list[bool],
    boilerplate_flags: list[bool],
    section_path: list[str],
) -> list[ListingBufferEntry]:
    section_heading = section_path[-1] if section_path else ""
    normalized_input_lines = [_normalize_listing_line(line) for line in lines]
    short_label_token_count = sum(1 for line in normalized_input_lines if _looks_like_short_label_token(line))
    deduped_entries: list[ListingBufferEntry] = []
    seen_non_date_lines: set[str] = set()
    seen_listing_title_lines: set[str] = set()
    seen_listing_date_lines: set[str] = set()
    for index, line in enumerate(lines):
        block_role = block_roles[index] if index < len(block_roles) else ""
        normalized = _normalize_listing_line(line)
        if not normalized or _should_skip_listing_line(normalized, section_heading):
            continue
        if (
            short_label_token_count >= 2
            and _looks_like_short_label_token(normalized)
            and (
                _is_listing_short_label_noise_candidate(
                    block_role,
                    navigation_flags[index] if index < len(navigation_flags) else False,
                    boilerplate_flags[index] if index < len(boilerplate_flags) else False,
                )
                or _is_interstitial_short_label_line(index, normalized_input_lines)
                or _is_trailing_short_label_cluster_line(index, normalized_input_lines)
            )
        ):
            continue
        if _should_drop_listing_summary_line(normalized, block_role):
            continue
        if _is_listing_date_only_line(normalized):
            seen_listing_date_lines.add(normalized)
            deduped_entries.append((index, normalized))
            continue
        title_date_pair = _split_listing_title_date_pair(normalized)
        if title_date_pair is not None:
            title_text, date_text = title_date_pair
            if title_text in seen_listing_title_lines and date_text in seen_listing_date_lines:
                continue
        if normalized in seen_non_date_lines:
            continue
        seen_non_date_lines.add(normalized)
        seen_listing_title_lines.add(title_date_pair[0] if title_date_pair is not None else normalized)
        if title_date_pair is not None:
            seen_listing_date_lines.add(title_date_pair[1])
        deduped_entries.append((index, normalized))
    return _drop_listing_teaser_cluster_entries(_drop_listing_aggregate_entries(deduped_entries))


def _normalize_listing_line(text: str) -> str:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return ""
    normalized = _split_compacted_listing_date_prefix(normalized)
    return " ".join(normalized.split()).strip()


def _split_compacted_listing_date_prefix(text: str) -> str:
    compacted_iso_match = LISTING_COMPACTED_ISO_DATE_PREFIX_PATTERN.match(text)
    if compacted_iso_match is not None:
        year, month, day, remainder = compacted_iso_match.groups()
        return f"{year}-{month.zfill(2)}-{day.zfill(2)} {remainder}".strip()

    compacted_day_year_month_match = LISTING_COMPACTED_DAY_YEAR_MONTH_PREFIX_PATTERN.match(text)
    if compacted_day_year_month_match is not None:
        day, year, month, remainder = compacted_day_year_month_match.groups()
        return f"{year}.{month.zfill(2)}.{day.zfill(2)} {remainder}".strip()

    return text


def _should_skip_listing_line(text: str, section_heading: str) -> bool:
    if text in {"更多", "当前位置：", "当前位置:"}:
        return True
    if text in LISTING_UTILITY_LINK_TOKENS:
        return True
    if _is_listing_pagination_token(text):
        return True
    if _looks_like_short_label_cluster(text):
        return True
    if _contains_terminal_ellipsis(text):
        return True
    if LISTING_UPPERCASE_BADGE_PATTERN.fullmatch(text) and text.upper() in section_heading.upper():
        return True
    return False


def _is_listing_pagination_token(text: str) -> bool:
    if text in LISTING_PAGINATION_TOKENS:
        return True
    return text.isdigit() and int(text) <= 99


def _should_drop_listing_summary_line(text: str, block_role: str) -> bool:
    if block_role != "paragraph":
        return False
    if _looks_like_short_label_cluster(text):
        return True
    if _contains_terminal_ellipsis(text):
        return True
    if _is_listing_date_only_line(text) or _split_listing_title_date_pair(text) is not None:
        return False
    punctuation_count = sum(text.count(punctuation) for punctuation in {"。", "！", "？", "；", "：", ":", "，", ","})
    return len(text) >= 40 and punctuation_count >= 2


def _drop_listing_aggregate_entries(entries: list[ListingBufferEntry]) -> list[ListingBufferEntry]:
    filtered_entries: list[ListingBufferEntry] = []
    lines = [line for _, line in entries]
    for index, entry in enumerate(entries):
        line = entry[1]
        matching_shorter_lines = {
            other
            for other_index, other in enumerate(lines)
            if other_index != index
            and len(other) >= 4
            and len(other) < len(line)
            and other in line
        }
        if len(matching_shorter_lines) >= 3 and line.count(" ") >= 2:
            continue
        filtered_entries.append(entry)
    return filtered_entries


def _drop_listing_teaser_cluster_entries(entries: list[ListingBufferEntry]) -> list[ListingBufferEntry]:
    if len(entries) < 3:
        return entries
    lines = [line for _, line in entries]
    for start_index in range(1, len(entries)):
        trailing_lines = lines[start_index:]
        if len(trailing_lines) < 2:
            continue
        if not _looks_like_listing_series_anchor(lines[start_index - 1]):
            continue
        teaser_like_count = sum(1 for line in trailing_lines if _looks_like_listing_teaser_line(line))
        if teaser_like_count >= 2:
            return entries[:start_index]
    return entries


def _is_listing_date_only_line(text: str) -> bool:
    return LISTING_DATE_ONLY_PATTERN.fullmatch(text) is not None


def _can_attach_listing_date(text: str) -> bool:
    return (
        not _is_listing_date_only_line(text)
        and not _listing_line_starts_with_date(text)
        and not any(punctuation in text for punctuation in {"。", "！", "？", "；", "：", ":", "!", "?"})
        and len(text) <= 96
    )


def _listing_line_starts_with_date(text: str) -> bool:
    return LISTING_DATE_ONLY_PATTERN.match(text) is not None or bool(
        re.match(r"^20\d{2}[./-]\d{2}[./-]\d{2}(?:\s|$)", text)
    ) or bool(re.match(r"^20\d{2}\.\d{2}\.\d{2}(?:\s|$)", text))


def _split_listing_title_date_pair(text: str) -> tuple[str, str] | None:
    suffix_match = re.match(r"^(.+?)\s+(20\d{2}[./-]\d{2}[./-]\d{2})$", text)
    if suffix_match is not None:
        title_text, date_text = suffix_match.groups()
        return title_text.strip(), date_text
    prefix_match = re.match(r"^(20\d{2}[./-]\d{2}[./-]\d{2})\s+(.+)$", text)
    if prefix_match is not None:
        date_text, title_text = prefix_match.groups()
        return title_text.strip(), date_text
    return None


def _normalize_listing_section_heading(text: str) -> str:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return ""
    badge_match = LISTING_HEADING_BADGE_SUFFIX_PATTERN.fullmatch(normalized)
    if badge_match is None:
        return normalized
    label = badge_match.group("label").strip(" -/&")
    if label and _contains_cjk_character(label):
        return label
    return normalized


def _contains_cjk_character(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def _contains_terminal_ellipsis(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    return normalized.endswith("...") or normalized.endswith("…")


def _looks_like_listing_series_anchor(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    return bool(re.match(r"^【[^】]{1,20}】", normalized))


def _looks_like_listing_teaser_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if re.match(r"^\d+\s*张[，,、 ]?", normalized):
        return True
    if " | " in normalized:
        return True
    return False


def _looks_like_short_label_cluster(text: str) -> bool:
    tokens = [token.strip() for token in re.split(r"\s+", text) if token.strip()]
    if len(tokens) < 2:
        return False
    return all(_looks_like_short_label_token(token) for token in tokens)


def _is_listing_short_label_noise_candidate(block_role: str, is_navigation: bool, is_boilerplate: bool) -> bool:
    return block_role == "paragraph" or is_navigation or is_boilerplate


def _is_interstitial_short_label_line(index: int, normalized_lines: list[str]) -> bool:
    has_substantive_before = any(
        _is_substantive_listing_line(line)
        for line in normalized_lines[:index]
    )
    has_substantive_after = any(
        _is_substantive_listing_line(line)
        for line in normalized_lines[index + 1 :]
    )
    return has_substantive_before and has_substantive_after


def _is_substantive_listing_line(text: str) -> bool:
    return bool(text) and not _looks_like_short_label_token(text) and not _is_listing_date_only_line(text)


def _is_trailing_short_label_cluster_line(index: int, normalized_lines: list[str]) -> bool:
    trailing_start = len(normalized_lines)
    for candidate_index in range(len(normalized_lines) - 1, -1, -1):
        if _looks_like_short_label_token(normalized_lines[candidate_index]):
            trailing_start = candidate_index
            continue
        break
    trailing_lines = normalized_lines[trailing_start:]
    if len(trailing_lines) < 3:
        return False
    if not all(_looks_like_short_label_token(line) for line in trailing_lines):
        return False
    if index < trailing_start:
        return False
    return any(_is_substantive_listing_line(line) for line in normalized_lines[:trailing_start])


def _looks_like_short_label_token(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if len(normalized) > 6:
        return False
    if not _contains_cjk_character(normalized):
        return False
    if _is_listing_date_only_line(normalized):
        return False
    if any(punctuation in normalized for punctuation in {"。", "！", "？", "；", "：", ":", "，", ","}):
        return False
    if any(character.isdigit() for character in normalized):
        return False
    return True


def _looks_like_headline_only_fragment(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if len(normalized) > 96:
        return False
    if _is_listing_date_only_line(normalized):
        return False
    if any(punctuation in normalized for punctuation in {"。", "！", "？", "；", ";"}):
        return False
    comma_count = normalized.count("，") + normalized.count(",")
    if comma_count >= 2:
        return False
    return True


def _looks_like_portal_generic_page(*, title: str, main_blocks: list[dict[str, object]]) -> bool:
    if not re.search(r"(新闻网|新闻中心|首页)", title):
        return False
    heading_count = 0
    link_count = 0
    paragraph_count = 0
    for block in main_blocks:
        block_role = str(block.get("blockRole") or "").strip()
        if block_role == "heading":
            heading_count += 1
        elif block_role == "link":
            link_count += 1
        elif block_role == "paragraph":
            paragraph_count += 1
    return heading_count >= 3 and link_count >= 2 and paragraph_count >= 2


def _looks_like_sparse_generic_link_hub(main_blocks: list[dict[str, object]]) -> bool:
    link_like_count = 0
    paragraph_count = 0
    for block in main_blocks:
        block_role = str(block.get("blockRole") or "").strip()
        if block_role in {"link", "list_item"}:
            link_like_count += 1
        elif block_role == "paragraph":
            paragraph_count += 1
    return paragraph_count == 0 and link_like_count >= 2


def _looks_like_portal_directory_page(
    *,
    title: str,
    manifest: dict[str, object],
    main_blocks: list[dict[str, object]],
) -> bool:
    normalized_title = " ".join(title.split()).strip()
    normalized_url = str(manifest.get("normalizedCanonicalUrl") or "").strip().rstrip("/")
    if normalized_title not in {"首页", "中央民族大学"} and not normalized_url.endswith("://www.example.edu"):
        if not normalized_url.endswith("://www.muc.edu.cn") and normalized_title != "门户首页":
            # Keep the guard narrow: this is a homepage/portal detector, not a generic directory downgrade.
            return False
    heading_count = 0
    link_like_count = 0
    date_like_count = 0
    short_utility_link_count = 0
    for block in main_blocks:
        block_role = str(block.get("blockRole") or "").strip()
        text = _normalize_block_text(block)
        if not text:
            continue
        if block_role == "heading":
            heading_count += 1
            if _looks_like_headline_only_fragment(text):
                link_like_count += 1
        elif block_role in {"link", "list_item"}:
            link_like_count += 1
            if text in LISTING_UTILITY_LINK_TOKENS or _looks_like_short_label_token(text):
                short_utility_link_count += 1
        elif block_role == "paragraph" and _looks_like_date_or_listing_badge_line(text):
            date_like_count += 1
    return heading_count >= 2 and (link_like_count >= 2 or date_like_count >= 2 or short_utility_link_count >= 1)


def _looks_like_date_or_listing_badge_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if _is_listing_date_only_line(normalized):
        return True
    return bool(re.fullmatch(r"20\d{2}[./-]\d{1,2}[./-]\d{1,2}", normalized))


def _should_skip_generic_noise_line(
    *,
    text: str,
    block_role: str,
    seen_primary_narrative: bool,
    portal_like_generic_page: bool,
) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return True
    if _looks_like_low_value_article_tail_line(normalized):
        return True
    if _looks_like_short_label_cluster(normalized):
        return True
    if _contains_terminal_ellipsis(normalized):
        return True
    if (
        portal_like_generic_page
        and seen_primary_narrative
        and block_role in {"paragraph", "link", "list_item"}
        and _looks_like_headline_only_fragment(normalized)
    ):
        return True
    return False


def _looks_like_low_value_article_tail_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if OFFICIAL_WEB_LOW_VALUE_QR_SIGNUP_PATTERN.match(normalized):
        return True
    if OFFICIAL_WEB_LOW_VALUE_ACTIVITY_POINTS_PATTERN.match(normalized):
        return True
    return False


def _looks_like_low_value_public_notice_page(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    normalized_canonical_url: str,
) -> bool:
    if page_family != "article_detail" or document_kind != "article":
        return False
    normalized_title = " ".join(title.split()).strip()
    normalized_url = normalized_canonical_url.lower().strip()
    if not normalized_title and not normalized_url:
        return False
    procurement_hit = any(
        token in normalized_title
        for token in ("采购", "招标", "比选", "询价", "竞价", "成交", "中标", "谈判结果")
    )
    recruitment_hit = "招聘" in normalized_title
    public_notice_hit = any(token in normalized_title for token in ("公告", "公示", "公示信息"))
    if procurement_hit and (public_notice_hit or "结果" in normalized_title):
        return True
    if recruitment_hit and public_notice_hit:
        return True
    return "招聘" in normalized_url and any(token in normalized_url for token in ("gonggao", "公告", "公示"))


def _resolve_unit_type(document_kind: str, block_role: str) -> str:
    if block_role in {"table", "table_row", "table_cell"}:
        return "table_unit"
    if document_kind == "listing":
        return "link_list"
    if document_kind == "directory":
        return "directory_entry"
    return "section_text"


def _should_flush_article_section_text_buffer(
    *,
    document_kind: str,
    buffered_unit_type: str | None,
    buffered_content_role: str | None,
    buffered_lines: list[str],
    buffered_line_roles: list[str],
    next_unit_type: str,
    next_content_role: str,
    next_block_role: str,
    next_line_class: str,
) -> bool:
    if document_kind != "article":
        return False
    if buffered_unit_type != "section_text" or next_unit_type != "section_text":
        return False
    if next_block_role != "paragraph":
        return False
    if buffered_content_role != next_content_role:
        return False
    if next_line_class in {"source_attribution_line", "terminal_boilerplate_line", "media_caption_line"}:
        return False
    if buffered_content_role == "notice_fact":
        return False
    buffered_paragraph_count = sum(1 for role in buffered_line_roles if role == "paragraph")
    return buffered_paragraph_count >= _ARTICLE_SECTION_MAX_PARAGRAPHS_PER_UNIT


def _load_local_page_source_truth(
    *,
    output_dir: Path,
    raw_asset_id: str,
    raw_version_id: str,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    base_dir = output_dir / "source-assets" / raw_asset_id / raw_version_id / "source-truth"
    manifest = _read_json(base_dir / "page-manifest.json")
    manifest_schema = str(manifest.get("schemaVersion") or manifest.get("schema_version") or "").strip()
    if manifest_schema != OFFICIAL_WEB_PAGE_MANIFEST_SCHEMA_VERSION:
        raise ValueError(f"unsupported page-manifest schema_version: {manifest_schema!r}")
    blocks = _read_jsonl(base_dir / "content-blocks.jsonl")
    for block in blocks:
        block_schema = str(block.get("schemaVersion") or block.get("schema_version") or "").strip()
        if block_schema != OFFICIAL_WEB_CONTENT_BLOCK_SCHEMA_VERSION:
            raise ValueError(f"unsupported content-block schema_version: {block_schema!r}")
    return manifest, blocks


def _build_structured_unit_row(
    *,
    doc_id: str,
    version_id: str,
    chunk_id: str,
    root_unit_id: str,
    unit_type: str,
    clean_text: str,
    source_pdf: str,
    source_url: str,
    anchor: dict[str, object],
    metadata: dict[str, object],
    table_cells: object = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id,
        "root_unit_id": root_unit_id,
        "unit_type": unit_type,
        "clean_text": clean_text,
        "source_pdf": source_pdf,
        "source_url": source_url,
        "source_md": None,
        "source": {"id": source_url},
        "page_start": int(anchor["page_start"]),
        "page_end": int(anchor["page_end"]),
        "anchor": anchor,
        "metadata": metadata,
        "table_cells": table_cells,
    }


def _build_projection_unit_metadata(
    *,
    declaration: OfficialWebProjectionDeclaration,
    manifest: dict[str, object],
    title: str,
    semantic_content_hash: str,
    content_role: str | None = None,
    is_answer_bearing: bool | None = None,
) -> dict[str, object]:
    serving_intent = _resolve_document_serving_intent(
        page_family=declaration.page_family,
        document_kind=declaration.document_kind,
        title=title,
        normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
    )
    promotion_block_reason = _resolve_document_promotion_block_reason(
        page_family=declaration.page_family,
        document_kind=declaration.document_kind,
        title=title,
        normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
    )
    metadata: dict[str, object] = {
        "title": title,
        "site_id": manifest["siteId"],
        "host": manifest["host"],
        "page_family": manifest["pageFamily"],
        "published_at": _optional_text(manifest.get("publishedAt") or manifest.get("published_at")),
        "fetched_at": _optional_text(manifest.get("fetchedAt") or manifest.get("fetched_at")),
        "last_modified": _optional_text(manifest.get("lastModified") or manifest.get("last_modified")),
        "projection_family": declaration.projection_family,
        "document_kind": declaration.document_kind,
        "declaration_id": declaration.declaration_id,
        "serving_intent": serving_intent,
        "semantic_content_hash": semantic_content_hash,
        "content_role": content_role
        or _resolve_projection_content_role(
            page_family=declaration.page_family,
            document_kind=declaration.document_kind,
            title=title,
        ),
    }
    resolved_content_role = str(metadata["content_role"]).strip()
    metadata["is_answer_bearing"] = (
        is_answer_bearing if is_answer_bearing is not None else _resolve_projection_is_answer_bearing(resolved_content_role)
    )
    if promotion_block_reason is not None:
        metadata["promotion_block_reason"] = promotion_block_reason
    return metadata


def _resolve_document_serving_intent(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    normalized_canonical_url: str,
) -> str:
    if page_family == "listing_page" or document_kind == "listing":
        return "audit_only"
    if _looks_like_low_value_public_notice_page(
        page_family=page_family,
        document_kind=document_kind,
        title=title,
        normalized_canonical_url=normalized_canonical_url,
    ):
        return "audit_only"
    return "promotable"


def _resolve_document_promotion_block_reason(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    normalized_canonical_url: str,
) -> str | None:
    if page_family == "listing_page" or document_kind == "listing":
        return "listing_page_audit_only"
    if _looks_like_low_value_public_notice_page(
        page_family=page_family,
        document_kind=document_kind,
        title=title,
        normalized_canonical_url=normalized_canonical_url,
    ):
        return "low_value_public_notice_audit_only"
    return None


def _resolve_projection_content_role(
    *,
    page_family: str,
    document_kind: str,
    title: str,
    line_class: str = "narrative_paragraph",
) -> str:
    if page_family == "listing_page" or document_kind == "listing":
        return "navigation_audit"
    if document_kind == "directory":
        return "directory_reference"
    if line_class == "source_attribution_line":
        return "source_attribution"
    if line_class == "terminal_boilerplate_line":
        return "boilerplate"
    if line_class == "media_caption_line":
        return "media_caption"
    if _is_reference_like_article_title(title):
        return "reference_fact"
    if _is_notice_like_article_title(title) and line_class == "labeled_fact_line":
        return "notice_fact"
    return "primary_content"


def _resolve_projection_is_answer_bearing(content_role: str | None) -> bool:
    normalized_role = str(content_role or "").strip()
    return normalized_role not in _OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES and normalized_role != "navigation_audit"


def _build_semantic_content_hash(
    *,
    document_kind: str,
    title: str,
    units: list[dict[str, object]],
) -> str:
    normalized_lines: list[str] = [f"title:{' '.join(title.split()).strip()}"]
    for unit in units:
        metadata = unit.get("metadata") if isinstance(unit.get("metadata"), dict) else {}
        content_role = str(metadata.get("content_role") or "").strip()
        if content_role in _OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES:
            continue
        text = _normalize_semantic_hash_text(str(unit.get("clean_text") or ""))
        if not text:
            continue
        unit_type = str(unit.get("unit_type") or "").strip()
        anchor = unit.get("anchor") if isinstance(unit.get("anchor"), dict) else {}
        section_path = " / ".join(
            item.strip()
            for item in _normalize_string_list(anchor.get("section_path") if isinstance(anchor, dict) else [])
            if item.strip()
        )
        normalized_lines.append(
            "\t".join(
                [
                    document_kind,
                    unit_type,
                    section_path,
                    " ".join(text.split()).strip(),
                ]
            )
        )
    digest = hashlib.sha256("\n".join(normalized_lines).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _normalize_semantic_hash_text(text: str) -> str:
    normalized_lines = [" ".join(line.split()).strip() for line in text.splitlines()]
    normalized_lines = [line for line in normalized_lines if line]
    while normalized_lines and _is_semantic_hash_terminal_boilerplate_line(normalized_lines[-1]):
        normalized_lines.pop()
    return "\n".join(normalized_lines).strip()


def _is_support_only_projection_unit(unit: dict[str, object]) -> bool:
    metadata = unit.get("metadata")
    if not isinstance(metadata, dict):
        return False
    return str(metadata.get("content_role") or "").strip() in _OFFICIAL_WEB_SUPPORT_ONLY_CONTENT_ROLES


def _classify_article_line(*, title: str, document_kind: str, text: str) -> _ArticleLineSemantics:
    if document_kind != "article":
        return _ArticleLineSemantics(line_class="narrative_paragraph", content_role="primary_content")
    normalized = " ".join(text.split()).strip()
    if _is_semantic_hash_terminal_boilerplate_line(normalized):
        return _ArticleLineSemantics(
            line_class="terminal_boilerplate_line",
            content_role=_resolve_projection_content_role(
                page_family="article_detail",
                document_kind=document_kind,
                title=title,
                line_class="terminal_boilerplate_line",
            ),
        )
    if _looks_like_source_attribution_line(normalized):
        return _ArticleLineSemantics(
            line_class="source_attribution_line",
            content_role=_resolve_projection_content_role(
                page_family="article_detail",
                document_kind=document_kind,
                title=title,
                line_class="source_attribution_line",
            ),
        )
    if _looks_like_media_caption_line(normalized):
        return _ArticleLineSemantics(
            line_class="media_caption_line",
            content_role=_resolve_projection_content_role(
                page_family="article_detail",
                document_kind=document_kind,
                title=title,
                line_class="media_caption_line",
            ),
        )
    line_class = "narrative_paragraph"
    if _looks_like_labeled_fact_line(normalized):
        if not _is_notice_like_article_title(title) or _looks_like_notice_fact_line(normalized):
            line_class = "labeled_fact_line"
    return _ArticleLineSemantics(
        line_class=line_class,
        content_role=_resolve_projection_content_role(
            page_family="article_detail",
            document_kind=document_kind,
            title=title,
            line_class=line_class,
        ),
    )


def _is_notice_like_article_title(title: str) -> bool:
    normalized = " ".join(title.split()).strip()
    return any(token in normalized for token in _OFFICIAL_WEB_NOTICE_TITLE_HINTS)


def _is_reference_like_article_title(title: str) -> bool:
    normalized = " ".join(title.split()).strip()
    if normalized in _OFFICIAL_WEB_REFERENCE_PAGE_TITLES:
        return True
    return any(token in normalized for token in ("简介", "概况"))


def _looks_like_source_attribution_line(text: str) -> bool:
    return _OFFICIAL_WEB_SOURCE_ATTRIBUTION_PATTERN.match(text) is not None


def _looks_like_labeled_fact_line(text: str) -> bool:
    return _OFFICIAL_WEB_LABELED_FACT_LINE_PATTERN.match(text) is not None


def _looks_like_notice_fact_line(text: str) -> bool:
    match = _OFFICIAL_WEB_LABELED_FACT_LINE_PATTERN.match(text)
    if match is None:
        return False
    return str(match.group("label") or "").strip() in _OFFICIAL_WEB_NOTICE_FACT_LABELS


def _looks_like_media_caption_line(text: str) -> bool:
    return _OFFICIAL_WEB_MEDIA_CAPTION_PATTERN.match(text) is not None


def _is_semantic_hash_terminal_boilerplate_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if normalized.startswith(SEMANTIC_HASH_TERMINAL_BOILERPLATE_PREFIXES):
        return True
    lowered = normalized.casefold()
    if "版权与免责声明" in normalized:
        return True
    if "all rights reserved" in lowered:
        return True
    if "转载、摘编或以其它方式使用本网作品" in normalized:
        return True
    if "并不代表本网赞同其观点和对其真实性负责" in normalized:
        return True
    if SEMANTIC_HASH_TERMINAL_COPYRIGHT_PATTERN.match(lowered) is not None:
        return True
    return False


def _slugify_text(value: str) -> str:
    lowered = value.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return normalized[:64]


def _normalize_block_text(block: dict[str, object]) -> str:
    if isinstance(block.get("textNormalized"), str) and str(block["textNormalized"]).strip():
        return str(block["textNormalized"]).strip()
    if isinstance(block.get("linkText"), str) and str(block["linkText"]).strip():
        return str(block["linkText"]).strip()
    return ""


def _normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]


def _read_json(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"failed to parse JSON file {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"JSON payload at {path} must be an object")
    return payload


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise ValueError(f"missing JSONL file: {path}") from exc
    rows: list[dict[str, object]] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"failed to parse JSONL line {index} at {path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"JSONL line {index} at {path} must be an object")
        rows.append(payload)
    return rows


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _require_non_empty_string_list(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must be a non-empty array")
    items: list[str] = []
    seen_items: set[str] = set()
    for item in value:
        text = _require_text(item, field_name)
        if text in seen_items:
            raise ValueError(f"duplicate {field_name} entry: {text}")
        seen_items.add(text)
        items.append(text)
    return tuple(items)


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _require_path_segment(value: object, field_name: str) -> str:
    normalized = _require_text(value, field_name)
    if "/" in normalized:
        raise ValueError(f"{field_name} must not contain slash")
    return normalized


def _require_page_family(value: object) -> str:
    normalized = _require_text(value, "page_family")
    if normalized not in OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES:
        raise ValueError(f"unsupported official_web page_family: {normalized}")
    return normalized


def _require_page_family_list(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must be a non-empty array")
    page_families: list[str] = []
    seen_page_families: set[str] = set()
    for item in value:
        page_family = _require_page_family(item)
        if page_family in seen_page_families:
            raise ValueError(f"duplicate {field_name} entry: {page_family}")
        seen_page_families.add(page_family)
        page_families.append(page_family)
    return tuple(page_families)


def _require_action(value: object) -> Literal["emit_document", "manual_review"]:
    normalized = _require_text(value, "action")
    if normalized not in OFFICIAL_WEB_PROJECTION_ACTIONS:
        raise ValueError(f"unsupported official_web projection action: {normalized}")
    return normalized  # type: ignore[return-value]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]
