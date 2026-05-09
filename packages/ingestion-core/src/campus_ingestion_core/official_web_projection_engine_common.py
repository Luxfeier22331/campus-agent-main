from __future__ import annotations

import re

from campus_ingestion_core.official_web_projection_shared import _require_text

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
_REGULATION_NON_RULE_FRAGMENT_TITLE_RE = re.compile(
    r"(?:申请材料|所需材料|办理材料|提交材料|材料清单|需提交|须提交|需提供|须提供|请提供)$"
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


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]


def _require_optional_text(value: object) -> str | None:
    text = value.strip() if isinstance(value, str) else None
    return text or None


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
    return None
