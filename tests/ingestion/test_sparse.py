from __future__ import annotations

import unittest

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.sparse import (
    MockSparseEmbeddingSettings,
    SparseEmbeddingSettings,
    build_mock_sparse_embedding_model,
    build_sparse_embedding_model,
)
from qdrant_client.http import models as qdrant_models


class SparseEmbeddingModelTest(unittest.TestCase):
    def test_sparse_settings_from_collection_profile_ignore_env_override(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")

        settings = SparseEmbeddingSettings.from_collection_profile(
            profile,
            env={
                "SPARSE_PROVIDER": "wrong-provider",
                "SPARSE_MODEL": "wrong-model",
                "SPARSE_TOKENIZER": "word",
                "SPARSE_LANGUAGE": "en",
            },
        )

        self.assertEqual(settings.provider, "qdrant")
        self.assertEqual(settings.model, "qdrant/bm25")
        self.assertEqual(settings.tokenizer, "multilingual")
        self.assertEqual(settings.language, "none")

    def test_qdrant_sparse_model_builds_server_side_bm25_document_for_live_path(
        self,
    ) -> None:
        model = build_sparse_embedding_model(SparseEmbeddingSettings())

        document = model.build_document("学生奖学金评定办法")
        query = model.build_query("奖学金办法")

        self.assertIsInstance(document, qdrant_models.Document)
        self.assertEqual(document.text, "学生奖学金评定办法")
        self.assertEqual(document.model, "qdrant/bm25")
        self.assertIsInstance(document.options, qdrant_models.Bm25Config)
        self.assertEqual(document.options.tokenizer, qdrant_models.TokenizerType.MULTILINGUAL)
        self.assertEqual(document.options.language, "none")
        self.assertTrue(document.options.lowercase)
        self.assertFalse(document.options.ascii_folding)
        self.assertIsInstance(query, qdrant_models.Document)
        self.assertEqual(query.text, "奖学金办法")
        self.assertEqual(query.model, "qdrant/bm25")
        self.assertIsInstance(query.options, qdrant_models.Bm25Config)
        self.assertEqual(query.options.tokenizer, qdrant_models.TokenizerType.MULTILINGUAL)
        self.assertEqual(query.options.language, "none")

    def test_qdrant_sparse_model_returns_none_for_blank_query(self) -> None:
        model = build_sparse_embedding_model(SparseEmbeddingSettings())

        self.assertIsNone(model.build_query(" \t\n "))

    def test_mock_sparse_model_builds_deterministic_sparse_vector_for_tests(self) -> None:
        model = build_mock_sparse_embedding_model(MockSparseEmbeddingSettings())

        document = model.build_document("学生奖学金评定办法")
        query = model.build_query("奖学金办法")

        self.assertIsInstance(document, qdrant_models.SparseVector)
        self.assertTrue(bool(document.indices))
        self.assertEqual(len(document.indices), len(document.values))
        self.assertIsInstance(query, qdrant_models.SparseVector)
        self.assertTrue(bool(query.indices))
        self.assertEqual(len(query.indices), len(query.values))


if __name__ == "__main__":
    unittest.main()
