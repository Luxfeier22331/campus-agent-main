from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache

from campus_ingestion_core.scope_catalog import default_config_root

_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class RegulationSemanticsRegistry:
    example_list_markers: tuple[str, ...]
    procedure_intro_markers: tuple[str, ...]
    procedure_context_markers: tuple[str, ...]
    procedure_action_markers: tuple[str, ...]
    procedure_contextual_action_markers: tuple[str, ...]
    exclusion_markers: tuple[str, ...]
    exception_markers: tuple[str, ...]
    prohibition_markers: tuple[str, ...]
    eligibility_markers: tuple[str, ...]
    amount_or_quota_markers: tuple[str, ...]
    timeline_markers: tuple[str, ...]
    material_markers: tuple[str, ...]
    contact_location_markers: tuple[str, ...]
    terminal_provision_markers: tuple[str, ...]
    navigation_keywords: tuple[str, ...]
    time_rule_keywords: tuple[str, ...]
    deadline_keywords: tuple[str, ...]
    procedure_keywords: tuple[str, ...]
    negative_polarity_keywords: tuple[str, ...]
    audience_scope_keywords: dict[str, tuple[str, ...]]
    lift_discipline_keywords: tuple[str, ...]
    reissue_keywords: tuple[str, ...]
    requirement_rule_markers: tuple[str, ...]
    condition_claim_markers: tuple[str, ...]
    deadline_constraint_markers: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RegulationCategoryDefinition:
    category_id: str
    display_name: str
    aliases: tuple[str, ...]
    audience: str
    member_policy_document_ids: tuple[str, ...]
    overview_document_id: str
    default_procedure_document_id: str = ""
    procedure_overrides: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class RegulationPolicyObjectDefinition:
    document_id: str
    title: str
    aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RegulationDiscoveryConfig:
    clarification_cues: tuple[str, ...]
    policy_objects: tuple[RegulationPolicyObjectDefinition, ...]
    policy_titles_by_document_id: dict[str, str]
    categories: tuple[RegulationCategoryDefinition, ...]


_DEFAULT_REGISTRY = RegulationSemanticsRegistry(
    example_list_markers=("具体表现如下", "具体包括", "包括以下"),
    procedure_intro_markers=(
        "按如下程序",
        "按以下程序",
        "按下列程序",
        "按照如下程序",
        "按照以下程序",
        "按照下列程序",
        "程序如下",
        "流程如下",
        "办理程序",
    ),
    procedure_context_markers=("程序", "流程", "手续", "步骤", "办理"),
    procedure_action_markers=("审核", "审批", "公示", "报送", "受理", "办理", "备案"),
    procedure_contextual_action_markers=("提交", "申请"),
    exclusion_markers=("不得", "不能", "不予", "取消", "无资格", "禁止", "不受理"),
    exception_markers=("除外", "超出", "例外", "特殊情况", "特殊条件", "破格"),
    prohibition_markers=("严禁", "禁止", "不得"),
    eligibility_markers=("条件", "资格", "对象", "参评", "申请", "应当", "须", "需"),
    amount_or_quota_markers=("金额", "名额", "额度", "标准", "元", "比例", "人数"),
    timeline_markers=("时间", "期限", "截止", "日期", "学年", "每年", "每学期"),
    material_markers=("材料", "证明", "申请表", "复印件", "照片", "原件"),
    contact_location_markers=("电话", "地点", "地址", "办公室", "联系人"),
    terminal_provision_markers=(
        "负责解释",
        "负责施行",
        "自发布之日起实施",
        "自发布之日起施行",
        "自印发之日起实施",
        "自印发之日起施行",
        "自公布之日起实施",
        "自公布之日起施行",
        "同时废止",
    ),
    navigation_keywords=("流程", "程序", "步骤", "办理路径", "办理方式"),
    time_rule_keywords=(
        "时间安排",
        "作息时间",
        "开放时间",
        "办理时间",
        "受理时间",
        "时间要求",
        "时间",
    ),
    deadline_keywords=("截止", "时限", "期限", "截至", "逾期"),
    procedure_keywords=(
        "程序",
        "流程",
        "步骤",
        "申请",
        "审核",
        "审批",
        "办理",
        "补办",
        "挂失",
        "提交",
        "报送",
        "复核",
    ),
    negative_polarity_keywords=(
        "不予",
        "不能",
        "不得",
        "严禁",
        "禁止",
        "取消",
        "不受理",
        "不予受理",
        "不再",
        "无资格",
        "不得申请",
    ),
    audience_scope_keywords={
        "undergraduate": ("本科生", "本科", "预科生", "预科"),
        "graduate": ("研究生", "硕士", "博士"),
        "all_students": ("学生", "在校生"),
    },
    lift_discipline_keywords=("解除处分", "纪律处分", "处分解除", "处分"),
    reissue_keywords=("补办", "补发", "挂失", "遗失", "丢失", "丢了", "损坏", "补卡", "补证"),
    requirement_rule_markers=("应当", "应及时", "必须", "不得", "严禁", "须"),
    condition_claim_markers=("可以", "可申请", "应当", "须", "必须"),
    deadline_constraint_markers=("前完成", "不得逾期"),
)


def compact_semantic_text(value: str) -> str:
    return _WHITESPACE_RE.sub("", value or "")


def load_default_regulation_semantics_registry() -> RegulationSemanticsRegistry:
    return _DEFAULT_REGISTRY


def starts_example_list(text: str, *, registry: RegulationSemanticsRegistry | None = None) -> bool:
    normalized = compact_semantic_text(text)
    active = registry or _DEFAULT_REGISTRY
    return any(marker in normalized for marker in active.example_list_markers)


def starts_procedure_list(
    text: str, *, registry: RegulationSemanticsRegistry | None = None
) -> bool:
    normalized = compact_semantic_text(text)
    active = registry or _DEFAULT_REGISTRY
    return any(marker in normalized for marker in active.procedure_intro_markers)


def infer_negative_semantic_role(
    text: str,
    *,
    registry: RegulationSemanticsRegistry | None = None,
) -> str:
    normalized = compact_semantic_text(text)
    active = registry or _DEFAULT_REGISTRY
    if not any(marker in normalized for marker in active.negative_polarity_keywords):
        return ""
    if any(marker in normalized for marker in active.prohibition_markers):
        return "prohibition"
    if any(marker in normalized for marker in active.exception_markers) or "情形" in normalized:
        return "exception"
    return "exclusion"


def looks_like_requirement_text(
    text: str,
    *,
    registry: RegulationSemanticsRegistry | None = None,
) -> bool:
    normalized = compact_semantic_text(text)
    active = registry or _DEFAULT_REGISTRY
    return any(marker in normalized for marker in active.requirement_rule_markers)


def looks_like_condition_claim_text(
    text: str,
    *,
    registry: RegulationSemanticsRegistry | None = None,
) -> bool:
    normalized = compact_semantic_text(text)
    active = registry or _DEFAULT_REGISTRY
    return any(marker in normalized for marker in active.condition_claim_markers)


def looks_like_deadline_constraint_text(
    text: str,
    *,
    registry: RegulationSemanticsRegistry | None = None,
) -> bool:
    normalized = compact_semantic_text(text)
    active = registry or _DEFAULT_REGISTRY
    return any(marker in normalized for marker in active.deadline_constraint_markers)


def infer_table_fact_type(
    *,
    text: str,
    metadata: Mapping[str, object],
    registry: RegulationSemanticsRegistry | None = None,
) -> str:
    active = registry or _DEFAULT_REGISTRY
    normalized = compact_semantic_text(
        " ".join(
            (
                text,
                str(metadata.get("table_header_line") or ""),
                " ".join(str(item) for item in metadata.get("caption_lines") or ()),
            )
        )
    )
    if any(marker in normalized for marker in active.amount_or_quota_markers):
        return "amount_or_quota"
    if any(marker in normalized for marker in active.material_markers):
        return "required_materials"
    if any(marker in normalized for marker in active.timeline_markers):
        return "timeline_or_deadline"
    if any(marker in normalized for marker in active.procedure_action_markers):
        return "procedure_table"
    if any(marker in normalized for marker in active.eligibility_markers):
        return "eligibility_table"
    if any(marker in normalized for marker in active.contact_location_markers):
        return "contact_or_location"
    return "generic_policy_table"


def load_student_rules_discovery_config() -> RegulationDiscoveryConfig:
    payload = _load_student_rules_query_planning_config()
    clarification_cues = tuple(
        str(cue).strip()
        for cue in payload.get("clarification_cues", ())
        if str(cue).strip()
    )
    policy_objects: list[RegulationPolicyObjectDefinition] = []
    policy_titles: dict[str, str] = {}
    for policy_object in payload.get("policy_objects", ()):
        if not isinstance(policy_object, Mapping):
            continue
        document_id = str(policy_object.get("document_id") or "").strip()
        title = str(policy_object.get("title") or "").strip()
        if document_id and title:
            policy_objects.append(
                RegulationPolicyObjectDefinition(
                    document_id=document_id,
                    title=title,
                    aliases=tuple(
                        str(alias).strip()
                        for alias in policy_object.get("aliases", ())
                        if str(alias).strip()
                    ),
                )
            )
            policy_titles[document_id] = title
    categories: list[RegulationCategoryDefinition] = []
    for item in payload.get("policy_categories", ()):
        if not isinstance(item, Mapping):
            continue
        category_id = str(item.get("category_id") or "").strip()
        if not category_id:
            continue
        member_policy_document_ids = tuple(
            str(document_id).strip()
            for document_id in item.get("member_policy_document_ids", ())
            if str(document_id).strip()
        )
        if not member_policy_document_ids:
            continue
        overview_document_id = str(
            item.get("overview_document_id") or member_policy_document_ids[0]
        ).strip()
        categories.append(
            RegulationCategoryDefinition(
                category_id=category_id,
                display_name=str(item.get("display_name") or "").strip(),
                aliases=tuple(
                    str(alias).strip()
                    for alias in item.get("aliases", ())
                    if str(alias).strip()
                ),
                audience=str(item.get("audience") or "").strip(),
                member_policy_document_ids=member_policy_document_ids,
                overview_document_id=overview_document_id,
                default_procedure_document_id=str(
                    item.get("default_procedure_document_id") or ""
                ).strip(),
                procedure_overrides=tuple(
                    (
                        str(override.get("match_term") or "").strip(),
                        str(override.get("document_id") or "").strip(),
                    )
                    for override in item.get("procedure_overrides", ())
                    if isinstance(override, Mapping)
                    and str(override.get("match_term") or "").strip()
                    and str(override.get("document_id") or "").strip()
                ),
            )
        )
    return RegulationDiscoveryConfig(
        clarification_cues=clarification_cues,
        policy_objects=tuple(policy_objects),
        policy_titles_by_document_id=policy_titles,
        categories=tuple(categories),
    )


def regulation_category_for_document(
    *,
    collection: str,
    document_id: str,
) -> RegulationCategoryDefinition | None:
    if collection != "student_rules":
        return None
    for category in load_student_rules_discovery_config().categories:
        if document_id in category.member_policy_document_ids:
            return category
    return None


def build_category_overview_metadata(
    *,
    collection: str,
    document_id: str,
) -> dict[str, object] | None:
    category = regulation_category_for_document(collection=collection, document_id=document_id)
    if category is None:
        return None
    if document_id != category.overview_document_id:
        return None
    discovery = load_student_rules_discovery_config()
    member_titles = tuple(
        title
        for member_document_id in category.member_policy_document_ids
        if (title := discovery.policy_titles_by_document_id.get(member_document_id, ""))
    )
    if not member_titles:
        return None
    display_text = (
        f"当前已收录依据中，{category.audience}{category.display_name}相关制度包括："
        f"{'、'.join(f'《{title}》' for title in member_titles)}。"
    )
    return {
        "display_text": display_text,
        "anchor": {
            "section_path": [category.display_name],
            "provision_label": "category_overview",
        },
        "metadata": {
            "title": f"{category.audience}{category.display_name}相关制度",
            "category_id": category.category_id,
            "category_display_name": category.display_name,
            "category_audience": category.audience,
            "category_member_document_ids": list(category.member_policy_document_ids),
            "category_member_titles": list(member_titles),
            "answer_role": "category_overview",
            "content_role": "policy_list",
            "semantic_role": "category_overview",
            "claim_type": "policy_list",
            "is_answer_bearing": True,
        },
    }


@lru_cache(maxsize=1)
def _load_student_rules_query_planning_config() -> dict[str, object]:
    path = default_config_root() / "regulations" / "student_rules" / "query-planning.json"
    return json.loads(path.read_text(encoding="utf-8"))


__all__ = [
    "RegulationCategoryDefinition",
    "RegulationDiscoveryConfig",
    "RegulationPolicyObjectDefinition",
    "RegulationSemanticsRegistry",
    "build_category_overview_metadata",
    "compact_semantic_text",
    "infer_negative_semantic_role",
    "infer_table_fact_type",
    "load_default_regulation_semantics_registry",
    "load_student_rules_discovery_config",
    "looks_like_condition_claim_text",
    "looks_like_deadline_constraint_text",
    "looks_like_requirement_text",
    "regulation_category_for_document",
    "starts_example_list",
    "starts_procedure_list",
]
