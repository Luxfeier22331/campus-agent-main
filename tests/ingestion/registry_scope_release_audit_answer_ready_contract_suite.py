from __future__ import annotations

from types import SimpleNamespace

from campus_ingestion_core.index_release import IndexReleaseManifest
from campus_ingestion_core.registry_scope_release import audit_published_scope_release
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
)
from llama_index.core.schema import TextNode
from qdrant_client.http import models as qdrant_models

from tests.ingestion.registry_scope_release_test_support import _FakeObjectStore


class RegistryScopeReleaseAuditAnswerReadyContractSuite:
    def test_post_publish_audit_reports_explicit_top_level_status_fields(self) -> None:
        class _FakeRemoteQdrant:
            def get_aliases(self):
                return SimpleNamespace(
                    aliases=[
                        SimpleNamespace(
                            alias_name="student_rules",
                            collection_name="student_rules__r20260501",
                        )
                    ]
                )

            def collection_exists(self, _collection_name: str) -> bool:
                return True

            def get_collection(self, collection_name: str):
                return SimpleNamespace(
                    points_count=1,
                    payload_schema={
                        "document_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "notice_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_notice_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_document_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "revision_track": qdrant_models.PayloadSchemaType.KEYWORD,
                        "version_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "corpus": qdrant_models.PayloadSchemaType.KEYWORD,
                        "collection": qdrant_models.PayloadSchemaType.KEYWORD,
                        "target_surface": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_program_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_scope": qdrant_models.PayloadSchemaType.KEYWORD,
                        "entitlement_groups": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_level": qdrant_models.PayloadSchemaType.KEYWORD,
                        "policy_projection_version": qdrant_models.PayloadSchemaType.KEYWORD,
                        "status": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_channel": qdrant_models.PayloadSchemaType.KEYWORD,
                        "is_current": qdrant_models.PayloadSchemaType.BOOL,
                    },
                )

            def scroll(self, **_kwargs):
                return [
                    SimpleNamespace(
                        payload={
                            "index_release_id": "r20260501",
                            "index_release_manifest_key": "manifest.json",
                            "index_release_alias": "student_rules",
                            "index_physical_collection_name": "student_rules__r20260501",
                        }
                    )
                ], None

        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", "manifest.json"): b"{}",
                ("campus-rag-derived", "validation.json"): b"{}",
                ("campus-rag-derived", "quality.json"): b"{}",
            }
        )
        manifest = IndexReleaseManifest(
            release_id="r20260501",
            corpus="regulations",
            collection="student_rules",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260501",
            previous_physical_collection_name=None,
            cleaning_policy_version="cleaning-v1",
            chunk_policy_version="chunk-v1",
            embedding_model="mock-embedding",
            indexed_at="2026-05-01T00:00:00+00:00",
            published_at="2026-05-01T00:01:00+00:00",
            document_count=1,
            point_count=1,
            document_version_ids_hash="hash",
            document_units_keys_hash="hash",
            validation_status="passed",
            validation_summary_object_key="validation.json",
            quality_gate_summary_object_key="quality.json",
        )

        audit = audit_published_scope_release(
            qdrant_client=_FakeRemoteQdrant(),
            object_store=object_store,
            bucket="campus-rag-derived",
            manifest=manifest,
            manifest_object_key="manifest.json",
            expected_release_metadata={
                "index_release_id": "r20260501",
                "index_release_manifest_key": "manifest.json",
                "index_release_alias": "student_rules",
                "index_physical_collection_name": "student_rules__r20260501",
            },
        )

        self.assertEqual(audit.status, "passed")
        self.assertEqual(audit.summary["release_drift_guard_status"], "passed")
        self.assertEqual(audit.summary["payload_index_audit_status"], "passed")
        self.assertEqual(audit.summary["required_filter_index_status"], "passed")

    def test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_provenance(
        self,
    ) -> None:
        class _FakeRemoteQdrant:
            def get_aliases(self):
                return SimpleNamespace(
                    aliases=[
                        SimpleNamespace(
                            alias_name="student_rules",
                            collection_name="student_rules__r20260501",
                        )
                    ]
                )

            def collection_exists(self, _collection_name: str) -> bool:
                return True

            def get_collection(self, collection_name: str):
                return SimpleNamespace(
                    points_count=1,
                    payload_schema={
                        "document_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "notice_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_notice_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_document_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "revision_track": qdrant_models.PayloadSchemaType.KEYWORD,
                        "version_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "corpus": qdrant_models.PayloadSchemaType.KEYWORD,
                        "collection": qdrant_models.PayloadSchemaType.KEYWORD,
                        "target_surface": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_program_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_scope": qdrant_models.PayloadSchemaType.KEYWORD,
                        "entitlement_groups": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_level": qdrant_models.PayloadSchemaType.KEYWORD,
                        "policy_projection_version": qdrant_models.PayloadSchemaType.KEYWORD,
                        "status": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_channel": qdrant_models.PayloadSchemaType.KEYWORD,
                        "is_current": qdrant_models.PayloadSchemaType.BOOL,
                    },
                )

            def scroll(self, **_kwargs):
                return [
                    SimpleNamespace(
                        payload={
                            "index_release_id": "r20260501",
                            "index_release_manifest_key": "manifest.json",
                            "index_release_alias": "student_rules",
                            "index_physical_collection_name": "student_rules__r20260501",
                            "answer_role": "eligibility_condition",
                            "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                            "parent_unit_id": "handbook:national-scholarship:article-9",
                            "condition_subject": "rank_threshold",
                            "condition_group_id": (
                                "handbook:national-scholarship:article-9:rank_threshold"
                            ),
                            "condition_subject_taxonomy_version": (
                                ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
                            ),
                            "condition_subject_provenance": "fallback:condition_subject",
                            "condition_polarity": "positive",
                        }
                    )
                ], None

        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", "manifest.json"): b"{}",
                ("campus-rag-derived", "validation.json"): b"{}",
                ("campus-rag-derived", "quality.json"): b"{}",
            }
        )
        manifest = IndexReleaseManifest(
            release_id="r20260501",
            corpus="regulations",
            collection="student_rules",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260501",
            previous_physical_collection_name=None,
            cleaning_policy_version="cleaning-v1",
            chunk_policy_version="chunk-v1",
            embedding_model="mock-embedding",
            indexed_at="2026-05-01T00:00:00+00:00",
            published_at="2026-05-01T00:01:00+00:00",
            document_count=1,
            point_count=1,
            document_version_ids_hash="hash",
            document_units_keys_hash="hash",
            validation_status="passed",
            validation_summary_object_key="validation.json",
            quality_gate_summary_object_key="quality.json",
        )

        audit = audit_published_scope_release(
            qdrant_client=_FakeRemoteQdrant(),
            object_store=object_store,
            bucket="campus-rag-derived",
            manifest=manifest,
            manifest_object_key="manifest.json",
            expected_release_metadata={
                "index_release_id": "r20260501",
                "index_release_manifest_key": "manifest.json",
                "index_release_alias": "student_rules",
                "index_physical_collection_name": "student_rules__r20260501",
            },
        )

        self.assertEqual(audit.status, "failed")
        self.assertIn(
            (
                "sample_1_answer_ready_disallowed_provenance:"
                "condition_subject_provenance=fallback:condition_subject"
            ),
            audit.summary["issues"],
        )

    def test_post_publish_audit_fails_when_runtime_node_metadata_drops_condition_group_id(
        self,
    ) -> None:
        class _FakeRemoteQdrant:
            def get_aliases(self):
                return SimpleNamespace(
                    aliases=[
                        SimpleNamespace(
                            alias_name="student_rules",
                            collection_name="student_rules__r20260501",
                        )
                    ]
                )

            def collection_exists(self, _collection_name: str) -> bool:
                return True

            def get_collection(self, collection_name: str):
                return SimpleNamespace(
                    points_count=1,
                    payload_schema={
                        "document_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "notice_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_notice_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_document_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "revision_track": qdrant_models.PayloadSchemaType.KEYWORD,
                        "version_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "corpus": qdrant_models.PayloadSchemaType.KEYWORD,
                        "collection": qdrant_models.PayloadSchemaType.KEYWORD,
                        "target_surface": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_program_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_scope": qdrant_models.PayloadSchemaType.KEYWORD,
                        "entitlement_groups": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_level": qdrant_models.PayloadSchemaType.KEYWORD,
                        "policy_projection_version": qdrant_models.PayloadSchemaType.KEYWORD,
                        "status": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_channel": qdrant_models.PayloadSchemaType.KEYWORD,
                        "is_current": qdrant_models.PayloadSchemaType.BOOL,
                    },
                )

            def scroll(self, **_kwargs):
                runtime_node = TextNode(
                    id_="point-1",
                    text="一等奖 3000元",
                    metadata={
                        "document_id": "handbook:professional-scholarship",
                        "revision_track": "current-effective",
                        "version_id": "v1",
                        "chunk_id": "chunk-1",
                        "collection": "student_rules",
                        "answer_role": "table_fact",
                        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                        "parent_unit_id": "handbook:professional-scholarship:table-1",
                        "condition_subject": "amount_or_quota",
                        "condition_subject_taxonomy_version": (
                            ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
                        ),
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_polarity": "positive",
                        "claim_type": "amount_or_quota",
                    },
                )
                return [
                    SimpleNamespace(
                        id="point-1",
                        payload={
                            "document_id": "handbook:professional-scholarship",
                            "revision_track": "current-effective",
                            "version_id": "v1",
                            "chunk_id": "chunk-1",
                            "collection": "student_rules",
                            "index_release_id": "r20260501",
                            "index_release_manifest_key": "manifest.json",
                            "index_release_alias": "student_rules",
                            "index_physical_collection_name": "student_rules__r20260501",
                            "answer_role": "table_fact",
                            "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                            "parent_unit_id": "handbook:professional-scholarship:table-1",
                            "condition_subject": "amount_or_quota",
                            "condition_subject_taxonomy_version": (
                                ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
                            ),
                            "condition_subject_provenance": "metadata:condition_subject",
                            "condition_group_id": (
                                "handbook:professional-scholarship:table-1:amount_or_quota"
                            ),
                            "condition_polarity": "positive",
                            "claim_type": "amount_or_quota",
                            "_node_content": runtime_node.model_dump_json(),
                        },
                    )
                ], None

        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", "manifest.json"): b"{}",
                ("campus-rag-derived", "validation.json"): b"{}",
                ("campus-rag-derived", "quality.json"): b"{}",
            }
        )
        manifest = IndexReleaseManifest(
            release_id="r20260501",
            corpus="regulations",
            collection="student_rules",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260501",
            previous_physical_collection_name=None,
            cleaning_policy_version="cleaning-v1",
            chunk_policy_version="chunk-v1",
            embedding_model="mock-embedding",
            indexed_at="2026-05-01T00:00:00+00:00",
            published_at="2026-05-01T00:01:00+00:00",
            document_count=1,
            point_count=1,
            document_version_ids_hash="hash",
            document_units_keys_hash="hash",
            validation_status="passed",
            validation_summary_object_key="validation.json",
            quality_gate_summary_object_key="quality.json",
        )

        audit = audit_published_scope_release(
            qdrant_client=_FakeRemoteQdrant(),
            object_store=object_store,
            bucket="campus-rag-derived",
            manifest=manifest,
            manifest_object_key="manifest.json",
            expected_release_metadata={
                "index_release_id": "r20260501",
                "index_release_manifest_key": "manifest.json",
                "index_release_alias": "student_rules",
                "index_physical_collection_name": "student_rules__r20260501",
            },
        )

        self.assertEqual(audit.status, "failed")
        self.assertIn(
            "sample_1_answer_ready_runtime_contract:answer_ready_condition_group_id_missing",
            audit.summary["issues"],
        )

    def test_post_publish_audit_fails_when_only_runtime_node_metadata_marks_target_v3_contract(
        self,
    ) -> None:
        class _FakeRemoteQdrant:
            def get_aliases(self):
                return SimpleNamespace(
                    aliases=[
                        SimpleNamespace(
                            alias_name="student_rules",
                            collection_name="student_rules__r20260501",
                        )
                    ]
                )

            def collection_exists(self, _collection_name: str) -> bool:
                return True

            def get_collection(self, collection_name: str):
                return SimpleNamespace(
                    points_count=1,
                    payload_schema={
                        "document_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "notice_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_notice_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_document_ids": qdrant_models.PayloadSchemaType.KEYWORD,
                        "revision_track": qdrant_models.PayloadSchemaType.KEYWORD,
                        "version_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "corpus": qdrant_models.PayloadSchemaType.KEYWORD,
                        "collection": qdrant_models.PayloadSchemaType.KEYWORD,
                        "target_surface": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_course_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "canonical_program_family_id": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_scope": qdrant_models.PayloadSchemaType.KEYWORD,
                        "entitlement_groups": qdrant_models.PayloadSchemaType.KEYWORD,
                        "visibility_level": qdrant_models.PayloadSchemaType.KEYWORD,
                        "policy_projection_version": qdrant_models.PayloadSchemaType.KEYWORD,
                        "status": qdrant_models.PayloadSchemaType.KEYWORD,
                        "source_channel": qdrant_models.PayloadSchemaType.KEYWORD,
                        "is_current": qdrant_models.PayloadSchemaType.BOOL,
                    },
                )

            def scroll(self, **_kwargs):
                runtime_node = TextNode(
                    id_="point-1",
                    text="一等奖 3000元",
                    metadata={
                        "document_id": "handbook:professional-scholarship",
                        "revision_track": "current-effective",
                        "version_id": "v1",
                        "chunk_id": "chunk-1",
                        "collection": "student_rules",
                        "answer_role": "table_fact",
                        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
                        "parent_unit_id": "handbook:professional-scholarship:table-1",
                        "condition_subject": "amount_or_quota",
                        "condition_subject_taxonomy_version": (
                            ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
                        ),
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_polarity": "positive",
                        "claim_type": "amount_or_quota",
                    },
                )
                return [
                    SimpleNamespace(
                        id="point-1",
                        payload={
                            "document_id": "handbook:professional-scholarship",
                            "revision_track": "current-effective",
                            "version_id": "v1",
                            "chunk_id": "chunk-1",
                            "collection": "student_rules",
                            "index_release_id": "r20260501",
                            "index_release_manifest_key": "manifest.json",
                            "index_release_alias": "student_rules",
                            "index_physical_collection_name": "student_rules__r20260501",
                            "_node_content": runtime_node.model_dump_json(),
                        },
                    )
                ], None

        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", "manifest.json"): b"{}",
                ("campus-rag-derived", "validation.json"): b"{}",
                ("campus-rag-derived", "quality.json"): b"{}",
            }
        )
        manifest = IndexReleaseManifest(
            release_id="r20260501",
            corpus="regulations",
            collection="student_rules",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260501",
            previous_physical_collection_name=None,
            cleaning_policy_version="cleaning-v1",
            chunk_policy_version="chunk-v1",
            embedding_model="mock-embedding",
            indexed_at="2026-05-01T00:00:00+00:00",
            published_at="2026-05-01T00:01:00+00:00",
            document_count=1,
            point_count=1,
            document_version_ids_hash="hash",
            document_units_keys_hash="hash",
            validation_status="passed",
            validation_summary_object_key="validation.json",
            quality_gate_summary_object_key="quality.json",
        )

        audit = audit_published_scope_release(
            qdrant_client=_FakeRemoteQdrant(),
            object_store=object_store,
            bucket="campus-rag-derived",
            manifest=manifest,
            manifest_object_key="manifest.json",
            expected_release_metadata={
                "index_release_id": "r20260501",
                "index_release_manifest_key": "manifest.json",
                "index_release_alias": "student_rules",
                "index_physical_collection_name": "student_rules__r20260501",
            },
        )

        self.assertEqual(audit.status, "failed")
        self.assertIn(
            "sample_1_answer_ready_runtime_contract:answer_ready_condition_group_id_missing",
            audit.summary["issues"],
        )
