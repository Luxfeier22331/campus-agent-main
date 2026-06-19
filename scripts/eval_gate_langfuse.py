from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable
from pathlib import Path

from campus_evals.langfuse_adapter import LangfuseAdapterSettings, derive_langfuse_trace_id
from campus_evals.langfuse_score_report import DEFAULT_REGISTRY_PATH


def add_langfuse_eval_gate_parsers(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    publish_langfuse_profile_parser = subparsers.add_parser(
        "publish-langfuse-profile",
        help="Publish sanitized profile-report.json scores to Langfuse.",
    )
    publish_langfuse_profile_parser.add_argument(
        "--profile-report",
        required=True,
        help="profile-report.json path produced by an eval profile gate.",
    )
    publish_langfuse_profile_parser.add_argument("--json", action="store_true")

    build_profile_score_report_parser = subparsers.add_parser(
        "build-langfuse-score-report-from-profile",
        help="Convert a profile-report.json artifact into a generic Langfuse score report.",
    )
    build_profile_score_report_parser.add_argument(
        "--profile-report",
        required=True,
        help="profile-report.json path produced by an eval profile gate.",
    )
    build_profile_score_report_parser.add_argument(
        "--output",
        required=True,
        help="Output langfuse-score-report.json path.",
    )
    build_profile_score_report_parser.add_argument("--json", action="store_true")

    publish_langfuse_score_report_parser = subparsers.add_parser(
        "publish-langfuse-score-report",
        help="Validate or publish a generic sanitized Langfuse score report.",
    )
    publish_langfuse_score_report_parser.add_argument(
        "--score-report",
        required=True,
        help="langfuse-score-report.json path produced by a repo-owned eval.",
    )
    publish_langfuse_score_report_parser.add_argument("--dry-run", action="store_true")
    publish_langfuse_score_report_parser.add_argument("--validate-only", action="store_true")
    publish_langfuse_score_report_parser.add_argument("--json", action="store_true")

    score_config_parser = subparsers.add_parser(
        "sync-langfuse-score-configs",
        help="Sync repo-owned score registry into Langfuse score configs.",
    )
    score_config_parser.add_argument(
        "--registry",
        default=str(DEFAULT_REGISTRY_PATH),
        help="Score registry JSON path.",
    )
    score_config_parser.add_argument("--dry-run", action="store_true")
    score_config_parser.add_argument("--json", action="store_true")

    dataset_parser = subparsers.add_parser(
        "sync-langfuse-datasets",
        help="Sync repo-owned sanitized fixtures into Langfuse datasets.",
    )
    dataset_parser.add_argument("--dataset-manifest", required=True)
    dataset_parser.add_argument("--dry-run", action="store_true")
    dataset_parser.add_argument("--json", action="store_true")

    experiment_parser = subparsers.add_parser(
        "run-langfuse-experiment",
        help="Run a repo-owned experiment and write Langfuse dataset-run evidence.",
    )
    experiment_parser.add_argument("--experiment-manifest", required=True)
    experiment_parser.add_argument("--json", action="store_true")

    rag_sweep_parser = subparsers.add_parser(
        "run-rag-first-stage-parameter-sweep",
        help="Aggregate RAG first-stage candidate results into a sweep report.",
    )
    rag_sweep_parser.add_argument("--qrels", action="append", required=True)
    rag_sweep_parser.add_argument("--candidate-result", action="append", required=True)
    rag_sweep_parser.add_argument("--output-dir", required=True)
    rag_sweep_parser.add_argument("--environment", required=True)
    rag_sweep_parser.add_argument("--release", required=True)
    rag_sweep_parser.add_argument("--source-git-head", required=True)
    rag_sweep_parser.add_argument("--dataset-run-id", required=True)
    rag_sweep_parser.add_argument("--json", action="store_true")

    review_sync_parser = subparsers.add_parser(
        "sync-langfuse-annotation-queue",
        help="Sync low-score review candidates into a Langfuse annotation queue.",
    )
    review_sync_parser.add_argument("--review-manifest", required=True)
    review_sync_parser.add_argument("--dry-run", action="store_true")
    review_sync_parser.add_argument("--json", action="store_true")

    review_export_parser = subparsers.add_parser(
        "export-langfuse-review-results",
        help="Export completed Langfuse annotation queue results into a repo artifact.",
    )
    review_export_parser.add_argument("--review-manifest", required=True)
    review_export_parser.add_argument("--output", required=True)
    review_export_parser.add_argument("--json", action="store_true")

    verify_langfuse_trace_parser = subparsers.add_parser(
        "verify-langfuse-trace",
        help="Verify a real online answer trace reached Langfuse.",
    )
    trace_id_group = verify_langfuse_trace_parser.add_mutually_exclusive_group(required=True)
    trace_id_group.add_argument("--trace-id")
    trace_id_group.add_argument(
        "--product-trace-id",
        help="Repo-owned product trace_id to derive the Langfuse trace id from.",
    )
    verify_langfuse_trace_parser.add_argument("--session-id", required=True)
    verify_langfuse_trace_parser.add_argument("--user-id", required=True)
    verify_langfuse_trace_parser.add_argument("--release", required=True)
    verify_langfuse_trace_parser.add_argument("--request-id")
    verify_langfuse_trace_parser.add_argument("--run-id")
    verify_langfuse_trace_parser.add_argument("--workflow-id")
    verify_langfuse_trace_parser.add_argument("--tag", action="append", default=[])
    verify_langfuse_trace_parser.add_argument("--json", action="store_true")


def handle_langfuse_eval_gate_command(
    args: argparse.Namespace,
    *,
    settings_factory: Callable[[], LangfuseAdapterSettings],
    publish_profile: Callable[..., dict[str, object]],
    publish_score_report: Callable[..., dict[str, object]],
    verify_trace: Callable[..., dict[str, object]],
) -> dict[str, object] | None:
    if args.command == "publish-langfuse-profile":
        return publish_profile(
            profile_report_path=Path(args.profile_report),
            settings=settings_factory(),
        )
    if args.command == "build-langfuse-score-report-from-profile":
        return build_langfuse_score_report_from_profile_artifact(
            profile_report_path=Path(args.profile_report),
            output_path=Path(args.output),
            settings=settings_factory(),
        )
    if args.command == "publish-langfuse-score-report":
        return publish_score_report(
            score_report_path=Path(args.score_report),
            settings=settings_factory(),
            dry_run=bool(args.dry_run),
            validate_only=bool(args.validate_only),
        )
    if args.command == "verify-langfuse-trace":
        return verify_trace(
            trace_id=resolve_langfuse_trace_id(
                trace_id=args.trace_id,
                product_trace_id=args.product_trace_id,
            ),
            expected_session_id=args.session_id,
            expected_user_id=args.user_id,
            expected_release=args.release,
            expected_tags=tuple(args.tag or ()),
            expected_request_id=args.request_id,
            expected_run_id=args.run_id,
            expected_workflow_id=args.workflow_id,
            settings=settings_factory(),
        )
    if args.command == "sync-langfuse-score-configs":
        return sync_langfuse_score_configs_artifact(
            registry_path=Path(args.registry),
            settings=settings_factory(),
            dry_run=bool(args.dry_run),
        )
    if args.command == "sync-langfuse-datasets":
        return sync_langfuse_datasets_artifact(
            manifest_path=Path(args.dataset_manifest),
            settings=settings_factory(),
            dry_run=bool(args.dry_run),
        )
    if args.command == "run-langfuse-experiment":
        return run_langfuse_experiment_artifact(
            manifest_path=Path(args.experiment_manifest),
            settings=settings_factory(),
        )
    if args.command == "run-rag-first-stage-parameter-sweep":
        return run_rag_first_stage_parameter_sweep_artifact(
            qrels_paths=tuple(Path(item) for item in args.qrels),
            candidate_paths=tuple(Path(item) for item in args.candidate_result),
            output_dir=Path(args.output_dir),
            environment=args.environment,
            release=args.release,
            source_git_head=args.source_git_head,
            dataset_run_id=args.dataset_run_id,
        )
    if args.command == "sync-langfuse-annotation-queue":
        return sync_langfuse_annotation_queue_artifact(
            manifest_path=Path(args.review_manifest),
            settings=settings_factory(),
            dry_run=bool(args.dry_run),
        )
    if args.command == "export-langfuse-review-results":
        return export_langfuse_review_results_artifact(
            manifest_path=Path(args.review_manifest),
            output_path=Path(args.output),
            settings=settings_factory(),
        )
    return None


def publish_langfuse_profile_report_artifact(
    *,
    profile_report_path: Path,
    settings: LangfuseAdapterSettings | None = None,
) -> dict[str, object]:
    from campus_evals.langfuse_score_report import (
        build_score_report_from_profile_report,
        publish_langfuse_score_report,
        write_langfuse_score_report,
    )

    profile_report_payload = json.loads(profile_report_path.read_text(encoding="utf-8"))
    resolved_settings = settings or langfuse_settings_from_env()
    score_report_payload = build_score_report_from_profile_report(
        profile_report_payload=profile_report_payload,
        profile_report_path=profile_report_path,
        environment=resolved_settings.environment,
    )
    score_report_path = profile_report_path.with_name("langfuse-score-report.json")
    write_langfuse_score_report(score_report_path, score_report_payload)
    return publish_langfuse_score_report(
        score_report_payload=score_report_payload,
        score_report_path=score_report_path,
        settings=resolved_settings,
    )


def build_langfuse_score_report_from_profile_artifact(
    *,
    profile_report_path: Path,
    output_path: Path,
    settings: LangfuseAdapterSettings | None = None,
) -> dict[str, object]:
    from campus_evals.langfuse_score_report import (
        build_score_report_from_profile_report,
        write_langfuse_score_report,
    )

    profile_report_payload = json.loads(profile_report_path.read_text(encoding="utf-8"))
    resolved_settings = settings or langfuse_settings_from_env()
    score_report_payload = build_score_report_from_profile_report(
        profile_report_payload=profile_report_payload,
        profile_report_path=profile_report_path,
        environment=resolved_settings.environment,
    )
    write_langfuse_score_report(output_path, score_report_payload)
    score_items = list(score_report_payload.get("score_items") or [])
    omitted_items = list(score_report_payload.get("omitted_items") or [])
    return {
        "schema_version": score_report_payload["schema_version"],
        "score_report_path": str(output_path),
        "eval_run_id": score_report_payload["eval_run_id"],
        "release": score_report_payload["release"],
        "source_result_denominator": score_report_payload["source_result_denominator"],
        "expected_publish_denominator": score_report_payload["expected_publish_denominator"],
        "score_count": len(score_items),
        "omitted": len(omitted_items),
    }


def publish_langfuse_score_report_artifact(
    *,
    score_report_path: Path,
    settings: LangfuseAdapterSettings | None = None,
    dry_run: bool = False,
    validate_only: bool = False,
) -> dict[str, object]:
    from campus_evals.langfuse_score_report import (
        load_langfuse_score_report,
        publish_langfuse_score_report,
    )

    resolved_settings = settings or langfuse_settings_from_env()
    return publish_langfuse_score_report(
        score_report_payload=load_langfuse_score_report(score_report_path),
        score_report_path=score_report_path,
        settings=resolved_settings,
        dry_run=dry_run,
        validate_only=validate_only,
    )


def verify_langfuse_online_trace_evidence_artifact(
    *,
    trace_id: str,
    expected_session_id: str,
    expected_user_id: str,
    expected_release: str,
    expected_tags: tuple[str, ...],
    expected_request_id: str | None = None,
    expected_run_id: str | None = None,
    expected_workflow_id: str | None = None,
    settings: LangfuseAdapterSettings | None = None,
) -> dict[str, object]:
    from campus_evals.langfuse_adapter import verify_langfuse_online_trace_evidence

    resolved_settings = settings or langfuse_settings_from_env()
    return verify_langfuse_online_trace_evidence(
        settings=resolved_settings,
        trace_id=trace_id,
        expected_session_id=expected_session_id,
        expected_user_id=expected_user_id,
        expected_release=expected_release,
        expected_tags=expected_tags,
        expected_request_id=expected_request_id,
        expected_run_id=expected_run_id,
        expected_workflow_id=expected_workflow_id,
    )


def sync_langfuse_score_configs_artifact(
    *,
    registry_path: Path = DEFAULT_REGISTRY_PATH,
    settings: LangfuseAdapterSettings | None = None,
    dry_run: bool,
) -> dict[str, object]:
    from campus_evals.langfuse_platform import sync_langfuse_score_configs

    return sync_langfuse_score_configs(
        registry_path=registry_path,
        settings=settings or langfuse_settings_from_env(),
        dry_run=dry_run,
    )


def sync_langfuse_datasets_artifact(
    *,
    manifest_path: Path,
    settings: LangfuseAdapterSettings | None = None,
    dry_run: bool,
) -> dict[str, object]:
    from campus_evals.langfuse_platform import sync_langfuse_datasets

    return sync_langfuse_datasets(
        manifest_path=manifest_path,
        settings=settings or langfuse_settings_from_env(),
        dry_run=dry_run,
    )


def run_langfuse_experiment_artifact(
    *,
    manifest_path: Path,
    settings: LangfuseAdapterSettings | None = None,
) -> dict[str, object]:
    from campus_evals.langfuse_platform import run_langfuse_experiment

    return run_langfuse_experiment(
        manifest_path=manifest_path,
        settings=settings or langfuse_settings_from_env(),
    )


def run_rag_first_stage_parameter_sweep_artifact(
    *,
    qrels_paths: tuple[Path, ...],
    candidate_paths: tuple[Path, ...],
    output_dir: Path,
    environment: str,
    release: str,
    source_git_head: str,
    dataset_run_id: str,
) -> dict[str, object]:
    from campus_evals.rag_first_stage_sweep import build_rag_first_stage_parameter_sweep

    return build_rag_first_stage_parameter_sweep(
        qrels_paths=qrels_paths,
        candidate_paths=candidate_paths,
        output_dir=output_dir,
        environment=environment,
        release=release,
        source_git_head=source_git_head,
        dataset_run_id=dataset_run_id,
    )


def sync_langfuse_annotation_queue_artifact(
    *,
    manifest_path: Path,
    settings: LangfuseAdapterSettings | None = None,
    dry_run: bool,
) -> dict[str, object]:
    from campus_evals.langfuse_platform import sync_langfuse_annotation_queue

    return sync_langfuse_annotation_queue(
        manifest_path=manifest_path,
        settings=settings or langfuse_settings_from_env(),
        dry_run=dry_run,
    )


def export_langfuse_review_results_artifact(
    *,
    manifest_path: Path,
    output_path: Path,
    settings: LangfuseAdapterSettings | None = None,
) -> dict[str, object]:
    from campus_evals.langfuse_platform import export_langfuse_review_results

    return export_langfuse_review_results(
        manifest_path=manifest_path,
        output_path=output_path,
        settings=settings or langfuse_settings_from_env(),
    )


def resolve_langfuse_trace_id(*, trace_id: str | None, product_trace_id: str | None) -> str:
    return derive_langfuse_trace_id(product_trace_id) if product_trace_id else str(trace_id or "")


def audit_workflow_langfuse_publish_contract(workflow_path: Path) -> dict[str, object]:
    text = workflow_path.read_text(encoding="utf-8")
    required_tokens = (
        "publish_langfuse_scores:",
        "LANGFUSE_BASE_URL: ${{ vars.LANGFUSE_BASE_URL }}",
        "LANGFUSE_PUBLIC_KEY: ${{ secrets.LANGFUSE_PUBLIC_KEY }}",
        "LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}",
        "LANGFUSE_ENVIRONMENT: ${{ vars.LANGFUSE_ENVIRONMENT }}",
        "inputs.profile == 'online-answer-path'",
        "inputs.publish_langfuse_scores == true",
        "build-langfuse-score-report-from-profile",
        "--profile-report",
        "${{ steps.accept.outputs.artifact_dir }}/profile-report.json",
        "--output",
        "${{ steps.accept.outputs.artifact_dir }}/langfuse-score-report.json",
        "publish-langfuse-score-report",
        "--score-report",
        "${{ steps.accept.outputs.artifact_dir }}/langfuse-score-report.json",
        "--json",
    )
    missing = [token for token in required_tokens if token not in text]
    return {
        "check_id": "workflow_langfuse_publish_contract",
        "passed": not missing,
        "missing": missing,
    }


def langfuse_settings_from_env() -> LangfuseAdapterSettings:
    timeout_raw = str(os.environ.get("LANGFUSE_TIMEOUT_SECONDS") or "").strip()
    return LangfuseAdapterSettings(
        base_url=str(os.environ.get("LANGFUSE_BASE_URL") or "").strip(),
        public_key=str(os.environ.get("LANGFUSE_PUBLIC_KEY") or "").strip(),
        secret_key=str(os.environ.get("LANGFUSE_SECRET_KEY") or "").strip(),
        environment=str(os.environ.get("LANGFUSE_ENVIRONMENT") or "").strip(),
        timeout_seconds=float(timeout_raw) if timeout_raw else 10.0,
    )
