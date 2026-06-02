from __future__ import annotations

import unittest

from .rebuild_local_data_test_support import *


class RebuildLocalDataRuntimeTest(unittest.TestCase):
    def test_rematerialize_curriculum_program_semester_facts_local_rebuild_passes_requested_source_documents(
        self,
    ) -> None:
        with patch(
            "campus_ingestion_core.local_rebuild_support.materialize_curriculum_program_semester_facts_from_canonical_scope"
        ) as materialize:
            materialize.return_value = SimpleNamespace(materialized_document_count=2)

            report = rematerialize_curriculum_program_semester_facts_from_local_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                },
                source_document_ids=(
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "curriculum:历史学（强基计划）本科人才培养方案",
                ),
            )

        materialize.assert_called_once_with(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            object_store=None,
            registry=None,
            raw_asset_registry=None,
            split_manifest_documents=None,
            raw_asset_record=None,
            source_document_units_keys=None,
            source_document_ids=(
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:历史学（强基计划）本科人才培养方案",
            ),
        )
        self.assertEqual(report.materialized_document_count, 2)

    def test_resolve_ingestion_qdrant_timeout_defaults_to_offline_budget(self) -> None:
        self.assertEqual(
            _resolve_ingestion_qdrant_timeout_seconds(source={}, default_timeout_seconds=10.0),
            60.0,
        )
        self.assertEqual(
            _resolve_ingestion_qdrant_timeout_seconds(source={}, default_timeout_seconds=90.0),
            90.0,
        )

    def test_resolve_ingestion_qdrant_timeout_honors_override(self) -> None:
        self.assertEqual(
            _resolve_ingestion_qdrant_timeout_seconds(
                source={"INGESTION_QDRANT_TIMEOUT_SECONDS": "25"},
                default_timeout_seconds=10.0,
            ),
            25.0,
        )
        with self.assertRaisesRegex(ValueError, "INGESTION_QDRANT_TIMEOUT_SECONDS"):
            _resolve_ingestion_qdrant_timeout_seconds(
                source={"INGESTION_QDRANT_TIMEOUT_SECONDS": "0"},
                default_timeout_seconds=10.0,
            )

    @patch("campus_ingestion_core.local_rebuild_runtime.QdrantClient")
    def test_build_qdrant_client_uses_ingestion_timeout_budget(self, qdrant_client) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://qdrant.example.com",
            qdrant_api_key="test-key",
            qdrant_timeout_seconds=10.0,
        )

        client = _build_qdrant_client(settings, source={})

        self.assertIs(client, qdrant_client.return_value)
        qdrant_client.assert_called_once_with(
            url="https://qdrant.example.com",
            api_key="test-key",
            timeout=60.0,
            cloud_inference=False,
            check_compatibility=False,
            trust_env=False,
        )
