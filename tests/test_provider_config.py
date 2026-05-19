from __future__ import annotations

import unittest

from campus_shared.provider_config import (
    ProviderConfigResolutionError,
    resolve_provider_config,
)


class ProviderConfigTest(unittest.TestCase):
    def test_reads_explicit_eval_scoped_provider_keys(self) -> None:
        env = {
            "LLM_API_KEY": "shared-llm",
            "EMBEDDING_API_KEY": "shared-embed",
            "EVAL_LLM_API_KEY": "eval-llm",
            "EVAL_EMBEDDING_API_KEY": "eval-embed",
        }

        resolved = resolve_provider_config("ragas", env=env)

        self.assertEqual(resolved.llm_api_key, "eval-llm")
        self.assertEqual(resolved.embedding_api_key, "eval-embed")

    def test_uses_shared_provider_keys_when_eval_scoped_keys_are_missing(self) -> None:
        env = {"LLM_API_KEY": "shared-llm", "EMBEDDING_API_KEY": "shared-embed"}

        resolved = resolve_provider_config("ragas", env=env)

        self.assertEqual(resolved.llm_api_key, "shared-llm")
        self.assertEqual(resolved.llm_api_key_source, "LLM_API_KEY")
        self.assertEqual(resolved.embedding_api_key, "shared-embed")
        self.assertEqual(resolved.embedding_api_key_source, "EMBEDDING_API_KEY")

    def test_missing_embedding_key_reports_surface_and_checked_keys_without_leaking_secrets(
        self,
    ) -> None:
        env = {"EVAL_LLM_API_KEY": "eval-llm"}

        with self.assertRaises(ProviderConfigResolutionError) as cm:
            resolve_provider_config("ragas", env=env)

        error = cm.exception
        self.assertEqual(error.surface_name, "ragas")
        self.assertEqual(
            error.checked_keys,
            ("EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"),
        )
        self.assertIn("ragas", str(error))
        self.assertIn("EVAL_EMBEDDING_API_KEY", str(error))
        self.assertIn("EMBEDDING_API_KEY", str(error))
        self.assertNotIn("eval-llm", str(error))
