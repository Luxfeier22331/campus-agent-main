from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

import httpx
from campus_ingestion_core.embed import (
    EmbeddingSettings,
    build_embedding_model,
    validate_ingestion_retrieval_embedding_env_alignment,
)


class EmbeddingProviderAliasTest(unittest.TestCase):
    def test_embedding_settings_from_env_defaults_to_gitee_qwen_baseline(self) -> None:
        settings = EmbeddingSettings.from_env({})

        self.assertEqual(settings.provider, "gitee")
        self.assertEqual(settings.model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.dimensions, 2560)

    def test_embedding_settings_default_qwen3_dimensions_to_native_width(self) -> None:
        settings = EmbeddingSettings.from_env(
            {
                "EMBEDDING_PROVIDER": "gitee",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(settings.dimensions, 2560)

    def test_embedding_alignment_rejects_ingestion_model_without_matching_retrieval_model(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "embedding model mismatch"):
            validate_ingestion_retrieval_embedding_env_alignment(
                {
                    "INGESTION_EMBEDDING_MODEL": "fixture-ingestion-model",
                }
            )

    def test_embedding_alignment_rejects_ingestion_dimensions_without_matching_retrieval_dimensions(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "embedding dimensions mismatch"):
            validate_ingestion_retrieval_embedding_env_alignment(
                {
                    "INGESTION_EMBEDDING_DIMENSIONS": "1536",
                }
            )

    def test_mock_embedding_provider_respects_configured_dimensions(self) -> None:
        settings = EmbeddingSettings(
            provider="mock",
            model="mock-embedding-8d",
            dimensions=8,
        )

        model = build_embedding_model(settings)

        self.assertEqual(len(model.get_text_embedding("测试正文")), 8)

    @patch("campus_ingestion_core.embed.OpenAIEmbedding")
    def test_build_embedding_model_uses_openai_embedding_for_official_provider(
        self, openai_embedding
    ) -> None:
        settings = EmbeddingSettings(
            provider="openai",
            model="Qwen3-Embedding-4B",
            dimensions=2560,
            api_key="test-key",
            api_base="https://example.invalid/v1",
            timeout_seconds=15.0,
            embed_batch_size=32,
        )

        model = build_embedding_model(settings)

        self.assertIs(model, openai_embedding.return_value)
        openai_embedding.assert_called_once_with(
            model="Qwen3-Embedding-4B",
            api_key="test-key",
            api_base="https://example.invalid/v1",
            dimensions=2560,
            timeout=15.0,
            embed_batch_size=32,
            model_name="Qwen3-Embedding-4B",
            http_client=unittest.mock.ANY,
            async_http_client=unittest.mock.ANY,
        )
        _, kwargs = openai_embedding.call_args
        self.assertIsInstance(kwargs["http_client"], httpx.Client)
        self.assertFalse(kwargs["http_client"]._trust_env)
        self.assertIsInstance(kwargs["async_http_client"], httpx.AsyncClient)
        self.assertFalse(kwargs["async_http_client"]._trust_env)

    @patch("campus_ingestion_core.embed.OpenAI")
    @patch("campus_ingestion_core.embed.AsyncOpenAI")
    def test_build_embedding_model_treats_gitee_as_openai_compatible_custom_model(
        self,
        async_openai,
        openai_client,
    ) -> None:
        sync_client = Mock()
        sync_client.embeddings.create.side_effect = [
            Mock(data=[Mock(embedding=[0.1, 0.2, 0.3])]),
            Mock(data=[Mock(embedding=[0.4, 0.5, 0.6])]),
        ]
        openai_client.return_value = sync_client
        async_openai.return_value = Mock()
        settings = EmbeddingSettings(
            provider="gitee",
            model="Qwen3-Embedding-4B",
            api_key="test-key",
            api_base="https://example.invalid/v1",
            timeout_seconds=15.0,
            embed_batch_size=32,
        )

        model = build_embedding_model(settings)

        self.assertEqual(model.get_text_embedding("手册正文"), [0.1, 0.2, 0.3])
        self.assertEqual(model.get_query_embedding("学生管理规定"), [0.4, 0.5, 0.6])
        openai_client.assert_called_once_with(
            api_key="test-key",
            base_url="https://example.invalid/v1",
            timeout=15.0,
            max_retries=10,
            http_client=unittest.mock.ANY,
        )
        async_openai.assert_called_once_with(
            api_key="test-key",
            base_url="https://example.invalid/v1",
            timeout=15.0,
            max_retries=10,
            http_client=unittest.mock.ANY,
        )
        _, sync_kwargs = openai_client.call_args
        self.assertIsInstance(sync_kwargs["http_client"], httpx.Client)
        self.assertFalse(sync_kwargs["http_client"]._trust_env)
        _, async_kwargs = async_openai.call_args
        self.assertIsInstance(async_kwargs["http_client"], httpx.AsyncClient)
        self.assertFalse(async_kwargs["http_client"]._trust_env)
        self.assertEqual(sync_client.embeddings.create.call_count, 2)
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[0].kwargs,
            {"input": ["手册正文"], "model": "Qwen3-Embedding-4B", "dimensions": 2560},
        )
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[1].kwargs,
            {"input": ["学生管理规定"], "model": "Qwen3-Embedding-4B", "dimensions": 2560},
        )

    @patch("campus_ingestion_core.embed.OpenAI")
    @patch("campus_ingestion_core.embed.AsyncOpenAI")
    def test_gitee_embedding_batches_text_embeddings_in_single_request(
        self,
        async_openai,
        openai_client,
    ) -> None:
        sync_client = Mock()
        sync_client.embeddings.create.return_value = Mock(
            data=[
                Mock(embedding=[0.1, 0.2, 0.3]),
                Mock(embedding=[0.4, 0.5, 0.6]),
            ]
        )
        openai_client.return_value = sync_client
        async_openai.return_value = Mock()
        settings = EmbeddingSettings(
            provider="gitee",
            model="Qwen3-Embedding-4B",
            api_key="test-key",
            api_base="https://example.invalid/v1",
            timeout_seconds=15.0,
            embed_batch_size=32,
        )

        model = build_embedding_model(settings)
        result = model.get_text_embedding_batch(["手册正文", "学生管理规定"])

        self.assertEqual(result, [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
        sync_client.embeddings.create.assert_called_once_with(
            input=["手册正文", "学生管理规定"],
            model="Qwen3-Embedding-4B",
            dimensions=2560,
        )

    @patch("campus_ingestion_core.embed.OpenAI")
    @patch("campus_ingestion_core.embed.AsyncOpenAI")
    def test_gitee_embedding_recursively_splits_batch_when_provider_rejects_large_request(
        self,
        async_openai,
        openai_client,
    ) -> None:
        sync_client = Mock()
        sync_client.embeddings.create.side_effect = [
            RuntimeError("provider rejected batch"),
            Mock(
                data=[
                    Mock(embedding=[0.1, 0.2, 0.3]),
                    Mock(embedding=[0.4, 0.5, 0.6]),
                ]
            ),
            Mock(
                data=[
                    Mock(embedding=[0.7, 0.8, 0.9]),
                    Mock(embedding=[1.0, 1.1, 1.2]),
                ]
            ),
        ]
        openai_client.return_value = sync_client
        async_openai.return_value = Mock()
        settings = EmbeddingSettings(
            provider="gitee",
            model="Qwen3-Embedding-4B",
            api_key="test-key",
            api_base="https://example.invalid/v1",
            timeout_seconds=15.0,
            embed_batch_size=32,
        )

        model = build_embedding_model(settings)
        result = model.get_text_embedding_batch(["甲", "乙", "丙", "丁"])

        self.assertEqual(
            result,
            [
                [0.1, 0.2, 0.3],
                [0.4, 0.5, 0.6],
                [0.7, 0.8, 0.9],
                [1.0, 1.1, 1.2],
            ],
        )
        self.assertEqual(sync_client.embeddings.create.call_count, 3)
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[0].kwargs,
            {"input": ["甲", "乙", "丙", "丁"], "model": "Qwen3-Embedding-4B", "dimensions": 2560},
        )
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[1].kwargs,
            {"input": ["甲", "乙"], "model": "Qwen3-Embedding-4B", "dimensions": 2560},
        )
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[2].kwargs,
            {"input": ["丙", "丁"], "model": "Qwen3-Embedding-4B", "dimensions": 2560},
        )


if __name__ == "__main__":
    unittest.main()
