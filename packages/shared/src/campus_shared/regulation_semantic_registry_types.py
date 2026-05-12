from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RegulationConditionSubjectDefinition:
    subject_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    query_focus_terms: tuple[str, ...] = ()
    query_focus_equivalents: tuple[tuple[str, ...], ...] = ()
    release_blocking: bool = True


@dataclass(frozen=True, slots=True)
class RegulationProcedureActionDefinition:
    action_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    release_blocking: bool = True


@dataclass(frozen=True, slots=True)
class RegulationProcedureActorDefinition:
    actor_id: str
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


@dataclass(frozen=True, slots=True)
class RegulationSemanticKeywordRule:
    value: str
    markers: tuple[str, ...]
    provenance: str
    match_mode: str = "any"
