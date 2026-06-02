from __future__ import annotations

import unittest

from campus_ingestion_core.sparse import (
    MockSparseEmbeddingSettings,
    SparseEmbeddingSettings,
    build_mock_sparse_embedding_model,
    build_sparse_embedding_model,
)
from qdrant_client.http import models as qdrant_models


class SparseEmbeddingModelTest(unittest.TestCase):
    def test_qdrant_sparse_model_builds_native_sparse_vectors_for_live_path(self) -> None:
        model = build_sparse_embedding_model(SparseEmbeddingSettings())

        document = model.build_document("学生奖学金评定办法")
        query = model.build_query("奖学金办法")

        self.assertIsInstance(document, qdrant_models.SparseVector)
        self.assertTrue(bool(document.indices))
        self.assertEqual(len(document.indices), len(document.values))
        self.assertIsInstance(query, qdrant_models.SparseVector)
        self.assertTrue(bool(query.indices))
        self.assertEqual(len(query.indices), len(query.values))

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
