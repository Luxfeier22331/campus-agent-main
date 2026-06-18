from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from campus_evals.judge_adapters import JudgeFn, RubricJudgeAdapter
from campus_evals.models import reject_forbidden_workflow_trace_keys

DEFAULT_SCHEMA_VERSION = "quality_calibration.v1"
DEFAULT_REPORT_NAME = "quality-calibration-report.json"
DEFAULT_RUBRICS = (
    "online_answer_usefulness",
    "ocr_semantic_quality",
    "agentic_plan_quality",
)
QUALITY_CALIBRATION_RUBRICS: dict[str, dict[str, object]] = {
    "online_answer_usefulness": {
        "metric_name": "online_answer_usefulness",
        "applies_to_statuses": ["completed", "needs_clarification", "no_answer", "fail_close"],
        "system_prompt": "Grade online answer usefulness using only the supplied case and response.",
        "criteria": [
            "Answers the user-facing task directly when the task is supported.",
            "Keeps refusal or clarification behavior appropriate for unsupported or ambiguous tasks.",
            "Uses citations, cards or source URLs when the answer depends on campus source truth.",
        ],
        "score_bands": [
            {"range": "0.8-1.0", "description": "useful and source-aware"},
            {"range": "0.5-0.79", "description": "partially useful; needs owner review"},
            {"range": "0.0-0.49", "description": "not useful or unsafe"},
        ],
    },
    "ocr_semantic_quality": {
        "metric_name": "ocr_semantic_quality",
        "applies_to_statuses": ["completed"],
        "system_prompt": "Grade OCR semantic preservation using only normalized extracted text evidence.",
        "criteria": [
            "Preserves key spans, table headers and dates needed by downstream consumption.",
            "Does not promote low-confidence visual output as owner-authored regulation truth.",
            "Avoids hallucinated claims not present in the normalized artifact.",
        ],
        "score_bands": [
            {"range": "0.8-1.0", "description": "semantically faithful"},
            {"range": "0.5-0.79", "description": "usable only with review"},
            {"range": "0.0-0.49", "description": "not consumption-ready"},
        ],
    },
    "agentic_plan_quality": {
        "metric_name": "agentic_plan_quality",
        "applies_to_statuses": ["completed", "needs_clarification", "no_answer", "fail_close"],
        "system_prompt": "Grade agentic retrieval planning quality from sanitized trace and response.",
        "criteria": [
            "Selects the correct freshness, historical, as-of, compare or fail-close branch.",
            "Uses evidence-bearing steps before final answer synthesis.",
            "Fails closed when live or unsupported sources are unavailable.",
        ],
        "score_bands": [
            {"range": "0.8-1.0", "description": "plan is aligned and evidence-aware"},
            {"range": "0.5-0.79", "description": "plan is incomplete; needs review"},
            {"range": "0.0-0.49", "description": "plan is wrong or unsafe"},
        ],
    },
}


@dataclass(frozen=True, slots=True)
class QualityCalibrationObservation:
    case_id: str
    rubric: str
    score: float
    verdict: str
    rationale: str = ""

    def __post_init__(self) -> None:
        if not self.case_id.strip():
            raise ValueError("case_id is required")
        if self.rubric not in DEFAULT_RUBRICS:
            raise ValueError(f"unsupported quality calibration rubric: {self.rubric}")
        if self.verdict not in {"pass", "needs_review", "fail"}:
            raise ValueError("verdict must be pass, needs_review or fail")
        if not 0 <= self.score <= 1:
            raise ValueError("score must be between 0 and 1")
        reject_forbidden_workflow_trace_keys(asdict(self), "quality_calibration_observation")


@dataclass(frozen=True, slots=True)
class QualityCalibrationReport:
    output_path: Path
    passed: bool


def build_quality_calibration_judge_adapter(
    *,
    rubric: str,
    judge_fn: JudgeFn,
    preflight: Callable[[], object] | None = None,
) -> RubricJudgeAdapter:
    rubric_payload = QUALITY_CALIBRATION_RUBRICS.get(rubric)
    if rubric_payload is None:
        raise ValueError(f"unsupported quality calibration rubric: {rubric}")
    return RubricJudgeAdapter(
        metric_name=rubric,
        applicable_statuses=tuple(str(item) for item in rubric_payload["applies_to_statuses"]),
        rubric=rubric_payload,
        judge_fn=judge_fn,
        preflight=preflight,
    )


def run_quality_calibration_profile(
    *,
    output_dir: Path,
    observations_path: Path | None = None,
    artifact_paths: tuple[Path, ...] = (),
    git_head_resolver: Callable[[], str | None] | None = None,
) -> QualityCalibrationReport:
    observations = (
        _load_observations_from_artifacts(artifact_paths)
        if artifact_paths
        else _load_observations(observations_path)
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / DEFAULT_REPORT_NAME
    pending_review = tuple(
        observation for observation in observations if observation.verdict == "needs_review"
    )
    payload = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "profile_id": "quality_calibration",
        "report_only": True,
        "passed": True,
        "summary": {
            "total": len(observations),
            "passed": sum(1 for observation in observations if observation.verdict == "pass"),
            "failed": sum(1 for observation in observations if observation.verdict == "fail"),
            "pending_review": len(pending_review),
        },
        "rubrics": list(DEFAULT_RUBRICS),
        "pending_review_candidates": [
            {
                "case_id": observation.case_id,
                "rubric": observation.rubric,
                "score": observation.score,
                "rationale": observation.rationale,
            }
            for observation in pending_review
        ],
        "observations": [asdict(observation) for observation in observations],
        "version_summary": {
            "runtime_version": DEFAULT_SCHEMA_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
            "git_head": (git_head_resolver or _resolve_git_head)(),
        },
    }
    reject_forbidden_workflow_trace_keys(payload, "quality_calibration_report")
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return QualityCalibrationReport(output_path=output_path, passed=True)


def quality_calibration_main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("quality calibration profile is report-only and requires reruns=1")
    report = run_quality_calibration_profile(
        output_dir=Path(args.output_dir),
        observations_path=Path(args.observations_path) if args.observations_path else None,
        artifact_paths=tuple(Path(item) for item in args.artifact_path),
    )
    if args.json:
        print(json.dumps(json.loads(report.output_path.read_text(encoding="utf-8")), indent=2))
    elif args.verbose:
        print(f"quality calibration report artifact={report.output_path}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run report-only quality calibration profile.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser("accept")
    accept_parser.add_argument("--output-dir", required=True)
    accept_parser.add_argument("--reruns", type=int, default=1)
    accept_parser.add_argument("--observations-path")
    accept_parser.add_argument("--cases-path")
    accept_parser.add_argument("--collect-runtime", action="store_true")
    accept_parser.add_argument("--artifact-path", action="append", default=[])
    accept_parser.add_argument("--verbose", action="store_true")
    accept_parser.add_argument("--log-jsonl")
    accept_parser.add_argument("--json", action="store_true")
    return parser


def _load_observations(path: Path | None) -> tuple[QualityCalibrationObservation, ...]:
    if path is None:
        return ()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("quality calibration observations must be a JSON object")
    raw_observations = payload.get("observations")
    if not isinstance(raw_observations, list):
        raise ValueError("quality calibration observations must be a list")
    return tuple(_parse_observation(item) for item in raw_observations)


def _load_observations_from_artifacts(
    artifact_paths: tuple[Path, ...],
) -> tuple[QualityCalibrationObservation, ...]:
    observations: list[QualityCalibrationObservation] = []
    for path in artifact_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"{path} must contain a JSON object")
        profile_id = str(payload.get("profile_id") or "").strip()
        rubric = _rubric_for_profile(profile_id)
        raw_results = payload.get("sanitized_results")
        if not isinstance(raw_results, list):
            continue
        for result in raw_results:
            if not isinstance(result, dict):
                continue
            case_id = str(result.get("case_id") or "").strip()
            if not case_id:
                continue
            passed = bool(result.get("passed"))
            observations.append(
                QualityCalibrationObservation(
                    case_id=case_id,
                    rubric=rubric,
                    score=1.0 if passed else 0.5,
                    verdict="pass" if passed else "needs_review",
                    rationale=str(result.get("reason") or ""),
                )
            )
    return tuple(observations)


def _rubric_for_profile(profile_id: str) -> str:
    if profile_id in {"document_quality", "document-quality"}:
        return "ocr_semantic_quality"
    if profile_id in {"agentic_retrieval_plan", "agentic-retrieval-plan"}:
        return "agentic_plan_quality"
    return "online_answer_usefulness"


def _parse_observation(payload: object) -> QualityCalibrationObservation:
    item = dict(payload or {})
    return QualityCalibrationObservation(
        case_id=str(item.get("case_id") or "").strip(),
        rubric=str(item.get("rubric") or "").strip(),
        score=float(item.get("score") or 0.0),
        verdict=str(item.get("verdict") or "").strip(),
        rationale=str(item.get("rationale") or "").strip(),
    )


def _resolve_git_head() -> str | None:
    completed = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=Path(__file__).resolve().parents[4],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout.strip() or None


__all__ = [
    "DEFAULT_REPORT_NAME",
    "DEFAULT_RUBRICS",
    "DEFAULT_SCHEMA_VERSION",
    "QUALITY_CALIBRATION_RUBRICS",
    "QualityCalibrationObservation",
    "QualityCalibrationReport",
    "build_quality_calibration_judge_adapter",
    "quality_calibration_main",
    "run_quality_calibration_profile",
]
