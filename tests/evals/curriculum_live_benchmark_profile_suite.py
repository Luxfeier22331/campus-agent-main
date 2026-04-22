from __future__ import annotations

from tests.evals.curriculum_live_benchmark_test_support import (
    Path,
    build_curriculum_live_profile,
    build_default_ragas_metric_names,
    curriculum_error_gate_cases,
    curriculum_release_gate_cases,
    patch,
    unittest,
)


class CurriculumLiveProfileTest(unittest.TestCase):
    def test_build_curriculum_live_profile_keeps_phase1000_case_inventory_shape(self) -> None:
        profile = build_curriculum_live_profile()
        release_cases = curriculum_release_gate_cases()
        error_cases = curriculum_error_gate_cases()
        cases = profile.cases_factory()

        self.assertEqual(len(release_cases), 16)
        self.assertEqual(len(error_cases), 3)
        self.assertEqual(len(cases), 19)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            tuple(case.case_id for case in (*release_cases, *error_cases)),
        )
        self.assertEqual(len({case.case_id for case in cases}), len(cases))

    def test_build_curriculum_live_profile_uses_curriculum_policy_and_metric_named_ragas_adapter(
        self,
    ) -> None:
        profile = build_curriculum_live_profile(
            env={
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(profile.benchmark_type, "curriculum_live_gate")
        self.assertEqual(Path(profile.policy_path).name, "curriculum_plan_live_gate_policy.json")
        self.assertEqual(profile.http_settings.read_timeout_seconds, 180.0)
        self.assertEqual(profile.http_settings.retry_attempts, 1)
        self.assertEqual(profile.http_settings.request_min_interval_seconds, 1.0)
        self.assertEqual(profile.http_settings.circuit_breaker_failure_threshold, 5)
        self.assertEqual(profile.http_settings.circuit_breaker_cooldown_seconds, 15.0)
        adapters = profile.supplemental_adapters_factory()
        self.assertEqual(len(adapters), 1)
        self.assertEqual(adapters[0].metric_names, build_default_ragas_metric_names())

    def test_build_curriculum_live_profile_uses_repo_tracked_http_settings_instead_of_env(
        self,
    ) -> None:
        profile = build_curriculum_live_profile(
            env={
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_HTTP_READ_TIMEOUT_SECONDS": "90",
            }
        )

        with patch(
            "campus_evals.curriculum_live_benchmark.build_ragas_supplemental_adapter_from_env",
            return_value="adapter",
        ) as build_adapter:
            adapters = profile.supplemental_adapters_factory()

        self.assertEqual(adapters, ("adapter",))
        self.assertEqual(profile.http_settings.read_timeout_seconds, 180.0)
        self.assertEqual(profile.http_settings.request_min_interval_seconds, 1.0)
        self.assertEqual(profile.case_workers, 2)
        self.assertEqual(
            build_adapter.call_args.kwargs["http_settings"].read_timeout_seconds,
            180.0,
        )
        self.assertEqual(build_adapter.call_args.kwargs["faithfulness_nli_batch_size"], 6)

    def test_build_curriculum_live_profile_aligns_app_api_eval_timeout_with_profile_http_settings(
        self,
    ) -> None:
        profile = build_curriculum_live_profile(
            env={
                "APP_API_BASE_URL": "https://app-api.internal",
                "APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
                "APP_API_EVAL_USER_EMAIL": "eval-benchmark@example.edu",
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        with patch(
            "campus_evals.curriculum_live_benchmark.build_curriculum_live_executor",
            return_value="executor",
        ) as build_executor:
            executor = profile.executor_factory()

        self.assertEqual(executor, "executor")
        self.assertEqual(
            build_executor.call_args.kwargs["default_timeout_seconds"],
            profile.http_settings.read_timeout_seconds,
        )
