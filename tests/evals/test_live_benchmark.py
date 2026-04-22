from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import ActorContext, KnowledgeScope
from campus_evals import ExecutionResult, GoldenCase, TraceExpectation
from campus_evals.live_benchmark import (
    BenchmarkProfile,
    OperatorObservabilityPublishConfig,
    accept_live_benchmark_profile,
    build_default_profile_http_settings,
    main_for_profile,
    repair_live_benchmark_profile,
    run_live_benchmark_profile,
)

TEST_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")


def _case() -> GoldenCase:
    return GoldenCase(
        case_id="live-benchmark-case",
        split="release_gate",
        source_type="expert_authored",
        user_goal="图书馆开放时间是什么？",
        actor=ActorContext(),
        scope=TEST_SCOPE,
        expected_status="completed",
        trace_expectation=TraceExpectation(
            selected_scope=TEST_SCOPE,
            retrieval_called=True,
        ),
    )


class LiveBenchmarkProfileRunnerTest(unittest.TestCase):
    def test_build_default_profile_http_settings_uses_extended_read_timeout_budget(self) -> None:
        settings = build_default_profile_http_settings()

        self.assertEqual(settings.read_timeout_seconds, 180.0)
        self.assertEqual(settings.retry_attempts, 1)
        self.assertEqual(settings.request_min_interval_seconds, 1.0)
        self.assertEqual(settings.circuit_breaker_failure_threshold, 5)
        self.assertEqual(settings.circuit_breaker_cooldown_seconds, 15.0)

    def test_run_live_benchmark_profile_passes_explicit_profile_policy_to_core(self) -> None:
        profile = BenchmarkProfile(
            profile_id="test_profile",
            benchmark_type="test_live_gate",
            repair_benchmark_type="test_live_gate_repair",
            run_prefix="test-live-gate",
            repair_prefix="test-live-gate-repair",
            description="test profile",
            policy_path=Path("/tmp/test-policy.json"),
            cases_factory=lambda: (_case(),),
            executor_factory=lambda: (
                lambda case: ExecutionResult(response=object(), observed_trace=None)
            ),
            supplemental_adapters_factory=lambda: (),
            case_workers=3,
        )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "run"
            with patch(
                "campus_evals.live_benchmark.run_handbook_formal_benchmark",
                return_value={"benchmark_type": "test_live_gate"},
            ) as run_benchmark:
                summary = run_live_benchmark_profile(
                    profile=profile, reruns=2, output_dir=output_dir
                )

        self.assertEqual(summary["benchmark_type"], "test_live_gate")
        self.assertEqual(
            run_benchmark.call_args.kwargs["policy_path"], Path("/tmp/test-policy.json")
        )
        self.assertEqual(run_benchmark.call_args.kwargs["benchmark_type"], "test_live_gate")
        self.assertEqual(run_benchmark.call_args.kwargs["case_workers"], 3)

    def test_repair_live_benchmark_profile_passes_explicit_profile_policy_to_core(self) -> None:
        profile = BenchmarkProfile(
            profile_id="test_profile",
            benchmark_type="test_live_gate",
            repair_benchmark_type="test_live_gate_repair",
            run_prefix="test-live-gate",
            repair_prefix="test-live-gate-repair",
            description="test profile",
            policy_path=Path("/tmp/test-policy.json"),
            cases_factory=lambda: (_case(),),
            executor_factory=lambda: (
                lambda case: ExecutionResult(response=object(), observed_trace=None)
            ),
            supplemental_adapters_factory=lambda: (),
            case_workers=3,
        )

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            output_dir = Path(tmpdir) / "repair"
            with patch(
                "campus_evals.live_benchmark.repair_handbook_formal_benchmark",
                return_value={"benchmark_type": "test_live_gate_repair"},
            ) as repair_benchmark:
                summary = repair_live_benchmark_profile(
                    profile=profile,
                    benchmark_dir=benchmark_dir,
                    output_dir=output_dir,
                )

        self.assertEqual(summary["benchmark_type"], "test_live_gate_repair")
        self.assertEqual(
            repair_benchmark.call_args.kwargs["policy_path"], Path("/tmp/test-policy.json")
        )
        self.assertEqual(
            repair_benchmark.call_args.kwargs["benchmark_type"], "test_live_gate_repair"
        )
        self.assertEqual(repair_benchmark.call_args.kwargs["case_workers"], 3)

    def test_accept_live_benchmark_profile_runs_repair_and_writes_final_summary(self) -> None:
        profile = BenchmarkProfile(
            profile_id="test_profile",
            benchmark_type="test_live_gate",
            repair_benchmark_type="test_live_gate_repair",
            run_prefix="test-live-gate",
            repair_prefix="test-live-gate-repair",
            description="test profile",
            policy_path=Path("/tmp/test-policy.json"),
            cases_factory=lambda: (_case(),),
            executor_factory=lambda: (
                lambda case: ExecutionResult(response=object(), observed_trace=None)
            ),
            supplemental_adapters_factory=lambda: (),
        )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "accept"
            run_dir = output_dir / "run"
            repair_dir = output_dir / "repair"

            def fake_run(**kwargs):
                self.assertEqual(kwargs["output_dir"], run_dir)
                run_dir.mkdir(parents=True, exist_ok=True)
                payload = {
                    "benchmark_type": "test_live_gate",
                    "deterministic": {"stable_across_runs": True, "mean_pass_rate": 1.0},
                    "gate_report": {"overall_verdict": "warn"},
                    "supplemental_runtime": {"status_counts": {"unavailable": 1}},
                }
                (run_dir / "summary.json").write_text(json.dumps(payload), encoding="utf-8")
                return payload

            def fake_repair(**kwargs):
                self.assertEqual(kwargs["benchmark_dir"], run_dir)
                self.assertEqual(kwargs["output_dir"], repair_dir)
                repair_dir.mkdir(parents=True, exist_ok=True)
                payload = {
                    "benchmark_type": "test_live_gate_repair",
                    "deterministic": {"stable_across_runs": True, "mean_pass_rate": 1.0},
                    "gate_report": {"overall_verdict": "pass"},
                    "supplemental_runtime": {"status_counts": {"available": 1}},
                    "repair": {"selected_target_count": 1, "applied_target_count": 1},
                }
                (repair_dir / "summary.json").write_text(json.dumps(payload), encoding="utf-8")
                return payload

            with (
                patch(
                    "campus_evals.live_benchmark.run_live_benchmark_profile", side_effect=fake_run
                ) as run_profile,
                patch(
                    "campus_evals.live_benchmark.collect_repairable_handbook_benchmark_targets",
                    return_value=[{"case_id": "c1"}],
                ) as collect_targets,
                patch(
                    "campus_evals.live_benchmark.repair_live_benchmark_profile",
                    side_effect=fake_repair,
                ) as repair_profile,
            ):
                summary = accept_live_benchmark_profile(
                    profile=profile, reruns=2, output_dir=output_dir
                )
                self.assertTrue((output_dir / "final-summary.json").exists())
                self.assertTrue((output_dir / "accept-config.json").exists())
                written_summary = json.loads(
                    (output_dir / "final-summary.json").read_text(encoding="utf-8")
                )
                self.assertEqual(
                    written_summary["runtime_observability"],
                    {
                        "run_events_path": None,
                        "repair_events_path": None,
                        "run_session_id": None,
                        "repair_session_id": None,
                        "run_provider_summary_path": None,
                        "repair_provider_summary_path": None,
                    },
                )

        self.assertEqual(summary["final_overall_verdict"], "pass")
        self.assertEqual(summary["initial_run_dir"], str(run_dir))
        self.assertEqual(summary["repair_run_dir"], str(repair_dir))
        self.assertEqual(summary["repair"]["selected_target_count"], 1)
        run_profile.assert_called_once()
        collect_targets.assert_called_once_with(run_dir)
        repair_profile.assert_called_once()

    def test_accept_live_benchmark_profile_skips_repair_when_no_targets(self) -> None:
        profile = BenchmarkProfile(
            profile_id="test_profile",
            benchmark_type="test_live_gate",
            repair_benchmark_type="test_live_gate_repair",
            run_prefix="test-live-gate",
            repair_prefix="test-live-gate-repair",
            description="test profile",
            policy_path=Path("/tmp/test-policy.json"),
            cases_factory=lambda: (_case(),),
            executor_factory=lambda: (
                lambda case: ExecutionResult(response=object(), observed_trace=None)
            ),
            supplemental_adapters_factory=lambda: (),
        )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "accept"
            run_dir = output_dir / "run"

            def fake_run(**kwargs):
                self.assertEqual(kwargs["output_dir"], run_dir)
                run_dir.mkdir(parents=True, exist_ok=True)
                payload = {
                    "benchmark_type": "test_live_gate",
                    "deterministic": {"stable_across_runs": True, "mean_pass_rate": 1.0},
                    "gate_report": {"overall_verdict": "pass"},
                    "supplemental_runtime": {"status_counts": {"available": 1}},
                }
                (run_dir / "summary.json").write_text(json.dumps(payload), encoding="utf-8")
                return payload

            with (
                patch(
                    "campus_evals.live_benchmark.run_live_benchmark_profile", side_effect=fake_run
                ),
                patch(
                    "campus_evals.live_benchmark.collect_repairable_handbook_benchmark_targets",
                    return_value=[],
                ),
                patch(
                    "campus_evals.live_benchmark.repair_live_benchmark_profile"
                ) as repair_profile,
            ):
                summary = accept_live_benchmark_profile(
                    profile=profile, reruns=2, output_dir=output_dir
                )
                self.assertTrue((output_dir / "final-summary.json").exists())
                self.assertTrue((output_dir / "accept-config.json").exists())

        self.assertEqual(summary["final_overall_verdict"], "pass")
        self.assertIsNone(summary["repair_run_dir"])
        self.assertEqual(summary["repair"]["selected_target_count"], 0)
        repair_profile.assert_not_called()

    def test_accept_live_benchmark_profile_publishes_final_case_results_when_configured(
        self,
    ) -> None:
        profile = BenchmarkProfile(
            profile_id="test_profile",
            benchmark_type="test_live_gate",
            repair_benchmark_type="test_live_gate_repair",
            run_prefix="test-live-gate",
            repair_prefix="test-live-gate-repair",
            description="test profile",
            policy_path=Path("/tmp/test-policy.json"),
            cases_factory=lambda: (_case(),),
            executor_factory=lambda: (
                lambda case: ExecutionResult(response=object(), observed_trace=None)
            ),
            supplemental_adapters_factory=lambda: (),
        )

        publish_config = OperatorObservabilityPublishConfig(
            grade_source="openai_trace_grader",
            grader_version="grader@2026-04-03",
            dry_run=True,
        )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "accept"
            run_dir = output_dir / "run"

            def fake_run(**kwargs):
                self.assertEqual(kwargs["output_dir"], run_dir)
                run_dir.mkdir(parents=True, exist_ok=True)
                payload = {
                    "benchmark_type": "test_live_gate",
                    "reruns": 2,
                    "deterministic": {"stable_across_runs": True, "mean_pass_rate": 1.0},
                    "gate_report": {"overall_verdict": "pass"},
                    "supplemental_runtime": {"status_counts": {"available": 1}},
                }
                (run_dir / "summary.json").write_text(json.dumps(payload), encoding="utf-8")
                (run_dir / "run-01-case-results.json").write_text(
                    json.dumps({"schema_version": 1, "run_number": 1, "results": []}),
                    encoding="utf-8",
                )
                (run_dir / "run-02-case-results.json").write_text(
                    json.dumps({"schema_version": 1, "run_number": 2, "results": []}),
                    encoding="utf-8",
                )
                return payload

            with (
                patch(
                    "campus_evals.live_benchmark.run_live_benchmark_profile", side_effect=fake_run
                ),
                patch(
                    "campus_evals.live_benchmark.collect_repairable_handbook_benchmark_targets",
                    return_value=[],
                ),
                patch(
                    "campus_evals.live_benchmark.publish_case_results_artifact",
                    return_value={
                        "case_results_path": str(run_dir / "run-02-case-results.json"),
                        "request_correlations_path": None,
                        "grade_source": "openai_trace_grader",
                        "grader_version": "grader@2026-04-03",
                        "dry_run": True,
                        "grade_count": 1,
                        "backlink_count": 1,
                        "accepted_grades": 0,
                        "accepted_backlinks": 0,
                        "skipped": [],
                    },
                ) as publish_artifact,
            ):
                summary = accept_live_benchmark_profile(
                    profile=profile,
                    reruns=2,
                    output_dir=output_dir,
                    operator_observability_publish=publish_config,
                )
                self.assertTrue(
                    (output_dir / "operator-observability-publish-summary.json").exists()
                )
                accept_config = json.loads(
                    (output_dir / "accept-config.json").read_text(encoding="utf-8")
                )

        publish_artifact.assert_called_once_with(
            case_results_path=run_dir / "run-02-case-results.json",
            request_correlations_path=None,
            grade_source="openai_trace_grader",
            grader_version="grader@2026-04-03",
            metric_domain_overrides=None,
            dry_run=True,
        )
        self.assertEqual(
            summary["operator_observability_publish"]["summary"]["grade_count"],
            1,
        )
        self.assertEqual(
            summary["operator_observability_publish"]["case_results_path"],
            str(run_dir / "run-02-case-results.json"),
        )
        self.assertEqual(
            accept_config["operator_observability_publish"],
            {
                "enabled": True,
                "dry_run": True,
                "grade_source": "openai_trace_grader",
                "grader_version": "grader@2026-04-03",
                "request_correlations_path": None,
                "metric_domain_overrides": {},
            },
        )

    def test_main_for_profile_accept_builds_operator_publish_config_from_flags(self) -> None:
        profile = BenchmarkProfile(
            profile_id="test_profile",
            benchmark_type="test_live_gate",
            repair_benchmark_type="test_live_gate_repair",
            run_prefix="test-live-gate",
            repair_prefix="test-live-gate-repair",
            description="test profile",
            policy_path=Path("/tmp/test-policy.json"),
            cases_factory=lambda: (_case(),),
            executor_factory=lambda: (
                lambda case: ExecutionResult(response=object(), observed_trace=None)
            ),
            supplemental_adapters_factory=lambda: (),
        )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "accept"
            with (
                patch("campus_evals.live_benchmark.load_repo_env"),
                patch(
                    "campus_evals.live_benchmark.accept_live_benchmark_profile"
                ) as accept_profile,
                patch("builtins.print"),
            ):
                exit_code = main_for_profile(
                    profile=profile,
                    argv=[
                        "accept",
                        "--reruns",
                        "2",
                        "--output-dir",
                        str(output_dir),
                        "--publish-operator-observability",
                        "--publish-operator-observability-dry-run",
                        "--publish-grade-source",
                        "openai_trace_grader",
                        "--publish-grader-version",
                        "grader@2026-04-03",
                        "--publish-metric-domain-override",
                        "judge.refusal_quality=policy",
                    ],
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            accept_profile.call_args.kwargs["operator_observability_publish"],
            OperatorObservabilityPublishConfig(
                grade_source="openai_trace_grader",
                grader_version="grader@2026-04-03",
                dry_run=True,
                metric_domain_overrides={"judge.refusal_quality": "policy"},
            ),
        )


if __name__ == "__main__":
    unittest.main()
