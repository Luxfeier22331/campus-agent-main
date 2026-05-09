from __future__ import annotations

import json
import unittest

from campus_ingestion_core.regulation_rag_release_manifest_audit import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    audit_regulation_rag_release_manifests,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_json(self, *, bucket: str, key: str, payload: dict[str, object]) -> None:
        self.objects[(bucket, key)] = (json.dumps(payload, ensure_ascii=False) + "\n").encode(
            "utf-8"
        )


class RegulationRagReleaseManifestAuditTest(unittest.TestCase):
    def test_audit_reports_release_and_admission_manifest_field_completeness(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-derived"
        release_id = "r20260507_154528_764347_1005cea7"
        release_key = f"regulations/releases/student_rules/{release_id}/index-release.json"
        admission_key = (
            "regulations/operations/regulation-rag-release-admission/"
            "adm-20260507-154500/student_rules/release-admission.json"
        )
        object_store.put_json(
            bucket=bucket,
            key=release_key,
            payload={
                "release_id": release_id,
                "corpus": "regulations",
                "collection": "student_rules",
                "serving_alias": "student_rules",
                "physical_collection_name": f"student_rules__{release_id}",
                "cleaning_policy_version": "student_rules_cleaning_v1",
                "chunk_policy_version": "student_rules_semantic_v3",
                "embedding_model": "text-embedding-3-large",
                "indexed_at": "2026-05-07T15:45:28+00:00",
                "published_at": "2026-05-07T15:46:12+00:00",
                "document_count": 2,
                "point_count": 42,
                "document_version_ids_hash": "sha256:versions",
                "document_units_keys_hash": "sha256:document-units",
                "documents": [
                    {
                        "document_id": "handbook:doc-a",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-a",
                        "document_units_object_key": "regulations/doc-a/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-a",
                    },
                    {
                        "document_id": "handbook:doc-b",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-b",
                        "document_units_object_key": "regulations/doc-b/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-b",
                    },
                ],
                "validation_status": "passed",
                "retrieval_acceptance_status": "passed",
                "retrieval_acceptance_summary_object_key": (
                    f"regulations/releases/student_rules/{release_id}/"
                    "retrieval-acceptance-summary.json"
                ),
                "chunk_quality_status": "passed",
                "qrels_coverage_status": "passed",
                "release_admission_manifest_key": admission_key,
                "release_admission_status": "passed",
                "component_eval_status": "passed",
                "component_eval_summary_object_key": (
                    f"regulations/releases/student_rules/{release_id}/component-eval-summary.json"
                ),
                "post_publish_audit_status": "passed",
                "post_publish_audit_summary_object_key": (
                    f"regulations/releases/student_rules/{release_id}/post-publish-audit-summary.json"
                ),
            },
        )
        object_store.put_json(
            bucket=bucket,
            key=admission_key,
            payload={
                "schema_version": "regulation_rag_release_admission.v1",
                "policy_version": "regulation_rag_release_admission_policy.v2",
                "admission_run_id": "adm-20260507-154500",
                "corpus": "regulations",
                "collection": "student_rules",
                "admission_status": "passed",
                "admitted_at": "2026-05-07T15:45:00+00:00",
                "cleaning_policy_version": "student_rules_cleaning_v1",
                "chunk_profile_version": "student_rules_semantic_v3",
                "runtime_profile_identity": "sha256:profile",
                "document_count": 2,
                "documents": [
                    {
                        "document_id": "handbook:doc-a",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-a",
                        "content_hash": "hash-a",
                        "document_units_object_key": "regulations/doc-a/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-a",
                        "cleaning_policy_version": "student_rules_cleaning_v1",
                        "chunk_profile_version": "student_rules_semantic_v3",
                        "runtime_profile_identity": "sha256:profile",
                        "reader_current_version_id": "v1:doc-a",
                    },
                    {
                        "document_id": "handbook:doc-b",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-b",
                        "content_hash": "hash-b",
                        "document_units_object_key": "regulations/doc-b/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-b",
                        "cleaning_policy_version": "student_rules_cleaning_v1",
                        "chunk_profile_version": "student_rules_semantic_v3",
                        "runtime_profile_identity": "sha256:profile",
                        "reader_current_version_id": "v1:doc-b",
                    },
                ],
                "chunk_quality_status": "passed",
                "answer_ready_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                "answer_ready_contract_status": "passed",
                "answer_ready_required_field_failures": [],
                "answer_ready_semantic_failures": [],
                "qrels_coverage_status": "passed",
                "reader_publish_status": "passed",
                "authz_denial_check_status": "passed",
                "semantic_oracle_status": "passed",
                "fallback_budget_status": "passed",
                "notes": [],
            },
        )

        report = audit_regulation_rag_release_manifests(
            reader=object_store,
            bucket=bucket,
            corpus="regulations",
            collection="student_rules",
            release_id=release_id,
        )

        self.assertEqual(report["overall_status"], "passed")
        self.assertEqual(report["release_manifest_status"], "passed")
        self.assertEqual(report["admission_manifest_status"], "passed")
        self.assertEqual(report["cross_check_status"], "passed")
        self.assertEqual(report["release_manifest_object_key"], release_key)
        self.assertEqual(report["admission_manifest_object_key"], admission_key)
        self.assertEqual(report["release_manifest_missing_fields"], [])
        self.assertEqual(report["admission_manifest_missing_fields"], [])
        self.assertEqual(report["cross_check_issues"], [])
        self.assertEqual(
            report["admission_manifest_summary"]["answer_ready_contract_version"],
            ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        )
        self.assertEqual(
            report["admission_manifest_summary"]["document_ids"],
            ["handbook:doc-a", "handbook:doc-b"],
        )
        self.assertEqual(
            report["admission_manifest_summary"]["version_ids"],
            ["v1:doc-a", "v1:doc-b"],
        )
        self.assertTrue(report["release_manifest_fields"]["release_id"]["present"])
        self.assertTrue(
            report["admission_manifest_fields"]["answer_ready_contract_version"]["present"]
        )

    def test_audit_flags_missing_release_admission_pointer_and_wrong_contract_version(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-derived"
        release_id = "r1"
        release_key = f"regulations/releases/student_rules/{release_id}/index-release.json"
        object_store.put_json(
            bucket=bucket,
            key=release_key,
            payload={
                "release_id": release_id,
                "corpus": "regulations",
                "collection": "student_rules",
                "physical_collection_name": "student_rules__r1",
                "serving_alias": "student_rules",
                "cleaning_policy_version": "student_rules_cleaning_v1",
                "chunk_policy_version": "student_rules_semantic_v3",
                "embedding_model": "text-embedding-3-large",
                "indexed_at": "2026-05-07T15:45:28+00:00",
                "document_count": 0,
                "point_count": 0,
                "document_version_ids_hash": "sha256:versions",
                "document_units_keys_hash": "sha256:document-units",
                "documents": [],
                "validation_status": "passed",
                "retrieval_acceptance_status": "passed",
                "chunk_quality_status": "passed",
                "qrels_coverage_status": "passed",
                "release_admission_status": "passed",
                "component_eval_status": "passed",
                "post_publish_audit_status": "passed",
            },
        )

        report = audit_regulation_rag_release_manifests(
            reader=object_store,
            bucket=bucket,
            corpus="regulations",
            collection="student_rules",
            release_id=release_id,
        )

        self.assertEqual(report["overall_status"], "failed")
        self.assertEqual(report["release_manifest_status"], "failed")
        self.assertEqual(report["admission_manifest_status"], "failed")
        self.assertIn("release_admission_manifest_key", report["release_manifest_missing_fields"])
        self.assertIn("release_admission_manifest_key_missing", report["cross_check_issues"])

    def test_audit_flags_release_published_before_admission_manifest_timestamp(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-derived"
        release_id = "r20260509_071445_145990_6a88f8b8"
        release_key = f"regulations/releases/institutional_rules/{release_id}/index-release.json"
        admission_key = (
            "regulations/operations/regulation-rag-release-admission/"
            "admit-20260509-institutional-rules-rebuild-v6-final/"
            "institutional_rules/release-admission.json"
        )
        object_store.put_json(
            bucket=bucket,
            key=release_key,
            payload={
                "release_id": release_id,
                "corpus": "regulations",
                "collection": "institutional_rules",
                "serving_alias": "institutional_rules",
                "physical_collection_name": f"institutional_rules__{release_id}",
                "cleaning_policy_version": "institutional_rules_cleaning_v1",
                "chunk_policy_version": "institutional_rules_semantic_v1",
                "embedding_model": "Qwen3-Embedding-4B",
                "indexed_at": "2026-05-09T07:14:45+00:00",
                "published_at": "2026-05-09T07:17:08.736382+00:00",
                "document_count": 1,
                "point_count": 1,
                "document_version_ids_hash": "sha256:versions",
                "document_units_keys_hash": "sha256:document-units",
                "documents": [
                    {
                        "document_id": "institutional_regulation:doc-a",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-a",
                        "document_units_object_key": "regulations/doc-a/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-a",
                    }
                ],
                "validation_status": "passed",
                "retrieval_acceptance_status": "passed",
                "chunk_quality_status": "passed",
                "qrels_coverage_status": "passed",
                "release_admission_manifest_key": admission_key,
                "release_admission_status": "passed",
                "component_eval_status": "passed",
                "post_publish_audit_status": "passed",
            },
        )
        object_store.put_json(
            bucket=bucket,
            key=admission_key,
            payload={
                "schema_version": "regulation_rag_release_admission.v1",
                "policy_version": "regulation_rag_release_admission_policy.v2",
                "admission_run_id": "admit-20260509-institutional-rules-rebuild-v6-final",
                "corpus": "regulations",
                "collection": "institutional_rules",
                "admission_status": "passed",
                "admitted_at": "2026-05-09T07:18:36.535896+00:00",
                "cleaning_policy_version": "institutional_rules_cleaning_v1",
                "chunk_profile_version": "institutional_rules_semantic_v1",
                "runtime_profile_identity": "sha256:profile",
                "document_count": 1,
                "documents": [
                    {
                        "document_id": "institutional_regulation:doc-a",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-a",
                        "content_hash": "hash-a",
                        "document_units_object_key": "regulations/doc-a/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-a",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "chunk_profile_version": "institutional_rules_semantic_v1",
                        "runtime_profile_identity": "sha256:profile",
                        "reader_current_version_id": "v1:doc-a",
                    }
                ],
                "chunk_quality_status": "passed",
                "answer_ready_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                "answer_ready_contract_status": "passed",
                "answer_ready_required_field_failures": [],
                "answer_ready_semantic_failures": [],
                "qrels_coverage_status": "passed",
                "reader_publish_status": "passed",
                "authz_denial_check_status": "passed",
                "semantic_oracle_status": "passed",
                "fallback_budget_status": "passed",
                "notes": [],
            },
        )

        report = audit_regulation_rag_release_manifests(
            reader=object_store,
            bucket=bucket,
            corpus="regulations",
            collection="institutional_rules",
            release_id=release_id,
        )

        self.assertEqual(report["overall_status"], "failed")
        self.assertEqual(report["cross_check_status"], "failed")
        self.assertIn("admission_after_publish", report["cross_check_issues"])

    def test_audit_flags_offsetless_timestamps_as_invalid(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-derived"
        release_id = "r-offsetless-time"
        release_key = f"regulations/releases/institutional_rules/{release_id}/index-release.json"
        admission_key = (
            "regulations/operations/regulation-rag-release-admission/"
            "admit-offsetless-time/institutional_rules/release-admission.json"
        )
        object_store.put_json(
            bucket=bucket,
            key=release_key,
            payload={
                "release_id": release_id,
                "corpus": "regulations",
                "collection": "institutional_rules",
                "serving_alias": "institutional_rules",
                "physical_collection_name": f"institutional_rules__{release_id}",
                "cleaning_policy_version": "institutional_rules_cleaning_v1",
                "chunk_policy_version": "institutional_rules_semantic_v1",
                "embedding_model": "Qwen3-Embedding-4B",
                "indexed_at": "2026-05-09T07:14:45+00:00",
                "published_at": "2026-05-09T07:17:08",
                "document_count": 1,
                "point_count": 1,
                "document_version_ids_hash": "sha256:versions",
                "document_units_keys_hash": "sha256:document-units",
                "documents": [
                    {
                        "document_id": "institutional_regulation:doc-a",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-a",
                        "document_units_object_key": "regulations/doc-a/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-a",
                    }
                ],
                "validation_status": "passed",
                "retrieval_acceptance_status": "passed",
                "chunk_quality_status": "passed",
                "qrels_coverage_status": "passed",
                "release_admission_manifest_key": admission_key,
                "release_admission_status": "passed",
                "component_eval_status": "passed",
                "post_publish_audit_status": "passed",
            },
        )
        object_store.put_json(
            bucket=bucket,
            key=admission_key,
            payload={
                "schema_version": "regulation_rag_release_admission.v1",
                "policy_version": "regulation_rag_release_admission_policy.v2",
                "admission_run_id": "admit-offsetless-time",
                "corpus": "regulations",
                "collection": "institutional_rules",
                "admission_status": "passed",
                "admitted_at": "2026-05-09T07:18:36+00:00",
                "cleaning_policy_version": "institutional_rules_cleaning_v1",
                "chunk_profile_version": "institutional_rules_semantic_v1",
                "runtime_profile_identity": "sha256:profile",
                "document_count": 1,
                "documents": [
                    {
                        "document_id": "institutional_regulation:doc-a",
                        "revision_track": "current-effective",
                        "version_id": "v1:doc-a",
                        "content_hash": "hash-a",
                        "document_units_object_key": "regulations/doc-a/document-units.jsonl",
                        "document_units_sha256": "sha256-doc-a",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "chunk_profile_version": "institutional_rules_semantic_v1",
                        "runtime_profile_identity": "sha256:profile",
                        "reader_current_version_id": "v1:doc-a",
                    }
                ],
                "chunk_quality_status": "passed",
                "answer_ready_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                "answer_ready_contract_status": "passed",
                "answer_ready_required_field_failures": [],
                "answer_ready_semantic_failures": [],
                "qrels_coverage_status": "passed",
                "reader_publish_status": "passed",
                "authz_denial_check_status": "passed",
                "semantic_oracle_status": "passed",
                "fallback_budget_status": "passed",
                "notes": [],
            },
        )

        report = audit_regulation_rag_release_manifests(
            reader=object_store,
            bucket=bucket,
            corpus="regulations",
            collection="institutional_rules",
            release_id=release_id,
        )

        self.assertEqual(report["overall_status"], "failed")
        self.assertEqual(report["cross_check_status"], "failed")
        self.assertIn("published_at_invalid", report["cross_check_issues"])


if __name__ == "__main__":
    unittest.main()
