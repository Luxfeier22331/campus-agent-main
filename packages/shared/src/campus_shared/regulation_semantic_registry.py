from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True, slots=True)
class RegulationConditionSubjectDefinition:
    subject_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    release_blocking: bool = True


@dataclass(frozen=True, slots=True)
class RegulationProcedureActionDefinition:
    action_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    release_blocking: bool = True


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


@dataclass(frozen=True, slots=True)
class RegulationSemanticAssignment:
    value: str
    provenance: str


REGULATION_CONDITION_SUBJECT_DEFINITIONS: dict[str, RegulationConditionSubjectDefinition] = {
    "application_procedure": RegulationConditionSubjectDefinition(
        subject_id="application_procedure",
        description="办理、申请、审核、公示、补办等程序性步骤或流程条件。",
        expected_answer_roles=("procedure_step", "eligibility_intro"),
    ),
    "rank_threshold": RegulationConditionSubjectDefinition(
        subject_id="rank_threshold",
        description="成绩、排名、综测等排序阈值条件。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "paper_or_publication": RegulationConditionSubjectDefinition(
        subject_id="paper_or_publication",
        description="论文、发表、科研成果、专利、竞赛成果等要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "academic_performance": RegulationConditionSubjectDefinition(
        subject_id="academic_performance",
        description="课程成绩、学分、培养环节完成情况等学业表现要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "conduct_or_discipline_status": RegulationConditionSubjectDefinition(
        subject_id="conduct_or_discipline_status",
        description="违纪处分、思想品德、行为规范等状态要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "exclusion_rule"),
    ),
    "material_requirement": RegulationConditionSubjectDefinition(
        subject_id="material_requirement",
        description="申请表、证明、复印件、原件等材料要求。",
        expected_answer_roles=("procedure_step", "eligibility_condition", "table_fact"),
    ),
    "deadline": RegulationConditionSubjectDefinition(
        subject_id="deadline",
        description="截止时间、办理时限、公示窗口等时间约束。",
        expected_answer_roles=("eligibility_condition", "exclusion_rule", "table_fact"),
    ),
    "appeal_or_review_right": RegulationConditionSubjectDefinition(
        subject_id="appeal_or_review_right",
        description="申诉、复核、复议、听证等权利和救济路径。",
        expected_answer_roles=("procedure_step", "eligibility_condition", "exception_rule"),
    ),
    "discipline_relief_condition": RegulationConditionSubjectDefinition(
        subject_id="discipline_relief_condition",
        description="解除处分的正向资格条件。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "discipline_relief_exclusion": RegulationConditionSubjectDefinition(
        subject_id="discipline_relief_exclusion",
        description="解除处分的不予受理、不得申请或排除情形。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "safety_or_security_restriction": RegulationConditionSubjectDefinition(
        subject_id="safety_or_security_restriction",
        description="国家安全、公共安全、经济安全、社会稳定、校园安全等限制。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "generic_condition": RegulationConditionSubjectDefinition(
        subject_id="generic_condition",
        description="当前还未细分到更窄 taxonomy 的通用资格条件。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "eligibility_intro"),
    ),
    "generic_restriction": RegulationConditionSubjectDefinition(
        subject_id="generic_restriction",
        description="当前还未细分到更窄 taxonomy 的通用限制条款。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "disqualification_or_nonacceptance": RegulationConditionSubjectDefinition(
        subject_id="disqualification_or_nonacceptance",
        description="不予受理、取消资格、无资格、不予加分等排除条款。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "activity_scope_restriction": RegulationConditionSubjectDefinition(
        subject_id="activity_scope_restriction",
        description="范围限制、不得变更、不得以无关事项替代等限制。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "amount_or_quota": RegulationConditionSubjectDefinition(
        subject_id="amount_or_quota",
        description="名额、金额、比例、额度等定量条件。",
        expected_answer_roles=("eligibility_condition", "exclusion_rule", "table_fact"),
    ),
    "example_evidence": RegulationConditionSubjectDefinition(
        subject_id="example_evidence",
        description="作为示例或补充举证出现的佐证条件。",
        expected_answer_roles=("example_evidence", "eligibility_intro"),
    ),
    "moral_or_social_contribution": RegulationConditionSubjectDefinition(
        subject_id="moral_or_social_contribution",
        description="道德表现、见义勇为、服务社会、志愿奉献等条件。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
    ),
    "arts_competition": RegulationConditionSubjectDefinition(
        subject_id="arts_competition",
        description="文艺比赛、艺术竞赛成果等条件。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
    ),
    "sports_competition": RegulationConditionSubjectDefinition(
        subject_id="sports_competition",
        description="体育比赛、体育竞赛成果等条件。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
    ),
    "student_card_or_identity_credential": RegulationConditionSubjectDefinition(
        subject_id="student_card_or_identity_credential",
        description="学生证、证件挂失、补办、身份凭证相关规则。",
        expected_answer_roles=("procedure_step", "eligibility_condition", "exclusion_rule"),
    ),
    "dormitory_or_accommodation": RegulationConditionSubjectDefinition(
        subject_id="dormitory_or_accommodation",
        description="宿舍、住宿、电器和寝室管理相关规则。",
        expected_answer_roles=("eligibility_condition", "exclusion_rule", "example_evidence"),
    ),
    "degree_or_graduation_requirement": RegulationConditionSubjectDefinition(
        subject_id="degree_or_graduation_requirement",
        description="学位授予、毕业资格、培养完成要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "audience_scope": RegulationConditionSubjectDefinition(
        subject_id="audience_scope",
        description="适用对象、受众范围、学生身份范围。",
        expected_answer_roles=("category_overview", "eligibility_condition", "eligibility_intro"),
    ),
}

REGULATION_PROCEDURE_ACTION_DEFINITIONS: dict[str, RegulationProcedureActionDefinition] = {
    "apply": RegulationProcedureActionDefinition(
        action_id="apply",
        description="发起申请或提交办理请求。",
        expected_answer_roles=("procedure_step",),
    ),
    "submit_materials": RegulationProcedureActionDefinition(
        action_id="submit_materials",
        description="提交申请表、证明或其他材料。",
        expected_answer_roles=("procedure_step",),
    ),
    "college_review": RegulationProcedureActionDefinition(
        action_id="college_review",
        description="学院、院系或基层单位审核。",
        expected_answer_roles=("procedure_step",),
    ),
    "office_review": RegulationProcedureActionDefinition(
        action_id="office_review",
        description="学校职能部门复核、审批或受理。",
        expected_answer_roles=("procedure_step",),
    ),
    "publish_notice": RegulationProcedureActionDefinition(
        action_id="publish_notice",
        description="公示、公告、结果发布。",
        expected_answer_roles=("procedure_step",),
    ),
    "appeal": RegulationProcedureActionDefinition(
        action_id="appeal",
        description="申诉、复核、提出异议。",
        expected_answer_roles=("procedure_step",),
    ),
    "report_loss": RegulationProcedureActionDefinition(
        action_id="report_loss",
        description="挂失、报告遗失或停用证件。",
        expected_answer_roles=("procedure_step",),
    ),
    "reissue": RegulationProcedureActionDefinition(
        action_id="reissue",
        description="补办、补发、换发证件或材料。",
        expected_answer_roles=("procedure_step",),
    ),
    "review": RegulationProcedureActionDefinition(
        action_id="review",
        description="尚未细分为学院或学校部门审核的泛化审核动作。",
        expected_answer_roles=("procedure_step",),
    ),
    "process": RegulationProcedureActionDefinition(
        action_id="process",
        description="受理、办理、协调、处理、答复等泛化办理动作。",
        expected_answer_roles=("procedure_step",),
    ),
    "procedure_step": RegulationProcedureActionDefinition(
        action_id="procedure_step",
        description="暂未细分到更窄动作 taxonomy 的占位程序动作。",
        expected_answer_roles=("procedure_step",),
    ),
}

REGULATION_CONDITION_SUBJECT_ALIASES: dict[str, str] = {
    "discipline_relief_procedure": "application_procedure",
    "general_eligibility": "generic_condition",
}

REGULATION_PROCEDURE_ACTION_ALIASES: dict[str, str] = {}


def regulation_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def student_rules_query_planning_path() -> Path:
    return (
        regulation_repo_root()
        / "configs"
        / "ingestion"
        / "regulations"
        / "student_rules"
        / "query-planning.json"
    )


def load_student_rules_discovery_config() -> RegulationDiscoveryConfig:
    payload = _load_student_rules_query_planning_config()
    clarification_cues = tuple(
        str(cue).strip() for cue in payload.get("clarification_cues", ()) if str(cue).strip()
    )
    policy_objects: list[RegulationPolicyObjectDefinition] = []
    policy_titles: dict[str, str] = {}
    for policy_object in payload.get("policy_objects", ()):
        if not isinstance(policy_object, Mapping):
            continue
        document_id = str(policy_object.get("document_id") or "").strip()
        title = str(policy_object.get("title") or "").strip()
        if not document_id or not title:
            continue
        aliases = tuple(
            str(alias).strip() for alias in policy_object.get("aliases", ()) if str(alias).strip()
        )
        policy_objects.append(
            RegulationPolicyObjectDefinition(
                document_id=document_id,
                title=title,
                aliases=aliases,
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
        categories.append(
            RegulationCategoryDefinition(
                category_id=category_id,
                display_name=str(item.get("display_name") or "").strip(),
                aliases=tuple(
                    str(alias).strip() for alias in item.get("aliases", ()) if str(alias).strip()
                ),
                audience=str(item.get("audience") or "").strip(),
                member_policy_document_ids=member_policy_document_ids,
                overview_document_id=str(
                    item.get("overview_document_id") or member_policy_document_ids[0]
                ).strip(),
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


def regulation_categories_for_document(
    *,
    collection: str,
    document_id: str,
) -> tuple[RegulationCategoryDefinition, ...]:
    if collection != "student_rules":
        return ()
    return tuple(
        category
        for category in load_student_rules_discovery_config().categories
        if document_id in category.member_policy_document_ids
    )


def canonical_regulation_condition_subject(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    return REGULATION_CONDITION_SUBJECT_ALIASES.get(normalized, normalized)


def canonical_regulation_procedure_action(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    return REGULATION_PROCEDURE_ACTION_ALIASES.get(normalized, normalized)


def resolve_regulation_condition_subject(
    *,
    text: str,
    answer_role: str = "",
    explicit_condition_subject: str = "",
    intro_target_roles: Sequence[str] = (),
    table_fact_type: str = "",
    action_type: str = "",
    section_path: Sequence[str] = (),
) -> RegulationSemanticAssignment:
    explicit = canonical_regulation_condition_subject(explicit_condition_subject.strip())
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:condition_subject",
        )

    target_roles = {item.strip() for item in intro_target_roles if item.strip()}
    compact = _compact(text)
    compact_section_path = _compact(" ".join(item.strip() for item in section_path if item.strip()))

    if answer_role == "procedure_step":
        return RegulationSemanticAssignment(
            value="application_procedure",
            provenance="answer_role:procedure_step",
        )
    if answer_role == "eligibility_intro":
        if "procedure_step" in target_roles:
            return RegulationSemanticAssignment(
                value="application_procedure",
                provenance="intro_target_roles:procedure_step",
            )
        if "example_evidence" in target_roles:
            return RegulationSemanticAssignment(
                value="example_evidence",
                provenance="intro_target_roles:example_evidence",
            )
        if any(role in target_roles for role in ("eligibility_condition", "exception_rule")):
            return RegulationSemanticAssignment(
                value="generic_condition",
                provenance="intro_target_roles:eligibility_group",
            )
        return RegulationSemanticAssignment(
            value="generic_condition",
            provenance="answer_role:eligibility_intro",
        )
    if answer_role == "category_overview":
        return RegulationSemanticAssignment(
            value="audience_scope",
            provenance="answer_role:category_overview",
        )
    if table_fact_type == "amount_or_quota":
        return RegulationSemanticAssignment(
            value="amount_or_quota",
            provenance="table_fact_type:amount_or_quota",
        )
    if table_fact_type == "required_materials":
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="table_fact_type:required_materials",
        )
    if table_fact_type == "timeline_or_deadline":
        return RegulationSemanticAssignment(
            value="deadline",
            provenance="table_fact_type:timeline_or_deadline",
        )
    if action_type == "lift_discipline" and answer_role == "exclusion_rule":
        return RegulationSemanticAssignment(
            value="discipline_relief_exclusion",
            provenance="action_type:lift_discipline+answer_role:exclusion_rule",
        )
    if action_type == "lift_discipline" and answer_role in {
        "eligibility_condition",
        "exception_rule",
    }:
        return RegulationSemanticAssignment(
            value="discipline_relief_condition",
            provenance="action_type:lift_discipline+answer_role:positive_condition",
        )
    if any(
        marker in compact for marker in ("国家安全", "公共安全", "经济安全", "社会稳定", "学校安全")
    ):
        return RegulationSemanticAssignment(
            value="safety_or_security_restriction",
            provenance="keyword:安全稳定限制",
        )
    if any(marker in compact_section_path for marker in ("程序", "流程", "步骤", "办理")):
        return RegulationSemanticAssignment(
            value="application_procedure",
            provenance="section_path:procedure",
        )
    if any(marker in compact_section_path for marker in ("申请材料", "证明材料", "材料")):
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="section_path:materials",
        )
    if any(marker in compact_section_path for marker in ("截止", "期限", "公示", "时间")):
        return RegulationSemanticAssignment(
            value="deadline",
            provenance="section_path:deadline",
        )
    if any(marker in compact_section_path for marker in ("对象", "范围", "适用", "本科生", "学生")):
        return RegulationSemanticAssignment(
            value="audience_scope",
            provenance="section_path:audience_scope",
        )
    if answer_role == "exclusion_rule" and "处分" in compact:
        return RegulationSemanticAssignment(
            value="discipline_relief_exclusion",
            provenance="keyword:处分排除",
        )
    if any(marker in compact for marker in ("排名", "前10%", "前30%", "综合测评")):
        return RegulationSemanticAssignment(
            value="rank_threshold",
            provenance="keyword:排名综测",
        )
    if any(marker in compact for marker in ("论文", "发表", "学术研究", "专利", "竞赛")):
        return RegulationSemanticAssignment(
            value="paper_or_publication",
            provenance="keyword:论文科研",
        )
    if any(
        marker in compact
        for marker in ("精神文明", "见义勇为", "助人为乐", "奉献爱心", "服务社会", "自立自强")
    ):
        return RegulationSemanticAssignment(
            value="moral_or_social_contribution",
            provenance="keyword:德育社会贡献",
        )
    if "文艺比赛" in compact:
        return RegulationSemanticAssignment(
            value="arts_competition",
            provenance="keyword:文艺比赛",
        )
    if "体育比赛" in compact or "体育竞赛" in compact:
        return RegulationSemanticAssignment(
            value="sports_competition",
            provenance="keyword:体育比赛",
        )
    if any(marker in compact for marker in ("证明材料", "申请材料", "提交材料", "材料")):
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="keyword:材料",
        )
    if any(marker in compact for marker in ("截止", "期限", "公示", "不少于", "每周", "时间")):
        return RegulationSemanticAssignment(
            value="deadline",
            provenance="keyword:时间期限",
        )
    if any(marker in compact for marker in ("本科", "预科", "学生", "年级", "专业")):
        return RegulationSemanticAssignment(
            value="audience_scope",
            provenance="keyword:对象范围",
        )
    if answer_role == "exclusion_rule":
        if any(marker in compact for marker in ("不得超过", "不设上限", "上限")):
            return RegulationSemanticAssignment(
                value="amount_or_quota",
                provenance="keyword:额度上限",
            )
        if any(
            marker in compact
            for marker in ("不予受理", "不受理", "不予公开", "不予加分", "取消", "无资格")
        ):
            return RegulationSemanticAssignment(
                value="disqualification_or_nonacceptance",
                provenance="keyword:不予受理取消资格",
            )
        if any(marker in compact for marker in ("不得以", "无关", "不得变更", "不得修改", "禁止")):
            return RegulationSemanticAssignment(
                value="activity_scope_restriction",
                provenance="keyword:范围限制",
            )
        return RegulationSemanticAssignment(
            value="generic_restriction",
            provenance="answer_role:exclusion_rule",
        )
    if answer_role == "example_evidence":
        return RegulationSemanticAssignment(
            value="example_evidence",
            provenance="answer_role:example_evidence",
        )
    if answer_role in {"eligibility_condition", "exception_rule"}:
        return RegulationSemanticAssignment(
            value="generic_condition",
            provenance="answer_role:generic_condition",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_procedure_action(
    *,
    text: str,
    actor: str = "",
    explicit_action: str = "",
) -> RegulationSemanticAssignment:
    explicit = canonical_regulation_procedure_action(explicit_action.strip())
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:procedure_action",
        )

    compact = _compact(text)
    if "挂失" in compact:
        return RegulationSemanticAssignment(value="report_loss", provenance="keyword:挂失")
    if any(marker in compact for marker in ("补办", "补发", "补卡", "补证")):
        return RegulationSemanticAssignment(value="reissue", provenance="keyword:补办补发")
    if "申诉" in compact or "听证" in compact:
        return RegulationSemanticAssignment(value="appeal", provenance="keyword:申诉听证")
    if any(marker in compact for marker in ("报送", "备案")):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:报送备案",
        )
    if any(marker in compact for marker in ("提供", "提交", "上交")) and any(
        marker in compact for marker in ("材料", "成绩单", "大纲", "简介", "复印件", "原件")
    ):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:提交+材料",
        )
    if "提交" in compact and any(marker in compact for marker in ("材料", "申请表", "证明", "表")):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:提交+材料",
        )
    if "提交" in compact and "申请" in compact:
        return RegulationSemanticAssignment(value="apply", provenance="keyword:提交+申请")
    if any(marker in compact for marker in ("受理", "办理", "协调", "答复", "处理")):
        if "处理" in compact:
            return RegulationSemanticAssignment(value="process", provenance="keyword:处理")
        return RegulationSemanticAssignment(
            value="process",
            provenance="keyword:受理办理协调答复",
        )
    if any(marker in compact for marker in ("审核", "审批", "复审")):
        if actor == "college":
            return RegulationSemanticAssignment(
                value="college_review",
                provenance="keyword:审核+actor:college",
            )
        if actor in {"academic_affairs_office", "student_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:审核+actor:{actor}",
            )
        return RegulationSemanticAssignment(value="review", provenance="keyword:审核审批")
    if "公示" in compact:
        return RegulationSemanticAssignment(value="publish_notice", provenance="keyword:公示")
    if "申请" in compact:
        return RegulationSemanticAssignment(value="apply", provenance="keyword:申请")
    return RegulationSemanticAssignment(
        value="procedure_step", provenance="resolved:procedure_step"
    )


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value.strip())


@lru_cache(maxsize=1)
def _load_student_rules_query_planning_config() -> dict[str, object]:
    return json.loads(student_rules_query_planning_path().read_text(encoding="utf-8"))


__all__ = [
    "REGULATION_CONDITION_SUBJECT_ALIASES",
    "REGULATION_CONDITION_SUBJECT_DEFINITIONS",
    "REGULATION_PROCEDURE_ACTION_ALIASES",
    "REGULATION_PROCEDURE_ACTION_DEFINITIONS",
    "RegulationCategoryDefinition",
    "RegulationConditionSubjectDefinition",
    "RegulationDiscoveryConfig",
    "RegulationPolicyObjectDefinition",
    "RegulationProcedureActionDefinition",
    "RegulationSemanticAssignment",
    "canonical_regulation_condition_subject",
    "canonical_regulation_procedure_action",
    "load_student_rules_discovery_config",
    "regulation_categories_for_document",
    "resolve_regulation_condition_subject",
    "resolve_regulation_procedure_action",
]
