from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal, Protocol

from campus_retrieval_core.evidence_semantics import infer_evidence_query_intent
from campus_retrieval_core.query_focus import extract_query_focus
from campus_shared.regulation_semantic_registry import load_regulation_discovery_config

from .retrieval_intent import (
    RetrievalIntent,
    retrieval_intent_for_institutional_rules_plan,
)


@dataclass(frozen=True, slots=True)
class InstitutionalRuleConsumptionEntry:
    document_id: str
    docs_nav_group: Literal["student", "public_service", "staff_governance"]
    rag_default_exposure: Literal["include", "gated"]
    title: str
    title_aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRulePolicyObjectEntry:
    document_id: str
    title: str
    title_aliases: tuple[str, ...]


class InstitutionalRuleMatchable(Protocol):
    document_id: str
    title: str
    title_aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRulesQueryPlanningConfig:
    default_nav_group: Literal["public_service", "staff_governance"]
    public_service_terms: tuple[str, ...]
    staff_governance_terms: tuple[str, ...]
    documents: tuple[InstitutionalRuleConsumptionEntry, ...]
    policy_objects: tuple[InstitutionalRulePolicyObjectEntry, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRulesQueryPlan:
    mode: Literal[
        "default_public_service",
        "default_staff_governance",
        "public_service_targeted",
        "governance_targeted",
        "title_targeted",
    ]
    normalized_query: str
    focused_query_text: str = ""
    target_document_ids: tuple[str, ...] = ()
    target_document_titles: tuple[str, ...] = ()
    category_id: str = ""
    category_member_document_ids: tuple[str, ...] = ()
    query_condition_subject: str = ""
    query_action_type: str = ""
    focus_detail_labels: tuple[str, ...] = ()
    focus_article_nos: tuple[str, ...] = ()
    focus_clause_nos: tuple[str, ...] = ()
    focus_terms: tuple[str, ...] = ()

    @property
    def rewritten_query_text(self) -> str:
        return self.normalized_query

    @property
    def task_kind(self) -> Literal["category_discovery", "specific_policy_lookup"]:
        if self.mode in {"public_service_targeted", "governance_targeted", "title_targeted"}:
            return "specific_policy_lookup"
        return "category_discovery"

    @property
    def retrieval_intent(self) -> RetrievalIntent:
        return retrieval_intent_for_institutional_rules_plan(self)


_WHITESPACE_RE = re.compile(r"\s+")
_DISCOVERY_QUERY_CUES = ("有哪些", "都有什么", "有什么", "哪些")
_CONTENT_QUERY_CUES = (
    "第",
    "条",
    "款",
    "条件",
    "要求",
    "材料",
    "流程",
    "步骤",
    "怎么办",
    "如何",
    "怎么",
    "能否",
    "能不能",
    "多少",
    "几",
)
_TITLE_PREFIX_PATTERNS = (re.compile(r"^中央民族大学"),)
_TITLE_SUFFIX_PATTERNS = (
    re.compile(
        r"(建设与运行管理办法|运行管理办法（试行）|运行管理办法|管理办法（试行）|管理办法|实施细则|规定（试行）|规定|章程|办法)$"
    ),
)
_TITLE_PARENTHESES_SUFFIX_RE = re.compile(r"([（(][^）)]{1,16}[）)])+$")
_TITLE_TERMINAL_SUFFIXES = (
    "办法",
    "规定",
    "细则",
    "章程",
    "规程",
    "规则",
    "条例",
    "规范",
    "方案",
    "计划",
)
_TITLE_SPLIT_RE = re.compile(r"[、/与和及]")
_MINIMUM_TITLE_SIGNAL_LENGTH = 2


def plan_institutional_rules_query(query_text: str) -> InstitutionalRulesQueryPlan:
    config = _load_institutional_rules_query_planning_config()
    normalized_query = _normalize_text(query_text)
    query_intent = infer_evidence_query_intent(query_text)
    query_condition_subject = query_intent.condition_subject
    query_action_type = query_intent.action_type

    matched_governance_docs = _match_documents(
        normalized_query,
        tuple(entry for entry in config.documents if entry.docs_nav_group == "staff_governance"),
    )
    if len(matched_governance_docs) == 1:
        return InstitutionalRulesQueryPlan(
            mode="governance_targeted",
            normalized_query=normalized_query,
            focused_query_text=normalized_query,
            target_document_ids=(matched_governance_docs[0].document_id,),
            query_condition_subject=query_condition_subject,
            query_action_type=query_action_type,
        )

    matched_public_service_docs = _match_documents(
        normalized_query,
        tuple(
            entry
            for entry in config.documents
            if entry.docs_nav_group == "public_service" and entry.rag_default_exposure == "include"
        ),
    )
    if _should_target_single_document(
        normalized_query=normalized_query,
        matched_documents=matched_public_service_docs,
        query_is_strong=query_intent.is_strong,
    ):
        return InstitutionalRulesQueryPlan(
            mode="public_service_targeted",
            normalized_query=normalized_query,
            focused_query_text=normalized_query,
            target_document_ids=(matched_public_service_docs[0].document_id,),
            query_condition_subject=query_condition_subject,
            query_action_type=query_action_type,
        )

    matched_policy_objects = _match_documents(normalized_query, config.policy_objects)
    if _should_target_single_document(
        normalized_query=normalized_query,
        matched_documents=matched_policy_objects,
        query_is_strong=query_intent.is_strong,
    ):
        targeted_query_intent = _infer_targeted_policy_query_intent(
            query_text=query_text,
            normalized_query=normalized_query,
            matched_document=matched_policy_objects[0],
        )
        focus = extract_query_focus(query_text)
        return InstitutionalRulesQueryPlan(
            mode="title_targeted",
            normalized_query=normalized_query,
            focused_query_text=normalized_query,
            target_document_ids=(matched_policy_objects[0].document_id,),
            target_document_titles=(matched_policy_objects[0].title,),
            query_condition_subject=targeted_query_intent.condition_subject,
            query_action_type=targeted_query_intent.action_type,
            focus_detail_labels=focus.detail_labels,
            focus_article_nos=focus.article_nos,
            focus_clause_nos=focus.clause_nos,
            focus_terms=focus.focus_terms,
        )

    if _looks_like_bare_institutional_policy_title_query(
        raw_query=query_text,
        normalized_query=normalized_query,
    ):
        stripped_query = query_text.strip()
        return InstitutionalRulesQueryPlan(
            mode="title_targeted",
            normalized_query=normalized_query,
            focused_query_text=normalized_query,
            target_document_titles=(stripped_query,),
        )

    if _contains_any(normalized_query, config.staff_governance_terms):
        return InstitutionalRulesQueryPlan(
            mode="default_staff_governance",
            normalized_query=normalized_query,
            focused_query_text=normalized_query,
            target_document_ids=staff_governance_document_ids(),
            category_id="staff_governance",
            category_member_document_ids=staff_governance_document_ids(),
            query_condition_subject=query_condition_subject,
            query_action_type=query_action_type,
        )
    public_service_ids = public_service_document_ids()
    return InstitutionalRulesQueryPlan(
        mode="default_public_service",
        normalized_query=normalized_query,
        focused_query_text=normalized_query,
        target_document_ids=public_service_ids,
        category_id=config.default_nav_group,
        category_member_document_ids=public_service_ids,
        query_condition_subject=query_condition_subject,
        query_action_type=query_action_type,
    )


def public_service_document_ids() -> tuple[str, ...]:
    return tuple(
        entry.document_id
        for entry in _load_institutional_rules_query_planning_config().documents
        if entry.docs_nav_group == "public_service" and entry.rag_default_exposure == "include"
    )


def staff_governance_document_ids() -> tuple[str, ...]:
    return tuple(
        entry.document_id
        for entry in _load_institutional_rules_query_planning_config().documents
        if entry.docs_nav_group == "staff_governance"
    )


@lru_cache(maxsize=1)
def _load_institutional_rules_query_planning_config() -> InstitutionalRulesQueryPlanningConfig:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "regulations"
        / "public-regulation-consumption.v1.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    policy = payload.get("institutional_rules_policy", {})
    documents = tuple(
        InstitutionalRuleConsumptionEntry(
            document_id=str(item["document_id"]).strip(),
            docs_nav_group=str(item["docs_nav_group"]).strip(),
            rag_default_exposure=str(item["rag_default_exposure"]).strip(),
            title=str(item["title"]).strip(),
            title_aliases=tuple(
                alias.strip()
                for alias in item.get("title_aliases", ())
                if isinstance(alias, str) and alias.strip()
            ),
        )
        for item in payload.get("documents", ())
        if isinstance(item, dict)
        and str(item.get("canonical_scope", "")).strip() == "regulations/institutional_rules"
    )
    return InstitutionalRulesQueryPlanningConfig(
        default_nav_group=str(policy.get("default_nav_group", "public_service")).strip(),
        public_service_terms=tuple(
            term.strip()
            for term in policy.get("public_service_terms", ())
            if isinstance(term, str) and term.strip()
        ),
        staff_governance_terms=tuple(
            term.strip()
            for term in policy.get("staff_governance_terms", ())
            if isinstance(term, str) and term.strip()
        ),
        documents=documents,
        policy_objects=_load_institutional_rules_policy_objects(),
    )


def _load_institutional_rules_policy_objects() -> tuple[InstitutionalRulePolicyObjectEntry, ...]:
    discovery = load_regulation_discovery_config("institutional_rules")
    return tuple(
        InstitutionalRulePolicyObjectEntry(
            document_id=policy_object.document_id,
            title=policy_object.title,
            title_aliases=policy_object.aliases,
        )
        for policy_object in discovery.policy_objects
    )


def _match_documents(
    normalized_query: str,
    documents: tuple[InstitutionalRuleMatchable, ...],
) -> tuple[InstitutionalRuleMatchable, ...]:
    scored_matches: list[tuple[InstitutionalRuleMatchable, int]] = []
    for entry in documents:
        score = _document_match_score(normalized_query, entry)
        if score > 0:
            scored_matches.append((entry, score))
    if not scored_matches:
        return ()
    scored_matches.sort(key=lambda item: item[1], reverse=True)
    top_score = scored_matches[0][1]
    return tuple(entry for entry, score in scored_matches if score == top_score)


def _should_target_single_document(
    *,
    normalized_query: str,
    matched_documents: tuple[InstitutionalRuleMatchable, ...],
    query_is_strong: bool,
) -> bool:
    if len(matched_documents) != 1:
        return False
    if query_is_strong:
        return True
    return not any(cue in normalized_query for cue in _DISCOVERY_QUERY_CUES)


def _document_match_score(
    normalized_query: str,
    entry: InstitutionalRuleMatchable,
) -> int:
    score = 0
    for candidate in (entry.title, *entry.title_aliases):
        candidate_score = _candidate_match_score(normalized_query, candidate)
        if candidate_score > score:
            score = candidate_score
    return score


def _candidate_match_score(normalized_query: str, candidate: str) -> int:
    normalized_candidate = _normalize_text(candidate)
    if normalized_candidate and normalized_candidate in normalized_query:
        return 400 + len(normalized_candidate)
    best_signal_score = 0
    for signal in _candidate_signals(candidate):
        if signal in normalized_query:
            signal_score = 200 + len(signal)
            if signal_score > best_signal_score:
                best_signal_score = signal_score
    return best_signal_score


def _infer_targeted_policy_query_intent(
    *,
    query_text: str,
    normalized_query: str,
    matched_document: InstitutionalRuleMatchable,
):
    residual_query = _matched_document_residual_query(
        normalized_query=normalized_query,
        matched_document=matched_document,
    )
    if residual_query:
        return infer_evidence_query_intent(residual_query)
    return infer_evidence_query_intent("")


def _matched_document_residual_query(
    *,
    normalized_query: str,
    matched_document: InstitutionalRuleMatchable,
) -> str:
    residuals: list[str] = []
    for candidate in (matched_document.title, *matched_document.title_aliases):
        for variant in _candidate_variants(candidate):
            normalized_variant = _normalize_text(variant)
            if normalized_variant and normalized_variant in normalized_query:
                residuals.append(normalized_query.replace(normalized_variant, "", 1))
    if not residuals:
        return normalized_query
    return min(
        (_strip_query_punctuation(residual) for residual in residuals),
        key=len,
    )


def _strip_query_punctuation(value: str) -> str:
    return str(value or "").strip("《》<>\"'“”‘’()（）[]【】:：,，.。?？/、-—_ ")


def _candidate_signals(candidate: str) -> tuple[str, ...]:
    raw_candidate = str(candidate or "").strip()
    if not raw_candidate:
        return ()
    normalized_signals: list[str] = []
    for value in _candidate_variants(raw_candidate):
        normalized_value = _normalize_text(value)
        if len(normalized_value) >= _MINIMUM_TITLE_SIGNAL_LENGTH:
            normalized_signals.append(normalized_value)
    return tuple(dict.fromkeys(normalized_signals))


def _candidate_variants(candidate: str) -> tuple[str, ...]:
    values = [candidate]
    without_prefix = candidate
    for pattern in _TITLE_PREFIX_PATTERNS:
        without_prefix = pattern.sub("", without_prefix).strip()
    if without_prefix and without_prefix not in values:
        values.append(without_prefix)
    trimmed_core = without_prefix
    for pattern in _TITLE_SUFFIX_PATTERNS:
        trimmed_core = pattern.sub("", trimmed_core).strip("（）() ")
    if trimmed_core and trimmed_core not in values:
        values.append(trimmed_core)
    for fragment in _TITLE_SPLIT_RE.split(trimmed_core):
        normalized_fragment = fragment.strip("（）() ").strip()
        if normalized_fragment and normalized_fragment not in values:
            values.append(normalized_fragment)
    return tuple(values)


def _contains_any(value: str, terms: tuple[str, ...]) -> bool:
    return any(_normalize_text(term) in value for term in terms if _normalize_text(term))


def _looks_like_bare_institutional_policy_title_query(
    *,
    raw_query: str,
    normalized_query: str,
) -> bool:
    if not raw_query.strip() or not normalized_query:
        return False
    if any(cue in normalized_query for cue in (*_DISCOVERY_QUERY_CUES, *_CONTENT_QUERY_CUES)):
        return False
    title_core = _TITLE_PARENTHESES_SUFFIX_RE.sub("", normalized_query)
    if not title_core.startswith("中央民族大学"):
        return False
    return title_core.endswith(_TITLE_TERMINAL_SUFFIXES)


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or ""))
    normalized = _WHITESPACE_RE.sub("", normalized)
    return normalized.lower()
