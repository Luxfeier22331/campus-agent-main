from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

RETRIEVAL_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION = "retrieval-qrels-denominator-policy-v1"
NORMALIZED_QRELS_DENOMINATOR_CLASSES = (
    "exact_title_or_policy_name",
    "entity_alias_or_abbreviation",
    "article_or_clause_reference",
    "long_form_semantic_answer",
    "table_or_structured_fact",
    "hard_negative",
    "no_hit",
    "authz_filtered",
    "current_only",
    "historical_version",
    "as_of_or_compare",
    "citation_backlink",
    "freshness_sensitive",
)


@dataclass(frozen=True, slots=True)
class RetrievalQrelsScopePolicy:
    scope_key: str
    fixture: str
    min_case_count: int
    required_classes: tuple[str, ...]
    required_scenarios: tuple[str, ...]
    scenario_denominator_classes: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievalQrelsDenominatorPolicy:
    schema_version: str
    normalized_denominator_classes: tuple[str, ...]
    scopes: dict[str, RetrievalQrelsScopePolicy]
    source_path: Path


def default_retrieval_qrels_denominator_policy_path(
    *, repo_root: str | Path | None = None
) -> Path:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    return root / "packages" / "evals" / "fixtures" / "retrieval_qrels_denominator_policy.v1.json"


def load_retrieval_qrels_denominator_policy(
    path: str | Path | None = None,
) -> RetrievalQrelsDenominatorPolicy:
    source_path = Path(path) if path is not None else default_retrieval_qrels_denominator_policy_path()
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    raw_scopes = payload.get("scopes")
    if not isinstance(raw_scopes, dict):
        raise ValueError("retrieval qrels denominator policy must contain scopes")
    scopes = {
        str(scope_key): _load_scope_policy(str(scope_key), raw_policy)
        for scope_key, raw_policy in raw_scopes.items()
    }
    return RetrievalQrelsDenominatorPolicy(
        schema_version=str(payload.get("schema_version") or ""),
        normalized_denominator_classes=tuple(
            str(item).strip()
            for item in payload.get("normalized_denominator_classes") or ()
            if str(item).strip()
        ),
        scopes=scopes,
        source_path=source_path,
    )


def validate_retrieval_qrels_denominator_policy(
    path: str | Path | None = None,
) -> tuple[str, ...]:
    policy = load_retrieval_qrels_denominator_policy(path)
    issues: list[str] = []
    if policy.schema_version != RETRIEVAL_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION:
        issues.append(
            "retrieval qrels denominator policy schema_version must be "
            f"{RETRIEVAL_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION}"
        )
    normalized_classes = set(policy.normalized_denominator_classes)
    for required_class in NORMALIZED_QRELS_DENOMINATOR_CLASSES:
        if required_class not in normalized_classes:
            issues.append(f"missing normalized denominator class {required_class}")
    for scope_key, scope_policy in policy.scopes.items():
        if scope_policy.min_case_count < 1:
            issues.append(f"{scope_key}: min_case_count must be greater than zero")
        if not scope_policy.fixture.strip():
            issues.append(f"{scope_key}: fixture must not be empty")
        for scenario_id in scope_policy.required_scenarios:
            denominator_classes = scope_policy.scenario_denominator_classes.get(scenario_id, ())
            if not denominator_classes:
                issues.append(
                    f"{scope_key}: required scenario {scenario_id} has no denominator class mapping"
                )
        for scenario_id, denominator_classes in scope_policy.scenario_denominator_classes.items():
            if not denominator_classes:
                issues.append(f"{scope_key}: scenario {scenario_id} has no denominator classes")
            for denominator_class in denominator_classes:
                if denominator_class not in normalized_classes:
                    issues.append(
                        f"{scope_key}: scenario {scenario_id} references unknown denominator class "
                        f"{denominator_class}"
                    )
    return tuple(issues)


def default_query_enabled_retrieval_qrels_paths(
    *,
    repo_root: str | Path | None = None,
    policy_path: str | Path | None = None,
) -> dict[str, Path]:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    policy = load_retrieval_qrels_denominator_policy(policy_path)
    fixture_root = root / "packages" / "evals" / "fixtures"
    return {
        scope_key: _resolve_fixture_path(
            fixture=scope_policy.fixture,
            fixture_root=fixture_root,
            policy_path=policy.source_path,
        )
        for scope_key, scope_policy in policy.scopes.items()
    }


def validate_default_query_enabled_qrels_coverage(
    qrels_paths: dict[str, Path] | None = None,
    *,
    policy_path: str | Path | None = None,
) -> tuple[str, ...]:
    policy = load_retrieval_qrels_denominator_policy(policy_path)
    paths = qrels_paths or default_query_enabled_retrieval_qrels_paths(policy_path=policy_path)
    issues: list[str] = list(validate_retrieval_qrels_denominator_policy(policy.source_path))
    for scope_key, scope_policy in policy.scopes.items():
        qrels_path = paths.get(scope_key)
        if qrels_path is None:
            issues.append(f"{scope_key}: missing qrels fixture")
            continue
        dataset = load_retrieval_qrels_dataset(qrels_path)
        if len(dataset.cases) < scope_policy.min_case_count:
            issues.append(
                f"{scope_key}: qrels case count {len(dataset.cases)} "
                f"below minimum {scope_policy.min_case_count}"
            )
        coverage_classes = _qrels_coverage_classes(dataset)
        for required_class in scope_policy.required_classes:
            if required_class not in coverage_classes:
                issues.append(f"{scope_key}: missing qrels coverage class {required_class}")
        declared_scenarios, scenario_issues = _declared_qrels_scenarios(qrels_path)
        issues.extend(f"{scope_key}: {issue}" for issue in scenario_issues)
        for required_scenario in scope_policy.required_scenarios:
            if required_scenario not in declared_scenarios:
                issues.append(f"{scope_key}: missing qrels scenario {required_scenario}")
        for scenario_id in declared_scenarios:
            if not scope_policy.scenario_denominator_classes.get(scenario_id):
                issues.append(
                    f"{scope_key}: qrels scenario {scenario_id} "
                    "has no denominator class mapping"
                )
    return tuple(issues)


def _load_scope_policy(scope_key: str, payload: object) -> RetrievalQrelsScopePolicy:
    if not isinstance(payload, dict):
        raise ValueError(f"qrels denominator scope policy must be an object: {scope_key}")
    raw_scenario_classes = payload.get("scenario_denominator_classes") or {}
    if not isinstance(raw_scenario_classes, dict):
        raise ValueError(f"scenario_denominator_classes must be an object: {scope_key}")
    return RetrievalQrelsScopePolicy(
        scope_key=scope_key,
        fixture=str(payload.get("fixture") or ""),
        min_case_count=int(payload.get("min_case_count") or 0),
        required_classes=_string_tuple(payload.get("required_classes")),
        required_scenarios=_string_tuple(payload.get("required_scenarios")),
        scenario_denominator_classes={
            str(scenario_id).strip(): _string_tuple(classes)
            for scenario_id, classes in raw_scenario_classes.items()
            if str(scenario_id).strip()
        },
    )


def _resolve_fixture_path(*, fixture: str, fixture_root: Path, policy_path: Path) -> Path:
    path = Path(fixture)
    if path.is_absolute():
        return path
    direct_path = fixture_root / path
    if direct_path.exists():
        return direct_path
    return policy_path.parent / path


def _qrels_coverage_classes(dataset) -> set[str]:
    coverage: set[str] = set()
    for case in dataset.cases:
        if case.expected_sources:
            coverage.add("positive")
        else:
            coverage.add("no_hit")
        if case.forbidden_sources:
            coverage.add("forbidden")
        if any(source.version_id for source in case.expected_sources):
            coverage.add("version_locked")
        if case.request_overrides:
            coverage.add("authz")
    return coverage


def _declared_qrels_scenarios(path: str | Path) -> tuple[set[str], tuple[str, ...]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    raw_scenarios = payload.get("coverage_scenarios")
    if not isinstance(raw_scenarios, dict):
        return set(), ("missing qrels coverage_scenarios",)
    cases = payload.get("cases") or ()
    case_ids = {
        str(case.get("case_id") or "").strip() for case in cases if isinstance(case, dict)
    }
    scenarios: set[str] = set()
    issues: list[str] = []
    for scenario_id, raw_case_ids in raw_scenarios.items():
        normalized_scenario_id = str(scenario_id).strip()
        if not normalized_scenario_id:
            issues.append("empty qrels scenario id")
            continue
        if not isinstance(raw_case_ids, list | tuple):
            issues.append(f"qrels scenario {normalized_scenario_id} must list case ids")
            continue
        scenario_case_ids = tuple(
            str(case_id).strip() for case_id in raw_case_ids if str(case_id).strip()
        )
        if not scenario_case_ids:
            issues.append(f"qrels scenario {normalized_scenario_id} has no cases")
            continue
        missing_case_ids = sorted(set(scenario_case_ids) - case_ids)
        if missing_case_ids:
            issues.append(
                f"qrels scenario {normalized_scenario_id} references missing cases: "
                + ", ".join(missing_case_ids)
            )
            continue
        scenarios.add(normalized_scenario_id)
    return scenarios, tuple(issues)


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return tuple()
    return tuple(str(item).strip() for item in value if str(item).strip())


__all__ = [
    "NORMALIZED_QRELS_DENOMINATOR_CLASSES",
    "RETRIEVAL_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION",
    "RetrievalQrelsDenominatorPolicy",
    "RetrievalQrelsScopePolicy",
    "default_query_enabled_retrieval_qrels_paths",
    "default_retrieval_qrels_denominator_policy_path",
    "load_retrieval_qrels_denominator_policy",
    "validate_default_query_enabled_qrels_coverage",
    "validate_retrieval_qrels_denominator_policy",
]
