from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from campus_ingestion_core.curriculum_budget_evaluation_documents import (
    load_default_curriculum_budget_evaluation_documents,
    load_historical_curriculum_budget_evaluation_documents,
    load_runtime_curriculum_budget_evaluation_documents,
)
from campus_ingestion_core.curriculum_budget_evaluation_probe import evaluate_candidate
from campus_ingestion_core.curriculum_budget_evaluation_reporting import (
    render_budget_eval_report,
)
from campus_ingestion_core.curriculum_budget_evaluation_shared import (
    CurriculumBudgetCandidate,
    CurriculumBudgetCandidateResult,
    CurriculumBudgetDocumentResult,
    CurriculumBudgetEvaluationDocument,
    CurriculumBudgetEvaluationReport,
    CurriculumBudgetIssueExample,
    CurriculumBudgetProbeCase,
    CurriculumBudgetProbeResult,
    CurriculumBudgetProbeSummary,
    CurriculumBudgetProfileSpec,
    CurriculumBudgetTokenSummary,
    build_default_curriculum_budget_candidates,
)


def evaluate_curriculum_budget_candidates(
    *,
    output_dir: Path,
    candidates: Sequence[CurriculumBudgetCandidate] | None = None,
    documents: Sequence[CurriculumBudgetEvaluationDocument] | None = None,
) -> CurriculumBudgetEvaluationReport:
    runtime_candidates = tuple(candidates or build_default_curriculum_budget_candidates())
    runtime_documents = tuple(documents or load_default_curriculum_budget_evaluation_documents())
    results = tuple(
        evaluate_candidate(candidate=candidate, documents=runtime_documents)
        for candidate in runtime_candidates
    )
    report = CurriculumBudgetEvaluationReport(
        generated_at=datetime.now(UTC).isoformat(),
        document_count=len(runtime_documents),
        candidate_count=len(results),
        candidates=results,
    )
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    (output_path / "budget-eval-matrix.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_path / "budget-eval-report.md").write_text(
        render_budget_eval_report(report=report),
        encoding="utf-8",
    )
    return report


__all__ = [
    "CurriculumBudgetCandidate",
    "CurriculumBudgetCandidateResult",
    "CurriculumBudgetDocumentResult",
    "CurriculumBudgetEvaluationDocument",
    "CurriculumBudgetEvaluationReport",
    "CurriculumBudgetIssueExample",
    "CurriculumBudgetProbeCase",
    "CurriculumBudgetProbeResult",
    "CurriculumBudgetProbeSummary",
    "CurriculumBudgetProfileSpec",
    "CurriculumBudgetTokenSummary",
    "build_default_curriculum_budget_candidates",
    "evaluate_curriculum_budget_candidates",
    "load_default_curriculum_budget_evaluation_documents",
    "load_historical_curriculum_budget_evaluation_documents",
    "load_runtime_curriculum_budget_evaluation_documents",
]
