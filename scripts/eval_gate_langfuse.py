from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from campus_evals.langfuse_adapter import LangfuseAdapterSettings, derive_langfuse_trace_id


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
        "publish-langfuse-profile",
        "--profile-report",
        "${{ steps.accept.outputs.artifact_dir }}/profile-report.json",
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
