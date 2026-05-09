from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from campus_shared.regulation_semantic_registry import (
    RegulationCategoryDefinition,
    RegulationDiscoveryConfig,
    RegulationPolicyObjectDefinition,
    load_regulation_discovery_config,
    regulation_categories_for_document,
)

_WHITESPACE_RE = re.compile(r"\s+")
_SCOPE_RULE_RE = re.compile(
    r"^(?:本(?:办法|规定|细则|制度|通知|规则)|该(?:办法|规定|细则|制度|通知|规则)).{0,24}(?:适用于|适用范围)"
)
_DEFINITION_RE = re.compile(r"^(?:本(?:办法|规定|细则|制度|通知|规则)所称|本条所称)")
_CLOCK_TIME_RE = re.compile(r"\d{1,2}[:：]\d{2}")
_DATE_TIME_RE = re.compile(r"\d{4}年\d{1,2}月\d{1,2}日")
_NESTED_NUMBERED_LINE_RE = re.compile(
    r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])"
)
_ELIGIBILITY_KEYWORDS = ("申请条件", "资格条件", "资格", "条件", "对象")
_PROCEDURE_SCOPE_NON_STEP_MARKERS = (
    "名额",
    "金额",
    "额度",
    "比例",
    "人数",
    "左右",
    "作为",
    "依据",
    "方可",
    "情形之一者",
    "有权",
    "回避",
)


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
    requirement_rule_markers: tuple[str, ...]
    condition_claim_markers: tuple[str, ...]
    deadline_constraint_markers: tuple[str, ...]


_DEFAULT_REGISTRY = RegulationSemanticsRegistry(
    example_list_markers=("具体表现如下", "具体包括", "包括以下"),
    procedure_intro_markers=(
        "按如下程序",
        "按以下程序",
        "按下列程序",
        "按照如下程序",
        "按照以下程序",
        "按照下列程序",
        "按照下列程序进行",
        "按照以下程序进行",
        "按照如下程序进行",
        "程序如下",
        "流程如下",
        "办理程序",
    ),
    procedure_context_markers=("程序", "流程", "手续", "步骤", "办理"),
    procedure_action_markers=(
        "审核",
        "审查",
        "审批",
        "审定",
        "公示",
        "报送",
        "受理",
        "办理",
        "备案",
        "复评",
        "复审",
        "评选",
        "签署意见",
    ),
    procedure_contextual_action_markers=("提交", "申请"),
    exclusion_markers=(
        "不得",
        "不能",
        "不予",
        "取消",
        "无资格",
        "禁止",
        "不受理",
        "不宜",
        "不适合",
    ),
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
        "不宜",
        "不适合",
    ),
    audience_scope_keywords={
        "undergraduate": ("本科生", "本科", "预科生", "预科"),
        "graduate": ("研究生", "硕士", "博士"),
        "all_students": ("学生", "在校生"),
    },
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


def infer_regulation_body_content_role(
    *,
    detail_label: str,
    section_leaf: str,
    text: str,
    registry: RegulationSemanticsRegistry | None = None,
) -> str:
    active = registry or _DEFAULT_REGISTRY
    normalized_text = normalize_regulation_semantic_text(text)
    compact_text = compact_semantic_text(text)
    compact_scope = compact_semantic_text(" ".join((detail_label, section_leaf, normalized_text)))
    compact_heading_scope = compact_semantic_text(" ".join((detail_label, section_leaf)))
    if _is_scope_rule_text(compact_text):
        return "scope_rule"
    if _is_deadline_rule_scope(compact_scope, compact_text, registry=active):
        return "deadline"
    if _is_time_rule_scope(text=text, compact_scope=compact_scope, registry=active):
        return "time_rule"
    if _is_eligibility_rule_scope(
        section_leaf=section_leaf,
        compact_heading_scope=compact_heading_scope,
        compact_text=compact_text,
        registry=active,
    ):
        return "eligibility"
    if _is_definition_rule_text(detail_label=detail_label, compact_text=compact_text):
        return "definition"
    if _is_procedure_rule_scope(
        section_leaf=section_leaf,
        compact_heading_scope=compact_heading_scope,
        compact_text=compact_text,
        text=text,
        registry=active,
    ):
        return "procedure"
    if looks_like_requirement_text(compact_text, registry=active):
        return "requirement"
    return ""


def normalize_regulation_semantic_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.strip()) if value else ""


def _is_scope_rule_text(compact_text: str) -> bool:
    if not compact_text:
        return False
    return bool(_SCOPE_RULE_RE.match(compact_text) or compact_text.startswith("适用于"))


def _is_time_rule_scope(
    *,
    text: str,
    compact_scope: str,
    registry: RegulationSemanticsRegistry,
) -> bool:
    if any(keyword in compact_scope for keyword in registry.time_rule_keywords):
        return True
    if _CLOCK_TIME_RE.search(text):
        return True
    return bool(_DATE_TIME_RE.search(text) and "实施" not in text and "施行" not in text)


def _is_deadline_rule_scope(
    compact_scope: str,
    compact_text: str,
    *,
    registry: RegulationSemanticsRegistry,
) -> bool:
    if any(keyword in compact_scope for keyword in registry.deadline_keywords):
        return True
    return looks_like_deadline_constraint_text(compact_text, registry=registry)


def _is_eligibility_rule_scope(
    *,
    section_leaf: str,
    compact_heading_scope: str,
    compact_text: str,
    registry: RegulationSemanticsRegistry,
) -> bool:
    if _is_procedure_rule_scope(
        section_leaf=section_leaf,
        compact_heading_scope=compact_heading_scope,
        compact_text=compact_text,
        text=compact_text,
        registry=registry,
    ):
        return False
    if any(keyword in compact_heading_scope for keyword in _ELIGIBILITY_KEYWORDS):
        return True
    if compact_text.startswith(("凡符合", "符合")):
        return True
    if any(keyword in section_leaf for keyword in ("程序", "流程", "办理", "步骤")):
        return not any(keyword in compact_text for keyword in registry.procedure_action_markers)
    return False


def _is_definition_rule_text(*, detail_label: str, compact_text: str) -> bool:
    if any(token in detail_label for token in ("释义", "定义")):
        return True
    return bool(_DEFINITION_RE.match(compact_text))


def _is_procedure_rule_scope(
    *,
    section_leaf: str,
    compact_heading_scope: str,
    compact_text: str,
    text: str,
    registry: RegulationSemanticsRegistry,
) -> bool:
    if any(marker in compact_text for marker in _PROCEDURE_SCOPE_NON_STEP_MARKERS) and not any(
        keyword in compact_text
        for keyword in (
            *registry.procedure_action_markers,
            *registry.procedure_contextual_action_markers,
            "填写",
            "签字",
            "盖章",
            "报至",
            "复评",
            "复审",
            "评选",
            "发放",
            "拨付",
        )
    ):
        return False
    strong_heading_markers = tuple(
        keyword for keyword in registry.procedure_keywords if keyword not in {"申请", "提交"}
    )
    if any(keyword in compact_heading_scope for keyword in strong_heading_markers):
        return True
    lines = tuple(line.strip() for line in text.splitlines() if line.strip())
    if sum(1 for line in lines if _NESTED_NUMBERED_LINE_RE.match(line)) >= 2:
        return True
    strong_markers = strong_heading_markers
    strong_hits = sum(1 for keyword in strong_markers if keyword in compact_text)
    if strong_hits >= 2:
        return True
    if any(
        keyword in compact_heading_scope for keyword in registry.procedure_context_markers
    ) and any(
        keyword in compact_text
        for keyword in (
            *registry.procedure_action_markers,
            *registry.procedure_contextual_action_markers,
            "填写",
            "签字",
            "盖章",
            "报至",
            "复评",
            "复审",
            "评选",
        )
    ):
        return True
    has_procedure_scope = any(
        keyword in compact_heading_scope for keyword in registry.procedure_context_markers
    )
    has_contextual_action = any(
        keyword in compact_text for keyword in registry.procedure_contextual_action_markers
    )
    return has_procedure_scope and has_contextual_action


def build_category_overview_metadata(
    *,
    collection: str,
    document_id: str,
) -> tuple[dict[str, object], ...]:
    categories = regulation_categories_for_document(collection=collection, document_id=document_id)
    if not categories:
        return ()
    discovery = load_regulation_discovery_config(collection)
    overviews: list[dict[str, object]] = []
    for category in categories:
        if document_id != category.overview_document_id:
            continue
        member_titles = tuple(
            title
            for member_document_id in category.member_policy_document_ids
            if (title := discovery.policy_titles_by_document_id.get(member_document_id, ""))
        )
        if not member_titles:
            continue
        display_text = (
            f"当前已收录依据中，{category.audience}{category.display_name}相关制度包括："
            f"{'、'.join(f'《{title}》' for title in member_titles)}。"
        )
        overviews.append(
            {
                "display_text": display_text,
                "anchor": {
                    "section_path": [category.display_name],
                    "provision_label": "category_overview",
                },
                "metadata": {
                    "title": f"{category.audience}{category.display_name}相关制度",
                    "category_id": category.category_id,
                    "category_display_name": category.display_name,
                    "audience": category.audience,
                    "category_audience": category.audience,
                    "member_policy_document_ids": list(category.member_policy_document_ids),
                    "category_member_document_ids": list(category.member_policy_document_ids),
                    "member_policy_titles": list(member_titles),
                    "category_member_titles": list(member_titles),
                    "answer_role": "category_overview",
                    "content_role": "policy_list",
                    "semantic_role": "category_overview",
                    "claim_type": "policy_list",
                    "is_answer_bearing": True,
                },
            }
        )
    return tuple(overviews)


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
    "load_regulation_discovery_config",
    "looks_like_condition_claim_text",
    "looks_like_deadline_constraint_text",
    "looks_like_requirement_text",
    "starts_example_list",
    "starts_procedure_list",
]
