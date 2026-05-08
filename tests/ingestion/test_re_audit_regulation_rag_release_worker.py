from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.re_audit_regulation_rag_release")


class ReAuditRegulationRagReleaseWorkerCliTest(unittest.TestCase):
    def test_main_rewrites_post_publish_audit_for_existing_release(self) -> None:
        fake_manifest = type(
            "Manifest",
            (),
            {
                "release_id": "r1",
                "corpus": "regulations",
                "collection": "student_rules",
                "serving_alias": "student_rules",
                "physical_collection_name": "student_rules__r1",
                "cleaning_policy_version": "student_rules_cleaning_v1",
                "chunk_policy_version": "student_rules_semantic_v3",
                "validation_status": "passed",
                "embedding_provider": "mock",
                "embedding_model": "mock-embedding-8d",
                "embedding_dimensions": 3,
                "document_units_content_hash": "du-hash",
                "chunk_fingerprint_hash": "chunk-hash",
                "retrieval_acceptance_status": "passed",
                "retrieval_acceptance_summary_object_key": "retrieval.json",
                "sparse_provider": "mock",
                "sparse_model": "mock",
                "sparse_tokenizer": "",
                "sparse_language": "",
                "dense_vector_name": "dense",
                "sparse_vector_name": "sparse",
                "dense_prefetch_limit": 32,
                "sparse_prefetch_limit": 32,
                "rrf_k": 60,
                "rrf_dense_weight": 1.0,
                "rrf_sparse_weight": 1.0,
                "reranker_enabled_by_default": False,
                "reranker_top_n": None,
                "reranker_profile_version": "",
                "reranker_adoption_evidence_id": "",
                "embedding_query_instruction_hash": "instr-hash",
                "hybrid_query_profile_hash": "hybrid-hash",
                "profile_identity_hash": "profile-hash",
                "quality_gate_status": "passed",
                "validation_summary_object_key": "validation.json",
                "quality_gate_summary_object_key": "quality.json",
                "chunk_quality_status": "passed",
                "qrels_coverage_status": "passed",
                "release_metadata_consistency_status": "passed",
                "release_admission_manifest_key": "admission.json",
                "release_admission_status": "passed",
                "component_eval_status": "passed",
                "component_eval_summary_object_key": "component-eval-summary.json",
                "post_publish_audit_status": "passed",
                "post_publish_audit_summary_object_key": (
                    "regulations/releases/student_rules/r1/post-publish-audit-summary.json"
                ),
            },
        )()
        fake_artifacts = type(
            "Artifacts",
            (),
            {
                "manifest_object_key": "regulations/releases/student_rules/r1/index-release.json",
                "manifest": type(
                    "Manifest",
                    (),
                    {
                        "post_publish_audit_summary_object_key": (
                            "regulations/releases/student_rules/r1/post-publish-audit-summary.json"
                        ),
                        "post_publish_audit_status": "passed",
                        "component_eval_status": "passed",
                        "release_id": "r1",
                        "physical_collection_name": "student_rules__r1",
                    },
                )(),
            },
        )()
        with (
            patch("campus_ingestion_worker.re_audit_regulation_rag_release.load_worker_env"),
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release.load_index_release_manifest"
            ) as load_manifest,
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release.S3ObjectStoreAdmin"
            ) as object_store_cls,
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release.ObjectStoreSettings.from_env"
            ) as object_store_settings,
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release._build_qdrant_client"
            ) as build_qdrant,
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release.RetrievalSettings.from_env"
            ) as retrieval_settings,
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release.audit_published_scope_release"
            ) as audit_release,
            patch(
                "campus_ingestion_worker.re_audit_regulation_rag_release.write_index_release_artifacts"
            ) as write_artifacts,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            object_store = type(
                "ObjectStore",
                (),
                {
                    "get_bytes": staticmethod(
                        lambda **_kwargs: (json.dumps({"status": "passed"}) + "\n").encode("utf-8")
                    )
                },
            )()
            object_store_settings.return_value = type(
                "Settings",
                (),
                {"bucket_derived": "campus-rag-derived"},
            )()
            object_store_cls.return_value = object_store
            retrieval_settings.return_value = object()
            build_qdrant.return_value = object()
            load_manifest.return_value = fake_manifest
            audit_release.return_value = type(
                "AuditResult",
                (),
                {
                    "summary": {
                        "status": "passed",
                        "fallback_primary_signal_count": 0,
                        "semantic_oracle_pass_count": 9,
                        "semantic_oracle_fail_count": 0,
                    }
                },
            )()
            write_artifacts.return_value = fake_artifacts

            worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r1",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["audit"]["fallback_primary_signal_count"], 0)
        self.assertEqual(payload["audit"]["semantic_oracle_pass_count"], 9)
        self.assertEqual(payload["audit"]["semantic_oracle_fail_count"], 0)
        self.assertEqual(
            payload["post_publish_audit_summary_object_key"],
            "regulations/releases/student_rules/r1/post-publish-audit-summary.json",
        )


if __name__ == "__main__":
    unittest.main()
