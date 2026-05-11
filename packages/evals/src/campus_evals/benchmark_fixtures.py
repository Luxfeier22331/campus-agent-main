from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from campus_contracts import KnowledgeScope

from campus_evals.benchmark_models import (
    ALLOWED_HYBRID_QUERY_SCOPE_KEYS,
    FixtureValidationSeverity,
    RetrievalHybridQueryCase,
    RetrievalHybridQueryDataset,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    _optional_string,
)

_QRELS_QUERY_ASK_CUES = frozenset({"多少", "几年", "怎么", "如何", "安排", "什么", "哪些"})
_QRELS_WHITESPACE_RE = re.compile(r"\s+")
_PROGRAM_FAMILY_MEMBERSHIP_CUES = ("有哪些", "有哪几个", "都有哪些", "包括哪些")


def load_retrieval_hybrid_query_dataset(path: str | Path) -> RetrievalHybridQueryDataset:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    scope = KnowledgeScope(
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
    )
    cases = tuple(_load_hybrid_query_case(item) for item in payload["cases"])
    return RetrievalHybridQueryDataset(
        schema_version=int(payload["schema_version"]),
        scope=scope,
        baseline=dict(payload.get("baseline") or {}),
        cases=cases,
    )


def validate_retrieval_hybrid_query_fixture(
    path: str | Path,
    *,
    manifest_path: str | Path,
) -> tuple[str, ...]:
    dataset = load_retrieval_hybrid_query_dataset(path)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    documents = tuple(manifest.get("documents") or ())
    titles = tuple(_optional_string(item.get("title")) or "" for item in documents)
    manifest_has_entitlement_projection = any(
        bool(item.get("entitlement_groups")) for item in documents
    )
    manifest_has_visibility_scope = any(
        item.get("visibility_scope") is not None for item in documents
    )

    errors: list[str] = []
    scope_label = f"{dataset.scope.corpus}/{dataset.scope.collection}"
    for case in dataset.cases:
        if (
            case.category == "restricted_entitlement_filter" or case.scope.get("entitlement_groups")
        ) and not manifest_has_entitlement_projection:
            errors.append(
                f"case {case.case_id} requires entitlement scope, but the manifest has no "
                f"entitlement-projected {scope_label} documents"
            )
        if (
            case.category == "restricted_visibility_scope_filter"
            or case.scope.get("visibility_scope")
        ) and not manifest_has_visibility_scope:
            errors.append(
                f"case {case.case_id} requires visibility_scope, but the manifest has no "
                f"visibility-scoped {scope_label} documents"
            )
        if case.category in {
            "policy_title_exact_match",
            "fixed_phrase_sparse_win",
        } and not _case_is_grounded_in_titles(
            case,
            titles=titles,
        ):
            errors.append(
                f"case {case.case_id} category {case.category} is not grounded in any current {scope_label} title keyword"
            )
    return tuple(errors)


def validate_retrieval_qrels_fixture(
    path: str | Path,
    *,
    manifest_path: str | Path,
    ambiguity_severity: FixtureValidationSeverity = "warn",
) -> tuple[str, ...]:
    dataset = load_retrieval_qrels_dataset(path)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    documents = tuple(manifest.get("documents") or ())
    scope_label = f"{dataset.scope.corpus}/{dataset.scope.collection}"

    issues: list[str] = []
    for case in dataset.cases:
        family_alias_issue = _find_course_family_alias_qrels_issue(case)
        if family_alias_issue is not None:
            issues.append(f"{ambiguity_severity}: {family_alias_issue}")
        program_family_alias_issue = _find_program_family_alias_qrels_issue(case)
        if program_family_alias_issue is not None:
            issues.append(f"{ambiguity_severity}: {program_family_alias_issue}")
        soft_personalization_issue = _find_soft_personalization_qrels_issue(case)
        if soft_personalization_issue is not None:
            issues.append(f"{ambiguity_severity}: {soft_personalization_issue}")
        matched_titles = _find_ambiguous_manifest_title_matches(case.query, documents=documents)
        if len(matched_titles) < 2 or not case.expected_sources:
            continue
        issues.append(
            f"{ambiguity_severity}: case {case.case_id} query {case.query!r} ambiguously matches "
            f"{len(matched_titles)} current {scope_label} titles "
            f"({', '.join(item.title for item in matched_titles[:3])}); canonical qrels must not lock this "
            f"to a single retrieval truth. Move it to a needs_clarification workflow case or diagnostic fixture."
        )
    return tuple(issues)


def load_retrieval_qrels_dataset(path: str | Path) -> RetrievalQrelsDataset:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    scope = KnowledgeScope(
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
    )
    coverage_scenarios = payload.get("coverage_scenarios") or {}
    cases = tuple(
        _load_case(
            item,
            default_scope=scope,
            supplemental_metric_overrides=_case_metric_overrides(
                item,
                default_scope=scope,
                coverage_scenarios=coverage_scenarios,
            ),
        )
        for item in payload["cases"]
    )
    return RetrievalQrelsDataset(
        schema_version=int(payload["schema_version"]),
        scope=scope,
        baseline=dict(payload.get("baseline") or {}),
        cases=cases,
    )


def resolve_retrieval_fixture_manifest_path(path: str | Path) -> Path:
    dataset = load_retrieval_qrels_dataset(path)
    repo_root = Path(__file__).resolve().parents[4]
    collection_root = (
        repo_root / "configs" / "ingestion" / dataset.scope.corpus / dataset.scope.collection
    )
    manifest_path = collection_root / "split-manifest.v1.json"
    if manifest_path.exists():
        return manifest_path
    manifest_path = collection_root / "retrieval-eval-manifest.v1.json"
    if not manifest_path.exists():
        raise FileNotFoundError(
            "unable to resolve retrieval fixture manifest for "
            f"{dataset.scope}: expected split-manifest.v1.json or "
            f"retrieval-eval-manifest.v1.json under {collection_root}"
        )
    return manifest_path


def _find_course_family_alias_qrels_issue(case: RetrievalQrelsCase) -> str | None:
    normalized_query = _fixture_query_key(case.query)
    if not any(alias in normalized_query for alias in _load_course_family_aliases()):
        return None
    if not any(
        cue in case.query
        for cue in (
            "哪些专业要上",
            "包括哪些课",
            "哪些课",
            "谁要上",
            "第几学期开",
            "什么学期开",
            "哪学期开",
            "开设学期",
        )
    ):
        return None
    if not case.expected_sources:
        return None
    if len(case.expected_sources) != 1:
        return None
    expected = case.expected_sources[0]
    if expected.doc_id != "curriculum:中央民族大学通识课程思想政治理论课教学计划":
        return None
    return (
        f"case {case.case_id} query {case.query!r} uses course-family alias truth; canonical qrels must not lock this "
        "to a single-course or single-doc retrieval truth. Move it to a family-aware completed case or needs_clarification fixture."
    )


def _find_program_family_alias_qrels_issue(case: RetrievalQrelsCase) -> str | None:
    normalized_query = _fixture_query_key(case.query)
    if not any(cue in normalized_query for cue in _PROGRAM_FAMILY_MEMBERSHIP_CUES):
        return None
    if not any(
        any(alias in normalized_query for alias in aliases)
        for aliases in _load_program_family_aliases()
    ):
        return None
    if not case.expected_sources:
        return None
    return (
        f"case {case.case_id} query {case.query!r} uses program-family alias truth; canonical qrels must not lock this "
        "to a single program doc truth. Move it to a family-aware completed case or needs_clarification fixture."
    )


def _find_soft_personalization_qrels_issue(case: RetrievalQrelsCase) -> str | None:
    normalized_query = _fixture_query_key(case.query)
    if len(case.expected_sources) != 1:
        return None
    if not _request_uses_soft_personalization_only(case.request_overrides):
        return None
    if not _query_uses_family_alias(normalized_query):
        return None

    return (
        f"case {case.case_id} query {case.query!r} uses soft personalization alone; canonical qrels must not let "
        "recent_goal, confirmed_slot_terms, or profile memory collapse family alias ambiguity into single-doc truth."
    )


def _request_uses_soft_personalization_only(request_overrides: dict[str, object]) -> bool:
    if not isinstance(request_overrides, dict):
        return False
    has_soft_personalization = _mapping_contains_non_empty_key(
        request_overrides,
        {"recent_goal", "confirmed_slot_terms", "confirmed_slots", "profile_memory"},
    )
    if not has_soft_personalization:
        return False
    if _mapping_contains_non_empty_key(request_overrides, {"verified_major"}):
        return False
    actor = request_overrides.get("actor")
    if isinstance(actor, dict):
        actor_major = actor.get("major")
        if isinstance(actor_major, str) and actor_major.strip():
            return False
    return True


def _mapping_contains_non_empty_key(payload: object, keys: set[str]) -> bool:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in keys and _value_is_non_empty(value):
                return True
            if _mapping_contains_non_empty_key(value, keys):
                return True
        return False
    if isinstance(payload, (list, tuple)):
        return any(_mapping_contains_non_empty_key(item, keys) for item in payload)
    return False


def _value_is_non_empty(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(_value_is_non_empty(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return any(_value_is_non_empty(item) for item in value)
    return value is not None


def _query_uses_family_alias(normalized_query: str) -> bool:
    if any(alias in normalized_query for alias in _load_course_family_aliases()):
        return True
    return any(
        any(alias in normalized_query for alias in aliases)
        for aliases in _load_program_family_aliases()
    )


@lru_cache(maxsize=1)
def _load_course_family_aliases() -> tuple[str, ...]:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "course_facts"
        / "alias-governance.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    aliases: list[str] = []
    for item in payload.get("entities", ()):
        if not isinstance(item, dict):
            continue
        if str(item.get("entity_type", "")).strip() != "course_family":
            continue
        for alias in item.get("aliases", ()):
            if isinstance(alias, str) and alias.strip():
                aliases.append(alias.strip())
    return tuple(dict.fromkeys(aliases))


@lru_cache(maxsize=1)
def _load_program_family_aliases() -> tuple[tuple[str, ...], ...]:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "program_family_facts"
        / "family-governance.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    aliases: list[tuple[str, ...]] = []
    for item in payload.get("families", ()):
        if not isinstance(item, dict):
            continue
        match_aliases = tuple(
            value.strip()
            for value in item.get("match_aliases", ())
            if isinstance(value, str) and value.strip()
        )
        if match_aliases:
            aliases.append(match_aliases)
    return tuple(aliases)


def _load_case(
    payload: dict[str, object],
    *,
    default_scope: KnowledgeScope,
    supplemental_metric_overrides: dict[str, bool] | None = None,
) -> RetrievalQrelsCase:
    raw_scope = payload.get("scope")
    if isinstance(raw_scope, dict):
        scope = KnowledgeScope(
            corpus=str(raw_scope.get("corpus") or default_scope.corpus),
            collection=str(raw_scope.get("collection") or default_scope.collection),
        )
    else:
        scope = default_scope
    return RetrievalQrelsCase(
        case_id=str(payload["case_id"]),
        split=str(payload["split"]),
        query=str(payload["query"]),
        scope=scope,
        request_overrides=dict(payload.get("request_overrides") or {}),
        supplemental_metric_overrides=dict(
            payload.get("supplemental_metric_overrides") or supplemental_metric_overrides or {}
        ),
        expected_sources=tuple(
            _load_source_ref(item) for item in payload.get("expected_sources") or ()
        ),
        forbidden_sources=tuple(
            _load_source_ref(item) for item in payload.get("forbidden_sources") or ()
        ),
        notes=str(payload.get("notes") or ""),
    )


def _load_hybrid_query_case(payload: dict[str, object]) -> RetrievalHybridQueryCase:
    category = str(payload["category"])
    scope = dict(payload.get("scope") or {})
    unsupported_scope_keys = tuple(
        key for key in scope if key not in ALLOWED_HYBRID_QUERY_SCOPE_KEYS
    )
    if unsupported_scope_keys:
        joined = ", ".join(unsupported_scope_keys)
        raise ValueError(f"unsupported hybrid fixture scope keys: {joined}")

    return RetrievalHybridQueryCase(
        case_id=str(payload["case_id"]),
        category=category,
        query=str(payload["query"]),
        scope=scope,
        expected_status=str(
            payload.get("expected_status") or _default_hybrid_expected_status(category)
        ),
        expected_keywords=tuple(str(item) for item in payload.get("expected_keywords") or ()),
        forbidden_doc_ids=tuple(str(item) for item in payload.get("forbidden_doc_ids") or ()),
        notes=str(payload.get("notes") or ""),
    )


def _case_metric_overrides(
    payload: dict[str, object],
    *,
    default_scope: KnowledgeScope,
    coverage_scenarios: object,
) -> dict[str, bool]:
    if not isinstance(coverage_scenarios, dict):
        return {}
    case_id = str(payload.get("case_id") or "").strip()
    if not case_id:
        return {}
    if _case_is_title_lookup(payload, default_scope=default_scope):
        return _identity_grounding_metric_overrides()
    if _case_asks_for_governing_document(payload):
        return _identity_grounding_metric_overrides()
    for scenario_id, raw_case_ids in coverage_scenarios.items():
        if not isinstance(raw_case_ids, list | tuple):
            continue
        if case_id not in {str(item).strip() for item in raw_case_ids}:
            continue
        if scenario_id in {
            "policy_title_exact_match",
            "article_number_exact_match",
            "institutional_policy_title",
        }:
            return _identity_grounding_metric_overrides()
        if scenario_id == "program_title":
            return {"answer_relevancy": False}
    return {}


def _case_is_title_lookup(payload: dict[str, object], *, default_scope: KnowledgeScope) -> bool:
    if default_scope.corpus != "regulations":
        return False
    if default_scope.collection not in {"student_rules", "institutional_rules"}:
        return False
    query = str(payload.get("query") or "").strip()
    if not query:
        return False
    if any(cue in query for cue in ("怎么", "如何", "多少", "几")):
        return False
    return query.endswith(("办法", "规定", "方案", "计划", "章程", "条例"))


def _case_asks_for_governing_document(payload: dict[str, object]) -> bool:
    query = str(payload.get("query") or "").strip()
    if not query:
        return False
    return any(
        cue in query
        for cue in (
            "哪份管理办法",
            "哪份办法",
            "哪个管理办法",
            "哪个办法",
            "依据哪份",
            "依据哪个",
        )
    )


def _identity_grounding_metric_overrides() -> dict[str, bool]:
    return {
        "answer_relevancy": False,
        "faithfulness": False,
        "identity_grounding": True,
    }


def _default_hybrid_expected_status(category: str) -> str:
    if category == "no_hit":
        return "no_answer"
    if category == "needs_clarification":
        return "needs_clarification"
    return "completed"


def _load_source_ref(payload: dict[str, object]) -> RetrievalQrelsSourceRef:
    return RetrievalQrelsSourceRef(
        doc_id=str(payload["doc_id"]),
        version_id=_optional_string(payload.get("version_id")),
        chunk_id=_optional_string(payload.get("chunk_id")),
        grade=int(payload.get("grade") or 1),
        rationale=str(payload.get("rationale") or ""),
    )


def _case_is_grounded_in_titles(case: RetrievalHybridQueryCase, *, titles: tuple[str, ...]) -> bool:
    terms = (case.query, *case.expected_keywords)
    normalized_terms = tuple(term.strip() for term in terms if term.strip())
    return any(term in title for title in titles for term in normalized_terms)


@dataclass(frozen=True, slots=True)
class _ManifestTitleMatch:
    doc_id: str
    title: str


def _find_ambiguous_manifest_title_matches(
    query: str,
    *,
    documents: tuple[dict[str, object], ...],
) -> tuple[_ManifestTitleMatch, ...]:
    query_key = _fixture_query_key(query)
    if not _query_can_lock_ambiguous_title_truth(query_key):
        return ()

    matches: list[_ManifestTitleMatch] = []
    for item in documents:
        title = _manifest_document_title(item)
        if not title:
            continue
        if any(query_key in title_key for title_key in _fixture_title_keys(title)):
            matches.append(
                _ManifestTitleMatch(
                    doc_id=str(item.get("document_id") or "").strip(),
                    title=title,
                )
            )
    return tuple(dict.fromkeys(matches))


def _manifest_document_title(payload: dict[str, object]) -> str:
    title = _optional_string(payload.get("title"))
    if title is not None:
        return title
    doc_id = _optional_string(payload.get("document_id"))
    if doc_id is None:
        return ""
    return doc_id.split(":", 1)[-1]


def _query_can_lock_ambiguous_title_truth(query_key: str) -> bool:
    if not query_key:
        return False
    if any(cue in query_key for cue in _QRELS_QUERY_ASK_CUES):
        return False
    cjk_length = sum(1 for char in query_key if _is_cjk_char(char))
    return 0 < cjk_length <= 8


def _fixture_query_key(text: str) -> str:
    normalized = _QRELS_WHITESPACE_RE.sub(" ", text).strip().lower()
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _fixture_title_keys(text: str) -> tuple[str, ...]:
    key = _fixture_query_key(text)
    return (key,) if key else ()


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


__all__ = [
    "load_retrieval_hybrid_query_dataset",
    "load_retrieval_qrels_dataset",
    "resolve_retrieval_fixture_manifest_path",
    "validate_retrieval_hybrid_query_fixture",
    "validate_retrieval_qrels_fixture",
]
