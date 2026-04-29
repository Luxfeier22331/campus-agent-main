from __future__ import annotations

from pathlib import Path

from campus_ingestion_core.official_web_projection_shared import (
    OFFICIAL_WEB_PROJECTION_DECLARATIONS_SCHEMA_VERSION,
    OFFICIAL_WEB_PROJECTION_ROUTING_SCHEMA_VERSION,
    OFFICIAL_WEB_SHELL_PAGE_FAMILIES,
    OfficialWebProjectionDeclaration,
    OfficialWebProjectionDeclarationsConfig,
    OfficialWebProjectionRoute,
    OfficialWebProjectionRoutingConfig,
    _read_json,
    _repo_root,
    _require_action,
    _require_non_empty_string_list,
    _require_page_family,
    _require_page_family_list,
    _require_path_segment,
    _require_text,
)


def default_official_web_projection_declarations_path(site_id: str) -> Path:
    return (
        _repo_root()
        / "configs"
        / "sources"
        / "official_web"
        / site_id
        / "projection-declarations.json"
    )


def default_official_web_projection_routing_path(site_id: str) -> Path:
    return (
        _repo_root() / "configs" / "sources" / "official_web" / site_id / "projection-routing.json"
    )


def load_official_web_projection_declarations(
    path: Path,
) -> OfficialWebProjectionDeclarationsConfig:
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
            target_collection=_require_path_segment(
                item.get("target_collection"), "target_collection"
            ),
            projection_family=_require_path_segment(
                item.get("projection_family"), "projection_family"
            ),
            document_kind=_require_path_segment(item.get("document_kind"), "document_kind"),
            action=_require_action(item.get("action")),
        )
        if declaration.declaration_id in seen_ids:
            raise ValueError(f"duplicate official_web declaration_id: {declaration.declaration_id}")
        if declaration.page_family in seen_page_families:
            raise ValueError(
                f"duplicate official_web page_family declaration: {declaration.page_family}"
            )
        if (
            declaration.page_family in OFFICIAL_WEB_SHELL_PAGE_FAMILIES
            and declaration.action != "manual_review"
        ):
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
        raise ValueError(
            f"unsupported official_web projection routing schema_version: {schema_version!r}"
        )
    site_id = _require_text(payload.get("site_id"), "site_id")
    routing_policy_version = _require_text(
        payload.get("routing_policy_version"),
        "routing_policy_version",
    )
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
                target_collection=_require_path_segment(
                    item.get("target_collection"),
                    "target_collection",
                ),
                page_families=_require_page_family_list(item.get("page_families"), "page_families"),
                title_allowlist=_require_non_empty_string_list(
                    item.get("title_allowlist"),
                    "title_allowlist",
                ),
            )
        )
        seen_route_ids.add(route_id)
    return OfficialWebProjectionRoutingConfig(
        schema_version=schema_version,
        site_id=site_id,
        routing_policy_version=routing_policy_version,
        routes=tuple(routes),
    )


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
