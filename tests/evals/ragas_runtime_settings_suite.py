from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    RagasSettings,
    SupplementalHTTPSettings,
    build_default_ragas_metric_names,
    build_ragas_supplemental_adapter_from_env,
    env_with_eval_provider_projection,
    unittest,
)


class RagasSettingsTest(unittest.TestCase):
    def test_supplemental_http_settings_from_env_reads_fine_grained_runtime_controls(self) -> None:
        settings = SupplementalHTTPSettings.from_env(
            {
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "2.5",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "18",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "7",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "1.5",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "1",
                "SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS": "0.25",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD": "4",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS": "45",
                "SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS": "6",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "0.5",
            }
        )

        self.assertEqual(settings.connect_timeout_seconds, 2.5)
        self.assertEqual(settings.read_timeout_seconds, 18.0)
        self.assertEqual(settings.write_timeout_seconds, 7.0)
        self.assertEqual(settings.pool_timeout_seconds, 1.5)
        self.assertEqual(settings.retry_attempts, 1)
        self.assertEqual(settings.retry_backoff_seconds, 0.25)
        self.assertEqual(settings.circuit_breaker_failure_threshold, 4)
        self.assertEqual(settings.circuit_breaker_cooldown_seconds, 45.0)
        self.assertEqual(settings.preflight_timeout_seconds, 6.0)
        self.assertEqual(settings.request_min_interval_seconds, 0.5)

    def test_supplemental_http_settings_derive_request_interval_from_requests_per_minute(
        self,
    ) -> None:
        settings = SupplementalHTTPSettings.from_env(
            {
                "SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE": "10",
            }
        )

        self.assertEqual(settings.requests_per_minute, 10.0)
        self.assertEqual(settings.request_min_interval_seconds, 6.0)

    def test_supplemental_http_settings_prefer_explicit_interval_over_requests_per_minute(
        self,
    ) -> None:
        settings = SupplementalHTTPSettings.from_env(
            {
                "SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE": "10",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "7.5",
            }
        )

        self.assertEqual(settings.requests_per_minute, 10.0)
        self.assertEqual(settings.request_min_interval_seconds, 7.5)

    def test_from_env_reads_provider_endpoints_and_profile_backed_models(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_BASE_URL": "https://wrong.example/v1",
                "EVAL_LLM_API_KEY": "wrong-key",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "75",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "9",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "2",
                "RAGAS_MAX_WORKERS": "2",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.llm_base_url, "https://llm.example/v1")
        self.assertEqual(settings.llm_api_key, "llm-key")
        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.embedding_base_url, "https://embed.example/v1")
        self.assertEqual(settings.embedding_api_key, "embed-key")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.http_settings.connect_timeout_seconds, 4.0)
        self.assertEqual(settings.http_settings.read_timeout_seconds, 75.0)
        self.assertEqual(settings.http_settings.write_timeout_seconds, 9.0)
        self.assertEqual(settings.http_settings.pool_timeout_seconds, 2.0)
        self.assertEqual(settings.http_settings.request_min_interval_seconds, 0.0)
        self.assertEqual(settings.reasoning_effort, "none")
        self.assertEqual(settings.text_verbosity, "low")
        self.assertEqual(settings.max_output_tokens, 256)
        self.assertEqual(settings.max_workers, 2)

    def test_from_env_uses_repo_tracked_eval_runtime_profile_for_model_and_runtime_knobs(
        self,
    ) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_BASE_URL": "https://llm.example/v1",
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_RAGAS_MODEL": "wrong-env-model",
                "EVAL_EMBEDDING_MODEL": "wrong-env-embedding",
                "RAGAS_REASONING_EFFORT": "high",
                "RAGAS_MAX_OUTPUT_TOKENS": "999",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.reasoning_effort, "none")
        self.assertEqual(settings.text_verbosity, "low")
        self.assertEqual(settings.max_output_tokens, 256)

    def test_from_env_reads_request_pacing_override(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.http_settings.request_min_interval_seconds, 12.5)

    def test_from_env_ignores_legacy_ragas_timeout_knobs(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "RAGAS_REQUEST_TIMEOUT_SECONDS": "180",
                "RAGAS_REQUEST_MIN_INTERVAL_SECONDS": "30",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.http_settings.connect_timeout_seconds, 10.0)
        self.assertEqual(settings.http_settings.read_timeout_seconds, 30.0)
        self.assertEqual(settings.http_settings.preflight_timeout_seconds, 20.0)
        self.assertEqual(settings.http_settings.request_min_interval_seconds, 0.0)

    def test_from_env_uses_eval_runtime_profile_without_model_env(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")

    def test_from_env_ignores_eval_ragas_model_as_env_entrypoint(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "wrong-env-model",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "wrong-env-embedding",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")

    def test_from_env_ignores_provider_handle_env_and_uses_projection(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_BASE_URL": "https://eval-llm.example/v1",
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "LLM_BASE_URL": "https://shared-llm.example/v1",
                "LLM_API_KEY": "shared-llm-key",
                "EVAL_EMBEDDING_BASE_URL": "https://eval-embed.example/v1",
                "EVAL_EMBEDDING_API_KEY": "eval-embed-key",
                "EMBEDDING_BASE_URL": "https://shared-embed.example/v1",
                "EMBEDDING_API_KEY": "shared-embed-key",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertEqual(settings.llm_base_url, "https://llm.example/v1")
        self.assertEqual(settings.llm_api_key, "llm-key")
        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.embedding_base_url, "https://embed.example/v1")
        self.assertEqual(settings.embedding_api_key, "embed-key")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")

    def test_from_env_ignores_eval_llm_transport_env_override(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
            }
        ) as env:
            default_settings = RagasSettings.from_env(env)
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_LLM_TRANSPORT": "chat_completions",
            }
        ) as env:
            shared_override = RagasSettings.from_env(env)
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_LLM_TRANSPORT": "responses",
                "EVAL_RAGAS_LLM_TRANSPORT": "chat_completions",
            }
        ) as env:
            surface_override = RagasSettings.from_env(env)

        self.assertEqual(default_settings.llm_transport, "responses")
        self.assertEqual(shared_override.llm_transport, "responses")
        self.assertEqual(surface_override.llm_transport, "responses")

    def test_constructor_rejects_unknown_eval_llm_transport(self) -> None:
        with self.assertRaisesRegex(ValueError, "eval runtime profile llm_transport"):
            RagasSettings(
                llm_api_key="llm-key",
                llm_model="gpt-5.4",
                llm_transport="legacy_sdk",
                embedding_api_key="embed-key",
                embedding_model="Qwen3-Embedding-4B",
            )

    def test_from_env_accepts_repo_tracked_http_settings_override(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4-eval",
                "EVAL_EMBEDDING_API_KEY": "eval-embed-key",
                "EVAL_EMBEDDING_MODEL": "text-embedding-3-large",
            },
        ) as env:
            settings = RagasSettings.from_env(
                env,
                http_settings=SupplementalHTTPSettings(read_timeout_seconds=45.0),
            )

        self.assertEqual(settings.http_settings.read_timeout_seconds, 45.0)

    def test_from_env_extends_statement_generation_read_timeout_without_widening_other_timeouts(
        self,
    ) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "30",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "9",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "2",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        statement_settings = settings.http_settings_for_metric_stage(
            metric_name="faithfulness",
            stage_name="statement_generation",
        )
        default_stage_settings = settings.http_settings_for_metric_stage(
            metric_name="faithfulness",
            stage_name="nli_verdicts",
        )

        self.assertEqual(statement_settings.read_timeout_seconds, 180.0)
        self.assertEqual(statement_settings.connect_timeout_seconds, 4.0)
        self.assertEqual(statement_settings.write_timeout_seconds, 9.0)
        self.assertEqual(statement_settings.pool_timeout_seconds, 2.0)
        self.assertEqual(default_stage_settings.read_timeout_seconds, 30.0)

    def test_from_env_ignores_prompt_language_adaptation_env_settings(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_RAGAS_TARGET_LANGUAGE": "chinese",
                "RAGAS_ADAPT_INSTRUCTION": "true",
            }
        ) as env:
            settings = RagasSettings.from_env(env)

        self.assertIsNone(settings.target_language)
        self.assertFalse(settings.adapt_instruction)

    def test_from_env_requires_llm_and_embedding_secrets_and_models(self) -> None:
        with self.assertRaisesRegex(ValueError, "provider projection path is required"):
            RagasSettings.from_env(
                {
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                    "EVAL_EMBEDDING_API_KEY": "embed-key",
                    "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                }
            )

    def test_build_ragas_supplemental_adapter_from_env_exposes_default_metric_names(self) -> None:
        with env_with_eval_provider_projection(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        ) as env:
            adapter = build_ragas_supplemental_adapter_from_env(env)

        self.assertEqual(adapter.metric_names, build_default_ragas_metric_names())
