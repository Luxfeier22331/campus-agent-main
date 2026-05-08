from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    REGULATION_GROUPED_ANSWER_ROLES,
    REGULATION_PROCEDURE_ACTION_DEFINITIONS,
    REGULATION_PROCEDURE_ACTOR_DEFINITIONS,
    condition_group_subject_from_group_id,
    load_regulation_discovery_config,
    resolve_regulation_condition_group_subject,
    resolve_regulation_expected_polarity,
    resolve_regulation_intro_scope,
    resolve_regulation_intro_subject,
)

ANSWER_READY_EVIDENCE_CONTRACT_VERSION = "answer_ready_evidence.v3"
ANSWER_READY_LEGACY_EVIDENCE_CONTRACT_VERSION = "answer_ready_evidence.v2"
ANSWER_READY_LEGACY_FALLBACK_PRIMARY_SIGNALS = frozenset(
    {"text_cue", "public_semantic", "public_content_role"}
)
ANSWER_READY_SCHEMA_VERSION = "answer_ready_evidence_schema.v3"
ANSWER_READY_ROLE_MATRIX_VERSION = "answer_ready_role_matrix.v3"
ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION = "condition_subject.v1"
ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION = "procedure_action.v1"
ANSWER_READY_CATEGORY_REGISTRY_VERSION = "policy_category_registry.v1"

ANSWER_READY_CONTRACT_REGULATION_SCOPES = frozenset(
    {
        ("regulations", "student_rules"),
        ("regulations", "institutional_rules"),
    }
)

ANSWER_READY_JUDGMENT_ANSWER_ROLES = frozenset(
    {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
    }
)
ANSWER_READY_GROUPED_ANSWER_ROLES = REGULATION_GROUPED_ANSWER_ROLES
ANSWER_READY_ANSWER_ROLES = ANSWER_READY_GROUPED_ANSWER_ROLES | frozenset(
    {
        "material_requirement",
        "category_overview",
        "definition",
        "supporting_detail",
    }
)
ANSWER_READY_INTRO_TARGET_ROLES = frozenset(
    {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "procedure_step",
        "material_requirement",
        "time_constraint",
    }
)
ANSWER_READY_CATEGORY_OVERVIEW_ROLES = frozenset({"category_overview", "policy_list"})
ANSWER_READY_ALLOWED_POLARITIES = frozenset({"positive", "negative", "neutral"})
ANSWER_READY_PROCEDURE_ACTIONS = frozenset(REGULATION_PROCEDURE_ACTION_DEFINITIONS)
ANSWER_READY_PROCEDURE_ACTORS = frozenset(REGULATION_PROCEDURE_ACTOR_DEFINITIONS)
ANSWER_READY_CONDITION_GROUP_SUBJECTS = frozenset(REGULATION_CONDITION_SUBJECT_DEFINITIONS)
ANSWER_READY_BASE_REQUIRED_FIELDS = ("answer_role", "parent_unit_id", "evidence_contract_version")
ANSWER_READY_JUDGMENT_REQUIRED_FIELDS = (
    "condition_subject",
    "condition_group_id",
)
ANSWER_READY_PROCEDURE_REQUIRED_FIELDS = (
    "condition_group_id",
    "condition_subject_taxonomy_version",
    "condition_subject_provenance",
    "procedure_step_index",
    "procedure_actor",
    "procedure_action",
    "procedure_action_taxonomy_version",
    "procedure_action_provenance",
)
ANSWER_READY_INTRO_REQUIRED_FIELDS = (
    "condition_group_id",
    "condition_subject",
    "condition_subject_taxonomy_version",
    "condition_subject_provenance",
    "intro_scope",
    "introduced_condition_group_id",
    "intro_target_roles",
)
ANSWER_READY_CATEGORY_OVERVIEW_REQUIRED_FIELDS = (
    "condition_subject",
    "condition_group_subject",
    "condition_subject_taxonomy_version",
    "condition_subject_provenance",
    "category_id",
    "category_registry_version",
    "audience",
    "member_policy_document_ids",
    "member_policy_titles",
)
ANSWER_READY_TABLE_FACT_REQUIRED_FIELDS = ("condition_subject",)
ANSWER_READY_REQUIRED_FIELDS_BY_ROLE: dict[str, tuple[str, ...]] = {
    "eligibility_condition": (
        *ANSWER_READY_JUDGMENT_REQUIRED_FIELDS,
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "exception_rule": (
        *ANSWER_READY_JUDGMENT_REQUIRED_FIELDS,
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "exclusion_rule": (
        *ANSWER_READY_JUDGMENT_REQUIRED_FIELDS,
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "example_evidence": (
        *ANSWER_READY_JUDGMENT_REQUIRED_FIELDS,
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "material_requirement": (
        "condition_subject",
        "condition_group_id",
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "time_constraint": (
        "condition_subject",
        "condition_group_id",
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "procedure_step": (*ANSWER_READY_PROCEDURE_REQUIRED_FIELDS, "condition_polarity"),
    "eligibility_intro": ANSWER_READY_INTRO_REQUIRED_FIELDS,
    "table_fact": (
        *ANSWER_READY_TABLE_FACT_REQUIRED_FIELDS,
        "condition_subject_taxonomy_version",
        "condition_subject_provenance",
        "condition_polarity",
    ),
    "definition": ("condition_polarity",),
    "category_overview": (*ANSWER_READY_CATEGORY_OVERVIEW_REQUIRED_FIELDS, "condition_polarity"),
}
ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS = (
    "answer_role",
    "condition_subject",
    "condition_group_subject",
    "parent_unit_id",
    "clause_unit_id",
    "evidence_contract_version",
    "semantic_role",
    "polarity",
    "action_type",
    "claim_type",
    "audience_scope",
    "article_no",
    "clause_no",
    "section_kind",
    "category_id",
    "category_audience",
    "audience",
    "category_member_document_ids",
    "member_policy_document_ids",
    "category_member_titles",
    "member_policy_titles",
    "category_registry_version",
    "condition_group_id",
    "condition_polarity",
    "condition_subject_taxonomy_version",
    "condition_subject_provenance",
    "procedure_action_taxonomy_version",
    "procedure_action_provenance",
    *ANSWER_READY_INTRO_REQUIRED_FIELDS,
    *ANSWER_READY_PROCEDURE_REQUIRED_FIELDS,
    "procedure_materials",
    "procedure_next_actor",
)


@dataclass(frozen=True, slots=True)
class AnswerReadyEvidenceValidationResult:
    status: str
    severity: str
    issues: tuple[str, ...]
    required_fields: tuple[str, ...]
    contract_version: str


@dataclass(frozen=True, slots=True)
class AnswerReadyEvidenceContractRules:
    corpus: str
    collection: str

    @property
    def applies(self) -> bool:
        return answer_ready_contract_applies(corpus=self.corpus, collection=self.collection)

    def requires_answer_role(
        self,
        *,
        metadata: Mapping[str, Any],
        content_role: str,
        unit_type: str,
    ) -> bool:
        if not self.applies:
            return False
        return bool(
            metadata.get("is_answer_bearing")
            or unit_type in {"category_overview", "table_unit"}
            or content_role
            in {"eligibility", "requirement", "procedure", "policy_list", "table_fact"}
        )

    def is_answer_ready_chunk(
        self,
        *,
        answer_role: str,
        content_role: str,
        unit_type: str,
    ) -> bool:
        if not self.applies:
            return False
        if not answer_role or answer_role == "supporting_detail":
            return False
        return bool(
            answer_role
            or unit_type in {"category_overview", "table_unit"}
            or content_role
            in {"eligibility", "requirement", "procedure", "policy_list", "table_fact"}
        )

    def requires_condition_subject(self, *, answer_role: str) -> bool:
        return self.applies and answer_role in (
            ANSWER_READY_JUDGMENT_ANSWER_ROLES
            | frozenset({"material_requirement", "time_constraint", "table_fact"})
        )

    def requires_condition_group_id(self, *, metadata: Mapping[str, Any]) -> bool:
        if not self.applies:
            return False
        answer_role = _text(metadata.get("answer_role"))
        if answer_role in {"procedure_step", "eligibility_intro"}:
            return True
        subject = _text(metadata.get("condition_subject"))
        return subject in ANSWER_READY_CONDITION_GROUP_SUBJECTS

    def requires_condition_group_subject(self, *, metadata: Mapping[str, Any]) -> bool:
        if not self.applies:
            return False
        answer_role = _text(metadata.get("answer_role"))
        return answer_role in {"procedure_step", "category_overview"}

    def is_category_overview(
        self,
        *,
        answer_role: str,
        content_role: str,
        unit_type: str,
    ) -> bool:
        if not self.applies:
            return False
        return (
            answer_role == "category_overview"
            or unit_type == "category_overview"
            or content_role == "policy_list"
        )

    def required_fields_for_role(self, *, answer_role: str) -> tuple[str, ...]:
        if not self.applies:
            return ()
        return ANSWER_READY_BASE_REQUIRED_FIELDS + ANSWER_READY_REQUIRED_FIELDS_BY_ROLE.get(
            answer_role,
            (),
        )


def answer_ready_contract_applies(*, corpus: str, collection: str) -> bool:
    return (corpus, collection) in ANSWER_READY_CONTRACT_REGULATION_SCOPES


def answer_ready_contract_rules_for_scope(
    *,
    corpus: str,
    collection: str,
) -> AnswerReadyEvidenceContractRules:
    return AnswerReadyEvidenceContractRules(corpus=corpus, collection=collection)


def validate_answer_ready_evidence_metadata(
    *,
    corpus: str,
    collection: str,
    metadata: Mapping[str, Any],
    content_role: str = "",
    unit_type: str = "",
    anchor: Mapping[str, Any] | None = None,
) -> AnswerReadyEvidenceValidationResult:
    rules = answer_ready_contract_rules_for_scope(corpus=corpus, collection=collection)
    if not rules.applies:
        return AnswerReadyEvidenceValidationResult(
            status="not_applicable",
            severity="not_applicable",
            issues=(),
            required_fields=(),
            contract_version=_text(metadata.get("evidence_contract_version")),
        )

    runtime_anchor = anchor or {}
    answer_role = _text(metadata.get("answer_role"))
    resolved_content_role = content_role or _text(metadata.get("content_role"))
    resolved_unit_type = unit_type or _text(metadata.get("unit_type"))
    contract_version = _text(metadata.get("evidence_contract_version"))
    issues: list[str] = []

    if not answer_role and rules.requires_answer_role(
        metadata=metadata,
        content_role=resolved_content_role,
        unit_type=resolved_unit_type,
    ):
        issues.append("answer_ready_answer_role_missing")
    if answer_role and answer_role not in ANSWER_READY_ANSWER_ROLES:
        issues.append("answer_ready_answer_role_unknown")

    if not rules.is_answer_ready_chunk(
        answer_role=answer_role,
        content_role=resolved_content_role,
        unit_type=resolved_unit_type,
    ):
        return AnswerReadyEvidenceValidationResult(
            status="passed" if not issues else "failed",
            severity="release_blocking" if issues else "not_answer_ready",
            issues=tuple(dict.fromkeys(issues)),
            required_fields=(),
            contract_version=contract_version,
        )

    required_fields = rules.required_fields_for_role(answer_role=answer_role)
    if contract_version == ANSWER_READY_LEGACY_EVIDENCE_CONTRACT_VERSION:
        return AnswerReadyEvidenceValidationResult(
            status="legacy",
            severity="legacy_old_index",
            issues=("answer_ready_evidence_contract_version_legacy",),
            required_fields=required_fields,
            contract_version=contract_version,
        )
    if contract_version != ANSWER_READY_EVIDENCE_CONTRACT_VERSION:
        issues.append("answer_ready_evidence_contract_version_missing")

    for field_name in required_fields:
        if field_name == "parent_unit_id":
            if not (
                _has_value(metadata.get("parent_unit_id"))
                or _has_value(runtime_anchor.get("parent_unit_id"))
            ):
                issues.append("answer_ready_parent_unit_id_missing")
            continue
        if field_name == "evidence_contract_version":
            continue
        if not _has_field_value(metadata, field_name):
            issues.append(_missing_issue_for_field(field_name))

    if (
        rules.requires_condition_group_id(metadata=metadata)
        and not _has_field_value(metadata, "condition_group_id")
        and "answer_ready_condition_group_id_missing" not in issues
    ):
        issues.append("answer_ready_condition_group_id_missing")
    if rules.requires_condition_group_subject(metadata=metadata) and not _has_field_value(
        metadata, "condition_group_subject"
    ):
        issues.append("answer_ready_condition_group_subject_missing")

    if _requires_clause_unit_identity(
        metadata=metadata,
        answer_role=answer_role,
        unit_type=resolved_unit_type,
    ) and not _has_field_value(metadata, "clause_unit_id"):
        issues.append("answer_ready_clause_unit_id_missing")

    condition_subject = _text(metadata.get("condition_subject"))
    if condition_subject and condition_subject not in ANSWER_READY_CONDITION_GROUP_SUBJECTS:
        issues.append("answer_ready_condition_subject_unknown")
    condition_subject_taxonomy_version = _text(metadata.get("condition_subject_taxonomy_version"))
    if (
        condition_subject_taxonomy_version
        and condition_subject_taxonomy_version != ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
    ):
        issues.append("answer_ready_condition_subject_taxonomy_version_unknown")
    if (
        condition_subject
        and answer_role
        and condition_subject in REGULATION_CONDITION_SUBJECT_DEFINITIONS
        and answer_role
        not in REGULATION_CONDITION_SUBJECT_DEFINITIONS[condition_subject].expected_answer_roles
    ):
        issues.append("answer_ready_condition_subject_role_conflict")
    explicit_condition_group_subject = _text(metadata.get("condition_group_subject"))
    condition_group_subject = explicit_condition_group_subject
    if not condition_group_subject:
        condition_group_subject = condition_group_subject_from_group_id(
            _text(metadata.get("condition_group_id"))
        )
    if (
        condition_group_subject
        and condition_group_subject not in ANSWER_READY_CONDITION_GROUP_SUBJECTS
    ):
        issues.append("answer_ready_condition_group_subject_unknown")
    condition_group_id = _text(metadata.get("condition_group_id"))
    parent_unit_id = _text(metadata.get("parent_unit_id")) or _text(
        runtime_anchor.get("parent_unit_id")
    )
    expected_group_subject = _expected_condition_group_subject(
        text=_text(metadata.get("display_text")) or _text(metadata.get("clean_text")),
        answer_role=answer_role,
        condition_subject=condition_subject,
        condition_group_subject=explicit_condition_group_subject,
        table_fact_type=_text(metadata.get("table_fact_type")),
        intro_target_roles=tuple(
            _text(item) for item in (metadata.get("intro_target_roles") or ()) if _text(item)
        ),
    )
    if (
        condition_group_id
        and expected_group_subject
        and not condition_group_id.endswith(f":{expected_group_subject}")
    ):
        issues.append("answer_ready_condition_group_subject_conflict")
    if (
        condition_group_id
        and parent_unit_id
        and not condition_group_id.startswith(f"{parent_unit_id}:")
    ):
        issues.append("answer_ready_condition_group_parent_conflict")
    if _has_field_value(metadata, "condition_group_key"):
        issues.append("answer_ready_condition_group_key_leaked")
    if _has_field_value(metadata, "introduced_condition_group_key"):
        issues.append("answer_ready_introduced_condition_group_key_leaked")

    if answer_role == "eligibility_intro":
        if "is_answer_bearing" not in metadata:
            issues.append("answer_ready_intro_answer_bearing_missing")
        elif metadata.get("is_answer_bearing") is not False:
            issues.append("answer_ready_intro_answer_bearing_conflict")
        intro_scope = _text(metadata.get("intro_scope"))
        intro_target_roles = tuple(
            _text(item) for item in (metadata.get("intro_target_roles") or ()) if _text(item)
        )
        if any(role not in ANSWER_READY_INTRO_TARGET_ROLES for role in intro_target_roles):
            issues.append("answer_ready_intro_target_roles_unknown")
        expected_intro_scope = _expected_intro_scope_for_target_roles(intro_target_roles)
        if expected_intro_scope and intro_scope and intro_scope != expected_intro_scope:
            issues.append("answer_ready_intro_scope_target_role_conflict")
        expected_intro_subject = _expected_intro_group_subject(
            target_roles=intro_target_roles,
            condition_subject=condition_subject,
        )
        if (
            expected_intro_subject
            and condition_subject
            and condition_subject != expected_intro_subject
        ):
            issues.append("answer_ready_intro_condition_subject_conflict")
        introduced_condition_group_id = _text(metadata.get("introduced_condition_group_id"))
        if (
            introduced_condition_group_id
            and expected_intro_subject
            and not introduced_condition_group_id.endswith(f":{expected_intro_subject}")
        ):
            issues.append("answer_ready_intro_group_subject_conflict")
        if (
            introduced_condition_group_id
            and parent_unit_id
            and not introduced_condition_group_id.startswith(f"{parent_unit_id}:")
        ):
            issues.append("answer_ready_intro_group_parent_conflict")
        if (
            introduced_condition_group_id
            and condition_group_id
            and introduced_condition_group_id != condition_group_id
        ):
            issues.append("answer_ready_intro_condition_group_id_conflict")

    polarity = _text(metadata.get("condition_polarity")) or _text(metadata.get("polarity"))
    expected_polarity = _expected_polarity_for_answer_role(
        answer_role,
        table_fact_type=_text(metadata.get("table_fact_type")),
    )
    if expected_polarity and not polarity:
        issues.append("answer_ready_condition_polarity_missing")
    if polarity and polarity not in ANSWER_READY_ALLOWED_POLARITIES:
        issues.append("answer_ready_condition_polarity_unknown")
    if expected_polarity and polarity and polarity != expected_polarity:
        issues.append("answer_ready_polarity_role_conflict")

    procedure_action = _text(metadata.get("procedure_action"))
    if procedure_action and procedure_action not in ANSWER_READY_PROCEDURE_ACTIONS:
        issues.append("answer_ready_procedure_action_unknown")
    if answer_role == "procedure_step" and procedure_action == "procedure_step":
        issues.append("answer_ready_procedure_action_generic_fallback")
    if (
        procedure_action
        and answer_role
        and procedure_action in REGULATION_PROCEDURE_ACTION_DEFINITIONS
        and answer_role
        not in REGULATION_PROCEDURE_ACTION_DEFINITIONS[procedure_action].expected_answer_roles
    ):
        issues.append("answer_ready_procedure_action_role_conflict")

    procedure_taxonomy_version = _text(metadata.get("procedure_action_taxonomy_version"))
    if (
        procedure_taxonomy_version
        and procedure_taxonomy_version != ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION
    ):
        issues.append("answer_ready_procedure_action_taxonomy_version_unknown")

    procedure_actor = _text(metadata.get("procedure_actor"))
    if procedure_actor and procedure_actor not in ANSWER_READY_PROCEDURE_ACTORS:
        issues.append("answer_ready_procedure_actor_unknown")
    if answer_role == "procedure_step" and procedure_actor == "responsible_party":
        issues.append("answer_ready_procedure_actor_generic_fallback")
    if (
        procedure_actor
        and answer_role
        and procedure_actor in REGULATION_PROCEDURE_ACTOR_DEFINITIONS
        and answer_role
        not in REGULATION_PROCEDURE_ACTOR_DEFINITIONS[procedure_actor].expected_answer_roles
    ):
        issues.append("answer_ready_procedure_actor_role_conflict")

    procedure_next_actor = _text(metadata.get("procedure_next_actor"))
    if procedure_next_actor and procedure_next_actor not in ANSWER_READY_PROCEDURE_ACTORS:
        issues.append("answer_ready_procedure_next_actor_unknown")
    if (
        procedure_next_actor
        and answer_role
        and procedure_next_actor in REGULATION_PROCEDURE_ACTOR_DEFINITIONS
        and answer_role
        not in REGULATION_PROCEDURE_ACTOR_DEFINITIONS[procedure_next_actor].expected_answer_roles
    ):
        issues.append("answer_ready_procedure_next_actor_role_conflict")

    category_registry_version = _text(metadata.get("category_registry_version"))
    if (
        category_registry_version
        and category_registry_version != ANSWER_READY_CATEGORY_REGISTRY_VERSION
    ):
        issues.append("category_overview_registry_version_unknown")
    if answer_role == "category_overview":
        category_id = _text(metadata.get("category_id"))
        if category_id:
            discovery = load_regulation_discovery_config(collection)
            category_definition = next(
                (item for item in discovery.categories if item.category_id == category_id),
                None,
            )
            if category_definition is None:
                issues.append("category_overview_category_id_unknown")
            else:
                audience = _text(metadata.get("audience")) or _text(
                    metadata.get("category_audience")
                )
                if audience and audience != category_definition.audience:
                    issues.append("category_overview_audience_registry_conflict")
                member_document_ids = _registry_member_document_ids(metadata)
                if (
                    member_document_ids
                    and member_document_ids != category_definition.member_policy_document_ids
                ):
                    issues.append("category_overview_member_documents_registry_conflict")
                member_titles = _registry_member_titles(metadata)
                if member_titles:
                    expected_titles = tuple(
                        discovery.policy_titles_by_document_id.get(document_id, "")
                        for document_id in category_definition.member_policy_document_ids
                    )
                    if member_titles != expected_titles:
                        issues.append("category_overview_member_titles_registry_conflict")

    return AnswerReadyEvidenceValidationResult(
        status="passed" if not issues else "failed",
        severity="release_blocking",
        issues=tuple(dict.fromkeys(issues)),
        required_fields=required_fields,
        contract_version=contract_version,
    )


def _has_field_value(metadata: Mapping[str, Any], field_name: str) -> bool:
    if field_name == "member_policy_document_ids":
        return _has_value(metadata.get("member_policy_document_ids")) or _has_value(
            metadata.get("category_member_document_ids")
        )
    if field_name == "member_policy_titles":
        return _has_value(metadata.get("member_policy_titles")) or _has_value(
            metadata.get("category_member_titles")
        )
    if field_name == "audience":
        return _has_value(metadata.get("audience")) or _has_value(metadata.get("category_audience"))
    return _has_value(metadata.get(field_name))


def _registry_member_document_ids(metadata: Mapping[str, Any]) -> tuple[str, ...]:
    primary = _text_sequence(metadata.get("member_policy_document_ids"))
    if primary:
        return primary
    return _text_sequence(metadata.get("category_member_document_ids"))


def _registry_member_titles(metadata: Mapping[str, Any]) -> tuple[str, ...]:
    primary = _text_sequence(metadata.get("member_policy_titles"))
    if primary:
        return primary
    return _text_sequence(metadata.get("category_member_titles"))


def _requires_clause_unit_identity(
    *,
    metadata: Mapping[str, Any],
    answer_role: str,
    unit_type: str,
) -> bool:
    if answer_role in {"eligibility_intro", "category_overview", "definition", "supporting_detail"}:
        return False
    if unit_type in {"table_unit", "table", "table_row"}:
        return False
    return bool(
        _text(metadata.get("clause_no"))
        or _single_clause_label(_text(metadata.get("provision_label")))
        or _text(metadata.get("item_label"))
    )


def _expected_polarity_for_answer_role(answer_role: str, *, table_fact_type: str = "") -> str:
    return resolve_regulation_expected_polarity(
        answer_role=answer_role,
        table_fact_type=table_fact_type,
    ).value


def _expected_intro_scope_for_target_roles(target_roles: tuple[str, ...]) -> str:
    if not target_roles:
        return ""
    return resolve_regulation_intro_scope(
        text="",
        intro_target_roles=target_roles,
    ).value


def _expected_intro_group_subject(
    *,
    target_roles: tuple[str, ...],
    condition_subject: str,
) -> str:
    return resolve_regulation_intro_subject(
        intro_target_roles=target_roles,
        fallback_condition_subject=condition_subject,
    ).value


def _expected_condition_group_subject(
    *,
    text: str,
    answer_role: str,
    condition_subject: str,
    condition_group_subject: str,
    table_fact_type: str,
    intro_target_roles: tuple[str, ...] = (),
) -> str:
    return resolve_regulation_condition_group_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_group_subject=condition_group_subject,
        fallback_condition_subject=condition_subject,
        intro_target_roles=intro_target_roles,
        table_fact_type=table_fact_type,
    ).value


def _missing_issue_for_field(field_name: str) -> str:
    return {
        "answer_role": "answer_ready_answer_role_missing",
        "parent_unit_id": "answer_ready_parent_unit_id_missing",
        "condition_subject": "answer_ready_condition_subject_missing",
        "condition_group_id": "answer_ready_condition_group_id_missing",
        "condition_subject_taxonomy_version": (
            "answer_ready_condition_subject_taxonomy_version_missing"
        ),
        "condition_subject_provenance": "answer_ready_condition_subject_provenance_missing",
        "procedure_step_index": "answer_ready_procedure_step_index_missing",
        "procedure_actor": "answer_ready_procedure_actor_missing",
        "procedure_action": "answer_ready_procedure_action_missing",
        "procedure_action_taxonomy_version": (
            "answer_ready_procedure_action_taxonomy_version_missing"
        ),
        "procedure_action_provenance": "answer_ready_procedure_action_provenance_missing",
        "intro_scope": "answer_ready_intro_scope_missing",
        "introduced_condition_group_id": "answer_ready_introduced_condition_group_id_missing",
        "intro_target_roles": "answer_ready_intro_target_roles_missing",
        "category_id": "category_overview_category_id_missing",
        "category_registry_version": "category_overview_registry_version_missing",
        "audience": "category_overview_audience_missing",
        "member_policy_document_ids": "category_overview_missing_member_document_ids",
        "member_policy_titles": "category_overview_missing_member_titles",
    }.get(field_name, f"answer_ready_{field_name}_missing")


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | tuple | set | dict):
        return (
            any(_has_value(item) for item in value) if not isinstance(value, dict) else bool(value)
        )
    return True


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _text_sequence(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        text = _text(value)
        return (text,) if text else ()
    if not isinstance(value, list | tuple):
        return ()
    items: list[str] = []
    for item in value:
        text = _text(item)
        if text:
            items.append(text)
    return tuple(items)


def _single_clause_label(value: str) -> str:
    normalized = value.strip()
    if not normalized or "-" in normalized:
        return ""
    return normalized


__all__ = [
    "ANSWER_READY_ALLOWED_POLARITIES",
    "ANSWER_READY_ANSWER_ROLES",
    "ANSWER_READY_BASE_REQUIRED_FIELDS",
    "ANSWER_READY_CATEGORY_OVERVIEW_REQUIRED_FIELDS",
    "ANSWER_READY_CATEGORY_OVERVIEW_ROLES",
    "ANSWER_READY_CATEGORY_REGISTRY_VERSION",
    "ANSWER_READY_CONDITION_GROUP_SUBJECTS",
    "ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION",
    "ANSWER_READY_CONTRACT_REGULATION_SCOPES",
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    "ANSWER_READY_GROUPED_ANSWER_ROLES",
    "ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS",
    "ANSWER_READY_INTRO_REQUIRED_FIELDS",
    "ANSWER_READY_INTRO_TARGET_ROLES",
    "ANSWER_READY_JUDGMENT_ANSWER_ROLES",
    "ANSWER_READY_JUDGMENT_REQUIRED_FIELDS",
    "ANSWER_READY_LEGACY_EVIDENCE_CONTRACT_VERSION",
    "ANSWER_READY_LEGACY_FALLBACK_PRIMARY_SIGNALS",
    "ANSWER_READY_PROCEDURE_ACTIONS",
    "ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION",
    "ANSWER_READY_PROCEDURE_ACTORS",
    "ANSWER_READY_PROCEDURE_REQUIRED_FIELDS",
    "ANSWER_READY_REQUIRED_FIELDS_BY_ROLE",
    "ANSWER_READY_ROLE_MATRIX_VERSION",
    "ANSWER_READY_SCHEMA_VERSION",
    "ANSWER_READY_TABLE_FACT_REQUIRED_FIELDS",
    "AnswerReadyEvidenceContractRules",
    "AnswerReadyEvidenceValidationResult",
    "answer_ready_contract_applies",
    "answer_ready_contract_rules_for_scope",
    "validate_answer_ready_evidence_metadata",
]
