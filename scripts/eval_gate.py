from __future__ import annotations

import argparse
import io
import json
from collections.abc import Callable
from contextlib import redirect_stdout
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from scripts.check_worker_secret_presence import collect_worker_secret_presence
from scripts.doctor_env import collect_env_doctor_status

DEFAULT_WORKER_APPS = (
    "apps/app-api",
    "apps/public-chat-web",
    "apps/protected-panel-web",
)


@dataclass(frozen=True, slots=True)
class EvalGateProfileSpec:
    name: str
    default_reruns: int
    output_prefix: str
    official_web_scope: str | None = None
    supports_publish_dry_run: bool = True


_PROFILE_SPECS = {
    "handbook": EvalGateProfileSpec(
        name="handbook",
        default_reruns=3,
        output_prefix="student-handbook-formal-benchmark-accept",
    ),
    "curriculum": EvalGateProfileSpec(
        name="curriculum",
        default_reruns=3,
        output_prefix="curriculum-plan-live-gate-accept",
    ),
    "official-web-stable-reference": EvalGateProfileSpec(
        name="official-web-stable-reference",
        default_reruns=1,
        output_prefix="official-web-stable-reference-live-gate-accept",
        official_web_scope="stable_reference",
    ),
    "official-web-fresh-news": EvalGateProfileSpec(
        name="official-web-fresh-news",
        default_reruns=1,
        output_prefix="official-web-fresh-news-live-gate-accept",
        official_web_scope="fresh_news",
    ),
    "service-guide-lookup": EvalGateProfileSpec(
        name="service-guide-lookup",
        default_reruns=1,
        output_prefix="service-guide-lookup-release-gate-accept",
        supports_publish_dry_run=False,
    ),
    "contact-directory-lookup": EvalGateProfileSpec(
        name="contact-directory-lookup",
        default_reruns=1,
        output_prefix="contact-directory-lookup-release-gate-accept",
        supports_publish_dry_run=False,
    ),
    "campus-services-product-path": EvalGateProfileSpec(
        name="campus-services-product-path",
        default_reruns=1,
        output_prefix="campus-services-product-path-opening-gate-accept",
        supports_publish_dry_run=False,
    ),
    "multi-agent-product-path": EvalGateProfileSpec(
        name="multi-agent-product-path",
        default_reruns=1,
        output_prefix="multi-agent-product-path-gate-accept",
        supports_publish_dry_run=False,
    ),
    "multi-agent-runtime-contract": EvalGateProfileSpec(
        name="multi-agent-runtime-contract",
        default_reruns=1,
        output_prefix="multi-agent-runtime-contract-gate-accept",
        supports_publish_dry_run=False,
    ),
    "public-chat-product-path": EvalGateProfileSpec(
        name="public-chat-product-path",
        default_reruns=1,
        output_prefix="public-chat-product-path-gate-accept",
        supports_publish_dry_run=False,
    ),
    "tool-family-denominator": EvalGateProfileSpec(
        name="tool-family-denominator",
        default_reruns=1,
        output_prefix="tool-family-denominator-gate-accept",
        supports_publish_dry_run=False,
    ),
    "document-quality": EvalGateProfileSpec(
        name="document-quality",
        default_reruns=1,
        output_prefix="document-quality-gate-accept",
        supports_publish_dry_run=False,
    ),
    "authz-privacy": EvalGateProfileSpec(
        name="authz-privacy",
        default_reruns=1,
        output_prefix="authz-privacy-gate-accept",
        supports_publish_dry_run=False,
    ),
    "agentic-retrieval-plan": EvalGateProfileSpec(
        name="agentic-retrieval-plan",
        default_reruns=1,
        output_prefix="agentic-retrieval-plan-gate-accept",
        supports_publish_dry_run=False,
    ),
    "eval-operations-governance": EvalGateProfileSpec(
        name="eval-operations-governance",
        default_reruns=1,
        output_prefix="eval-operations-governance-gate-accept",
        supports_publish_dry_run=False,
    ),
    "quality-calibration": EvalGateProfileSpec(
        name="quality-calibration",
        default_reruns=1,
        output_prefix="quality-calibration-gate-accept",
        supports_publish_dry_run=False,
    ),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run shared eval gate doctor, acceptance, and publish flows."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="Run repo-owned eval environment doctor, optionally with worker secret presence audit.",
    )
    doctor_parser.add_argument(
        "--repo-root",
        default=".",
        help="Repo root containing the shared .env and app directories.",
    )
    doctor_parser.add_argument(
        "--check-worker-secrets",
        action="store_true",
        help="Also audit Cloudflare worker secret presence for the selected apps.",
    )
    doctor_parser.add_argument(
        "--worker-env",
        default="staging",
        help="Worker environment used for secret presence audit when enabled.",
    )
    doctor_parser.add_argument(
        "--worker-app",
        action="append",
        default=[],
        help="Worker app path to audit. Defaults to the three canonical worker surfaces.",
    )
    doctor_parser.add_argument(
        "--json",
        action="store_true",
        help="Render doctor output as JSON.",
    )

    accept_parser = subparsers.add_parser(
        "accept",
        help="Run a shared eval acceptance flow for one admitted profile.",
    )
    accept_parser.add_argument(
        "--profile",
        choices=tuple(_PROFILE_SPECS),
        required=True,
        help="Repo-owned eval profile to execute.",
    )
    accept_parser.add_argument(
        "--reruns",
        type=int,
        help="Number of reruns for the initial acceptance run. Defaults to the profile baseline.",
    )
    accept_parser.add_argument(
        "--output-dir",
        help="Explicit acceptance artifact directory. Defaults to timestamped .tmp/evals output.",
    )
    accept_parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print high-signal runtime events during acceptance.",
    )
    accept_parser.add_argument(
        "--log-jsonl",
        help="Optional runtime event JSONL base path for accept mode.",
    )
    accept_parser.add_argument(
        "--qdrant-collection-name",
        help="Required for official-web profiles; ignored by handbook/curriculum profiles.",
    )
    accept_parser.add_argument(
        "--cases-path",
        help="Optional case fixture override for observation-backed deterministic profiles.",
    )
    accept_parser.add_argument(
        "--observations-path",
        help="Observation JSON path for observation-backed deterministic profiles.",
    )
    accept_parser.add_argument(
        "--collect-runtime",
        action="store_true",
        help="Collect runtime observations when the selected profile supports it.",
    )
    accept_parser.add_argument(
        "--artifact-path",
        action="append",
        default=[],
        help="Input profile artifact path used by eval operations governance profiles.",
    )
    accept_parser.add_argument(
        "--publish-dry-run",
        action="store_true",
        help="Also build operator publish artifacts in dry-run mode from the accepted case-results.",
    )
    accept_parser.add_argument(
        "--publish-grade-source",
        help="Stable producer/source id used for publish dry-run.",
    )
    accept_parser.add_argument(
        "--publish-grader-version",
        help="Stable grader/runtime version used for publish dry-run.",
    )
    accept_parser.add_argument(
        "--publish-request-correlations",
        help="Optional explicit request correlation manifest for publish dry-run.",
    )
    accept_parser.add_argument(
        "--publish-metric-domain-override",
        action="append",
        default=[],
        help="Optional metric-to-domain override in the form adapter.metric=grounding|citation|policy.",
    )
    accept_parser.add_argument(
        "--json",
        action="store_true",
        help="Render acceptance summary as JSON.",
    )

    publish_parser = subparsers.add_parser(
        "publish",
        help="Build or execute operator observability publish from case-results artifacts.",
    )
    publish_parser.add_argument(
        "--case-results", required=True, help="run-XX-case-results.json path."
    )
    publish_parser.add_argument(
        "--request-correlations",
        help="Optional explicit case_id -> request_id/trace_id manifest.",
    )
    publish_parser.add_argument("--grade-source", required=True, help="Stable producer/source id.")
    publish_parser.add_argument(
        "--grader-version",
        required=True,
        help="Stable grader/runtime version label.",
    )
    publish_parser.add_argument(
        "--metric-domain-override",
        action="append",
        default=[],
        help="Optional metric-to-domain override in the form adapter.metric=grounding|citation|policy.",
    )
    publish_parser.add_argument(
        "--dry-run",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Default true. Use --no-dry-run to POST into app-api operator ingest seams.",
    )
    publish_parser.add_argument(
        "--json",
        action="store_true",
        help="Render publish summary as JSON.",
    )

    publish_profile_parser = subparsers.add_parser(
        "publish-profile",
        help="Build or execute operator observability publish from profile report artifacts.",
    )
    publish_profile_parser.add_argument(
        "--profile-report",
        required=True,
        help="profile report artifact path.",
    )
    publish_profile_parser.add_argument(
        "--grade-source",
        required=True,
        help="Stable producer/source id.",
    )
    publish_profile_parser.add_argument(
        "--grader-version",
        required=True,
        help="Stable grader/runtime version label.",
    )
    publish_profile_parser.add_argument(
        "--dry-run",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Default true. Use --no-dry-run to POST into app-api operator ingest seams.",
    )
    publish_profile_parser.add_argument(
        "--json",
        action="store_true",
        help="Render publish summary as JSON.",
    )
    return parser


def collect_eval_gate_status(
    *,
    repo_root: Path,
    include_worker_secret_presence: bool = False,
    worker_env: str = "staging",
    worker_apps: tuple[str, ...] = DEFAULT_WORKER_APPS,
) -> dict[str, object]:
    env_doctor = collect_env_doctor_status(repo_root=repo_root, surface="evals")
    worker_secret_presence = None
    overall_ready = bool(env_doctor.get("overall_ready"))

    if include_worker_secret_presence:
        worker_secret_presence = collect_worker_secret_presence(
            repo_root=repo_root,
            env_name=worker_env,
            app_paths=worker_apps,
        )
        overall_ready = overall_ready and bool(worker_secret_presence.get("overall_ready"))

    return {
        "surface": "eval_gate",
        "repo_root": str(repo_root),
        "overall_ready": overall_ready,
        "env_doctor": env_doctor,
        "worker_secret_presence": worker_secret_presence,
    }


def run_eval_acceptance(
    *,
    profile: str,
    output_dir: Path,
    reruns: int | None = None,
    verbose: bool = False,
    log_jsonl: Path | None = None,
    qdrant_collection_name: str | None = None,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    artifact_paths: tuple[Path, ...] = (),
    publish_dry_run: bool = False,
    publish_grade_source: str | None = None,
    publish_grader_version: str | None = None,
    publish_request_correlations: Path | None = None,
    publish_metric_domain_overrides: tuple[str, ...] = (),
) -> dict[str, object]:
    profile_spec = _resolve_profile_spec(profile)
    runner = _resolve_profile_runner(profile)
    resolved_reruns = reruns or profile_spec.default_reruns
    if publish_dry_run and not profile_spec.supports_publish_dry_run:
        raise ValueError(
            f"{profile_spec.name} does not produce live case-results artifacts; "
            "operator publish dry-run is not applicable"
        )

    argv = [
        "accept",
        "--output-dir",
        str(output_dir),
        "--reruns",
        str(resolved_reruns),
    ]
    if verbose:
        argv.append("--verbose")
    if log_jsonl is not None:
        argv.extend(["--log-jsonl", str(log_jsonl)])
    if publish_dry_run:
        argv.extend(
            [
                "--publish-operator-observability",
                "--publish-operator-observability-dry-run",
            ]
        )
        if not publish_grade_source or not publish_grader_version:
            raise ValueError(
                "publish_grade_source and publish_grader_version are required when publish_dry_run is enabled"
            )
        argv.extend(["--publish-grade-source", publish_grade_source])
        argv.extend(["--publish-grader-version", publish_grader_version])
        if publish_request_correlations is not None:
            argv.extend(["--publish-request-correlations", str(publish_request_correlations)])
        for item in publish_metric_domain_overrides:
            argv.extend(["--publish-metric-domain-override", item])

    if profile_spec.official_web_scope is not None:
        if not qdrant_collection_name:
            raise ValueError("qdrant_collection_name is required for official-web profiles")
        argv.extend(["--official-web-scope", profile_spec.official_web_scope])
        argv.extend(["--qdrant-collection-name", qdrant_collection_name])
    if cases_path is not None:
        argv.extend(["--cases-path", str(cases_path)])
    if observations_path is not None:
        argv.extend(["--observations-path", str(observations_path)])
    if collect_runtime:
        argv.append("--collect-runtime")
    for artifact_path in artifact_paths:
        argv.extend(["--artifact-path", str(artifact_path)])

    exit_code = runner(argv)
    return {
        "profile": profile_spec.name,
        "output_dir": str(output_dir),
        "reruns": resolved_reruns,
        "publish_dry_run": publish_dry_run,
        "exit_code": exit_code,
    }


def publish_case_results_artifact(
    *,
    case_results_path: Path,
    request_correlations_path: Path | None,
    grade_source: str,
    grader_version: str,
    metric_domain_overrides: dict[str, str] | None = None,
    dry_run: bool = True,
) -> dict[str, object]:
    from campus_evals.operator_observability import publish_case_results_artifact as _publish

    return _publish(
        case_results_path=case_results_path,
        request_correlations_path=request_correlations_path,
        grade_source=grade_source,
        grader_version=grader_version,
        metric_domain_overrides=metric_domain_overrides,
        dry_run=dry_run,
    )


def publish_profile_report_artifact(
    *,
    profile_report_path: Path,
    grade_source: str,
    grader_version: str,
    dry_run: bool = True,
) -> dict[str, object]:
    from campus_evals.operator_observability import publish_profile_report_artifact as _publish

    return _publish(
        profile_report_path=profile_report_path,
        grade_source=grade_source,
        grader_version=grader_version,
        dry_run=dry_run,
    )


def render_eval_gate_status_text(status: dict[str, object]) -> str:
    lines = [
        "Eval Gate Doctor",
        f"repo_root: {status['repo_root']}",
        f"overall_ready: {status['overall_ready']}",
        f"env_doctor_ready: {dict(status['env_doctor']).get('overall_ready')}",
    ]
    worker_secret_presence = status.get("worker_secret_presence")
    if worker_secret_presence is not None:
        lines.append(
            f"worker_secret_presence_ready: {dict(worker_secret_presence).get('overall_ready')}"
        )
        lines.append(f"worker_env: {dict(worker_secret_presence).get('env')}")
    return "\n".join(lines)


def render_eval_acceptance_text(summary: dict[str, object]) -> str:
    return "\n".join(
        [
            "Eval Gate Acceptance",
            f"profile: {summary['profile']}",
            f"output_dir: {summary['output_dir']}",
            f"reruns: {summary['reruns']}",
            f"publish_dry_run: {summary['publish_dry_run']}",
            f"exit_code: {summary['exit_code']}",
        ]
    )


def _resolve_profile_spec(profile: str) -> EvalGateProfileSpec:
    normalized = profile.strip().lower()
    try:
        return _PROFILE_SPECS[normalized]
    except KeyError as exc:
        allowed = ", ".join(sorted(_PROFILE_SPECS))
        raise ValueError(
            f"unsupported eval profile {profile!r}; expected one of {allowed}"
        ) from exc


def _resolve_profile_runner(profile: str) -> Callable[[list[str]], int]:
    normalized = profile.strip().lower()
    if normalized == "handbook":
        from campus_evals.handbook_live_benchmark import main as runner

        return runner
    if normalized == "curriculum":
        from campus_evals.curriculum_live_benchmark import main as runner

        return runner
    if normalized in {"official-web-stable-reference", "official-web-fresh-news"}:
        from campus_evals.official_web_live_benchmark import main as runner

        return runner
    if normalized == "service-guide-lookup":
        from campus_evals.service_guide_lookup_release_gate import main as runner

        return runner
    if normalized == "contact-directory-lookup":
        from campus_evals.contact_directory_lookup_release_gate import main as runner

        return runner
    if normalized == "campus-services-product-path":
        from campus_evals.campus_services_product_path_opening_gate import main as runner

        return runner
    if normalized in {"multi-agent-product-path", "multi-agent-runtime-contract"}:
        from campus_evals.multi_agent_product_path_gate import main as runner

        return runner
    if normalized == "public-chat-product-path":
        from campus_evals.eval_profile_gate import public_chat_product_path_main as runner

        return runner
    if normalized == "tool-family-denominator":
        from campus_evals.eval_profile_gate import tool_family_denominator_main as runner

        return runner
    if normalized == "document-quality":
        from campus_evals.eval_profile_gate import document_quality_main as runner

        return runner
    if normalized == "authz-privacy":
        from campus_evals.eval_profile_gate import authz_privacy_main as runner

        return runner
    if normalized == "agentic-retrieval-plan":
        from campus_evals.eval_profile_gate import agentic_retrieval_plan_main as runner

        return runner
    if normalized == "eval-operations-governance":
        from campus_evals.eval_profile_gate import eval_operations_governance_main as runner

        return runner
    if normalized == "quality-calibration":
        from campus_evals.quality_calibration import quality_calibration_main as runner

        return runner
    raise ValueError(f"unsupported eval profile runner: {profile}")


def _build_default_output_dir(prefix: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    return Path(".tmp/evals") / f"{prefix}-{timestamp}"


def _parse_metric_domain_overrides(items: list[str]) -> dict[str, str]:
    if not items:
        return {}
    overrides: dict[str, str] = {}
    for item in items:
        metric_key, separator, domain = str(item or "").strip().partition("=")
        if separator != "=" or not metric_key or not domain:
            raise ValueError(
                "metric domain override must use adapter.metric=grounding|citation|policy"
            )
        overrides[metric_key] = domain
    return overrides


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "doctor":
        status = collect_eval_gate_status(
            repo_root=Path(args.repo_root).resolve(),
            include_worker_secret_presence=bool(args.check_worker_secrets),
            worker_env=args.worker_env,
            worker_apps=tuple(args.worker_app or DEFAULT_WORKER_APPS),
        )
        if args.json:
            print(json.dumps(status, ensure_ascii=False, indent=2))
        else:
            print(render_eval_gate_status_text(status))
        return 0 if status["overall_ready"] else 1

    if args.command == "accept":
        resolved_output_dir = (
            Path(args.output_dir)
            if args.output_dir
            else _build_default_output_dir(_resolve_profile_spec(args.profile).output_prefix)
        )
        if args.publish_dry_run and (
            not str(args.publish_grade_source or "").strip()
            or not str(args.publish_grader_version or "").strip()
        ):
            parser.error(
                "--publish-grade-source and --publish-grader-version are required when --publish-dry-run is set"
            )
        captured_stdout = io.StringIO()
        with redirect_stdout(captured_stdout):
            summary = run_eval_acceptance(
                profile=args.profile,
                output_dir=resolved_output_dir,
                reruns=args.reruns,
                verbose=bool(args.verbose),
                log_jsonl=Path(args.log_jsonl) if args.log_jsonl else None,
                qdrant_collection_name=args.qdrant_collection_name,
                cases_path=Path(args.cases_path) if args.cases_path else None,
                observations_path=Path(args.observations_path) if args.observations_path else None,
                collect_runtime=bool(args.collect_runtime),
                artifact_paths=tuple(Path(item) for item in args.artifact_path),
                publish_dry_run=bool(args.publish_dry_run),
                publish_grade_source=args.publish_grade_source,
                publish_grader_version=args.publish_grader_version,
                publish_request_correlations=(
                    Path(args.publish_request_correlations)
                    if args.publish_request_correlations
                    else None
                ),
                publish_metric_domain_overrides=tuple(args.publish_metric_domain_override),
            )
        runner_output = captured_stdout.getvalue().strip()
        if args.json:
            payload = dict(summary)
            payload["runner_output"] = runner_output
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            if runner_output:
                print(runner_output)
            print(render_eval_acceptance_text(summary))
        return int(summary["exit_code"])

    if args.command == "publish-profile":
        summary = publish_profile_report_artifact(
            profile_report_path=Path(args.profile_report),
            grade_source=args.grade_source,
            grader_version=args.grader_version,
            dry_run=bool(args.dry_run),
        )
        if args.json:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
        else:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    metric_domain_overrides = _parse_metric_domain_overrides(args.metric_domain_override)
    summary = publish_case_results_artifact(
        case_results_path=Path(args.case_results),
        request_correlations_path=Path(args.request_correlations)
        if args.request_correlations
        else None,
        grade_source=args.grade_source,
        grader_version=args.grader_version,
        metric_domain_overrides=metric_domain_overrides or None,
        dry_run=bool(args.dry_run),
    )
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
