from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from campus_evals.langfuse_adapter import LangfuseAdapterSettings


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

    verify_langfuse_trace_parser = subparsers.add_parser(
        "verify-langfuse-trace",
        help="Verify a real online answer trace reached Langfuse.",
    )
    verify_langfuse_trace_parser.add_argument("--trace-id", required=True)
    verify_langfuse_trace_parser.add_argument("--session-id", required=True)
    verify_langfuse_trace_parser.add_argument("--user-id", required=True)
    verify_langfuse_trace_parser.add_argument("--release", required=True)
    verify_langfuse_trace_parser.add_argument("--tag", action="append", default=[])
    verify_langfuse_trace_parser.add_argument("--json", action="store_true")


def publish_langfuse_profile_report_artifact(
    *,
    profile_report_path: Path,
    settings: LangfuseAdapterSettings | None = None,
) -> dict[str, object]:
    from campus_evals.langfuse_adapter import create_langfuse_adapter

    profile_report_payload = json.loads(profile_report_path.read_text(encoding="utf-8"))
    resolved_settings = settings or langfuse_settings_from_env()
    adapter = create_langfuse_adapter(resolved_settings)
    return adapter.publish_profile_report(profile_report_payload)


def verify_langfuse_online_trace_evidence_artifact(
    *,
    trace_id: str,
    expected_session_id: str,
    expected_user_id: str,
    expected_release: str,
    expected_tags: tuple[str, ...],
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
    )


def langfuse_settings_from_env() -> LangfuseAdapterSettings:
    timeout_raw = str(os.environ.get("LANGFUSE_TIMEOUT_SECONDS") or "").strip()
    return LangfuseAdapterSettings(
        base_url=str(os.environ.get("LANGFUSE_BASE_URL") or "").strip(),
        public_key=str(os.environ.get("LANGFUSE_PUBLIC_KEY") or "").strip(),
        secret_key=str(os.environ.get("LANGFUSE_SECRET_KEY") or "").strip(),
        environment=str(os.environ.get("LANGFUSE_ENVIRONMENT") or "").strip(),
        timeout_seconds=float(timeout_raw) if timeout_raw else 10.0,
    )
