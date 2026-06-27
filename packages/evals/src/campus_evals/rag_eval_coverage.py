from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_evals.answer_quality_contract import load_answer_quality_cases
from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset
from campus_evals.case_governance import load_denominator_registry
from campus_evals.fixture_registry import fixture_path
from campus_evals.rag_known_gap import case_count_by_surface, load_rag_known_gap_cases
from campus_evals.retrieval_qrels_policy import (
    default_query_enabled_retrieval_qrels_paths,
    load_retrieval_qrels_denominator_policy,
    validate_default_query_enabled_qrels_coverage,
)

RAG_EVAL_COVERAGE_REPORT_SCHEMA_VERSION = "rag-eval-coverage-report-v2"
RAG_EVAL_MATURITY_POLICY_SCHEMA_VERSION = "rag-eval-maturity-policy-v1"
RAG_EVAL_MATURITY_BACKLOG_SCHEMA_VERSION = "rag-eval-maturity-backlog-v1"
CURRENT_RAG_CONSUMPTION_SURFACES = (
    "regulations/student_rules",
    "regulations/institutional_rules",
    "curriculum/curriculum_plan",
    "official_web/stable_reference",
)
EXCLUDED_RAG_DENOMINATOR_SURFACES = {
    "official_web/fresh_news": "not_current_rag_consumption_surface",
}

_DETERMINISTIC_GATE_BY_SURFACE = {
    "regulations/student_rules": ("regulations-student-rules", "release_acceptance_result"),
    "regulations/institutional_rules": (
        "regulations-institutional-rules",
        "release_acceptance_result",
    ),
    "curriculum/curriculum_plan": ("curriculum-curriculum-plan", "release_acceptance_result"),
    "official_web/stable_reference": (
        "official-web-stable-reference-release",
        "release_acceptance_result",
    ),
}
_RELEASE_ACCEPTANCE_FIXTURE_BY_SURFACE = {
    "regulations/student_rules": "rag.student_rules.release_acceptance",
    "regulations/institutional_rules": "rag.institutional_rules.release_acceptance",
    "curriculum/curriculum_plan": "rag.curriculum_plan.release_acceptance",
    "official_web/stable_reference": "rag.official_web_stable_reference.release_acceptance",
}
_ANSWER_QUALITY_FIXTURE_BY_SURFACE = {
    "regulations/student_rules": "rag.student_rules.answer_quality",
    "regulations/institutional_rules": "rag.institutional_rules.answer_quality",
    "curriculum/curriculum_plan": "rag.curriculum_plan.answer_quality",
}
_GOLDEN_QRELS_FIXTURE_BY_SURFACE = {
    "regulations/institutional_rules": "rag.institutional_rules.golden_retrieval_qrels",
}
_KNOWN_GAP_FIXTURE = "ops.rag_known_gap_cases"


@dataclass(frozen=True, slots=True)
class RagEvalSurfaceCoverage:
    surface_key: str
    profile_id: str
    profile_artifact_kind: str
    qrels_fixture: str
    qrels_case_count: int
    unique_expected_doc_count: int
    release_acceptance_fixture: str
    release_acceptance_case_count: int
    has_release_baseline_gate: bool
    has_answer_quality_cases: bool
    answer_quality_case_count: int
    has_golden_qrels: bool
    golden_qrels_case_count: int
    known_gap_fixture: str
    known_gap_case_count: int
    minimum_gate_passed: bool
    maturity_status: str
    recommended_target_case_count: int
    recommended_release_acceptance_case_count: int
    recommended_unique_expected_doc_count: int
    maturity_backlog_fixture: str
    backlog_case_types: tuple[str, ...]
    gaps: tuple[str, ...]
    maturity_gaps: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RagEvalCoverageReport:
    schema_version: str
    report_id: str
    passed: bool
    minimum_gate_passed: bool
    maturity_passed: bool
    surfaces: tuple[RagEvalSurfaceCoverage, ...]
    gaps: tuple[str, ...]
    maturity_gaps: tuple[str, ...]
    excluded_surfaces: dict[str, str]


def build_rag_eval_coverage_report(
    *,
    repo_root: str | Path | None = None,
    denominator_registry_path: str | Path | None = None,
) -> RagEvalCoverageReport:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    policy = load_retrieval_qrels_denominator_policy()
    maturity_policy = _load_maturity_policy(root)
    maturity_backlog = _load_maturity_backlog(root)
    known_gap_case_set = load_rag_known_gap_cases(fixture_path(_KNOWN_GAP_FIXTURE))
    known_gap_counts = case_count_by_surface(known_gap_case_set.cases)
    policy_scope_keys = tuple(policy.scopes)
    surfaces: list[RagEvalSurfaceCoverage] = []
    gaps: list[str] = []
    maturity_gaps: list[str] = []

    if policy_scope_keys != CURRENT_RAG_CONSUMPTION_SURFACES:
        gaps.append(
            "rag qrels denominator policy must exactly match current RAG consumption surfaces"
        )
    registry = load_denominator_registry(denominator_registry_path)
    registry_rag_surfaces = tuple(
        entry.surface_id
        for entry in registry.entries
        if entry.tool_surface == "knowledge_query" and entry.admission_state == "admitted"
    )
    expected_registry_surfaces = tuple(
        _registry_surface_id(surface_key) for surface_key in CURRENT_RAG_CONSUMPTION_SURFACES
    )
    if registry_rag_surfaces != expected_registry_surfaces:
        gaps.append("rag denominator registry must exactly match current RAG consumption surfaces")

    policy_coverage_issues = validate_default_query_enabled_qrels_coverage()
    gaps.extend(f"qrels_policy:{issue}" for issue in policy_coverage_issues)

    qrels_paths = default_query_enabled_retrieval_qrels_paths(repo_root=root)
    for surface_key in CURRENT_RAG_CONSUMPTION_SURFACES:
        surface = _build_surface_coverage(
            surface_key=surface_key,
            root=root,
            qrels_path=qrels_paths.get(surface_key),
            maturity_policy=maturity_policy,
            maturity_backlog=maturity_backlog,
            known_gap_counts=known_gap_counts,
        )
        surfaces.append(surface)
        gaps.extend(f"{surface.surface_key}:{gap}" for gap in surface.gaps)
        maturity_gaps.extend(f"{surface.surface_key}:{gap}" for gap in surface.maturity_gaps)

    return RagEvalCoverageReport(
        schema_version=RAG_EVAL_COVERAGE_REPORT_SCHEMA_VERSION,
        report_id="rag_eval_coverage",
        passed=not gaps,
        minimum_gate_passed=not gaps,
        maturity_passed=not maturity_gaps,
        surfaces=tuple(surfaces),
        gaps=tuple(gaps),
        maturity_gaps=tuple(maturity_gaps),
        excluded_surfaces=dict(EXCLUDED_RAG_DENOMINATOR_SURFACES),
    )


def rag_eval_coverage_report_to_dict(report: RagEvalCoverageReport) -> dict[str, object]:
    return {
        "schema_version": report.schema_version,
        "report_id": report.report_id,
        "passed": report.passed,
        "minimum_gate_passed": report.minimum_gate_passed,
        "maturity_passed": report.maturity_passed,
        "surfaces": [asdict(surface) for surface in report.surfaces],
        "gaps": list(report.gaps),
        "maturity_gaps": list(report.maturity_gaps),
        "excluded_surfaces": dict(report.excluded_surfaces),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the RAG-only eval coverage report.")
    parser.add_argument("--output", required=True, help="Path to write coverage report JSON.")
    parser.add_argument("--json", action="store_true", help="Print the JSON report to stdout.")
    args = parser.parse_args(argv)

    report = build_rag_eval_coverage_report()
    payload = rag_eval_coverage_report_to_dict(report)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    output_path.write_text(output_text, encoding="utf-8")
    if args.json:
        print(output_text.strip())
    return 0 if report.passed else 1


def _build_surface_coverage(
    *,
    surface_key: str,
    root: Path,
    qrels_path: Path | None,
    maturity_policy: dict[str, dict[str, object]],
    maturity_backlog: dict[str, dict[str, object]],
    known_gap_counts: dict[str, int],
) -> RagEvalSurfaceCoverage:
    profile_id, profile_artifact_kind = _DETERMINISTIC_GATE_BY_SURFACE[surface_key]
    gaps: list[str] = []
    maturity_gaps: list[str] = []
    policy = maturity_policy[surface_key]
    backlog = maturity_backlog.get(surface_key, {})

    if qrels_path is None:
        qrels_fixture = ""
        qrels_case_count = 0
        unique_expected_doc_count = 0
        gaps.append("missing_qrels_fixture")
    else:
        qrels_fixture = _repo_relative(qrels_path, root)
        qrels_dataset = load_retrieval_qrels_dataset(qrels_path)
        qrels_case_count = len(qrels_dataset.cases)
        unique_expected_doc_count = len(
            {source.doc_id for case in qrels_dataset.cases for source in case.expected_sources}
        )

    release_acceptance_fixture = _RELEASE_ACCEPTANCE_FIXTURE_BY_SURFACE[surface_key]
    release_acceptance_path = fixture_path(release_acceptance_fixture)
    release_acceptance_case_count = _case_count_from_json_fixture(release_acceptance_path)
    if release_acceptance_case_count < 1:
        gaps.append("missing_release_acceptance_cases")

    answer_quality_case_count = 0
    answer_quality_fixture = _ANSWER_QUALITY_FIXTURE_BY_SURFACE.get(surface_key)
    if answer_quality_fixture:
        answer_quality_case_count = len(
            load_answer_quality_cases(fixture_path(answer_quality_fixture)).cases
        )

    golden_qrels_case_count = 0
    golden_qrels_fixture = _GOLDEN_QRELS_FIXTURE_BY_SURFACE.get(surface_key)
    if golden_qrels_fixture:
        golden_qrels_case_count = len(
            load_retrieval_qrels_dataset(fixture_path(golden_qrels_fixture)).cases
        )
    known_gap_path = fixture_path(_KNOWN_GAP_FIXTURE)
    known_gap_case_count = known_gap_counts.get(surface_key, 0)

    has_release_baseline_gate = surface_key == "regulations/institutional_rules"
    minimum_gate_passed = (
        qrels_case_count >= int(policy["minimum_qrels_case_count"])
        and release_acceptance_case_count >= int(policy["minimum_release_acceptance_case_count"])
        and not gaps
    )
    if qrels_case_count < int(policy["recommended_target_case_count"]):
        maturity_gaps.append("qrels_case_count_below_maturity_target")
    if release_acceptance_case_count < int(policy["recommended_release_acceptance_case_count"]):
        maturity_gaps.append("release_acceptance_case_count_below_maturity_target")
    if unique_expected_doc_count < int(policy["recommended_unique_expected_doc_count"]):
        maturity_gaps.append("unique_expected_doc_count_below_maturity_target")
    if bool(policy["baseline_ready_requires_answer_quality"]) and answer_quality_case_count < 1:
        maturity_gaps.append("answer_quality_cases_required_for_baseline_ready")
    maturity_status = "baseline_ready" if not maturity_gaps else "coverage_present_but_thin"
    return RagEvalSurfaceCoverage(
        surface_key=surface_key,
        profile_id=profile_id,
        profile_artifact_kind=profile_artifact_kind,
        qrels_fixture=qrels_fixture,
        qrels_case_count=qrels_case_count,
        unique_expected_doc_count=unique_expected_doc_count,
        release_acceptance_fixture=_repo_relative(release_acceptance_path, root),
        release_acceptance_case_count=release_acceptance_case_count,
        has_release_baseline_gate=has_release_baseline_gate,
        has_answer_quality_cases=answer_quality_case_count > 0,
        answer_quality_case_count=answer_quality_case_count,
        has_golden_qrels=golden_qrels_case_count > 0,
        golden_qrels_case_count=golden_qrels_case_count,
        known_gap_fixture=_repo_relative(known_gap_path, root),
        known_gap_case_count=known_gap_case_count,
        minimum_gate_passed=minimum_gate_passed,
        maturity_status=maturity_status,
        recommended_target_case_count=int(policy["recommended_target_case_count"]),
        recommended_release_acceptance_case_count=int(
            policy["recommended_release_acceptance_case_count"]
        ),
        recommended_unique_expected_doc_count=int(policy["recommended_unique_expected_doc_count"]),
        maturity_backlog_fixture=_backlog_fixture_path(policy, root),
        backlog_case_types=tuple(str(item) for item in backlog.get("case_types") or ()),
        gaps=tuple(gaps),
        maturity_gaps=tuple(maturity_gaps),
    )


def _case_count_from_json_fixture(path: Path) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases")
    return len(cases) if isinstance(cases, list) else 0


def _load_maturity_policy(root: Path) -> dict[str, dict[str, object]]:
    path = fixture_path("ops.rag_eval_maturity_policy")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != RAG_EVAL_MATURITY_POLICY_SCHEMA_VERSION:
        raise ValueError("unsupported RAG eval maturity policy schema_version")
    surfaces = payload.get("surfaces")
    if not isinstance(surfaces, dict):
        raise ValueError("RAG eval maturity policy must contain surfaces")
    missing = set(CURRENT_RAG_CONSUMPTION_SURFACES) - set(surfaces)
    if missing:
        raise ValueError("RAG eval maturity policy missing surfaces: " + ", ".join(sorted(missing)))
    return {str(key): dict(value) for key, value in surfaces.items() if isinstance(value, dict)}


def _load_maturity_backlog(root: Path) -> dict[str, dict[str, object]]:
    path = fixture_path("ops.rag_eval_maturity_backlog")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != RAG_EVAL_MATURITY_BACKLOG_SCHEMA_VERSION:
        raise ValueError("unsupported RAG eval maturity backlog schema_version")
    surfaces = payload.get("surfaces")
    if not isinstance(surfaces, dict):
        raise ValueError("RAG eval maturity backlog must contain surfaces")
    return {str(key): dict(value) for key, value in surfaces.items() if isinstance(value, dict)}


def _backlog_fixture_path(policy: dict[str, object], root: Path) -> str:
    fixture = str(policy.get("backlog_fixture") or "")
    if not fixture:
        return ""
    return _repo_relative(fixture_path(fixture), root)


def _repo_relative(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _registry_surface_id(surface_key: str) -> str:
    return {
        "regulations/student_rules": "student_rules",
        "regulations/institutional_rules": "institutional_rules",
        "curriculum/curriculum_plan": "curriculum_plan",
        "official_web/stable_reference": "official_web/stable_reference",
    }[surface_key]


__all__ = [
    "CURRENT_RAG_CONSUMPTION_SURFACES",
    "EXCLUDED_RAG_DENOMINATOR_SURFACES",
    "RAG_EVAL_COVERAGE_REPORT_SCHEMA_VERSION",
    "RAG_EVAL_MATURITY_BACKLOG_SCHEMA_VERSION",
    "RAG_EVAL_MATURITY_POLICY_SCHEMA_VERSION",
    "RagEvalCoverageReport",
    "RagEvalSurfaceCoverage",
    "build_rag_eval_coverage_report",
    "main",
    "rag_eval_coverage_report_to_dict",
]


if __name__ == "__main__":
    raise SystemExit(main())
