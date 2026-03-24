from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model


class EmbeddingProviderAliasTest(unittest.TestCase):
    @patch("campus_ingestion_core.embed.OpenAIEmbedding")
    def test_build_embedding_model_uses_openai_embedding_for_official_provider(self, openai_embedding) -> None:
        settings = EmbeddingSettings(
            provider="openai",
            model="text-embedding-3-large",
            api_key="test-key",
            api_base="https://example.invalid/v1",
            timeout_seconds=15.0,
            embed_batch_size=32,
        )

        model = build_embedding_model(settings)

        self.assertIs(model, openai_embedding.return_value)
        openai_embedding.assert_called_once_with(
            model="text-embedding-3-large",
            api_key="test-key",
            api_base="https://example.invalid/v1",
            timeout=15.0,
            embed_batch_size=32,
            model_name="text-embedding-3-large",
        )

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
        )
        self.assertEqual(sync_client.embeddings.create.call_count, 2)
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[0].kwargs,
            {"input": ["手册正文"], "model": "Qwen3-Embedding-4B"},
        )
        self.assertEqual(
            sync_client.embeddings.create.call_args_list[1].kwargs,
            {"input": ["学生管理规定"], "model": "Qwen3-Embedding-4B"},
        )


if __name__ == "__main__":
    unittest.main()
