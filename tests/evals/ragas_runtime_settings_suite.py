from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    ProviderConfigResolutionError,
    RagasSettings,
    SupplementalHTTPSettings,
    build_default_ragas_metric_names,
    build_ragas_supplemental_adapter_from_env,
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

    def test_from_env_reads_openai_compatible_llm_and_embedding_settings(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "75",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "9",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "2",
                "RAGAS_REASONING_EFFORT": "none",
                "RAGAS_TEXT_VERBOSITY": "low",
                "RAGAS_MAX_OUTPUT_TOKENS": "256",
                "RAGAS_MAX_WORKERS": "2",
            }
        )

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

    def test_from_env_reads_request_pacing_override(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        )

        self.assertEqual(settings.http_settings.request_min_interval_seconds, 12.5)

    def test_from_env_ignores_legacy_ragas_timeout_knobs(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "RAGAS_REQUEST_TIMEOUT_SECONDS": "180",
                "RAGAS_REQUEST_MIN_INTERVAL_SECONDS": "30",
            }
        )

        self.assertEqual(settings.http_settings.connect_timeout_seconds, 10.0)
        self.assertEqual(settings.http_settings.read_timeout_seconds, 30.0)
        self.assertEqual(settings.http_settings.preflight_timeout_seconds, 20.0)
        self.assertEqual(settings.http_settings.request_min_interval_seconds, 0.0)

    def test_from_env_requires_eval_ragas_model(self) -> None:
        with self.assertRaisesRegex(ValueError, "EVAL_RAGAS_MODEL is required"):
            RagasSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                    "EMBEDDING_API_KEY": "embed-key",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                }
            )

    def test_from_env_uses_eval_ragas_model_as_single_model_entrypoint(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(settings.llm_model, "gpt-5.4")

    def test_from_env_prefers_eval_scoped_keys_over_shared_runtime_keys(self) -> None:
        settings = RagasSettings.from_env(
            {
                "EVAL_LLM_BASE_URL": "https://eval-llm.example/v1",
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4-eval",
                "LLM_BASE_URL": "https://shared-llm.example/v1",
                "LLM_API_KEY": "shared-llm-key",
                "EVAL_EMBEDDING_BASE_URL": "https://eval-embed.example/v1",
                "EVAL_EMBEDDING_API_KEY": "eval-embed-key",
                "EVAL_EMBEDDING_MODEL": "text-embedding-3-large",
                "EMBEDDING_BASE_URL": "https://shared-embed.example/v1",
                "EMBEDDING_API_KEY": "shared-embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(settings.llm_base_url, "https://eval-llm.example/v1")
        self.assertEqual(settings.llm_api_key, "eval-llm-key")
        self.assertEqual(settings.llm_model, "gpt-5.4-eval")
        self.assertEqual(settings.embedding_base_url, "https://eval-embed.example/v1")
        self.assertEqual(settings.embedding_api_key, "eval-embed-key")
        self.assertEqual(settings.embedding_model, "text-embedding-3-large")

    def test_from_env_reads_eval_llm_transport_with_surface_override(self) -> None:
        default_settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        shared_override = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_LLM_TRANSPORT": "chat_completions",
            }
        )
        surface_override = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_LLM_TRANSPORT": "responses",
                "EVAL_RAGAS_LLM_TRANSPORT": "chat_completions",
            }
        )

        self.assertEqual(default_settings.llm_transport, "responses")
        self.assertEqual(shared_override.llm_transport, "chat_completions")
        self.assertEqual(surface_override.llm_transport, "chat_completions")

    def test_from_env_rejects_unknown_eval_llm_transport(self) -> None:
        with self.assertRaisesRegex(ValueError, "EVAL_LLM_TRANSPORT must be one of"):
            RagasSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                    "EMBEDDING_API_KEY": "embed-key",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "EVAL_LLM_TRANSPORT": "legacy_sdk",
                }
            )

    def test_from_env_accepts_repo_tracked_http_settings_override(self) -> None:
        settings = RagasSettings.from_env(
            {
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4-eval",
                "EVAL_EMBEDDING_API_KEY": "eval-embed-key",
                "EVAL_EMBEDDING_MODEL": "text-embedding-3-large",
            },
            http_settings=SupplementalHTTPSettings(read_timeout_seconds=45.0),
        )

        self.assertEqual(settings.http_settings.read_timeout_seconds, 45.0)

    def test_from_env_extends_statement_generation_read_timeout_without_widening_other_timeouts(
        self,
    ) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "30",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "9",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "2",
            }
        )

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

    def test_from_env_reads_prompt_language_adaptation_settings(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_RAGAS_TARGET_LANGUAGE": "chinese",
                "RAGAS_ADAPT_INSTRUCTION": "true",
            }
        )

        self.assertEqual(settings.target_language, "chinese")
        self.assertTrue(settings.adapt_instruction)

    def test_from_env_requires_llm_and_embedding_secrets_and_models(self) -> None:
        with self.assertRaises(ProviderConfigResolutionError) as raised:
            RagasSettings.from_env(
                {
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                    "EMBEDDING_API_KEY": "embed-key",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                }
            )
        self.assertEqual(raised.exception.surface_name, "eval.ragas")
        self.assertEqual(raised.exception.checked_keys, ("EVAL_LLM_API_KEY", "LLM_API_KEY"))
        self.assertIn("eval.ragas", str(raised.exception))
        self.assertIn("EVAL_LLM_API_KEY", str(raised.exception))

    def test_build_ragas_supplemental_adapter_from_env_exposes_default_metric_names(self) -> None:
        adapter = build_ragas_supplemental_adapter_from_env(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(adapter.metric_names, build_default_ragas_metric_names())
