from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from scripts.doctor_env import collect_env_doctor_status

SCORE_REGISTRY_PATH = Path(
    "packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json"
)
EVAL_MAP_PATH = Path("docs/reference/eval-map.md")
LANGFUSE_CLI_PATH = Path("packages/eval-langfuse/src/cli.ts")
RAG_ASSET_ROOT = Path("packages/eval-langfuse/assets")
PR_WORKFLOW_PATH = Path(".github/workflows/pr.yml")
LANGFUSE_RUNTIME_CONTRACT_PATH = Path("docs/contracts/langfuse-runtime.md")
APP_API_EVAL_INGRESS_CONTRACT_PATH = Path("docs/contracts/app-api/eval-benchmark.md")
TRACE_EVIDENCE_PATH = Path("packages/eval-langfuse/src/trace-evidence.ts")
OTEL_TAXONOMY_PATH = Path("docs/reference/runtime-otel-telemetry-taxonomy.md")
ACTIVE_DOC_TOKEN_SCAN_PATHS = (
    Path("docs/contracts"),
    Path("docs/reference"),
    Path("docs/runbooks"),
)
RETIRED_SOURCE_PATHS = (
    Path("apps/execution-control/cmd/rag-first-stage-eval-runner"),
    Path("apps/execution-control/internal/rageval/first_stage_runner.go"),
    Path("apps/execution-control/internal/httpapi/rag_eval_adapter.go"),
    Path("packages/eval-langfuse/src/agent-eval-answer-facts.ts"),
    Path("packages/eval-langfuse/src/agent-eval-projection-sources.ts"),
    Path("packages/eval-langfuse/src/context-followup.ts"),
    Path("packages/eval-langfuse/src/score-report.ts"),
    Path("packages/eval-langfuse/fixtures/ops/context_followup_sample_batch.valid.v1.json"),
    Path("packages/eval-langfuse/fixtures/ops/langfuse_context_followup_dataset_manifest.v1.json"),
    Path(
        "packages/eval-langfuse/fixtures/ops/langfuse_context_followup_experiment_manifest.v1.json"
    ),
)
RETIRED_EVAL_POLICY_PATHS = (
    Path("docs/reference/eval/eval_operations_profile_policy.v1.json"),
    Path("docs/reference/eval/eval_denominator_registry.v1.json"),
    Path("docs/reference/eval/rag_eval_maturity_policy.v1.json"),
    Path("docs/reference/eval/rag_eval_maturity_backlog.v1.json"),
    Path("docs/reference/golden-dataset-case-matrix.md"),
)
ACTIVE_SOURCE_TOKEN_SCAN_PATHS = (
    Path("packages/eval-langfuse/src"),
    Path("packages/eval-langfuse/test"),
    Path("apps/app-api/src"),
    Path("apps/app-api/test"),
)
RETIRED_ACTIVE_SOURCE_TOKENS = (
    "langfuse_score_report.v1",
    "publishLangfuseScoreReport",
    "validateLangfuseScoreReport",
    "buildScoreReportFromRagasScoreBatch",
    "ragas_diagnostic",
    "ragas-diagnostic-combined-report.v1",
    "agent_rag_answer",
    "agent_multiturn_memory",
    "agent_routing_trajectory",
    "agent_retrieval_planning",
    "coverage-snapshots",
    "diagnostic-badcases",
    "langfuse_eval_coverage.v1",
    "langfuse_ragas_score",
    "langfuse_ragas_score_candidates.v1",
    "eval_coverage_snapshot",
    "eval_diagnostic_badcase_projection",
    "eval_diagnostic_badcases.v1",
    "eval_coverage_snapshot.v1",
    "lastGate",
    "releaseAcceptanceCaseCount",
    "profileArtifactKind",
    "maturityStatus",
    "maturityGaps",
    "eval_profile_gate.v1",
    "eval-release-gate.yml",
    "eval-release-gate-automation",
    "/api/operator/langfuse/eval-backlinks",
    "runLangfuseExperiment",
    "syncLangfuseAnnotationQueue",
    "exportLangfuseReviewResults",
    "langfuse_experiment_manifest",
    "langfuse_review_manifest",
)
RETIRED_ACTIVE_DOC_TOKENS = (
    "eval_coverage_snapshot.v1",
    "coverage-snapshots",
    "diagnostic-badcases",
    "langfuse_eval_coverage.v1",
    "langfuse_ragas_score",
    "langfuse_ragas_score_candidates.v1",
    "eval_coverage_snapshot",
    "eval_diagnostic_badcase_projection",
    "ragasDiagnostic",
    "lastGate",
    "releaseAcceptanceCaseCount",
    "profileArtifactKind",
    "maturityStatus",
    "maturityGaps",
    "eval_profile_gate.v1",
    "eval_operations_profile_policy",
    "eval_denominator_registry",
    "rag_eval_maturity_policy",
    "rag_eval_maturity_backlog",
    "golden-dataset-case-matrix",
)
ACTIVE_EVAL_DOC_REGRESSION_TOKENS = (
    "后续 TS qrels scorer",
    "TS qrels scorer",
    "qrels scorer",
    "future mature benchmark",
    "mature benchmark adapter",
    "eval_coverage_gate_artifacts",
    "live benchmark",
)
REQUIRED_APP_API_EVAL_MATERIALIZATION_TOKENS = (
    "internal eval materialization ingress seam",
    "materialization request",
    "Langfuse/Ragas materialized dataset run",
    "safe trace observation",
)
FORBIDDEN_APP_API_EVAL_INGRESS_TOKENS = (
    "live benchmark",
    "deterministic gate",
    "operator publish backflow",
)
RETIRED_LANGFUSE_CLI_TOKENS = (
    "build-agent-eval-case-results",
    "build-score-report-from-agent-eval",
    "build-score-report-from-rag-retrieval",
    "agent-eval-run-staging",
    "run-ragas-batch",
    "run-context-followup-batch",
    "buildScoreReportFromContextFollowupScoreBatch",
    "runContextFollowupScoreBatch",
    "build-online-answer-results",
    "build-score-report-from-online-answer",
    "build-runtime-config-results",
    "build-score-report-from-runtime-config",
    "build-ragas-sample-batch",
    "publish-score-report",
    "run-ragas-scoring",
    "closeout-staging",
    "build-release-evidence",
    "check-release-evidence",
    "run-experiment",
    "sync-annotation-queue",
    "export-review-results",
)
REQUIRED_LANGFUSE_CLI_TOKENS = (
    "ragas-score-traces",
    "ragas-score-dataset",
    "build-rag-dataset-manifest",
    "sync-datasets",
)
REQUIRED_RAGAS_PROJECTION_TOKENS = (
    "materialized for Ragas scoring",
    "ragasEvalFieldsFromTrace",
    "retrieved_contexts",
    "reference_context_ids",
)
REQUIRED_RAGAS_SCORE_NAMES = (
    "ragas.faithfulness",
    "ragas.answer_relevancy",
    "ragas.context_precision",
    "ragas.context_recall",
    "ragas.context_precision_without_reference",
    "ragas.id_context_precision",
    "ragas.id_context_recall",
)
REQUIRED_EVAL_MAP_ACTIVE_TOKENS = (
    "## Active Eval Lanes",
    "`ragas-trace`",
    "`ragas-dataset`",
    "## Retired Surfaces",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run Langfuse eval environment doctor and package/runtime audit checks."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="Run repo-owned eval environment doctor.",
    )
    doctor_parser.add_argument(
        "--repo-root",
        default=".",
        help="Repo root containing the shared .env and app directories.",
    )
    doctor_parser.add_argument("--json", action="store_true", help="Render doctor output as JSON.")

    audit_parser = subparsers.add_parser(
        "audit",
        help="Audit TS/Langfuse eval package/runtime and asset coverage.",
    )
    audit_parser.add_argument("--repo-root", default=".")
    audit_parser.add_argument("--json", action="store_true")
    return parser


def collect_langfuse_eval_status(
    *,
    repo_root: Path,
) -> dict[str, object]:
    env_doctor = collect_env_doctor_status(repo_root=repo_root, surface="evals")
    overall_ready = bool(env_doctor.get("overall_ready"))

    return {
        "surface": "langfuse_eval_audit",
        "repo_root": str(repo_root),
        "overall_ready": overall_ready,
        "env_doctor": env_doctor,
    }


def render_langfuse_eval_status_text(status: dict[str, object]) -> str:
    lines = [
        "Langfuse Eval Doctor",
        f"repo_root: {status['repo_root']}",
        f"overall_ready: {status['overall_ready']}",
        f"env_doctor_ready: {dict(status['env_doctor']).get('overall_ready')}",
    ]
    return "\n".join(lines)


def audit_langfuse_eval_configuration(*, repo_root: Path) -> dict[str, object]:
    checks = (
        _audit_retired_evals_package_absent(repo_root),
        _audit_retired_source_paths_absent(repo_root),
        _audit_score_registry_owners(repo_root),
        _audit_score_registry_required_scores_present(repo_root),
        _audit_score_registry_retired_scores_absent(repo_root),
        _audit_score_registry_release_gate_fields_absent(repo_root),
        _audit_langfuse_cli_retired_commands_absent(repo_root),
        _audit_langfuse_cli_required_commands_present(repo_root),
        _audit_ragas_projection_materialization_present(repo_root),
        _audit_retired_active_source_tokens_absent(repo_root),
        _audit_retired_active_doc_tokens_absent(repo_root),
        _audit_active_eval_doc_regression_tokens_absent(repo_root),
        _audit_app_api_eval_ingress_is_materialization_only(repo_root),
        _audit_retired_eval_policy_paths_absent(repo_root),
        _audit_retired_asset_splits_absent(repo_root),
        _audit_eval_map_retired_lanes_absent(repo_root),
        _audit_langfuse_ci_surface_contract_path(repo_root),
        _audit_unique_literal_list(
            repo_root=repo_root,
            relative_path=TRACE_EVIDENCE_PATH,
            list_name="REQUIRED_OBSERVATION_ATTRIBUTES",
            check_id="trace_evidence_required_observation_attributes_unique",
        ),
        _audit_markdown_bullet_token_unique(
            repo_root=repo_root,
            relative_path=OTEL_TAXONOMY_PATH,
            section_heading="### Runtime / Request Attributes",
            token="selected_tool",
            check_id="otel_runtime_request_selected_tool_unique",
        ),
    )
    return {
        "surface": "langfuse_eval_audit.audit",
        "passed": all(bool(check["passed"]) for check in checks),
        "checks": list(checks),
    }


def _audit_retired_evals_package_absent(repo_root: Path) -> dict[str, object]:
    retired_path = repo_root / "packages" / "evals"
    return {
        "check_id": "retired_evals_package_absent",
        "passed": not retired_path.exists(),
        "path": str(retired_path),
    }


def _audit_retired_source_paths_absent(repo_root: Path) -> dict[str, object]:
    present = [path.as_posix() for path in RETIRED_SOURCE_PATHS if (repo_root / path).exists()]
    return {
        "check_id": "retired_source_paths_absent",
        "passed": not present,
        "present": present,
    }


def _audit_score_registry_owners(repo_root: Path) -> dict[str, object]:
    registry_path = repo_root / SCORE_REGISTRY_PATH
    if not registry_path.exists():
        return {
            "check_id": "score_registry_owners",
            "passed": False,
            "missing_registry": str(registry_path),
            "retired_owners": [],
        }
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    retired_owners = sorted(
        {
            str(score.get("owner"))
            for score in payload.get("scores", [])
            if score.get("owner") == "packages/evals"
        }
    )
    return {
        "check_id": "score_registry_owners",
        "passed": not retired_owners,
        "registry": str(registry_path),
        "retired_owners": retired_owners,
    }


def _audit_score_registry_required_scores_present(repo_root: Path) -> dict[str, object]:
    registry_path = repo_root / SCORE_REGISTRY_PATH
    if not registry_path.exists():
        return {
            "check_id": "score_registry_required_scores_present",
            "passed": False,
            "missing_registry": str(registry_path),
            "missing": list(REQUIRED_RAGAS_SCORE_NAMES),
        }
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    names = {str(score.get("name")) for score in payload.get("scores", [])}
    missing = [name for name in REQUIRED_RAGAS_SCORE_NAMES if name not in names]
    return {
        "check_id": "score_registry_required_scores_present",
        "passed": not missing,
        "registry": str(registry_path),
        "missing": missing,
    }


def _audit_score_registry_retired_scores_absent(repo_root: Path) -> dict[str, object]:
    registry_path = repo_root / SCORE_REGISTRY_PATH
    if not registry_path.exists():
        return {
            "check_id": "score_registry_retired_scores_absent",
            "passed": False,
            "missing_registry": str(registry_path),
            "retired_scores": [],
        }
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    retired_scores = sorted(
        str(score.get("name"))
        for score in payload.get("scores", [])
        if str(score.get("name", "")).startswith("retrieval.")
        or str(score.get("name", "")).startswith("context.")
        or "agent_eval" in {str(kind) for kind in score.get("eval_kinds", [])}
        or "context_followup" in {str(kind) for kind in score.get("eval_kinds", [])}
    )
    return {
        "check_id": "score_registry_retired_scores_absent",
        "passed": not retired_scores,
        "registry": str(registry_path),
        "retired_scores": retired_scores,
    }


def _audit_score_registry_release_gate_fields_absent(repo_root: Path) -> dict[str, object]:
    registry_path = repo_root / SCORE_REGISTRY_PATH
    if not registry_path.exists():
        return {
            "check_id": "score_registry_release_gate_fields_absent",
            "passed": False,
            "missing_registry": str(registry_path),
            "scores": [],
        }
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    scores = sorted(
        str(score.get("name")) for score in payload.get("scores", []) if "release_gate" in score
    )
    return {
        "check_id": "score_registry_release_gate_fields_absent",
        "passed": not scores,
        "registry": str(registry_path),
        "scores": scores,
    }


def _audit_langfuse_cli_retired_commands_absent(repo_root: Path) -> dict[str, object]:
    cli_path = repo_root / LANGFUSE_CLI_PATH
    if not cli_path.exists():
        return {
            "check_id": "langfuse_cli_retired_commands_absent",
            "passed": False,
            "missing_cli": str(cli_path),
            "present": [],
        }
    text = cli_path.read_text(encoding="utf-8")
    present = [token for token in RETIRED_LANGFUSE_CLI_TOKENS if token in text]
    return {
        "check_id": "langfuse_cli_retired_commands_absent",
        "passed": not present,
        "present": present,
    }


def _audit_langfuse_cli_required_commands_present(repo_root: Path) -> dict[str, object]:
    cli_path = repo_root / LANGFUSE_CLI_PATH
    if not cli_path.exists():
        return {
            "check_id": "langfuse_cli_required_commands_present",
            "passed": False,
            "missing_cli": str(cli_path),
            "missing": list(REQUIRED_LANGFUSE_CLI_TOKENS),
        }
    text = cli_path.read_text(encoding="utf-8")
    missing = [token for token in REQUIRED_LANGFUSE_CLI_TOKENS if token not in text]
    return {
        "check_id": "langfuse_cli_required_commands_present",
        "passed": not missing,
        "missing": missing,
    }


def _audit_ragas_projection_materialization_present(repo_root: Path) -> dict[str, object]:
    path = repo_root / "packages/eval-langfuse/src/ragas-langfuse.ts"
    if not path.exists():
        return {
            "check_id": "ragas_projection_materialization_present",
            "passed": False,
            "missing_path": str(path),
            "missing": list(REQUIRED_RAGAS_PROJECTION_TOKENS),
        }
    text = path.read_text(encoding="utf-8")
    missing = [token for token in REQUIRED_RAGAS_PROJECTION_TOKENS if token not in text]
    return {
        "check_id": "ragas_projection_materialization_present",
        "passed": not missing,
        "missing": missing,
    }


def _audit_retired_active_source_tokens_absent(repo_root: Path) -> dict[str, object]:
    present: list[dict[str, str]] = []
    for relative_root in ACTIVE_SOURCE_TOKEN_SCAN_PATHS:
        root = repo_root / relative_root
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"}:
                continue
            text = path.read_text(encoding="utf-8")
            for token in RETIRED_ACTIVE_SOURCE_TOKENS:
                if token in text:
                    present.append({"path": str(path.relative_to(repo_root)), "token": token})
    return {
        "check_id": "retired_active_source_tokens_absent",
        "passed": not present,
        "present": present,
    }


def _audit_retired_active_doc_tokens_absent(repo_root: Path) -> dict[str, object]:
    present: list[dict[str, str]] = []
    for relative_root in ACTIVE_DOC_TOKEN_SCAN_PATHS:
        root = repo_root / relative_root
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in {".md", ".json"}:
                continue
            text = path.read_text(encoding="utf-8")
            for token in RETIRED_ACTIVE_DOC_TOKENS:
                if token in text:
                    present.append({"path": str(path.relative_to(repo_root)), "token": token})
    return {
        "check_id": "retired_active_doc_tokens_absent",
        "passed": not present,
        "present": present,
    }


def _audit_active_eval_doc_regression_tokens_absent(repo_root: Path) -> dict[str, object]:
    present: list[dict[str, str]] = []
    for relative_root in ACTIVE_DOC_TOKEN_SCAN_PATHS:
        root = repo_root / relative_root
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in {".md", ".json"}:
                continue
            text = path.read_text(encoding="utf-8")
            for token in ACTIVE_EVAL_DOC_REGRESSION_TOKENS:
                if token in text:
                    present.append({"path": str(path.relative_to(repo_root)), "token": token})
    return {
        "check_id": "active_eval_doc_regression_tokens_absent",
        "passed": not present,
        "present": present,
    }


def _audit_app_api_eval_ingress_is_materialization_only(repo_root: Path) -> dict[str, object]:
    path = repo_root / APP_API_EVAL_INGRESS_CONTRACT_PATH
    if not path.exists():
        return {
            "check_id": "app_api_eval_ingress_is_materialization_only",
            "passed": False,
            "missing_path": str(path),
            "missing": list(REQUIRED_APP_API_EVAL_MATERIALIZATION_TOKENS),
            "forbidden": [],
        }
    text = path.read_text(encoding="utf-8")
    missing = [token for token in REQUIRED_APP_API_EVAL_MATERIALIZATION_TOKENS if token not in text]
    forbidden = [token for token in FORBIDDEN_APP_API_EVAL_INGRESS_TOKENS if token in text]
    return {
        "check_id": "app_api_eval_ingress_is_materialization_only",
        "passed": not missing and not forbidden,
        "missing": missing,
        "forbidden": forbidden,
    }


def _audit_retired_eval_policy_paths_absent(repo_root: Path) -> dict[str, object]:
    present = [path.as_posix() for path in RETIRED_EVAL_POLICY_PATHS if (repo_root / path).exists()]
    return {
        "check_id": "retired_eval_policy_paths_absent",
        "passed": not present,
        "present": present,
    }


def _audit_retired_asset_splits_absent(repo_root: Path) -> dict[str, object]:
    root = repo_root / RAG_ASSET_ROOT
    present: list[dict[str, str]] = []
    if root.exists():
        for path in root.rglob("*.json"):
            text = path.read_text(encoding="utf-8")
            for token in ('"split": "release_gate"', '"split": "regression_locked"'):
                if token in text:
                    present.append({"path": str(path.relative_to(repo_root)), "token": token})
    return {
        "check_id": "retired_asset_splits_absent",
        "passed": not present,
        "present": present,
    }


def _audit_eval_map_retired_lanes_absent(repo_root: Path) -> dict[str, object]:
    eval_map_path = repo_root / EVAL_MAP_PATH
    if not eval_map_path.exists():
        return {
            "check_id": "eval_map_retired_lanes_absent",
            "passed": False,
            "missing_eval_map": str(eval_map_path),
            "present": [],
        }
    text = eval_map_path.read_text(encoding="utf-8")
    missing = [token for token in REQUIRED_EVAL_MAP_ACTIVE_TOKENS if token not in text]
    return {
        "check_id": "eval_map_active_lanes_are_ragas_only",
        "passed": not missing,
        "missing": missing,
    }


def _audit_langfuse_ci_surface_contract_path(repo_root: Path) -> dict[str, object]:
    workflow_path = repo_root / PR_WORKFLOW_PATH
    active_path = LANGFUSE_RUNTIME_CONTRACT_PATH.as_posix()
    retired_path = "docs/contracts/langfuse-runtime-observability-contract.md"
    if not workflow_path.exists():
        return {
            "check_id": "langfuse_ci_surface_contract_path",
            "passed": False,
            "missing_workflow": str(workflow_path),
        }
    text = workflow_path.read_text(encoding="utf-8")
    return {
        "check_id": "langfuse_ci_surface_contract_path",
        "passed": active_path in text and retired_path not in text,
        "active_path_present": active_path in text,
        "retired_path_present": retired_path in text,
    }


def _audit_unique_literal_list(
    *,
    repo_root: Path,
    relative_path: Path,
    list_name: str,
    check_id: str,
) -> dict[str, object]:
    path = repo_root / relative_path
    if not path.exists():
        return {
            "check_id": check_id,
            "passed": False,
            "missing_path": str(path),
            "duplicates": [],
        }
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"{re.escape(list_name)}\s*=\s*\[(?P<body>.*?)\];",
        text,
        re.S,
    )
    if not match:
        return {
            "check_id": check_id,
            "passed": False,
            "missing_list": list_name,
            "duplicates": [],
        }
    values = re.findall(r'"([^"]+)"', match.group("body"))
    duplicates = _duplicates(values)
    return {
        "check_id": check_id,
        "passed": not duplicates,
        "duplicates": duplicates,
    }


def _audit_markdown_bullet_token_unique(
    *,
    repo_root: Path,
    relative_path: Path,
    section_heading: str,
    token: str,
    check_id: str,
) -> dict[str, object]:
    path = repo_root / relative_path
    if not path.exists():
        return {
            "check_id": check_id,
            "passed": False,
            "missing_path": str(path),
            "count": 0,
        }
    text = path.read_text(encoding="utf-8")
    body = _markdown_section_body(text, section_heading)
    count = len(re.findall(rf"^- `{re.escape(token)}`$", body, re.M))
    return {
        "check_id": check_id,
        "passed": count == 1,
        "count": count,
    }


def _markdown_section_body(text: str, heading: str) -> str:
    escaped = re.escape(heading)
    match = re.search(rf"^{escaped}\n(?P<body>.*?)(?:\n### |\n## |\Z)", text, re.S | re.M)
    return match.group("body") if match else ""


def _duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "doctor":
        status = collect_langfuse_eval_status(
            repo_root=Path(args.repo_root).resolve(),
        )
        if args.json:
            print(json.dumps(status, ensure_ascii=False, indent=2))
        else:
            print(render_langfuse_eval_status_text(status))
        return 0 if status["overall_ready"] else 1

    if args.command == "audit":
        report = audit_langfuse_eval_configuration(repo_root=Path(args.repo_root).resolve())
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["passed"] else 1

    raise ValueError(f"unsupported langfuse eval audit command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
