from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from campus_ingestion_core.official_web_academic_calendar_projection import (
    block_has_academic_calendar_image_ref,
    build_academic_calendar_typed_candidate,
)
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
from campus_ingestion_core.official_web_regulation_titles import (
    normalize_official_web_regulation_title,
    official_web_regulation_title_metadata,
)
from campus_ingestion_core.official_web_target_labeling import (
    choose_official_web_contact_display_name,
    choose_official_web_service_name,
)

_PHONE_RE = re.compile(r"(?<!\d)(?:0\d{2,3}[-\s]?)?\d{7,8}(?!\d)")
_EMAIL_RE = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.IGNORECASE)
_LOCATION_RE = re.compile(r"(?:办公地点|办理地点|地点|地址)[:：]\s*([^，。；;\n]+)")
_CAMPUS_ADDRESS_RE = re.compile(
    r"(?P<label>(?:海淀|丰台|海南)校区)[:：]\s*"
    r"(?P<address>.*?)(?=\s*(?:海淀|丰台|海南)校区[:：]|$)"
)
_OFFICE_HOURS_RE = re.compile(r"(?:办公时间|办理时间|服务时间|开放时间)[:：]\s*([^。；;\n]+)")
_CONTACT_POINT_RE = re.compile(
    r"(?P<label>[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,30}(?:服务)?)电话[:：]\s*(?P<phone>(?:0\d{2,3}[-\s]?)?\d{7,8})"
)
_SELECTED_WRITE_SUPPRESSION_RE = re.compile(
    r"(采购|招标|中标|中选|比选|竞价|结果公示|公示期|公开招聘|招聘启事|新闻|通知|公告)"
)
_REGULATION_BODY_SIGNAL_RE = re.compile(
    r"(^第[一二三四五六七八九十百千万\d]+[章节条]|"
    r"^[一二三四五六七八九十]+、|"
    r"^[（(][一二三四五六七八九十\d]+[）)]|"
    r"本(?:办法|规定|章程|细则|规程)|"
    r"制定本(?:办法|规定|章程|细则|规程))"
)
_REGULATION_NON_BODY_RE = re.compile(
    r"(copyright|all rights reserved|"
    r"发布时间|更新时间|作者[:：]|来源[:：]|"
    r"上一篇|下一篇|上一条|下一条)",
    re.IGNORECASE,
)
_REGULATION_FORMAL_TITLE_RE = re.compile(
    r"(办法|规定|章程|细则|规程|制度)(?:（(?:试行|暂行|最新)）)?$"
)
_REGULATION_NOTICE_TITLE_SUPPRESSION_RE = re.compile(
    r"(采购|招标|中标|中选|比选|竞价|结果公示|公示期|公开招聘|招聘启事|新闻|通知|公告)"
)
_SERVICE_PROCESS_RE = re.compile(
    r"(办理流程|工作流程|流程|步骤|受理|审核|答复|提交|补正|办理|申请方法|补办|挂失|解挂|报销|预约|"
    r"申请人|承办部门|工作日|领取|发放|携带|支付)"
)
_SERVICE_ENTRY_RE = re.compile(r"(入口|系统|APP|小程序|自助|线下|窗口|前台)", re.IGNORECASE)
_SERVICE_HOST_ENTRY_RE = re.compile(
    r"(?<![A-Za-z0-9.-])((?:mail|vpn|rz)\.muc\.edu\.cn)(?![A-Za-z0-9.-])",
    re.IGNORECASE,
)
_SERVICE_MATERIAL_RE = re.compile(r"(材料|申请表|证明|身份证|证件|附件)")
_SERVICE_EXPLANATION_PREFIX_RE = re.compile(r"^\s*(?:服务说明|业务说明|说明)[:：]")
_SERVICE_MATERIAL_DECLARATION_RE = re.compile(
    r"(?:申请材料|所需材料|办理材料|提交材料|材料清单|需提交|须提交|需提供|须提供|请提供)"
)
_SERVICE_MATERIAL_ITEM_RE = re.compile(
    r"(身份证|学生证|有效证件|申请表|证明材料|证明|复印件|照片|附件)"
)
_SERVICE_URL_RE = re.compile(r"https?://[^\s，。；;）)]+", re.IGNORECASE)
_SERVICE_APP_RE = re.compile(
    r"(?:可登录|可通过|登录|通过|使用|打开|下载)?(?P<label>[\u4e00-\u9fffA-Za-z0-9]{1,24}APP)",
    re.IGNORECASE,
)
_SERVICE_MINIPROGRAM_RE = re.compile(
    r"(?:可登录|可通过|登录|通过|使用|打开)?(?P<label>[\u4e00-\u9fffA-Za-z0-9]{1,24}小程序)"
)
_SERVICE_SYSTEM_RE = re.compile(
    r"(?:可登录|可通过|登录|通过|使用|进入|打开)?(?P<label>[\u4e00-\u9fffA-Za-z0-9]{2,30}系统)"
)
_SERVICE_SYSTEM_ENTRY_SIGNAL_RE = re.compile(r"(登录|访问|进入|使用|通过|入口|办理入口)")
_SERVICE_SYSTEM_NON_ENTRY_RE = re.compile(r"(同步|推送|更新|生成).*系统")
_SERVICE_SELF_SERVICE_MACHINE_RE = re.compile(r"(自助补卡机|圈存机|自助服务机|自助终端|自助机)")
_SERVICE_OFFLINE_ENTRY_RE = re.compile(
    r"(?:到|至|前往|在)(?P<label>[^，。；;\n]{2,36}(?:前台|窗口))"
)
_SERVICE_ORDERED_STEP_RE = re.compile(r"^\s*(?:\d{1,2}|[一二三四五六七八九十]+)[、.)．）]")
_SERVICE_ORDERED_STEP_SIGNAL_RE = re.compile(
    r"(访问|登录|登陆|输入|下载|安装|点击|打开|选择|填写|提交|进入|使用|完成|申请|办理|"
    r"携带|领取|支付|递交|上传|确认|根据提示)"
)
_RESPONSIBLE_OFFICE_RE = re.compile(
    r"(?:由)?(?P<office>[\u4e00-\u9fff（）()]{2,30}?"
    r"(?:办公室|承办部门|部门|处|中心|单位|学院))"
    r"(?:负责|统一答复|初步审核|审核)"
)
_TARGET_WORKSET_COLLECTION_MODE = "target-workset"
_TARGET_CONSUMER_FAMILIES = frozenset(
    {
        "contact_directory_candidate",
        "service_guide_candidate",
        "academic_calendar_candidate",
        "stable_reference_candidate",
        "regulation_candidate",
        "student_regulation_candidate",
        "notice_news_candidate",
    }
)
_TARGET_MATERIALIZATION_POLICIES = frozenset(
    {"candidate_only", "release_gate_required", "inventory_only"}
)
_SERVICE_GUIDE_COMPOSITION_SPECS: dict[str, dict[str, object]] = {
    "information_disclosure": {
        "primary_role": "procedure_source",
        "allowed_roles": frozenset(
            {"policy_source", "procedure_source", "material_source", "contact_source"}
        ),
        "service_target_roles": frozenset(
            {"procedure_source", "material_source", "contact_source"}
        ),
    },
    "email_service": {
        "primary_role": "policy_source",
        "allowed_roles": frozenset(
            {"policy_source", "entry_source", "material_source", "contact_source"}
        ),
        "service_target_roles": frozenset(
            {"policy_source", "entry_source", "material_source", "contact_source"}
        ),
    },
}


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

    candidate_pages = _candidate_pages_from_override(composition_override)
    skipped_consumer_families = _skipped_consumer_families(composition_override)
    force_candidate_action = bool(
        composition_override is not None and composition_override.get("force_candidate_action")
    )
    for match in matches:
        if not isinstance(match, dict):
            continue
        consumer_family = _require_optional_text(
            match.get("consumerFamily") or match.get("consumer_family")
        )
        materialization_policy = _require_optional_text(
            match.get("materializationPolicy") or match.get("materialization_policy")
        )
        if consumer_family is None or materialization_policy is None:
            continue
        if consumer_family == "stable_reference_candidate":
            continue
        if consumer_family in skipped_consumer_families:
            continue
        target_corpus, target_collection = _target_from_consumer_match(match)
        selected_write_target = (
            _require_optional_text(
                match.get("selectedWriteTarget") or match.get("selected_write_target")
            )
            or ""
        )
        candidate_pages.append(
            _build_consumer_candidate_page(
                blocks=blocks,
                consumer_family=consumer_family,
                manifest=manifest,
                materialization_policy=materialization_policy,
                matched_evidence=_string_list(
                    match.get("matchedEvidence") or match.get("matched_evidence")
                )
                or _target_lineage_matched_evidence(match),
                review_policy=_require_optional_text(
                    match.get("reviewPolicy") or match.get("review_policy")
                )
                or "",
                selected_write_target=selected_write_target,
                target_lineage=match,
                target_collection=target_collection,
                target_corpus=target_corpus,
                title=title,
            )
        )
    if candidate_pages or force_candidate_action:
        return {"action": "candidate", "candidate_pages": candidate_pages}
    return None


def _build_consumer_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    grouped_contexts: dict[tuple[str, str], list[dict[str, object]]] = {}
    for page_context in page_contexts:
        manifest = dict(page_context["manifest"])
        raw_page = dict(page_context["raw_page"])
        page_lineage = _page_lineage_fields(manifest=manifest, raw_page=raw_page)
        source_pack_id = _require_optional_text(page_lineage.get("sourcePackId"))
        composition_group = _require_optional_text(page_lineage.get("compositionGroup"))
        if source_pack_id is None or composition_group is None:
            continue
        grouped_contexts.setdefault((source_pack_id, composition_group), []).append(page_context)

    overrides: dict[tuple[str, str], dict[str, object]] = {}
    for (_, composition_group), group_contexts in grouped_contexts.items():
        if composition_group == "information_disclosure":
            overrides.update(_build_information_disclosure_projection_overrides(group_contexts))
        elif composition_group == "email_service":
            overrides.update(_build_email_service_projection_overrides(group_contexts))
    return overrides


def _build_information_disclosure_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    role_contexts, primary_context, suppressed_page_keys, invalid_group = (
        _resolve_service_guide_composition_group(
            page_contexts,
            composition_group="information_disclosure",
        )
    )
    if invalid_group:
        return _empty_service_guide_composition_overrides(suppressed_page_keys)
    if primary_context is None:
        return {}

    procedure_target_lineage = _find_consumer_match(
        list(primary_context["target_matches"]),
        "service_guide_candidate",
    )
    if procedure_target_lineage is None:
        return {}

    procedure_manifest = dict(primary_context["manifest"])
    return _merge_service_guide_primary_with_suppressed_overrides(
        primary_page_key=_page_identity(procedure_manifest),
        primary_candidate_page=_build_information_disclosure_service_candidate_page(
            procedure_context=primary_context,
            material_contexts=role_contexts.get("material_source", []),
            contact_contexts=role_contexts.get("contact_source", []),
            target_lineage=procedure_target_lineage,
        ),
        suppressed_page_keys=suppressed_page_keys,
    )


def _build_email_service_projection_overrides(
    page_contexts: list[dict[str, object]],
) -> dict[tuple[str, str], dict[str, object]]:
    role_contexts, primary_context, suppressed_page_keys, invalid_group = (
        _resolve_service_guide_composition_group(
            page_contexts,
            composition_group="email_service",
        )
    )
    if invalid_group:
        return _empty_service_guide_composition_overrides(suppressed_page_keys)
    if primary_context is None:
        return {}

    policy_target_lineage = _find_consumer_match(
        list(primary_context["target_matches"]),
        "service_guide_candidate",
    )
    if policy_target_lineage is None:
        return {}

    policy_manifest = dict(primary_context["manifest"])
    return _merge_service_guide_primary_with_suppressed_overrides(
        primary_page_key=_page_identity(policy_manifest),
        primary_candidate_page=_build_email_service_candidate_page(
            policy_context=primary_context,
            entry_contexts=role_contexts.get("entry_source", []),
            material_contexts=role_contexts.get("material_source", []),
            contact_contexts=role_contexts.get("contact_source", []),
            target_lineage=policy_target_lineage,
        ),
        suppressed_page_keys=suppressed_page_keys,
    )


def _resolve_service_guide_composition_group(
    page_contexts: list[dict[str, object]],
    *,
    composition_group: str,
) -> tuple[
    dict[str, list[dict[str, object]]],
    dict[str, object] | None,
    set[tuple[str, str]],
    bool,
]:
    spec = _SERVICE_GUIDE_COMPOSITION_SPECS[composition_group]
    primary_role = str(spec["primary_role"])
    allowed_roles = set(spec["allowed_roles"])
    service_target_roles = set(spec["service_target_roles"])

    role_contexts: dict[str, list[dict[str, object]]] = {}
    service_target_page_keys: set[tuple[str, str]] = set()
    invalid_service_target_page_keys: set[tuple[str, str]] = set()

    for page_context in page_contexts:
        manifest = dict(page_context["manifest"])
        raw_page = dict(page_context["raw_page"])
        page_key = _page_identity(manifest)
        page_lineage = _page_lineage_fields(manifest=manifest, raw_page=raw_page)
        composition_role = _require_optional_text(page_lineage.get("compositionRole"))
        if composition_role is not None:
            role_contexts.setdefault(composition_role, []).append(page_context)

        target_matches = list(page_context["target_matches"])
        if _find_consumer_match(target_matches, "service_guide_candidate") is None:
            continue
        service_target_page_keys.add(page_key)
        if composition_role is None or composition_role not in allowed_roles:
            invalid_service_target_page_keys.add(page_key)
            continue
        if composition_role not in service_target_roles:
            invalid_service_target_page_keys.add(page_key)

    primary_contexts = role_contexts.get(primary_role, [])
    primary_context = primary_contexts[0] if len(primary_contexts) == 1 else None
    invalid_group = bool(invalid_service_target_page_keys) or len(primary_contexts) != 1
    return role_contexts, primary_context, service_target_page_keys, invalid_group


def _empty_service_guide_composition_overrides(
    page_keys: set[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, object]]:
    return {
        page_key: {
            "candidate_pages": [],
            "skip_consumer_families": ["service_guide_candidate"],
            "force_candidate_action": True,
        }
        for page_key in page_keys
    }


def _merge_service_guide_primary_with_suppressed_overrides(
    *,
    primary_page_key: tuple[str, str],
    primary_candidate_page: dict[str, object],
    suppressed_page_keys: set[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, object]]:
    overrides = _empty_service_guide_composition_overrides(suppressed_page_keys)
    overrides[primary_page_key] = {
        "candidate_pages": [primary_candidate_page],
        "skip_consumer_families": ["service_guide_candidate"],
        "force_candidate_action": True,
    }
    return overrides


def _build_email_service_candidate_page(
    *,
    policy_context: dict[str, object],
    entry_contexts: list[dict[str, object]],
    material_contexts: list[dict[str, object]],
    contact_contexts: list[dict[str, object]],
    target_lineage: dict[str, object],
) -> dict[str, object]:
    policy_manifest = dict(policy_context["manifest"])
    policy_blocks = list(policy_context["blocks"])
    title = str(policy_context["title"])
    normalized_canonical_url = _require_text(
        policy_manifest.get("normalizedCanonicalUrl"),
        "normalizedCanonicalUrl",
    )
    raw_version_id = _require_text(policy_manifest.get("rawVersionId"), "rawVersionId")
    selected_write_target = (
        _require_optional_text(
            target_lineage.get("selectedWriteTarget") or target_lineage.get("selected_write_target")
        )
        or ""
    )
    policy_lines = _main_content_lines(policy_blocks)
    entry_lines = _combined_main_content_lines(entry_contexts)
    material_lines = _combined_main_content_lines(material_contexts)
    contact_blocks = _combined_candidate_blocks(
        contact_contexts,
        consumer_family="contact_directory_candidate",
    )
    contact_lines = _block_lines(contact_blocks)
    process_steps = _extract_service_process_steps(policy_lines)
    materials = _extract_service_materials(material_lines)
    if not materials:
        materials = [
            line
            for line in material_lines
            if ("申请表" in line or "审批表" in line) and len(line.strip()) <= 64
        ]
        materials = _unique(materials)
    responsible_office = _unique(
        _extract_responsible_offices(policy_lines) + _extract_responsible_offices(contact_lines)
    )
    if not responsible_office and any("网络中心" in line for line in policy_lines):
        responsible_office = ["网络中心"]
    entry_points = _unique(_extract_service_entry_points([*policy_lines, *entry_lines]))
    contact_text_lines = _unique(contact_lines + policy_lines + entry_lines)
    field_source_urls = {
        "process_steps": [
            _require_text(
                dict(policy_context["manifest"]).get("normalizedCanonicalUrl"),
                "normalizedCanonicalUrl",
            )
        ]
        if process_steps
        else [],
        "materials": _composition_source_urls(material_contexts) if materials else [],
        "entry_points": _composition_source_urls(entry_contexts) if entry_points else [],
        "responsible_office": _composition_source_urls([policy_context, *contact_contexts])
        if responsible_office
        else [],
        "contacts": _composition_source_urls(contact_contexts) if contact_text_lines else [],
    }
    typed_candidate = {
        "service_name": _service_candidate_name(
            title=title,
            target_lineage=target_lineage,
        ),
        "process_steps": process_steps,
        "materials": materials,
        "responsible_office": responsible_office,
        "entry_points": entry_points,
        "contacts": {
            "phones": _unique(_PHONE_RE.findall("\n".join(contact_text_lines))),
            "emails": _unique(_EMAIL_RE.findall("\n".join(contact_text_lines))),
            "locations": _extract_locations(contact_text_lines),
            "office_hours": _unique(
                match.strip() for match in _OFFICE_HOURS_RE.findall("\n".join(contact_text_lines))
            ),
        },
        "supporting_source_urls": _composition_source_urls(
            [policy_context, *entry_contexts, *material_contexts, *contact_contexts]
        ),
        "field_source_urls": field_source_urls,
        "source_url": normalized_canonical_url,
        "source_title": title,
    }
    candidate = {
        "candidate_key": _build_candidate_key(
            consumer_family="service_guide_candidate",
            normalized_canonical_url=normalized_canonical_url,
            raw_version_id=raw_version_id,
            selected_write_target=selected_write_target,
        ),
        "consumer_family": "service_guide_candidate",
        "materialization_policy": _require_optional_text(
            target_lineage.get("materializationPolicy")
            or target_lineage.get("materialization_policy")
        )
        or "",
        "target_corpus": "campus_services",
        "target_collection": "service_guide",
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": policy_manifest["rawAssetId"],
        "raw_version_id": raw_version_id,
        "title": title,
        "matched_evidence": _target_lineage_matched_evidence(target_lineage),
        "selected_write_target": selected_write_target,
        "review_policy": _require_optional_text(
            target_lineage.get("reviewPolicy") or target_lineage.get("review_policy")
        ),
        "reason": "candidate_only consumer denominator match",
        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
        "typed_candidate": typed_candidate,
        "quality_gate": _quality_gate(
            suppressed=_selected_write_suppressed(title=title, lines=policy_lines),
            has_identity=bool(title.strip()),
            has_required_evidence=bool(process_steps),
            has_source=bool(normalized_canonical_url.strip()),
        ),
        "evidence_spans": _build_evidence_spans(
            _main_content_blocks(policy_blocks)
            + _combined_main_content_blocks(entry_contexts)
            + _combined_main_content_blocks(material_contexts)
            + contact_blocks
        ),
        "source_refs": _composition_source_refs(
            [policy_context, *entry_contexts, *material_contexts, *contact_contexts]
        ),
    }
    candidate.update(_target_projection_fields(target_lineage))
    return candidate


def _build_information_disclosure_service_candidate_page(
    *,
    procedure_context: dict[str, object],
    material_contexts: list[dict[str, object]],
    contact_contexts: list[dict[str, object]],
    target_lineage: dict[str, object],
) -> dict[str, object]:
    procedure_manifest = dict(procedure_context["manifest"])
    procedure_blocks = list(procedure_context["blocks"])
    title = str(procedure_context["title"])
    normalized_canonical_url = _require_text(
        procedure_manifest.get("normalizedCanonicalUrl"),
        "normalizedCanonicalUrl",
    )
    raw_version_id = _require_text(procedure_manifest.get("rawVersionId"), "rawVersionId")
    selected_write_target = (
        _require_optional_text(
            target_lineage.get("selectedWriteTarget") or target_lineage.get("selected_write_target")
        )
        or ""
    )
    procedure_lines = _main_content_lines(procedure_blocks)
    material_lines = _combined_main_content_lines(material_contexts)
    contact_blocks = _combined_candidate_blocks(
        contact_contexts,
        consumer_family="contact_directory_candidate",
    )
    contact_lines = _block_lines(contact_blocks)
    process_steps = _extract_service_process_steps(procedure_lines)
    materials = _extract_service_materials(material_lines) or _extract_service_materials(
        procedure_lines
    )
    responsible_office = _unique(
        _extract_responsible_offices(procedure_lines) + _extract_responsible_offices(contact_lines)
    )
    entry_points = _unique(_extract_service_entry_points([*procedure_lines, *material_lines]))
    contact_text_lines = _unique(contact_lines + procedure_lines)
    field_source_urls = {
        "process_steps": [
            _require_text(
                dict(procedure_context["manifest"]).get("normalizedCanonicalUrl"),
                "normalizedCanonicalUrl",
            )
        ]
        if process_steps
        else [],
        "materials": _composition_source_urls(material_contexts) if materials else [],
        "entry_points": _composition_source_urls(material_contexts) if entry_points else [],
        "responsible_office": _composition_source_urls([procedure_context, *contact_contexts])
        if responsible_office
        else [],
        "contacts": _composition_source_urls(contact_contexts) if contact_text_lines else [],
    }
    typed_candidate = {
        "service_name": _service_candidate_name(
            title=title,
            target_lineage=target_lineage,
        ),
        "process_steps": process_steps,
        "materials": materials,
        "responsible_office": responsible_office,
        "entry_points": entry_points,
        "contacts": {
            "phones": _unique(_PHONE_RE.findall("\n".join(contact_text_lines))),
            "emails": _unique(_EMAIL_RE.findall("\n".join(contact_text_lines))),
            "locations": _extract_locations(contact_text_lines),
            "office_hours": _unique(
                match.strip() for match in _OFFICE_HOURS_RE.findall("\n".join(contact_text_lines))
            ),
        },
        "supporting_source_urls": _composition_source_urls(
            [procedure_context, *material_contexts, *contact_contexts]
        ),
        "field_source_urls": field_source_urls,
        "source_url": normalized_canonical_url,
        "source_title": title,
    }
    candidate = {
        "candidate_key": _build_candidate_key(
            consumer_family="service_guide_candidate",
            normalized_canonical_url=normalized_canonical_url,
            raw_version_id=raw_version_id,
            selected_write_target=selected_write_target,
        ),
        "consumer_family": "service_guide_candidate",
        "materialization_policy": _require_optional_text(
            target_lineage.get("materializationPolicy")
            or target_lineage.get("materialization_policy")
        )
        or "",
        "target_corpus": "campus_services",
        "target_collection": "service_guide",
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": procedure_manifest["rawAssetId"],
        "raw_version_id": raw_version_id,
        "title": title,
        "matched_evidence": _target_lineage_matched_evidence(target_lineage),
        "selected_write_target": selected_write_target,
        "review_policy": _require_optional_text(
            target_lineage.get("reviewPolicy") or target_lineage.get("review_policy")
        ),
        "reason": "candidate_only consumer denominator match",
        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
        "typed_candidate": typed_candidate,
        "quality_gate": _quality_gate(
            suppressed=_selected_write_suppressed(title=title, lines=procedure_lines),
            has_identity=bool(title.strip()),
            has_required_evidence=bool(process_steps),
            has_source=bool(normalized_canonical_url.strip()),
        ),
        "evidence_spans": _build_evidence_spans(
            _main_content_blocks(procedure_blocks)
            + _combined_main_content_blocks(material_contexts)
            + contact_blocks
        ),
        "source_refs": _composition_source_refs(
            [procedure_context, *material_contexts, *contact_contexts]
        ),
    }
    candidate.update(_target_projection_fields(target_lineage))
    return candidate


def _combined_main_content_lines(page_contexts: list[dict[str, object]]) -> list[str]:
    return _block_lines(_combined_main_content_blocks(page_contexts))


def _composition_source_urls(page_contexts: list[dict[str, object]]) -> list[str]:
    return _unique(
        _require_text(
            dict(page_context["manifest"]).get("normalizedCanonicalUrl"), "normalizedCanonicalUrl"
        )
        for page_context in page_contexts
    )


def _composition_source_refs(page_contexts: list[dict[str, object]]) -> list[dict[str, object]]:
    refs: list[dict[str, object]] = []
    seen: set[str] = set()
    for page_context in page_contexts:
        manifest = dict(page_context["manifest"])
        normalized_url = _require_text(
            manifest.get("normalizedCanonicalUrl"),
            "normalizedCanonicalUrl",
        )
        if normalized_url in seen:
            continue
        seen.add(normalized_url)
        refs.append(
            {
                "source_channel": "official_web",
                "raw_asset_id": _require_text(manifest.get("rawAssetId"), "rawAssetId"),
                "raw_version_id": _require_text(manifest.get("rawVersionId"), "rawVersionId"),
                "normalized_canonical_url": normalized_url,
            }
        )
    return refs


def _combined_main_content_blocks(
    page_contexts: list[dict[str, object]],
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for page_context in page_contexts:
        blocks.extend(_main_content_blocks(list(page_context["blocks"])))
    return blocks


def _combined_candidate_blocks(
    page_contexts: list[dict[str, object]],
    *,
    consumer_family: str,
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for page_context in page_contexts:
        blocks.extend(
            _candidate_content_blocks(
                blocks=list(page_context["blocks"]),
                consumer_family=consumer_family,
            )
        )
    return blocks


def _candidate_pages_from_override(
    composition_override: dict[str, object] | None,
) -> list[dict[str, object]]:
    if composition_override is None:
        return []
    raw_candidate_pages = composition_override.get("candidate_pages")
    if not isinstance(raw_candidate_pages, list):
        return []
    return [item for item in raw_candidate_pages if isinstance(item, dict)]


def _skipped_consumer_families(
    composition_override: dict[str, object] | None,
) -> set[str]:
    if composition_override is None:
        return set()
    raw_families = composition_override.get("skip_consumer_families")
    if not isinstance(raw_families, list):
        return set()
    return {
        str(item).strip() for item in raw_families if isinstance(item, str) and str(item).strip()
    }


def _build_consumer_candidate_page(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
    manifest: dict[str, object],
    materialization_policy: str,
    matched_evidence: list[str],
    review_policy: str,
    selected_write_target: str,
    target_lineage: dict[str, object] | None,
    target_collection: str,
    target_corpus: str,
    title: str,
) -> dict[str, object]:
    normalized_canonical_url = _require_text(
        manifest.get("normalizedCanonicalUrl"),
        "normalizedCanonicalUrl",
    )
    raw_version_id = _require_text(manifest.get("rawVersionId"), "rawVersionId")
    candidate_title = title
    title_projection_fields: dict[str, object] = {}
    if consumer_family == "regulation_candidate":
        title_info = normalize_official_web_regulation_title(title)
        candidate_title = title_info.display_title
        title_projection_fields = {
            "title_raw": title_info.raw_title,
            "title_base": title_info.base_title,
            **official_web_regulation_title_metadata(title_info),
        }
    typed_candidate_schema_version, typed_candidate, quality_gate, evidence_spans = (
        _build_typed_candidate(
            blocks=blocks,
            consumer_family=consumer_family,
            normalized_canonical_url=normalized_canonical_url,
            raw_title=title,
            title=candidate_title,
            target_lineage=target_lineage,
        )
    )
    candidate = {
        "candidate_key": _build_candidate_key(
            consumer_family=consumer_family,
            normalized_canonical_url=normalized_canonical_url,
            raw_version_id=raw_version_id,
            selected_write_target=selected_write_target,
        ),
        "consumer_family": consumer_family,
        "materialization_policy": materialization_policy,
        "target_corpus": target_corpus,
        "target_collection": target_collection,
        "normalized_canonical_url": normalized_canonical_url,
        "raw_asset_id": manifest["rawAssetId"],
        "raw_version_id": raw_version_id,
        "title": candidate_title,
        **title_projection_fields,
        "matched_evidence": matched_evidence,
        "selected_write_target": selected_write_target,
        "review_policy": review_policy,
        "reason": f"{materialization_policy} consumer denominator match",
        "typed_candidate_schema_version": typed_candidate_schema_version,
        "typed_candidate": typed_candidate,
        "quality_gate": quality_gate,
        "evidence_spans": evidence_spans,
    }
    if consumer_family == "notice_news_candidate":
        candidate["source_family"] = "official_web_public_notice"
    if target_lineage is not None:
        candidate.update(_target_projection_fields(target_lineage))
    return candidate


def _build_candidate_key(
    *,
    consumer_family: str,
    normalized_canonical_url: str,
    raw_version_id: str,
    selected_write_target: str,
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "consumer_family": consumer_family,
                "normalized_canonical_url": normalized_canonical_url,
                "raw_version_id": raw_version_id,
                "selected_write_target": selected_write_target,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"owcand_{digest}"


def _build_typed_candidate(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
    normalized_canonical_url: str,
    raw_title: str | None = None,
    title: str,
    target_lineage: dict[str, object] | None = None,
) -> tuple[str, dict[str, object], dict[str, object], list[dict[str, object]]]:
    main_lines = _main_content_lines(blocks)
    candidate_blocks = _candidate_content_blocks(blocks=blocks, consumer_family=consumer_family)
    lines = _block_lines(candidate_blocks)
    page_text = "\n".join(lines)
    phones = _unique(_PHONE_RE.findall(page_text))
    emails = _unique(_EMAIL_RE.findall(page_text))
    locations = _extract_locations(lines)
    office_hours = _unique(match.strip() for match in _OFFICE_HOURS_RE.findall(page_text))
    evidence_spans = _build_evidence_spans(candidate_blocks)
    suppressed = _selected_write_suppressed(title=title, lines=main_lines)

    if consumer_family == "contact_directory_candidate":
        contact_points = _extract_contact_points(lines)
        typed_candidate = {
            "display_name": _contact_candidate_display_name(
                title=title,
                contact_points=contact_points,
                target_lineage=target_lineage,
            ),
            "phones": phones,
            "emails": emails,
            "locations": locations,
            "office_hours": office_hours,
            "contact_points": contact_points,
            "source_url": normalized_canonical_url,
            "source_title": title,
        }
        return (
            "official_web_contact_directory_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=suppressed,
                has_identity=bool(title.strip()),
                has_required_evidence=bool(phones or emails),
                has_source=bool(normalized_canonical_url.strip()),
            ),
            evidence_spans,
        )

    if consumer_family == "service_guide_candidate":
        process_steps = _extract_service_process_steps(lines)
        procedure_groups = _extract_service_procedure_groups(
            title=title,
            target_lineage=target_lineage,
            normalized_canonical_url=normalized_canonical_url,
            process_steps=process_steps,
        )
        materials = _extract_service_materials(lines)
        entry_points = _extract_service_entry_points(lines)
        responsible_office = _extract_responsible_offices(lines)
        typed_candidate = {
            "service_name": _service_candidate_name(
                title=title,
                target_lineage=target_lineage,
            ),
            "process_steps": process_steps,
            "procedure_groups": procedure_groups,
            "materials": materials,
            "responsible_office": responsible_office,
            "entry_points": entry_points,
            "contacts": {
                "phones": phones,
                "emails": emails,
                "locations": locations,
                "office_hours": office_hours,
            },
            "field_source_urls": {
                "process_steps": [normalized_canonical_url] if process_steps else [],
                "procedure_groups": [normalized_canonical_url] if procedure_groups else [],
                "materials": [normalized_canonical_url] if materials else [],
                "entry_points": [normalized_canonical_url] if entry_points else [],
                "responsible_office": [normalized_canonical_url] if responsible_office else [],
                "contacts": [normalized_canonical_url]
                if (phones or emails or locations or office_hours)
                else [],
            },
            "source_url": normalized_canonical_url,
            "source_title": title,
        }
        return (
            "official_web_service_guide_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=suppressed,
                has_identity=bool(title.strip()),
                has_required_evidence=bool(process_steps),
                has_source=bool(normalized_canonical_url.strip()),
            ),
            evidence_spans,
        )

    if consumer_family == "academic_calendar_candidate":
        typed_candidate = build_academic_calendar_typed_candidate(
            lines=lines,
            candidate_blocks=candidate_blocks,
            normalized_canonical_url=normalized_canonical_url,
            title=title,
        )
        calendar_arrangement = str(typed_candidate.get("calendar_arrangement") or "").strip()
        calendar_records = typed_candidate.get("records")
        calendar_image_refs = typed_candidate.get("calendar_image_refs")
        has_required_evidence = bool(calendar_arrangement and calendar_records)
        missing_reason = (
            "missing_structured_calendar_records"
            if calendar_arrangement and calendar_image_refs and not calendar_records
            else "missing_required_evidence"
        )
        return (
            "official_web_academic_calendar_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=suppressed,
                has_identity=bool(title.strip()),
                has_required_evidence=has_required_evidence,
                has_source=bool(normalized_canonical_url.strip()),
                missing_required_evidence_reason=missing_reason,
            ),
            evidence_spans,
        )

    if consumer_family in {"regulation_candidate", "student_regulation_candidate"}:
        title_info = normalize_official_web_regulation_title(raw_title or title)
        answer_bearing_lines = _regulation_answer_bearing_lines(lines)
        normalized_summary = _build_regulation_content_summary(answer_bearing_lines)
        regulation_text = "\n".join(
            line for line in answer_bearing_lines if line.strip() and line.strip() != title.strip()
        )
        release_scope = _regulation_release_scope(target_lineage)
        typed_candidate = {
            "reference_title": title_info.display_title,
            "title_base": title_info.base_title,
            "title_raw": title_info.raw_title,
            **official_web_regulation_title_metadata(title_info),
            "normalized_content_summary": normalized_summary,
            "regulation_text": regulation_text,
            "authoritative_source_url": normalized_canonical_url,
            "release_scope": release_scope,
            "source_url": normalized_canonical_url,
            "source_title": title_info.display_title,
            "source_title_raw": title_info.raw_title,
        }
        return (
            "official_web_regulation_candidate.v1",
            typed_candidate,
            _quality_gate(
                suppressed=_regulation_selected_write_suppressed(title=title),
                has_identity=bool(title.strip()),
                has_required_evidence=bool(normalized_summary),
                has_source=bool(normalized_canonical_url.strip()),
                missing_required_evidence_reason="missing_answer_bearing_regulation_body",
            ),
            evidence_spans,
        )

    return (
        "official_web_inventory_candidate.v1",
        {
            "source_url": normalized_canonical_url,
            "source_title": title,
        },
        {
            "decision": "inventory_only",
            "reason_codes": [],
        },
        evidence_spans,
    )


def _quality_gate(
    *,
    suppressed: bool,
    has_identity: bool,
    has_required_evidence: bool,
    has_source: bool,
    missing_required_evidence_reason: str = "missing_required_evidence",
) -> dict[str, object]:
    reason_codes: list[str] = []
    if suppressed:
        reason_codes.append("selected_write_suppressed_page_type")
    if not has_identity:
        reason_codes.append("missing_candidate_identity")
    if not has_required_evidence:
        reason_codes.append(missing_required_evidence_reason)
    if not has_source:
        reason_codes.append("missing_source_url")
    return {
        "decision": "pass" if not reason_codes else "reject",
        "reason_codes": reason_codes,
    }


def _main_content_lines(blocks: list[dict[str, object]]) -> list[str]:
    return _block_lines(_main_content_blocks(blocks))


def _main_content_blocks(blocks: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        block
        for block in blocks
        if bool(block.get("isMainContent")) or block.get("blockRole") == "title"
    ]


def _candidate_content_blocks(
    *,
    blocks: list[dict[str, object]],
    consumer_family: str,
) -> list[dict[str, object]]:
    if consumer_family == "academic_calendar_candidate":
        return [
            block
            for block in blocks
            if bool(block.get("isMainContent"))
            or block.get("blockRole") == "title"
            or block_has_academic_calendar_image_ref(block)
        ]
    if consumer_family != "contact_directory_candidate":
        return _main_content_blocks(blocks)
    candidate_blocks: list[dict[str, object]] = []
    for block in blocks:
        text = _normalize_block_text(block)
        if not text:
            continue
        if bool(block.get("isMainContent")) or block.get("blockRole") == "title":
            candidate_blocks.append(block)
            continue
        if _has_contact_directory_signal(text):
            candidate_blocks.append(block)
    return candidate_blocks


def _block_lines(blocks: list[dict[str, object]]) -> list[str]:
    lines: list[str] = []
    for block in blocks:
        text = _normalize_block_text(block)
        if text:
            lines.append(text)
    return lines


def _has_contact_directory_signal(text: str) -> bool:
    return bool(
        _PHONE_RE.search(text)
        or _EMAIL_RE.search(text)
        or _LOCATION_RE.search(text)
        or _CAMPUS_ADDRESS_RE.search(text)
        or _OFFICE_HOURS_RE.search(text)
    )


def _extract_locations(lines: list[str]) -> list[str]:
    locations: list[str] = []
    for line in lines:
        for match in _LOCATION_RE.findall(line):
            normalized = match.strip()
            if normalized:
                locations.append(normalized)
        for match in _CAMPUS_ADDRESS_RE.finditer(line):
            label = match.group("label").strip()
            address = _clean_campus_address(match.group("address"))
            if label and address:
                locations.append(f"{label}：{address}")
    return _unique(locations)


def _clean_campus_address(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized.strip(" ，,。；;")


def _extract_responsible_offices(lines: list[str]) -> list[str]:
    offices: list[str] = []
    for line in lines:
        for match in _RESPONSIBLE_OFFICE_RE.finditer(line):
            office = _clean_responsible_office(match.group("office"))
            if office:
                offices.append(office)
    return _unique(offices)


def _clean_responsible_office(value: str) -> str:
    normalized = value.strip(" ，,。；;：:")
    normalized = re.sub(r"^(?:并由|由|经)", "", normalized)
    for prefix in ("校园网电子邮件由", "电子邮件由", "由"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]
    return normalized.strip()


def _extract_service_materials(lines: list[str]) -> list[str]:
    materials: list[str] = []
    for line in lines:
        if _SERVICE_EXPLANATION_PREFIX_RE.search(line):
            continue
        if _is_service_material_name_line(line):
            materials.append(line.strip())
            continue
        if not _SERVICE_MATERIAL_DECLARATION_RE.search(line):
            continue
        fragment = _material_fragment(line)
        declared_items = _extract_declared_material_items(fragment)
        if declared_items:
            materials.extend(declared_items)
            continue
        matches = _SERVICE_MATERIAL_ITEM_RE.findall(fragment)
        materials.extend(matches)
    return _unique(materials)


def _extract_service_process_steps(lines: list[str]) -> list[str]:
    return _unique(line for line in lines if _is_service_process_line(line))


def _extract_service_procedure_groups(
    *,
    title: str,
    target_lineage: dict[str, object] | None,
    normalized_canonical_url: str,
    process_steps: list[str],
) -> list[dict[str, object]]:
    if not process_steps:
        return []
    service_seed = _service_procedure_group_seed(
        title=title,
        target_lineage=target_lineage,
        normalized_canonical_url=normalized_canonical_url,
    )
    public_source_refs = [normalized_canonical_url]
    cleaned_steps = [
        _clean_service_procedure_step_content(step)
        for step in process_steps
        if _clean_service_procedure_step_content(step)
    ]
    if not cleaned_steps:
        return []
    if service_seed == "vpn":
        grouped_steps: dict[str, list[str]] = {
            "direct_login": [],
            "client_install": [],
            "mobile_usage": [],
        }
        for step in cleaned_steps:
            bucket = _vpn_procedure_group_kind(step)
            grouped_steps[bucket].append(step)
        procedure_groups: list[dict[str, object]] = []
        for order, (group_key, title_text, focus_tags) in enumerate(
            (
                ("direct_login", "直接登录", ["entry", "direct_login"]),
                ("client_install", "客户端安装", ["procedure", "install", "client"]),
                ("mobile_usage", "移动端使用", ["procedure", "mobile"]),
            ),
            start=1,
        ):
            steps = grouped_steps[group_key]
            if not steps:
                continue
            group_id = f"service:official_web:{service_seed}:procedure_group:{group_key}"
            procedure_groups.append(
                {
                    "group_id": group_id,
                    "title": title_text,
                    "focus_tags": focus_tags,
                    "steps": [
                        {
                            "step_id": f"{group_id}:step:{index}",
                            "content": content,
                            "source_refs": public_source_refs,
                        }
                        for index, content in enumerate(steps, start=1)
                    ],
                    "source_refs": public_source_refs,
                    "order": order,
                }
            )
        return procedure_groups

    group_id = f"service:official_web:{service_seed}:procedure_group:default"
    return [
        {
            "group_id": group_id,
            "title": "办理步骤",
            "focus_tags": ["procedure"],
            "steps": [
                {
                    "step_id": f"{group_id}:step:{index}",
                    "content": content,
                    "source_refs": public_source_refs,
                }
                for index, content in enumerate(cleaned_steps, start=1)
            ],
            "source_refs": public_source_refs,
            "order": 1,
        }
    ]


def _service_procedure_group_seed(
    *,
    title: str,
    target_lineage: dict[str, object] | None,
    normalized_canonical_url: str,
) -> str:
    target_label = (
        _require_optional_text(
            (target_lineage or {}).get("targetLabel") or (target_lineage or {}).get("target_label")
        )
        or ""
    )
    combined = f"{title}\n{target_label}\n{normalized_canonical_url}".lower()
    if "vpn" in combined:
        return "vpn"
    if "信息公开" in f"{title}{target_label}":
        return "information_disclosure"
    if any(token in combined for token in ("电子邮件", "邮箱", "mail")):
        return "email"
    if "校园卡" in f"{title}{target_label}" or "一卡通" in f"{title}{target_label}":
        return "campus_card"
    if "认证" in f"{title}{target_label}" or "rz.muc.edu.cn" in combined:
        return "network_auth"
    path_tail = normalized_canonical_url.rstrip("/").rsplit("/", 1)[-1]
    normalized_tail = re.sub(r"[^a-z0-9]+", "-", path_tail.lower()).strip("-")
    if normalized_tail:
        return normalized_tail
    return hashlib.sha256(normalized_canonical_url.encode("utf-8")).hexdigest()[:8]


def _clean_service_procedure_step_content(step: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        _SERVICE_ORDERED_STEP_RE.sub("", step.strip(), count=1),
    ).strip(" ，,；;")


def _vpn_procedure_group_kind(
    step: str,
) -> Literal["direct_login", "client_install", "mobile_usage"]:
    normalized = step.lower()
    if any(token in step for token in ("移动端", "手机端", "安卓端", "iOS")) or any(
        token in normalized for token in ("easyconnect app", "android", "ios", "mobile")
    ):
        return "mobile_usage"
    if any(
        token in step for token in ("客户端", "安装", "下载", "EasyConnect", "Install EasyConnect")
    ) or any(token in normalized for token in ("easyconnect", ".pkg", ".exe", "install")):
        return "client_install"
    return "direct_login"


def _is_service_process_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if _is_service_material_only_line(normalized):
        return False
    if _SERVICE_ORDERED_STEP_RE.search(normalized) and _SERVICE_ORDERED_STEP_SIGNAL_RE.search(
        normalized
    ):
        return True
    return bool(_SERVICE_PROCESS_RE.search(normalized))


def _is_service_material_only_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if _SERVICE_MATERIAL_DECLARATION_RE.search(normalized):
        return False
    if _SERVICE_PROCESS_RE.search(normalized) and not re.search(
        r"(申请表|审批表|下载)", normalized
    ):
        return False
    return bool(
        re.fullmatch(
            r"[\u4e00-\u9fffA-Za-z0-9（）()《》、，, -]*(?:申请表|审批表|表格|下载)[\u4e00-\u9fffA-Za-z0-9（）()《》、，, -]*",
            normalized,
        )
    )


def _is_service_material_name_line(line: str) -> bool:
    normalized = line.strip(" \t，,。；;：:")
    if not normalized:
        return False
    if "下载" in normalized:
        return False
    if normalized in {"申请表格", "申请表", "审批表", "表格"}:
        return False
    if len(normalized) > 48:
        return False
    return bool(
        re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9（）()《》、，, .·\-－—]+", normalized)
        and re.search(r"(申请表|审批表|表格)", normalized)
    )


def _material_fragment(line: str) -> str:
    normalized = line.strip()
    for separator in ("：", ":", "包括", "包含"):
        if separator in normalized:
            normalized = normalized.split(separator, 1)[1]
            break
    return normalized


def _extract_declared_material_items(fragment: str) -> list[str]:
    normalized = fragment.strip().strip("。；;")
    if not normalized:
        return []
    parts = re.split(r"[、；;，,]|(?:以及)|(?:及)", normalized)
    items: list[str] = []
    for part in parts:
        candidate = part.strip().strip("。；;，,")
        if not candidate:
            continue
        if not (
            _SERVICE_MATERIAL_ITEM_RE.search(candidate)
            or candidate.endswith(("申请表", "审批表", "证明材料", "证明", "复印件", "附件"))
        ):
            continue
        items.append(candidate)
    return _unique(items)


def _extract_service_entry_points(lines: list[str]) -> list[str]:
    entries: list[str] = []
    for line in lines:
        if (
            not _SERVICE_ENTRY_RE.search(line)
            and not _SERVICE_URL_RE.search(line)
            and not _SERVICE_HOST_ENTRY_RE.search(line)
        ):
            continue
        entries.extend(_SERVICE_URL_RE.findall(line))
        entries.extend(match.lower() for match in _SERVICE_HOST_ENTRY_RE.findall(line))
        entries.extend(_SERVICE_SELF_SERVICE_MACHINE_RE.findall(line))
        for pattern in (_SERVICE_APP_RE, _SERVICE_MINIPROGRAM_RE, _SERVICE_OFFLINE_ENTRY_RE):
            for match in pattern.finditer(line):
                entries.append(_clean_service_entry_label(match.group("label")))
        if _SERVICE_SYSTEM_ENTRY_SIGNAL_RE.search(line) and not _SERVICE_SYSTEM_NON_ENTRY_RE.search(
            line
        ):
            for match in _SERVICE_SYSTEM_RE.finditer(line):
                entries.append(_clean_service_entry_label(match.group("label")))
    return _filter_service_entry_points(_unique(entry for entry in entries if entry))


def _service_candidate_name(*, title: str, target_lineage: dict[str, object] | None) -> str:
    return choose_official_web_service_name(
        source_title=title,
        target_label=_target_label_from_lineage(target_lineage),
    )


def _contact_candidate_display_name(
    *,
    title: str,
    contact_points: list[dict[str, str]],
    target_lineage: dict[str, object] | None,
) -> str:
    del contact_points
    return choose_official_web_contact_display_name(
        source_title=title,
        target_label=_target_label_from_lineage(target_lineage),
    )


def _target_label_from_lineage(target_lineage: dict[str, object] | None) -> str:
    if not isinstance(target_lineage, dict):
        return ""
    return (
        _require_optional_text(
            target_lineage.get("targetLabel") or target_lineage.get("target_label")
        )
        or ""
    )


def _filter_service_entry_points(entries: list[str]) -> list[str]:
    filtered: list[str] = []
    host_entries = {
        entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        for entry in entries
        if _SERVICE_HOST_ENTRY_RE.fullmatch(
            entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        )
    }
    url_host_entries = {
        entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        for entry in entries
        if entry.lower().startswith(("https://", "http://"))
        and _SERVICE_HOST_ENTRY_RE.fullmatch(
            entry.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        )
    }
    for entry in entries:
        normalized = entry.strip()
        if not normalized:
            continue
        if normalized in {"APP", "app"}:
            continue
        normalized_host = normalized.lower()
        if normalized_host in url_host_entries and not normalized.lower().startswith(
            ("https://", "http://")
        ):
            continue
        if (
            normalized.endswith(("系统", "平台"))
            and host_entries
            and ("认证" in normalized or "VPN" in normalized or "邮箱" in normalized)
        ):
            continue
        if normalized.endswith("系统") and not (
            "认证" in normalized or "VPN" in normalized or "邮箱" in normalized
        ):
            continue
        filtered.append(normalized)
    return filtered


def _extract_mail_host_entry_points(lines: list[str]) -> list[str]:
    entries: list[str] = []
    for line in lines:
        for match in _SERVICE_HOST_ENTRY_RE.findall(line):
            entries.append(match.lower())
    return _unique(entries)


def _extract_contact_points(lines: list[str]) -> list[dict[str, str]]:
    points: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for line in lines:
        for match in _CONTACT_POINT_RE.finditer(line):
            label = str(match.group("label") or "").strip(" ：:，,。；;")
            phone = str(match.group("phone") or "").strip()
            if not label or not phone:
                continue
            key = (label, phone)
            if key in seen:
                continue
            seen.add(key)
            points.append({"label": label, "phone": phone})
    return points


def _clean_service_entry_label(value: str) -> str:
    normalized = re.sub(r"\s+", "", value).strip(" ，,。；;：:（）()")
    for separator in ("或", "、", "/"):
        if separator in normalized:
            normalized = normalized.split(separator)[-1]
    while True:
        for prefix in (
            "请立即通过",
            "请通过",
            "可登录",
            "可通过",
            "可使用",
            "登录",
            "通过",
            "使用",
            "打开",
            "下载",
            "进入",
            "到",
            "至",
            "前往",
            "在",
        ):
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix) :]
                break
        else:
            break
    return normalized.strip(" ，,。；;：:（）()")


def _selected_write_suppressed(*, title: str, lines: list[str]) -> bool:
    if _SELECTED_WRITE_SUPPRESSION_RE.search(title):
        return True
    non_boilerplate_text = "\n".join(lines[:3])
    return bool(_SELECTED_WRITE_SUPPRESSION_RE.search(non_boilerplate_text))


def _regulation_selected_write_suppressed(*, title: str) -> bool:
    normalized_title = re.sub(r"\s+", "", title.strip())
    if _REGULATION_FORMAL_TITLE_RE.search(normalized_title):
        return False
    return bool(_REGULATION_NOTICE_TITLE_SUPPRESSION_RE.search(normalized_title))


def _build_evidence_spans(blocks: list[dict[str, object]]) -> list[dict[str, object]]:
    spans: list[dict[str, object]] = []
    for block in blocks:
        text = _normalize_block_text(block)
        if not text:
            continue
        row_id = str(block.get("rowId") or block.get("row_id") or "")
        for phone in _PHONE_RE.findall(text):
            spans.append({"evidence_type": "phone", "row_id": row_id, "text": phone})
        for location in _LOCATION_RE.findall(text):
            spans.append(
                {
                    "evidence_type": "location",
                    "row_id": row_id,
                    "text": location.strip(),
                }
            )
        for location in _extract_locations([text]):
            spans.append(
                {
                    "evidence_type": "location",
                    "row_id": row_id,
                    "text": location,
                }
            )
        for email in _EMAIL_RE.findall(text):
            spans.append({"evidence_type": "email", "row_id": row_id, "text": email})
    return spans


def _matching_lines(lines: list[str], pattern: re.Pattern[str]) -> list[str]:
    return _unique(line for line in lines if pattern.search(line))


def _unique(values: object) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value).strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            items.append(normalized)
    return items


def _consumer_matches(payload: dict[str, object]) -> list[dict[str, object]]:
    raw_matches = payload.get("consumerMatches") or payload.get("consumer_matches")
    if not isinstance(raw_matches, list):
        return []
    return [item for item in raw_matches if isinstance(item, dict)]


def _target_matches(payload: dict[str, object]) -> list[dict[str, object]]:
    raw_matches = payload.get("targetMatches") or payload.get("target_matches")
    if not isinstance(raw_matches, list):
        return []
    return [item for item in raw_matches if isinstance(item, dict)]


def _single_target_lineage(
    target_matches: list[dict[str, object]],
) -> dict[str, object] | None:
    if len(target_matches) != 1:
        return None
    return target_matches[0]


def _page_identity(manifest: dict[str, object]) -> tuple[str, str]:
    return (
        _require_text(manifest.get("rawAssetId"), "rawAssetId"),
        _require_text(manifest.get("rawVersionId"), "rawVersionId"),
    )


def _page_lineage_fields(
    *,
    manifest: dict[str, object],
    raw_page: dict[str, object],
) -> dict[str, object]:
    return {
        "sourcePackId": _require_optional_text(
            manifest.get("sourcePackId")
            or manifest.get("source_pack_id")
            or raw_page.get("sourcePackId")
            or raw_page.get("source_pack_id")
        ),
        "sourcePackEntryId": _require_optional_text(
            manifest.get("sourcePackEntryId")
            or manifest.get("source_pack_entry_id")
            or raw_page.get("sourcePackEntryId")
            or raw_page.get("source_pack_entry_id")
        ),
        "compositionGroup": _require_optional_text(
            manifest.get("compositionGroup")
            or manifest.get("composition_group")
            or raw_page.get("compositionGroup")
            or raw_page.get("composition_group")
        ),
        "compositionRole": _require_optional_text(
            manifest.get("compositionRole")
            or manifest.get("composition_role")
            or raw_page.get("compositionRole")
            or raw_page.get("composition_role")
        ),
    }


def _merge_target_lineage_with_page_fields(
    target_match: dict[str, object],
    *,
    manifest: dict[str, object],
    raw_page: dict[str, object],
) -> dict[str, object]:
    merged = dict(target_match)
    page_lineage = _page_lineage_fields(manifest=manifest, raw_page=raw_page)
    if page_lineage["sourcePackId"] is not None:
        merged["sourcePackId"] = page_lineage["sourcePackId"]
    if page_lineage["sourcePackEntryId"] is not None:
        merged["sourcePackEntryId"] = page_lineage["sourcePackEntryId"]
    if page_lineage["compositionGroup"] is not None:
        merged["compositionGroup"] = page_lineage["compositionGroup"]
    if page_lineage["compositionRole"] is not None:
        merged["compositionRole"] = page_lineage["compositionRole"]
    return merged


def _target_lineage_issues(
    *,
    collection_mode: str | None,
    manifest: dict[str, object],
    raw_page: dict[str, object],
    target_matches: list[dict[str, object]],
) -> list[dict[str, object]]:
    if collection_mode != _TARGET_WORKSET_COLLECTION_MODE and not target_matches:
        return []
    raw_asset_id = str(
        raw_page.get("rawAssetId")
        or raw_page.get("raw_asset_id")
        or manifest.get("rawAssetId")
        or ""
    )
    raw_version_id = str(
        raw_page.get("rawVersionId")
        or raw_page.get("raw_version_id")
        or manifest.get("rawVersionId")
        or ""
    )
    normalized_canonical_url = str(
        raw_page.get("normalizedCanonicalUrl")
        or raw_page.get("normalized_canonical_url")
        or manifest.get("normalizedCanonicalUrl")
        or ""
    )

    base_issue = {
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "normalized_canonical_url": normalized_canonical_url,
    }
    issues: list[dict[str, object]] = []
    if collection_mode == _TARGET_WORKSET_COLLECTION_MODE and not target_matches:
        issues.append(
            {
                **base_issue,
                "code": "missing_target_lineage",
                "message": "target-workset source-truth page is missing targetMatches",
            }
        )
        return issues

    for target_match in target_matches:
        consumer_family = _require_optional_text(
            target_match.get("consumerFamily") or target_match.get("consumer_family")
        )
        materialization_policy = _require_optional_text(
            target_match.get("materializationPolicy") or target_match.get("materialization_policy")
        )
        if consumer_family not in _TARGET_CONSUMER_FAMILIES:
            issues.append(
                {
                    **base_issue,
                    "code": "unsupported_target_consumer_family",
                    "message": (
                        "targetMatches consumerFamily is not canonical: "
                        f"{consumer_family or '<empty>'}"
                    ),
                }
            )
        if materialization_policy not in _TARGET_MATERIALIZATION_POLICIES:
            issues.append(
                {
                    **base_issue,
                    "code": "unsupported_target_materialization_policy",
                    "message": (
                        "targetMatches materializationPolicy is not supported: "
                        f"{materialization_policy or '<empty>'}"
                    ),
                }
            )
        if consumer_family == "public_notice_inventory":
            issues.append(
                {
                    **base_issue,
                    "code": "forbidden_public_notice_inventory_family",
                    "message": "public_notice_inventory is not a canonical official-web family",
                }
            )
    return issues


def _target_projection_fields(target_lineage: dict[str, object]) -> dict[str, object]:
    return {
        "target_job_id": _require_optional_text(
            target_lineage.get("targetJobId") or target_lineage.get("target_job_id")
        ),
        "target_candidate_id": _require_optional_text(
            target_lineage.get("targetCandidateId") or target_lineage.get("target_candidate_id")
        ),
        "target_id": _require_optional_text(
            target_lineage.get("targetId") or target_lineage.get("target_id")
        ),
        "target_declaration_version": _require_optional_text(
            target_lineage.get("targetDeclarationVersion")
            or target_lineage.get("target_declaration_version")
        ),
        "target_consumer_family": _require_optional_text(
            target_lineage.get("consumerFamily") or target_lineage.get("consumer_family")
        ),
        "retention_policy": _require_optional_text(
            target_lineage.get("retentionPolicy") or target_lineage.get("retention_policy")
        ),
        "materialization_policy": _require_optional_text(
            target_lineage.get("materializationPolicy")
            or target_lineage.get("materialization_policy")
        ),
        "selected_write_target": _require_optional_text(
            target_lineage.get("selectedWriteTarget") or target_lineage.get("selected_write_target")
        )
        or "",
        "review_policy": _require_optional_text(
            target_lineage.get("reviewPolicy") or target_lineage.get("review_policy")
        ),
        "workset_reason": _require_optional_text(
            target_lineage.get("worksetReason") or target_lineage.get("workset_reason")
        ),
        "source_pack_id": _require_optional_text(
            target_lineage.get("sourcePackId") or target_lineage.get("source_pack_id")
        ),
        "source_pack_entry_id": _require_optional_text(
            target_lineage.get("sourcePackEntryId") or target_lineage.get("source_pack_entry_id")
        ),
        "target_label": _require_optional_text(
            target_lineage.get("targetLabel") or target_lineage.get("target_label")
        ),
        "composition_group": _require_optional_text(
            target_lineage.get("compositionGroup") or target_lineage.get("composition_group")
        ),
        "composition_role": _require_optional_text(
            target_lineage.get("compositionRole") or target_lineage.get("composition_role")
        ),
    }


def _target_lineage_matched_evidence(match: dict[str, object]) -> list[str]:
    workset_reason = _require_optional_text(
        match.get("worksetReason") or match.get("workset_reason")
    )
    target_id = _require_optional_text(match.get("targetId") or match.get("target_id"))
    values = [item for item in (workset_reason, target_id) if item]
    return values or ["target_lineage_match"]


def _find_consumer_match(
    matches: list[dict[str, object]],
    consumer_family: str,
) -> dict[str, object] | None:
    for match in matches:
        if (
            str(match.get("consumerFamily") or match.get("consumer_family") or "")
            == consumer_family
        ):
            return match
    return None


def _target_from_consumer_match(match: dict[str, object]) -> tuple[str, str]:
    selected_write_target = _require_optional_text(
        match.get("selectedWriteTarget") or match.get("selected_write_target")
    )
    if selected_write_target and "/" in selected_write_target:
        corpus, collection = selected_write_target.split("/", 1)
        if corpus and collection:
            return corpus, collection
    target_corpus = _require_optional_text(match.get("targetCorpus") or match.get("target_corpus"))
    target_collection = _require_optional_text(
        match.get("targetCollection") or match.get("target_collection")
    )
    if target_corpus and target_collection:
        return target_corpus, target_collection
    consumer_family = str(match.get("consumerFamily") or match.get("consumer_family") or "")
    if consumer_family == "regulation_candidate":
        return "regulations", "institutional_rules"
    if consumer_family == "student_regulation_candidate":
        return "regulations", "student_rules"
    if consumer_family == "notice_news_candidate":
        return "official_web_public_notice", "inventory"
    return "official_web", "muc_public_pages"


def _regulation_release_scope(target_lineage: dict[str, object] | None) -> str:
    if target_lineage is None:
        return "regulations/institutional_rules"
    selected_write_target = _require_optional_text(
        target_lineage.get("selectedWriteTarget") or target_lineage.get("selected_write_target")
    )
    if selected_write_target and selected_write_target.startswith("regulations/"):
        return selected_write_target
    target_corpus = _require_optional_text(
        target_lineage.get("targetCorpus") or target_lineage.get("target_corpus")
    )
    target_collection = _require_optional_text(
        target_lineage.get("targetCollection") or target_lineage.get("target_collection")
    )
    if target_corpus == "regulations" and target_collection:
        return f"{target_corpus}/{target_collection}"
    return "regulations/institutional_rules"


def _build_regulation_content_summary(lines: list[str]) -> str:
    normalized_lines = [line.strip() for line in lines if line.strip()]
    if not normalized_lines:
        return ""
    summary = " ".join(normalized_lines[:3]).strip()
    return re.sub(r"\s+", " ", summary)[:500]


def _regulation_answer_bearing_lines(lines: list[str]) -> list[str]:
    candidates = [
        line.strip()
        for line in lines
        if line.strip() and not _REGULATION_NON_BODY_RE.search(line.strip())
    ]
    if not any(_REGULATION_BODY_SIGNAL_RE.search(line) for line in candidates):
        return []
    return candidates


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]


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

    if declaration.document_kind == "generic" and (
        _looks_like_portal_generic_page(
            title=title,
            main_blocks=main_blocks,
        )
        or _looks_like_sparse_generic_link_hub(main_blocks)
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
